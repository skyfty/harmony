import Pica from 'pica'
import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { getLastExtensionFromFilenameOrUrl, isSkyCubeArchiveExtension } from '@schema/assetTypeConversion'
import { disposeSkyCubeTexture, extractSkycubeZipFaces, loadSkyCubeTexture } from '@schema/skyCubeTexture'
import type { ProjectAsset } from '@/types/project-asset'
import { usesTransparentThumbnailBackground } from '@/utils/assetThumbnailTransparency'

const IMAGE_ASSET_TYPES = new Set<ProjectAsset['type']>(['image'])
const TEXTURE_ASSET_TYPES = new Set<ProjectAsset['type']>(['texture'])
const MODEL_ASSET_TYPES = new Set<ProjectAsset['type']>(['model', 'mesh', 'prefab'])
const HDRI_ASSET_TYPES = new Set<ProjectAsset['type']>(['hdri'])

const DEFAULT_BACKGROUND = '#161b22'
const IMAGE_OUTPUT_TYPE = 'image/jpeg'
const IMAGE_OUTPUT_QUALITY = 0.9
const MODEL_OUTPUT_TYPE = 'image/png'
const ALPHA_THRESHOLD = 10
const MODEL_MARGIN_RATIO = 0.08
const FAST_HDR_KTX2_TRANSCODER_PATH = 'https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/libs/basis/'

const thumbnailResizer = typeof window !== 'undefined' ? Pica() : null
type KTX2LoaderClass = new (manager?: THREE.LoadingManager) => KTX2Loader

let ktx2LoaderClassPromise: Promise<KTX2LoaderClass> | null = null
let ktx2LoaderInstance: KTX2Loader | null = null

export const ASSET_THUMBNAIL_WIDTH = 192
export const ASSET_THUMBNAIL_HEIGHT = 96

export interface GenerateThumbnailOptions {
  asset: ProjectAsset
  file: File
  width?: number
  height?: number
}

export async function generateAssetThumbnail(options: GenerateThumbnailOptions): Promise<File> {
  const width = Math.max(1, Math.round(options.width ?? ASSET_THUMBNAIL_WIDTH))
  const height = Math.max(1, Math.round(options.height ?? ASSET_THUMBNAIL_HEIGHT))

  if (typeof document === 'undefined') {
    throw new Error('Thumbnail generation requires a browser environment')
  }

  if (HDRI_ASSET_TYPES.has(options.asset.type)) {
    const blob = await generateHdriThumbnail(options.file, width, height)
    return blobToFile(blob, buildThumbnailFilename(options.asset, 'jpg'))
  }

  if (isSkycubeArchiveFile(options.asset, options.file)) {
    const blob = await generateSkycubeThumbnail(options.file, width, height)
    return blobToFile(blob, buildThumbnailFilename(options.asset, 'jpg'))
  }

  if (TEXTURE_ASSET_TYPES.has(options.asset.type)) {
    if (isKtx2File(options.file)) {
      const textureThumbnail = await generateKtx2TextureThumbnail(options.asset, options.file, width, height)
      return textureThumbnail.thumbnailFile
    }

    const blob = await generateImageThumbnail(options.file, width, height)
    return blobToFile(blob, buildThumbnailFilename(options.asset, 'jpg'))
  }

  if (IMAGE_ASSET_TYPES.has(options.asset.type)) {
    const blob = await generateImageThumbnail(options.file, width, height)
    return blobToFile(blob, buildThumbnailFilename(options.asset, 'jpg'))
  }

  // Model thumbnails should be captured from the preview renderer, but fall back to a placeholder when invoked here.
  if (MODEL_ASSET_TYPES.has(options.asset.type)) {
    const blob = await generateDefaultThumbnail(options.asset, width, height)
    return blobToFile(blob, buildThumbnailFilename(options.asset, 'png'))
  }

  const blob = await generateDefaultThumbnail(options.asset, width, height)
  return blobToFile(blob, buildThumbnailFilename(options.asset, 'png'))
}

export interface TextureThumbnailData {
  imageWidth: number
  imageHeight: number
  thumbnailFile: File
}

export interface CanvasThumbnailOptions {
  width?: number
  height?: number
  marginRatio?: number
}

export async function createThumbnailFromCanvas(
  asset: ProjectAsset,
  canvas: HTMLCanvasElement,
  options: CanvasThumbnailOptions = {},
): Promise<File> {
  const targetWidth = Math.max(1, Math.round(options.width ?? ASSET_THUMBNAIL_WIDTH))
  const targetHeight = Math.max(1, Math.round(options.height ?? ASSET_THUMBNAIL_HEIGHT))
  const marginRatio = typeof options.marginRatio === 'number' ? Math.max(0, options.marginRatio) : MODEL_MARGIN_RATIO

  const working = cloneCanvas(canvas)
  const bounds = extractOpaqueBounds(working, ALPHA_THRESHOLD)
  const expanded = expandBounds(bounds, working.width, working.height, marginRatio)
  const cropped = cropCanvas(working, expanded)
  const finalCanvas = renderToTargetCanvas(cropped, targetWidth, targetHeight)
  const blob = await canvasToBlob(finalCanvas, MODEL_OUTPUT_TYPE)
  return blobToFile(blob, buildThumbnailFilename(asset, 'png'))
}

async function generateImageThumbnail(file: File, width: number, height: number): Promise<Blob> {
  const image = await loadImageElement(file)
  if (!image.width || !image.height) {
    throw new Error('Image does not contain dimension data')
  }
  const targetRatio = width / height
  const imageRatio = image.width / image.height

  let cropWidth = image.width
  let cropHeight = image.height
  let offsetX = 0
  let offsetY = 0

  if (imageRatio > targetRatio) {
    cropHeight = image.height
    cropWidth = Math.round(cropHeight * targetRatio)
    offsetX = Math.round((image.width - cropWidth) / 2)
  } else if (imageRatio < targetRatio) {
    cropWidth = image.width
    cropHeight = Math.round(cropWidth / targetRatio)
    offsetY = Math.round((image.height - cropHeight) / 2)
  }

  const sourceCanvas = ensureCanvas(Math.max(1, cropWidth), Math.max(1, cropHeight))
  const sourceContext = sourceCanvas.getContext('2d')
  if (!sourceContext) {
    throw new Error('Unable to create drawing context')
  }
  sourceContext.drawImage(image, offsetX, offsetY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)

  const targetCanvas = ensureCanvas(width, height)
  if (thumbnailResizer) {
    await thumbnailResizer.resize(sourceCanvas, targetCanvas, { alpha: false })
  } else {
    const targetContext = targetCanvas.getContext('2d')
    targetContext?.drawImage(sourceCanvas, 0, 0, width, height)
  }

  return canvasToBlob(targetCanvas, IMAGE_OUTPUT_TYPE, IMAGE_OUTPUT_QUALITY)
}

export async function generateKtx2TextureThumbnail(
  asset: ProjectAsset,
  file: File,
  width: number,
  height: number,
): Promise<TextureThumbnailData> {
  if (!isKtx2File(file)) {
    throw new Error('Unsupported texture format')
  }

  const textureResult = await loadKtx2Texture(file)
  try {
    const thumbnailFile = await renderTextureThumbnail(asset, textureResult.texture, width, height)
    return {
      imageWidth: textureResult.imageWidth,
      imageHeight: textureResult.imageHeight,
      thumbnailFile,
    }
  } finally {
    textureResult.texture.dispose()
  }
}

async function generateDefaultThumbnail(asset: ProjectAsset, width: number, height: number): Promise<Blob> {
  const canvas = ensureCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to create drawing context')
  }

  const transparentBackground = usesTransparentThumbnailBackground(asset)
  if (!transparentBackground) {
    const baseColor = resolvePreviewColor(asset)
    const gradient = context.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, blendColor(baseColor, '#ffffff', 0.25))
    gradient.addColorStop(1, baseColor)
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
  } else {
    context.clearRect(0, 0, width, height)
  }

  context.fillStyle = transparentBackground ? 'rgba(255, 255, 255, 0.82)' : 'rgba(255, 255, 255, 0.88)'
  context.shadowColor = transparentBackground ? 'rgba(0, 0, 0, 0.42)' : 'transparent'
  context.shadowBlur = transparentBackground ? Math.max(4, Math.round(height * 0.08)) : 0
  context.font = `700 ${Math.round(height * 0.42)}px "Inter", "Segoe UI", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const label = asset.type.toUpperCase().slice(0, 3)
  context.fillText(label, width / 2, height / 2)

  return canvasToBlob(canvas, MODEL_OUTPUT_TYPE)
}

async function renderTextureThumbnail(
  asset: ProjectAsset,
  texture: THREE.Texture,
  width: number,
  height: number,
): Promise<File> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(0x000000, 0)
  renderer.setSize(512, 512, false)

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0.1, 10)
  camera.position.z = 2

  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true })
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
  const { width: textureWidth, height: textureHeight } = resolveTextureDimensions(texture)
  const textureAspect = textureWidth > 0 && textureHeight > 0 ? textureWidth / textureHeight : 1
  if (textureAspect >= 1) {
    plane.scale.set(textureAspect, 1, 1)
  } else {
    plane.scale.set(1, 1 / Math.max(textureAspect, 1e-6), 1)
  }
  scene.add(plane)

  try {
    renderer.render(scene, camera)
    return await createThumbnailFromCanvas(asset, renderer.domElement, { width, height })
  } finally {
    plane.geometry.dispose()
    material.dispose()
    scene.remove(plane)
    renderer.dispose()
    if (typeof renderer.forceContextLoss === 'function') {
      renderer.forceContextLoss()
    }
  }
}

export async function loadKtx2Texture(file: File): Promise<{ texture: THREE.Texture; imageWidth: number; imageHeight: number }> {
  if (typeof document === 'undefined') {
    throw new Error('KTX2 thumbnail generation requires a browser environment')
  }

  const objectUrl = URL.createObjectURL(file)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace

  try {
    const loader = await createKtx2Loader(renderer)
    if (!loader) {
      throw new Error('Failed to initialize KTX2 loader')
    }
    const texture = await loader.loadAsync(objectUrl)
    const dimensions = resolveTextureDimensions(texture)
    return {
      texture,
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
    renderer.dispose()
    if (typeof renderer.forceContextLoss === 'function') {
      renderer.forceContextLoss()
    }
  }
}

export async function createKtx2Loader(renderer: THREE.WebGLRenderer): Promise<KTX2Loader | null> {
  if (typeof window === 'undefined') {
    return null
  }

  if (!ktx2LoaderClassPromise) {
    ktx2LoaderClassPromise = import('three/examples/jsm/loaders/KTX2Loader.js').then(
      (module) => module.KTX2Loader as KTX2LoaderClass,
    )
  }

  const LoaderClass = await ktx2LoaderClassPromise
  if (!ktx2LoaderInstance) {
    ktx2LoaderInstance = new LoaderClass().setTranscoderPath(FAST_HDR_KTX2_TRANSCODER_PATH).detectSupport(renderer)
  }
  return ktx2LoaderInstance
}

function resolveTextureDimensions(texture: THREE.Texture): { width: number; height: number } {
  const image = texture.image as { width?: number; height?: number } | undefined
  const sourceData = texture.source?.data as { width?: number; height?: number } | undefined
  const width = image?.width ?? sourceData?.width ?? 0
  const height = image?.height ?? sourceData?.height ?? 0
  return {
    width: width > 0 ? width : 1,
    height: height > 0 ? height : 1,
  }
}

function isKtx2File(file: File): boolean {
  return file.name.toLowerCase().endsWith('.ktx2') || file.type.toLowerCase().includes('ktx2')
}

async function generateHdriThumbnail(file: File, width: number, height: number): Promise<Blob> {
  if (typeof window === 'undefined') {
    throw new Error('HDRI thumbnail generation requires a browser environment')
  }

  const url = URL.createObjectURL(file)
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  const renderScale = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(renderScale)
  renderer.setSize(width, height, false)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 50)
  camera.position.set(0, 1.05, 3.2)
  camera.lookAt(0, 0.8, 0)

  const disposeStack: Array<() => void> = []

  try {
    const loader = new RGBELoader().setDataType(THREE.FloatType)
    const texture = await loader.loadAsync(url)
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.LinearSRGBColorSpace
    scene.background = texture
    disposeStack.push(() => {
      scene.background = null
      texture.dispose()
    })

    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    pmremGenerator.compileEquirectangularShader()
    const envTarget = pmremGenerator.fromEquirectangular(texture)
    const envTexture = envTarget.texture
    scene.environment = envTexture
    disposeStack.push(() => {
      scene.environment = null
      envTexture.dispose()
      envTarget.dispose()
      pmremGenerator.dispose()
    })

    const ambient = new THREE.AmbientLight(0xffffff, 0.25)
    scene.add(ambient)
    disposeStack.push(() => {
      scene.remove(ambient)
    })

    const demoGroup = new THREE.Group()
    demoGroup.rotation.y = -Math.PI / 10

    const sphereGeometry = new THREE.SphereGeometry(0.9, 64, 64)
    const sphereMaterial = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.1, envMapIntensity: 1.2 })
    sphereMaterial.envMap = envTexture
    sphereMaterial.needsUpdate = true
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
    sphere.position.set(-0.95, 0.8, 0)
    demoGroup.add(sphere)
    disposeStack.push(() => {
      sphereGeometry.dispose()
      sphereMaterial.dispose()
    })

    const boxGeometry = new THREE.BoxGeometry(1.2, 1.2, 1.2)
    const boxMaterial = new THREE.MeshStandardMaterial({ metalness: 0.25, roughness: 0.35, envMapIntensity: 1 })
    boxMaterial.envMap = envTexture
    boxMaterial.needsUpdate = true
    const box = new THREE.Mesh(boxGeometry, boxMaterial)
    box.position.set(1.05, 0.6, 0)
    demoGroup.add(box)
    disposeStack.push(() => {
      boxGeometry.dispose()
      boxMaterial.dispose()
    })

    const groundGeometry = new THREE.CircleGeometry(4.5, 64)
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0, roughness: 1 })
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.05
    demoGroup.add(ground)
    disposeStack.push(() => {
      groundGeometry.dispose()
      groundMaterial.dispose()
    })

    scene.add(demoGroup)
    disposeStack.push(() => {
      scene.remove(demoGroup)
    })

    renderer.render(scene, camera)

    const sourceCanvas = renderer.domElement
    const targetCanvas = ensureCanvas(width, height)
    if (thumbnailResizer) {
      await thumbnailResizer.resize(sourceCanvas, targetCanvas, { alpha: false })
    } else {
      const targetContext = targetCanvas.getContext('2d')
      targetContext?.drawImage(sourceCanvas, 0, 0, width, height)
    }

    const blob = await canvasToBlob(targetCanvas, IMAGE_OUTPUT_TYPE, IMAGE_OUTPUT_QUALITY)
    return blob
  } catch (error) {
    throw new Error((error as Error).message || 'Failed to render HDRI thumbnail')
  } finally {
    disposeStack.reverse().forEach((dispose) => {
      try {
        dispose()
      } catch (error) {
        console.warn('HDRI thumbnail cleanup failed', error)
      }
    })
    renderer.dispose()
    if (typeof renderer.forceContextLoss === 'function') {
      renderer.forceContextLoss()
    }
    URL.revokeObjectURL(url)
  }
}

function isSkycubeArchiveFile(asset: ProjectAsset, file: File): boolean {
  if (asset.type !== 'file') {
    return false
  }
  const extension = getLastExtensionFromFilenameOrUrl(file.name || asset.name || asset.downloadUrl || asset.id)
  return isSkyCubeArchiveExtension(extension)
}

function buildObjectUrlsFromSkycubeZipFaces(
  facesInOrder: ReadonlyArray<ReturnType<typeof extractSkycubeZipFaces>['facesInOrder'][number]>,
): { urls: Array<string | null>; dispose: () => void } {
  const urls: Array<string | null> = []
  const created: string[] = []
  for (const face of facesInOrder) {
    if (!face) {
      urls.push(null)
      continue
    }
    const mimeType = face.mimeType ?? 'application/octet-stream'
    const bytes = face.bytes as unknown as Uint8Array<ArrayBuffer>
    const blob = new Blob([bytes], { type: mimeType })
    const url = URL.createObjectURL(blob)
    created.push(url)
    urls.push(url)
  }
  return {
    urls,
    dispose: () => {
      for (const url of created) {
        try {
          URL.revokeObjectURL(url)
        } catch (_error) {
          // ignore
        }
      }
    },
  }
}

async function generateSkycubeThumbnail(file: File, width: number, height: number): Promise<Blob> {
  if (typeof window === 'undefined') {
    throw new Error('SkyCube thumbnail generation requires a browser environment')
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  const renderScale = Math.min(window.devicePixelRatio || 1, 2)
  renderer.setPixelRatio(renderScale)
  renderer.setSize(width, height, false)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 50)
  camera.position.set(0, 1.05, 3.2)
  camera.lookAt(0, 0.8, 0)

  const disposeStack: Array<() => void> = []
  let skyCubeTexture: THREE.CubeTexture | null = null
  let faceUrlCleanup: (() => void) | null = null

  try {
    const buffer = await file.arrayBuffer()
    const extracted = extractSkycubeZipFaces(buffer)
    const facesResult = buildObjectUrlsFromSkycubeZipFaces(extracted.facesInOrder)
    faceUrlCleanup = facesResult.dispose
    const loaded = await loadSkyCubeTexture(facesResult.urls)
    if (!loaded.texture) {
      throw new Error(loaded.error || 'Failed to load skycube texture')
    }
    skyCubeTexture = loaded.texture
    scene.background = skyCubeTexture

    const pmremGenerator = new THREE.PMREMGenerator(renderer)
    pmremGenerator.compileCubemapShader()
    const envTarget = pmremGenerator.fromCubemap(skyCubeTexture)
    const envTexture = envTarget.texture
    scene.environment = envTexture
    disposeStack.push(() => {
      scene.environment = null
      envTexture.dispose()
      envTarget.dispose()
      pmremGenerator.dispose()
    })

    const ambient = new THREE.AmbientLight(0xffffff, 0.25)
    scene.add(ambient)
    disposeStack.push(() => {
      scene.remove(ambient)
    })

    const demoGroup = new THREE.Group()
    demoGroup.rotation.y = -Math.PI / 10

    const sphereGeometry = new THREE.SphereGeometry(0.9, 64, 64)
    const sphereMaterial = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.1, envMapIntensity: 1.2 })
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
    sphere.position.set(-0.95, 0.8, 0)
    demoGroup.add(sphere)
    disposeStack.push(() => {
      sphereGeometry.dispose()
      sphereMaterial.dispose()
    })

    const boxGeometry = new THREE.BoxGeometry(1.2, 1.2, 1.2)
    const boxMaterial = new THREE.MeshStandardMaterial({ metalness: 0.25, roughness: 0.35, envMapIntensity: 1 })
    const box = new THREE.Mesh(boxGeometry, boxMaterial)
    box.position.set(1.05, 0.6, 0)
    demoGroup.add(box)
    disposeStack.push(() => {
      boxGeometry.dispose()
      boxMaterial.dispose()
    })

    const groundGeometry = new THREE.CircleGeometry(4.5, 64)
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0, roughness: 1 })
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.05
    demoGroup.add(ground)
    disposeStack.push(() => {
      groundGeometry.dispose()
      groundMaterial.dispose()
    })

    scene.add(demoGroup)
    disposeStack.push(() => {
      scene.remove(demoGroup)
    })

    renderer.render(scene, camera)

    const sourceCanvas = renderer.domElement
    const targetCanvas = ensureCanvas(width, height)
    if (thumbnailResizer) {
      await thumbnailResizer.resize(sourceCanvas, targetCanvas, { alpha: false })
    } else {
      const targetContext = targetCanvas.getContext('2d')
      targetContext?.drawImage(sourceCanvas, 0, 0, width, height)
    }

    return await canvasToBlob(targetCanvas, IMAGE_OUTPUT_TYPE, IMAGE_OUTPUT_QUALITY)
  } catch (error) {
    throw new Error((error as Error).message || 'Failed to render SkyCube thumbnail')
  } finally {
    disposeStack.reverse().forEach((dispose) => {
      try {
        dispose()
      } catch (error) {
        console.warn('SkyCube thumbnail cleanup failed', error)
      }
    })
    disposeSkyCubeTexture(skyCubeTexture)
    faceUrlCleanup?.()
    renderer.dispose()
    if (typeof renderer.forceContextLoss === 'function') {
      renderer.forceContextLoss()
    }
  }
}

function ensureCanvas(width: number, height: number): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('Canvas is not available in this environment')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

async function loadImageElement(file: File): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    const cleanup = () => {
      URL.revokeObjectURL(url)
      image.onload = null
      image.onerror = null
    }
    image.onload = () => {
      cleanup()
      resolve(image)
    }
    image.onerror = () => {
      cleanup()
      reject(new Error('Failed to read image file'))
    }
    image.src = url
  })
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  if (thumbnailResizer?.toBlob) {
    return thumbnailResizer.toBlob(canvas, type, quality)
  }
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
        return
      }
      reject(new Error('Failed to encode thumbnail'))
    }, type, quality)
  })
}

function blobToFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: blob.type || 'application/octet-stream' })
}

function sanitizeFilenameSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
  return normalized || 'asset'
}

function buildThumbnailFilename(asset: ProjectAsset, extension: string): string {
  const source = asset.name?.trim().length ? asset.name : asset.id
  const segment = sanitizeFilenameSegment(source)
  return `${segment}-thumb.${extension}`
}

function resolvePreviewColor(asset: ProjectAsset): string {
  const candidates = [asset.color, asset.previewColor, DEFAULT_BACKGROUND]
  const match = candidates.find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  return match ?? DEFAULT_BACKGROUND
}

function blendColor(base: string, target: string, ratio: number): string {
  const clamped = Math.min(Math.max(ratio, 0), 1)
  const baseRgb = hexToRgb(base)
  const targetRgb = hexToRgb(target)
  if (!baseRgb || !targetRgb) {
    return base
  }
  const mix = {
    r: Math.round(baseRgb.r + (targetRgb.r - baseRgb.r) * clamped),
    g: Math.round(baseRgb.g + (targetRgb.g - baseRgb.g) * clamped),
    b: Math.round(baseRgb.b + (targetRgb.b - baseRgb.b) * clamped),
  }
  return rgbToHex(mix)
}

function hexToRgb(value: string): { r: number; g: number; b: number } | null {
  const normalized = value?.trim().replace('#', '') ?? ''
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null
  }
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const toHex = (component: number) => component.toString(16).padStart(2, '0')
  return `#${toHex(clamp255(rgb.r))}${toHex(clamp255(rgb.g))}${toHex(clamp255(rgb.b))}`
}

function clamp255(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(255, Math.round(value)))
}

function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = ensureCanvas(source.width, source.height)
  const context = canvas.getContext('2d')
  context?.drawImage(source, 0, 0)
  return canvas
}

type Bounds = { x: number; y: number; width: number; height: number }

function extractOpaqueBounds(canvas: HTMLCanvasElement, threshold: number): Bounds {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height }
  }
  const { width, height } = canvas
  const data = context.getImageData(0, 0, width, height).data
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4 + 3
      const alpha = data[index] ?? 0
      if (alpha > threshold) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX === 0 && maxY === 0 && minX === width && minY === height) {
    return { x: 0, y: 0, width, height }
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX + 1),
    height: Math.max(1, maxY - minY + 1),
  }
}

function expandBounds(bounds: Bounds, maxWidth: number, maxHeight: number, marginRatio: number): Bounds {
  const marginX = Math.round(bounds.width * marginRatio)
  const marginY = Math.round(bounds.height * marginRatio)
  const x = Math.max(0, bounds.x - marginX)
  const y = Math.max(0, bounds.y - marginY)
  const width = Math.min(maxWidth - x, bounds.width + marginX * 2)
  const height = Math.min(maxHeight - y, bounds.height + marginY * 2)
  return { x, y, width, height }
}

function cropCanvas(canvas: HTMLCanvasElement, bounds: Bounds): HTMLCanvasElement {
  const cropped = ensureCanvas(bounds.width, bounds.height)
  const context = cropped.getContext('2d')
  context?.drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height)
  return cropped
}

function renderToTargetCanvas(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const target = ensureCanvas(width, height)
  const context = target.getContext('2d')
  if (!context) {
    return target
  }
  context.clearRect(0, 0, width, height)
  const scale = Math.min(width / source.width, height / source.height)
  const drawWidth = source.width * scale
  const drawHeight = source.height * scale
  const offsetX = (width - drawWidth) / 2
  const offsetY = (height - drawHeight) / 2
  context.drawImage(source, offsetX, offsetY, drawWidth, drawHeight)
  return target
}
