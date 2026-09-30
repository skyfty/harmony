import * as THREE from 'three'
import { PagedSplats, SparkRenderer, SplatMesh, SplatFileType } from '@sparkjsdev/spark'

const SPARK_RENDERER_KEY = '__harmonySparkRenderer'

type SparkScene = THREE.Scene & { [SPARK_RENDERER_KEY]?: SparkRenderer }
type SparkSplatOwnership = { references: number; disposeSource: () => void }
const sparkSplatOwnership = new WeakMap<object, SparkSplatOwnership>()

function registerSparkSplat(splat: SplatMesh, ownership?: SparkSplatOwnership): void {
  const source = splat.paged ?? splat.packedSplats ?? splat.extSplats
  if (!source) {
    return
  }
  const state = ownership ?? sparkSplatOwnership.get(source) ?? {
    references: 0,
    disposeSource: splat.dispose.bind(splat),
  }
  sparkSplatOwnership.set(source, state)
  state.references += 1
  let disposed = false
  splat.dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    state.references = Math.max(0, state.references - 1)
    if (state.references === 0) {
      state.disposeSource()
      sparkSplatOwnership.delete(source)
    }
  }
}

export function registerSparkSplatResources(splat: SplatMesh): void {
  registerSparkSplat(splat)
}

/** Build a paged Spark RAD mesh; RAD LoD chunks are not exposed in numSplats until rendered. */
export async function createPagedRadSplat(bytes: ArrayBuffer, filename: string): Promise<SplatMesh> {
  const paged = new PagedSplats({
    fileBytes: new Uint8Array(bytes),
    fileType: SplatFileType.RAD,
  })
  try {
    const { meta } = await paged.getRadMeta()
    if (!Number.isSafeInteger(meta.count) || meta.count <= 0 || meta.chunks.length === 0) {
      throw new Error(`RAD 文件元数据无效或没有 splat 数据 (${filename})`)
    }
    if (meta.chunks.some((chunk) => Boolean(chunk.filename))) {
      throw new Error(`RAD 文件依赖外部 chunk 文件，不能单独导入 (${filename})；请导入整套 RAD 资源`)
    }
    const splat = new SplatMesh({ paged, lod: true })
    splat.name = filename
    splat.userData = {
      ...splat.userData,
      __harmonySparkSplat: true,
      __harmonySplatCount: meta.count,
      __harmonyLocalBounds: null,
    }
    splat.clone = (recursive = true) => cloneSparkSplat(splat, recursive)
    registerSparkSplatResources(splat)
    return splat
  } catch (error) {
    paged.dispose()
    throw error
  }
}

/** Attach Spark's renderer hook once to a Three.js scene. */
export function attachSparkRenderer(scene: THREE.Scene, renderer: THREE.WebGLRenderer): SparkRenderer {
  const sparkScene = scene as SparkScene
  if (sparkScene[SPARK_RENDERER_KEY]) {
    return sparkScene[SPARK_RENDERER_KEY]!
  }

  const sparkRenderer = new SparkRenderer({ renderer })
  sparkRenderer.name = 'HarmonySparkRenderer'
  sparkRenderer.userData.__harmonySparkRenderer = true
  sparkScene[SPARK_RENDERER_KEY] = sparkRenderer
  scene.add(sparkRenderer)
  return sparkRenderer
}

export function cloneSparkSplat(source: SplatMesh, recursive = true): SplatMesh {
  if (!source.packedSplats && !source.paged && !source.extSplats) {
    throw new Error('Spark splat asset has no shareable data source')
  }
  const sourceData = source.paged ?? source.packedSplats ?? source.extSplats!
  const cloned = source.paged
    ? new SplatMesh({ paged: source.paged })
    : source.packedSplats
      ? new SplatMesh({ packedSplats: source.packedSplats })
      : new SplatMesh({ extSplats: source.extSplats! })
  registerSparkSplat(cloned, sparkSplatOwnership.get(sourceData))
  cloned.name = source.name
  cloned.position.copy(source.position)
  cloned.quaternion.copy(source.quaternion)
  cloned.scale.copy(source.scale)
  cloned.visible = source.visible
  cloned.userData = { ...source.userData }
  if (recursive) {
    for (const child of source.children) {
      cloned.add(child.clone(true))
    }
  }
  cloned.clone = (nextRecursive = true) => cloneSparkSplat(cloned, nextRecursive)
  return cloned
}

/** Dispose Spark-owned GPU resources before the owning Three renderer is destroyed. */
export function disposeSparkScene(scene: THREE.Scene | null | undefined): void {
  if (!scene) {
    return
  }
  const sparkScene = scene as SparkScene
  const sparkRenderer = sparkScene[SPARK_RENDERER_KEY]
  if (sparkRenderer) {
    scene.remove(sparkRenderer)
    sparkRenderer.dispose()
    delete sparkScene[SPARK_RENDERER_KEY]
  }
  scene.traverse((object) => {
    disposeSparkObject(object)
  })
}

export function getSparkSplatBounds(object: THREE.Object3D): THREE.Box3 | null {
  const splat = object as SplatMesh
  if (!(splat instanceof SplatMesh) || !splat.isInitialized) {
    return null
  }
  try {
    const bounds = splat.getBoundingBox(false)
    return bounds.isEmpty() ? null : bounds
  } catch {
    return null
  }
}

export function disposeSparkObject(object: THREE.Object3D): void {
  const splat = object as SplatMesh
  if (!(splat instanceof SplatMesh)) {
    return
  }
  if (splat.userData?.__harmonySparkDisposed !== true) {
    splat.userData.__harmonySparkDisposed = true
    splat.dispose()
  }
}
