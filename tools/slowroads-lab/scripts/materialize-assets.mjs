#!/usr/bin/env node
/**
 * Slow Roads Lab asset pipeline.
 *
 * The lab deliberately keeps the raw slowroads texture/model library OUT of git
 * (repo bloat + the final deployment downloads these from the asset server on
 * demand). This script materialises the runtime asset directory the lab loads
 * from and, in the same pass, produces the upload-ready asset bundle that
 * follows `schema/asset-api.ts` (`harmony-asset-bundle`):
 *
 *   tools/slowroads-lab/assets-src/           (gitignored, also the upload payload)
 *     ├─ *.png                                full-resolution textures
 *     ├─ *_@2048.png                          downscaled variants (long edge 2048)
 *     ├─ *.obj / *.treebin                    models (bin = compact, mp-friendly)
 *     ├─ catalog.json                         measured facts for every file (committed copy
 *     │                                       lives at src/core/assets-catalog.json)
 *     └─ asset-bundle.json                    AssetBundleManifest for admin upload
 *
 * Usage:
 *   node scripts/materialize-assets.mjs [--source <dir>] [--out <dir>] [--zip] [--quiet]
 *
 * Defaults: --source "D:\Downloads\新建文件夹", --out "./assets-src".
 * `--zip` additionally packs the directory into `slowroads-atlas-bundle.zip`
 * next to it (Windows: Compress-Archive, otherwise: `zip -r` if available).
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LAB_ROOT = resolve(HERE, '..')

const DEFAULT_SOURCE = 'D:\\Downloads\\新建文件夹'
const DEFAULT_OUT = join(LAB_ROOT, 'assets-src')
const CATALOG_COMMITTED_PATH = join(LAB_ROOT, 'src', 'core', 'assets-catalog.json')
/**
 * Files that are not part of the slowroads download folder but still ship with
 * the lab (currently only the wooden barrier rail, committed in the old
 * asset folder). They are copied into the runtime directory so the lab loads
 * everything through one pipeline.
 */
const SUPPLEMENT_DIR = join(LAB_ROOT, 'src', 'assets', 'slowroads')

/** Legacy atlases from the previous slowroads export; byte-identical to the four
 * files that shipped in src/assets before this refactor. Not part of the
 * seasonal slowroads library. */
const EXCLUDED_FILES = new Set(['草.png', '灌木.png', '阔叶.png', '针叶.png'])

const MAX_FULL_TEX_SIZE = 2048
const VARIANT_SUFFIX = '@2048'

// ---- fnv1a-64-compat (must match server/src/controllers/resourceController.ts) ----

function computeFnv1a64CompatHash(bytes) {
  let hash = 14695981039346656037n
  const prime = 1099511628211n
  const mask = (1n << 64n) - 1n
  for (let i = 0; i < bytes.length; i += 1) {
    hash = hash ^ BigInt(bytes[i])
    hash = (hash * prime) & mask
  }
  return `sha256-${hash.toString(16).padStart(16, '0')}`
}

// ---- PNG header reading (no deps) ----

function readPngSize(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('not a PNG file')
  }
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  return { width, height }
}

// ---- OBJ parsing ----

function parseObj(text) {
  const positions = []
  const uvs = []
  const normals = []
  const vertexMap = new Map()
  const outPositions = []
  const outUvs = []
  const outNormals = []
  const indices = []

  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (!line.length) continue
    const code = line.charCodeAt(0)
    if (code === 118 /* v */) {
      if (line.startsWith('v ')) {
        const p = line.split(/\s+/)
        positions.push(Number(p[1]), Number(p[2]), Number(p[3]))
      } else if (line.startsWith('vt ')) {
        const p = line.split(/\s+/)
        uvs.push(Number(p[1]), Number(p[2]))
      } else if (line.startsWith('vn ')) {
        const p = line.split(/\s+/)
        normals.push(Number(p[1]), Number(p[2]), Number(p[3]))
      }
      continue
    }
    if (code !== 102 /* f */ || !line.startsWith('f ')) continue
    const parts = line.split(/\s+/).slice(1)
    const face = []
    for (const part of parts) {
      const [vRaw, vtRaw, vnRaw] = part.split('/')
      const v = Number(vRaw)
      const vt = vtRaw && vtRaw.length ? Number(vtRaw) : null
      const vn = vnRaw && vnRaw.length ? Number(vnRaw) : null
      const key = `${v}/${vt ?? ''}/${vn ?? ''}`
      let index = vertexMap.get(key)
      if (index === undefined) {
        index = outPositions.length / 3
        vertexMap.set(key, index)
        outPositions.push(positions[(v - 1) * 3], positions[(v - 1) * 3 + 1], positions[(v - 1) * 3 + 2])
        if (vt) {
          outUvs.push(uvs[(vt - 1) * 2], uvs[(vt - 1) * 2 + 1])
        } else {
          outUvs.push(0, 0)
        }
        if (vn) {
          outNormals.push(normals[(vn - 1) * 3], normals[(vn - 1) * 3 + 1], normals[(vn - 1) * 3 + 2])
        } else {
          outNormals.push(0, 1, 0)
        }
      }
      face.push(index)
    }
    if (face.length < 3) continue
    for (let i = 1; i < face.length - 1; i += 1) {
      indices.push(face[0], face[i], face[i + 1])
    }
  }

  return {
    positions: Float32Array.from(outPositions),
    uvs: Float32Array.from(outUvs),
    normals: Float32Array.from(outNormals),
    indices: Uint32Array.from(indices),
    vertexCount: outPositions.length / 3,
    indexCount: indices.length,
  }
}

/**
 * SRTB v1 binary tree mesh (little-endian):
 *   u32 magic 'SRTB', u32 version(1), u32 vertexCount, u32 indexCount,
 *   u32 indexBits (16|32), f32 positions[3N], f32 normals[3N], f32 uvs[2N],
 *   indices (u16[] | u32[])
 */
function encodeTreeBin(mesh) {
  const indexBits = mesh.vertexCount > 65535 ? 32 : 16
  const header = 20
  const indexByteLength = mesh.indexCount * (indexBits / 8)
  const buffer = Buffer.alloc(header + mesh.vertexCount * (3 + 3 + 2) * 4 + indexByteLength)
  buffer.writeUInt32BE(0x53525442, 0) // 'SRTB'
  buffer.writeUInt32LE(1, 4)
  buffer.writeUInt32LE(mesh.vertexCount, 8)
  buffer.writeUInt32LE(mesh.indexCount, 12)
  buffer.writeUInt32LE(indexBits, 16)
  let offset = header
  for (const array of [mesh.positions, mesh.normals, mesh.uvs]) {
    for (let i = 0; i < array.length; i += 1) {
      buffer.writeFloatLE(array[i], offset)
      offset += 4
    }
  }
  for (let i = 0; i < mesh.indices.length; i += 1) {
    if (indexBits === 16) {
      buffer.writeUInt16LE(mesh.indices[i], offset)
      offset += 2
    } else {
      buffer.writeUInt32LE(mesh.indices[i], offset)
      offset += 4
    }
  }
  return buffer
}

// ---- CLI ----

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE, out: DEFAULT_OUT, zip: false, quiet: false }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--source') args.source = argv[++i]
    else if (token === '--out') args.out = argv[++i]
    else if (token === '--zip') args.zip = true
    else if (token === '--quiet') args.quiet = true
    else if (token === '--help' || token === '-h') {
      console.log('Usage: node scripts/materialize-assets.mjs [--source <dir>] [--out <dir>] [--zip] [--quiet]')
      process.exit(0)
    }
  }
  args.source = resolve(args.source)
  args.out = resolve(args.out)
  return args
}

function log(quiet, ...parts) {
  if (!quiet) console.log('[materialize]', ...parts)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.source)) {
    console.error(`[materialize] source directory not found: ${args.source}`)
    process.exit(1)
  }

  mkdirSync(args.out, { recursive: true })

  const readFileNames = (dir) =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
          .sort()
      : []

  const sourceEntries = readFileNames(args.source)
  const supplementEntries = readFileNames(SUPPLEMENT_DIR).filter((name) => !EXCLUDED_FILES.has(name))

  const pngFiles = sourceEntries.filter((name) => extname(name).toLowerCase() === '.png')
  const objFiles = sourceEntries.filter((name) => extname(name).toLowerCase() === '.obj')

  const excluded = []
  const files = []
  const logicalIdOf = (filename) => filename.replace(/\.(png|obj)$/i, '')

  const materializePng = async (name, from) => {
    const to = join(args.out, name)
    await copyFile(from, to)
    const buffer = readFileSync(to)
    const { width, height } = readPngSize(buffer)
    files.push({
      logicalId: logicalIdOf(name),
      file: name,
      kind: 'png',
      bytes: buffer.length,
      hash: computeFnv1a64CompatHash(buffer),
      width,
      height,
      rgbaBytes: width * height * 4,
    })

    // Downscaled variant for texture-size-capped devices (WeChat, old phones).
    const longEdge = Math.max(width, height)
    if (longEdge > MAX_FULL_TEX_SIZE) {
      const scale = MAX_FULL_TEX_SIZE / longEdge
      const targetW = Math.max(2, Math.round((width * scale) / 2) * 2)
      const targetH = Math.max(2, Math.round((height * scale) / 2) * 2)
      const variantName = `${basename(name, extname(name))}${VARIANT_SUFFIX}.png`
      const variantPath = join(args.out, variantName)
      try {
        execFileSync('ffmpeg', [
          '-y',
          '-loglevel',
          'error',
          '-i',
          to,
          '-vf',
          `scale=${targetW}:${targetH}:flags=lanczos,format=rgba`,
          '-pix_fmt',
          'rgba',
          variantPath,
        ], {
          stdio: ['ignore', 'ignore', 'pipe'],
        })
        const variantBuffer = readFileSync(variantPath)
        files.push({
          logicalId: logicalIdOf(variantName),
          file: variantName,
          kind: 'png',
          derivedFrom: logicalIdOf(name),
          variant: VARIANT_SUFFIX.slice(1),
          bytes: variantBuffer.length,
          hash: computeFnv1a64CompatHash(variantBuffer),
          width: targetW,
          height: targetH,
          rgbaBytes: targetW * targetH * 4,
        })
      } catch (error) {
        console.error(`[materialize] ffmpeg failed for ${name}: ${error instanceof Error ? error.message : error}`)
        process.exit(1)
      }
    }
  }

  for (const name of pngFiles) {
    if (EXCLUDED_FILES.has(name)) {
      excluded.push({ file: name, reason: 'legacy duplicate atlas (superseded by seasonal slowroads sets)' })
      continue
    }
    await materializePng(name, join(args.source, name))
  }

  for (const name of supplementEntries) {
    if (extname(name).toLowerCase() !== '.png') continue
    const logicalId = logicalIdOf(name)
    if (files.some((entry) => entry.logicalId === logicalId)) continue
    log(args.quiet, `supplement: ${name}`)
    await materializePng(name, join(SUPPLEMENT_DIR, name))
  }

  for (const name of objFiles) {
    const from = join(args.source, name)
    const to = join(args.out, name)
    await copyFile(from, to)
    const buffer = readFileSync(to)
    const mesh = parseObj(buffer.toString('utf8'))
    files.push({
      logicalId: logicalIdOf(name),
      file: name,
      kind: 'obj',
      bytes: buffer.length,
      hash: computeFnv1a64CompatHash(buffer),
      obj: { vertexCount: mesh.vertexCount, indexCount: mesh.indexCount, triangleCount: mesh.indexCount / 3 },
    })

    const binName = `${basename(name, extname(name))}.treebin`
    const binBuffer = encodeTreeBin(mesh)
    const binPath = join(args.out, binName)
    await writeFile(binPath, binBuffer)
    files.push({
      logicalId: logicalIdOf(binName),
      file: binName,
      kind: 'treebin',
      derivedFrom: logicalIdOf(name),
      bytes: binBuffer.length,
      hash: computeFnv1a64CompatHash(binBuffer),
      obj: { vertexCount: mesh.vertexCount, indexCount: mesh.indexCount, triangleCount: mesh.indexCount / 3 },
    })
  }

  files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))

  const generatedAt = new Date().toISOString()
  const catalog = {
    generatedAt,
    source: args.source,
    entryCount: files.length,
    totalBytes: files.reduce((sum, entry) => sum + entry.bytes, 0),
    files,
    excluded,
    notes: [
      'logicalId = source filename without extension (content hash kept in the filename).',
      'Slot/season usage lives in src/core/seasonCatalog.ts; this catalog only records measured facts.',
      'hash uses the server-compatible fnv1a-64-compat algorithm (sha256-<16 hex>).',
    ],
  }
  const catalogText = `${JSON.stringify(catalog, null, 2)}\n`
  writeFileSync(join(args.out, 'catalog.json'), catalogText, 'utf8')
  mkdirSync(dirname(CATALOG_COMMITTED_PATH), { recursive: true })
  writeFileSync(CATALOG_COMMITTED_PATH, catalogText, 'utf8')

  // Upload manifest: primary = the catalog itself; every texture/model is a
  // dependency addressed by logicalId, so the server returns an
  // assetIdMap { logicalId -> assetId } after import.
  const manifest = {
    format: 'harmony-asset-bundle',
    version: 1,
    bundleId: 'slowroads-atlas-v1',
    createdAt: generatedAt,
    primaryAsset: {
      logicalId: 'slowroads-atlas-catalog',
      name: 'Slow Roads 四季素材库',
      type: 'file',
      description: 'slowroads.io seasonal terrain / foliage / road texture library used by tools/slowroads-lab and the procedural landscape component.',
      dependencyLogicalIds: [],
      rewriteReferences: false,
    },
    files: [
      {
        logicalId: 'slowroads-atlas-catalog',
        path: 'catalog.json',
        filename: 'catalog.json',
        role: 'primary',
        assetType: 'file',
        mimeType: 'application/json',
        extension: 'json',
        hash: computeFnv1a64CompatHash(Buffer.from(catalogText, 'utf8')),
        hashAlgorithm: 'fnv1a-64-compat',
        size: Buffer.byteLength(catalogText, 'utf8'),
      },
      ...files.map((entry) => {
        const mimeType = entry.kind === 'png'
          ? 'image/png'
          : entry.kind === 'treebin'
            ? 'application/octet-stream'
            : 'model/obj'
        return {
          logicalId: entry.logicalId,
          path: entry.file,
          filename: entry.file,
          role: 'dependency',
          assetType: entry.kind === 'png' ? 'texture' : entry.kind === 'obj' ? 'model' : 'file',
          sourceLocalAssetId: entry.logicalId,
          mimeType,
          extension: extname(entry.file).slice(1),
          hash: entry.hash,
          hashAlgorithm: 'fnv1a-64-compat',
          size: entry.bytes,
          rewriteTarget: false,
        }
      }),
    ],
  }
  writeFileSync(join(args.out, 'asset-bundle.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  log(args.quiet, `${files.length} files, ${(catalog.totalBytes / 1024 / 1024).toFixed(1)} MB -> ${args.out}`)
  log(args.quiet, `excluded ${excluded.length} legacy files`)

  if (args.zip) {
    const zipPath = join(dirname(args.out), 'slowroads-atlas-bundle.zip')
    if (existsSync(zipPath)) rmSync(zipPath)
    try {
      if (process.platform === 'win32') {
        execFileSync('powershell.exe', [
          '-NoProfile',
          '-Command',
          `Compress-Archive -Path '${args.out}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal`,
        ], { stdio: 'inherit' })
      } else {
        execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: args.out, stdio: 'inherit' })
      }
      log(args.quiet, `zip -> ${zipPath}`)
    } catch (error) {
      console.error(`[materialize] zip step failed (directory output is still valid): ${error instanceof Error ? error.message : error}`)
    }
  }

  // Deterministic pass indicator for the idempotency check.
  const passHash = createHash('sha256')
    .update(files.map((entry) => `${entry.file}:${entry.hash}`).join('|'))
    .digest('hex')
    .slice(0, 12)
  log(args.quiet, `pass ${passHash}`)
  const stamp = statSync(join(args.out, 'catalog.json'))
  log(args.quiet, `catalog ${stamp.size} bytes`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
