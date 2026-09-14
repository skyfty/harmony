import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Serves the three.js DRACO / Basis (KTX2) decoder binaries from the installed
 * `three` package instead of committing them into the repo.
 *
 * dev:  `/three-decoders/<mount>/<file>` is served straight out of node_modules.
 * build: the same files are emitted into the output directory with identical names,
 *        so `import.meta.env.BASE_URL + 'three-decoders/...'` keeps working.
 */

const DECODER_MOUNTS = [
  {
    mount: 'draco',
    directory: 'examples/jsm/libs/draco',
    files: ['draco_wasm_wrapper.js', 'draco_decoder.wasm', 'draco_decoder.js'],
  },
  {
    mount: 'basis',
    directory: 'examples/jsm/libs/basis',
    files: ['basis_transcoder.js', 'basis_transcoder.wasm'],
  },
] as const

const MIME_BY_EXTENSION: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
}

export const DECODER_ASSET_MOUNT = '/three-decoders'

function resolveThreePackageRoot(): string {
  const require = createRequire(import.meta.url)
  // `three` is a direct dependency of the tools package: resolve its entry and
  // walk back to the package root.
  const entry = require.resolve('three')
  return resolve(dirname(entry), '..')
}

function collectDecoderFiles(threeRoot: string): Map<string, Map<string, string>> {
  const filesByMount = new Map<string, Map<string, string>>()

  for (const entry of DECODER_MOUNTS) {
    const directory = resolve(threeRoot, entry.directory)
    const files = new Map<string, string>()
    const available = new Set(readdirSync(directory))
    for (const name of entry.files) {
      if (!available.has(name)) {
        continue
      }
      files.set(name, join(directory, name))
    }
    filesByMount.set(entry.mount, files)
  }

  return filesByMount
}

export function threeDecoderAssets(options: { mountPath?: string } = {}): Plugin {
  const mountPath = (options.mountPath ?? DECODER_ASSET_MOUNT).replace(/\/+$/, '')
  const threeRoot = resolveThreePackageRoot()
  const filesByMount = collectDecoderFiles(threeRoot)

  return {
    name: 'harmony-three-decoder-assets',

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const rawUrl = request.url ?? ''
        const pathname = rawUrl.split('?')[0] ?? ''
        if (!pathname.startsWith(`${mountPath}/`)) {
          next()
          return
        }

        const relative = decodeURIComponent(pathname.slice(mountPath.length + 1))
        const separatorIndex = relative.indexOf('/')
        const mount = separatorIndex >= 0 ? relative.slice(0, separatorIndex) : relative
        const fileName = separatorIndex >= 0 ? relative.slice(separatorIndex + 1) : ''
        const absolutePath = filesByMount.get(mount)?.get(fileName)
        if (!absolutePath) {
          next()
          return
        }

        response.setHeader(
          'Content-Type',
          MIME_BY_EXTENSION[extname(absolutePath).toLowerCase()] ?? 'application/octet-stream',
        )
        response.setHeader('Cache-Control', 'no-cache')
        response.end(readFileSync(absolutePath))
      })
    },

    generateBundle() {
      for (const [mount, files] of filesByMount) {
        for (const [name, absolutePath] of files) {
          this.emitFile({
            type: 'asset',
            fileName: `${mountPath.replace(/^\//, '')}/${mount}/${name}`,
            source: readFileSync(absolutePath),
          })
        }
      }
    },
  }
}
