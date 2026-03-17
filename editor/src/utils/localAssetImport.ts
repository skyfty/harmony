import * as THREE from 'three'
import { createGltfLoader } from '@schema/loader'
import { createThumbnailFromCanvas, generateAssetThumbnail, ASSET_THUMBNAIL_HEIGHT, ASSET_THUMBNAIL_WIDTH } from '@/utils/assetThumbnail'
import { extractExtension } from '@/utils/blob'
import type { ProjectAsset, ProjectAssetMetadata, ProjectAssetModelStats } from '@/types/project-asset'

const IMAGE_ASSET_TYPES = new Set<ProjectAsset['type']>(['image', 'texture'])
const MODEL_ASSET_TYPES = new Set<ProjectAsset['type']>(['model', 'mesh', 'prefab'])

export type LocalAssetImportPhase = 'extract-metadata' | 'generate-thumbnail'

export interface PreparedLocalAssetImport {
  dimensionLength?: number | null
  dimensionWidth?: number | null
  dimensionHeight?: number | null
  imageWidth?: number | null
  imageHeight?: number | null
  metadata?: ProjectAssetMetadata | null
  thumbnailDataUrl?: string | null
}

export interface PrepareLocalAssetImportOptions {
  signal?: AbortSignal
  onPhase?: (phase: LocalAssetImportPhase) => void
}

export async function prepareLocalAssetImport(
  asset: ProjectAsset,
  file: File,
  options: PrepareLocalAssetImportOptions = {},
): Promise<PreparedLocalAssetImport> {
  assertNotAborted(options.signal)

  if (IMAGE_ASSET_TYPES.has(asset.type)) {
    options.onPhase?.('extract-metadata')
    const imageMeta = await readImageMetadata(file, options.signal)
    assertNotAborted(options.signal)

    options.onPhase?.('generate-thumbnail')
    const thumbnailFile = await generateAssetThumbnail({
      asset,
      file,
      width: ASSET_THUMBNAIL_WIDTH,
      height: ASSET_THUMBNAIL_HEIGHT,
    })

    return {
      imageWidth: imageMeta.width,
      imageHeight: imageMeta.height,
      thumbnailDataUrl: await readBlobAsDataUrl(thumbnailFile, options.signal),
    }
  }

  if (MODEL_ASSET_TYPES.has(asset.type) && isGltfLikeFile(file)) {
    options.onPhase?.('extract-metadata')
    const object = await loadModelObject(file, options.signal)

    try {
      assertNotAborted(options.signal)
      const dimensions = measureObjectDimensions(object)
      const modelStats = collectModelStats(object)

      options.onPhase?.('generate-thumbnail')
      const thumbnailFile = await renderModelThumbnail(asset, object, options.signal)

      return {
        dimensionLength: dimensions.length,
        dimensionWidth: dimensions.width,
        dimensionHeight: dimensions.height,
        metadata: { modelStats },
        thumbnailDataUrl: await readBlobAsDataUrl(thumbnailFile, options.signal),
      }
    } finally {
      disposeObject(object)
    }
  }

  options.onPhase?.('generate-thumbnail')
  try {
    const thumbnailFile = await generateAssetThumbnail({
      asset,
      file,
      width: ASSET_THUMBNAIL_WIDTH,
      height: ASSET_THUMBNAIL_HEIGHT,
    })
    return {
      thumbnailDataUrl: await readBlobAsDataUrl(thumbnailFile, options.signal),
    }
  } catch {
    return {}
  }
}

function isGltfLikeFile(file: File): boolean {
  const extension = extractExtension(file.name)?.toLowerCase()
  return extension === 'glb' || extension === 'gltf'
}

async function readImageMetadata(file: File, signal?: AbortSignal): Promise<{ width: number; height: number }> {
  assertNotAborted(signal)
  const objectUrl = URL.createObjectURL(file)
  const image = new Image()
  image.crossOrigin = 'anonymous'

  try {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const cleanup = () => {
        image.onload = null
        image.onerror = null
      }
      image.onload = () => {
        cleanup()
        resolve({
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
        })
      }
      image.onerror = () => {
        cleanup()
        reject(new Error('Failed to read image metadata'))
      }
      image.src = objectUrl
    })
    assertNotAborted(signal)
    return dimensions
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function loadModelObject(file: File, signal?: AbortSignal): Promise<THREE.Object3D> {
  assertNotAborted(signal)
  const extension = extractExtension(file.name)?.toLowerCase()
  const loader = await createGltfLoader()

  try {
    if (extension === 'glb') {
      const buffer = await file.arrayBuffer()
      assertNotAborted(signal)
      return await new Promise<THREE.Object3D>((resolve, reject) => {
        loader.parse(
          buffer,
          '',
          (result: { scene?: THREE.Object3D | null }) => resolve(result.scene ?? new THREE.Group()),
          (error: unknown) => reject(error instanceof Error ? error : new Error('Failed to parse GLB model')),
        )
      })
    }

    const contents = await file.text()
    assertNotAborted(signal)
    return await new Promise<THREE.Object3D>((resolve, reject) => {
      loader.parse(
        contents,
        '',
        (result: { scene?: THREE.Object3D | null }) => resolve(result.scene ?? new THREE.Group()),
        (error: unknown) => reject(error instanceof Error ? error : new Error('Failed to parse GLTF model')),
      )
    })
  } finally {
    loader.dracoLoader?.dispose?.()
    loader.ktx2Loader?.dispose?.()
  }
}

function measureObjectDimensions(object: THREE.Object3D): { length: number; width: number; height: number } {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  return {
    length: roundDimension(size.x),
    width: roundDimension(size.z),
    height: roundDimension(size.y),
  }
}

function roundDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  return Number.parseFloat(value.toFixed(3))
}

function collectModelStats(object: THREE.Object3D): ProjectAssetModelStats {
  let vertexCount = 0
  let faceCount = 0
  let meshCount = 0

  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) {
      return
    }
    meshCount += 1
    const geometry = mesh.geometry
    if (!(geometry instanceof THREE.BufferGeometry)) {
      return
    }
    const positionAttribute = geometry.getAttribute('position')
    if (positionAttribute) {
      vertexCount += positionAttribute.count
    }
    const index = geometry.getIndex()
    if (index) {
      faceCount += Math.floor(index.count / 3)
      return
    }
    if (positionAttribute) {
      faceCount += Math.floor(positionAttribute.count / 3)
    }
  })

  return { vertexCount, faceCount, meshCount }
}

async function renderModelThumbnail(asset: ProjectAsset, object: THREE.Object3D, signal?: AbortSignal): Promise<File> {
  assertNotAborted(signal)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x000000, 0)
  renderer.setSize(512, 512, false)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
  const ambient = new THREE.AmbientLight(0xffffff, 1.5)
  const directional = new THREE.DirectionalLight(0xffffff, 2)
  directional.position.set(5, 10, 7.5)
  const fill = new THREE.DirectionalLight(0xffffff, 1)
  fill.position.set(-5, 0, -5)

  scene.add(ambient)
  scene.add(directional)
  scene.add(fill)
  scene.add(object)

  try {
    fitCameraToObject(camera, object)
    renderer.render(scene, camera)
    assertNotAborted(signal)
    return await createThumbnailFromCanvas(asset, renderer.domElement, {
      width: ASSET_THUMBNAIL_WIDTH,
      height: ASSET_THUMBNAIL_HEIGHT,
    })
  } finally {
    scene.remove(object)
    renderer.dispose()
  }
}

function fitCameraToObject(camera: THREE.PerspectiveCamera, object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = THREE.MathUtils.degToRad(camera.fov)
  const distance = maxDim === 0 ? 5 : maxDim / (2 * Math.tan(fov / 2))
  const offset = distance * 1.4
  camera.position.set(center.x + offset, center.y + offset, center.z + offset)
  camera.near = Math.max(0.1, distance / 100)
  camera.far = distance * 100
  camera.lookAt(center)
  camera.updateProjectionMatrix()
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) {
      return
    }
    mesh.geometry?.dispose?.()
    const { material } = mesh
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose?.())
      return
    }
    material?.dispose?.()
  })
}

async function readBlobAsDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  assertNotAborted(signal)
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null
      if (!result) {
        reject(new Error('Failed to read generated thumbnail'))
        return
      }
      resolve(result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read generated thumbnail'))
    reader.readAsDataURL(blob)
  })
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Import aborted', 'AbortError')
  }
}
