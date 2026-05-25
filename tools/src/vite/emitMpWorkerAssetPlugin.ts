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
      const sourceChunk = bundleValues.find((item): item is BundleChunkLike => {
        const chunk = item as BundleChunkLike | undefined
        if (!chunk) {
          return false
        }
        if (chunk.type !== 'chunk') {
          return false
        }
        return chunk.name.includes(options.sourceChunkName)
      })
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
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })

      const emittedAsset = Object.values(bundle).find((item): item is BundleAssetLike => {
        if (!item || item.type !== 'asset') {
          return false
        }
        return item.name === options.fileName || item.name?.includes(options.sourceChunkName) === true
      })

      if (typeof emittedAsset?.source === 'string') {
        fs.writeFileSync(targetPath, emittedAsset.source)
        return
      }

      if (emittedAsset?.source instanceof Uint8Array) {
        fs.writeFileSync(targetPath, emittedAsset.source)
        return
      }

      const assetsDir = path.resolve(outputOptions.dir, 'assets')
      if (!fs.existsSync(assetsDir)) {
        return
      }

      const sourceFile = fs
        .readdirSync(assetsDir)
        .find((name: string) => /^instancedLodCulling\.worker-.*\.js$/.test(name))
      if (!sourceFile) {
        return
      }

      fs.copyFileSync(path.join(assetsDir, sourceFile), targetPath)
    },
  }
}
