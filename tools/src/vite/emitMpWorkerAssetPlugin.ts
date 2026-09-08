import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

type EmitMpWorkerAssetPluginOptions = {
  sourceChunkName: string
  fileName: string
}

type BundleChunkLike = {
  type: 'chunk'
  name: string
  code: string
}

type BundleAssetLike = {
  type: 'asset'
  name?: string
  source?: string | Uint8Array
}

type BundleValueLike = BundleChunkLike | BundleAssetLike | undefined
type BundleLike = Record<string, BundleValueLike>

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function removeDuplicateMpWorkerAssets(outputDir: string, targetBaseName: string): void {
  const assetsDir = path.resolve(outputDir, 'assets')
  if (!fs.existsSync(assetsDir)) {
    return
  }
  const expectedPattern = new RegExp(`^${escapeRegExp(targetBaseName)}-.*\\.js$`)
  fs.readdirSync(assetsDir).forEach((name: string) => {
    if (!expectedPattern.test(name)) {
      return
    }
    try {
      fs.unlinkSync(path.join(assetsDir, name))
    } catch (error) {
      console.warn(`[harmony-worker] failed to remove duplicate worker asset ${name}`, error)
    }
  })
}

export function emitMpWorkerAssetPlugin(options: EmitMpWorkerAssetPluginOptions): Plugin {
  const isMp = process.env.UNI_PLATFORM?.startsWith('mp-') ?? false
  return {
    name: 'harmony:emit-mp-worker-asset',
    apply: 'build',
    generateBundle(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: string }) => string }, _options: unknown, bundle: BundleLike) {
      if (!isMp) {
        return
      }

      const bundleValues = Object.values(bundle) as BundleValueLike[]
      const sourceChunkKey = Object.keys(bundle).find((key) => {
        const chunk = bundle[key] as BundleChunkLike | undefined
        return Boolean(chunk && chunk.type === 'chunk' && chunk.name.includes(options.sourceChunkName))
      })
      const sourceChunk = sourceChunkKey ? bundle[sourceChunkKey] as BundleChunkLike | undefined : undefined
      if (!sourceChunk) {
        return
      }

      this.emitFile({
        type: 'asset',
        fileName: options.fileName,
        source: sourceChunk.code,
      })
    },
    writeBundle(outputOptions: { dir?: string }, bundle: BundleLike) {
      if (!isMp || !outputOptions.dir) {
        return
      }

      const targetPath = path.resolve(outputOptions.dir, options.fileName)
      const targetBaseName = path.basename(options.fileName, path.extname(options.fileName))
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })

      const emittedAsset = Object.values(bundle).find((item): item is BundleAssetLike => {
        if (!item || item.type !== 'asset') {
          return false
        }
        return item.name === options.fileName || item.name?.includes(options.sourceChunkName) === true
      })

      if (typeof emittedAsset?.source === 'string') {
        fs.writeFileSync(targetPath, emittedAsset.source)
        removeDuplicateMpWorkerAssets(outputOptions.dir, targetBaseName)
        return
      }

      if (emittedAsset?.source instanceof Uint8Array) {
        fs.writeFileSync(targetPath, emittedAsset.source)
        removeDuplicateMpWorkerAssets(outputOptions.dir, targetBaseName)
        return
      }

      const assetsDir = path.resolve(outputOptions.dir, 'assets')
      const expectedPattern = new RegExp(`^${escapeRegExp(targetBaseName)}-.*\\.js$`)
      const sourceFile = fs.existsSync(assetsDir)
        ? fs
          .readdirSync(assetsDir)
          .find((name: string) => expectedPattern.test(name))
        : undefined
      if (sourceFile) {
        fs.copyFileSync(path.join(assetsDir, sourceFile), targetPath)
      }
      removeDuplicateMpWorkerAssets(outputOptions.dir, targetBaseName)
    },
  }
}
