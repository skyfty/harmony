import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import EngineLoader from '@schema/loader'
import { prepareImportedObject } from '@schema/assetImport'
import { normalizeScatterMaterials } from '@schema/scatterMaterials'
import type { EnginePostProcessOptions, ModelSource, PipelineMode } from '../types'

/** Extensions the engine loader (`@schema/loader`) can actually parse. */
const ENGINE_MODEL_EXTENSIONS = new Set(['glb', 'fbx'])
const MODEL_EXTENSIONS = new Set(['glb', 'gltf', 'fbx'])

const DECODER_ASSET_PATH = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}three-decoders/`

/** GLTF extensions the engine loader cannot decode because no decoder is attached. */
const ENGINE_UNSUPPORTED_EXTENSIONS: Record<string, string> = {
  KHR_draco_mesh_compression: 'DRACO 网格压缩',
  KHR_texture_basisu: 'KTX2 / Basis 贴图压缩',
  EXT_meshopt_compression: 'meshopt 压缩',
}

export type GltfExtensionInfo = {
  used: string[]
  required: string[]
  generator: string | null
}

export type LoadedModel = {
  mode: PipelineMode
  root: THREE.Object3D
  animations: THREE.AnimationClip[]
  parsePath: 'engine-loader' | 'engine-emulated' | 'native'
  notices: string[]
  file: {
    name: string
    extension: string
    bytes: number
    sourceKind: ModelSource['kind']
  }
  engineSupported: boolean
  extensions: GltfExtensionInfo | null
}

export type LoadModelRequest = {
  source: ModelSource
  mode: PipelineMode
  renderer: THREE.WebGLRenderer
  postProcess: EnginePostProcessOptions
  onProgress?: (loaded: number, total: number) => void
}

export class EngineUnsupportedFormatError extends Error {
  readonly extension: string

  constructor(extension: string) {
    super(`引擎 loader 仅支持 glb/fbx，无法解析 .${extension}`)
    this.name = 'EngineUnsupportedFormatError'
    this.extension = extension
  }
}

export function resolveFileExtension(name: string): string {
  const cleaned = (name.split(/[?#]/)[0] ?? name).trim()
  const match = /\.([A-Za-z0-9]+)$/.exec(cleaned)
  return match?.[1] ? match[1].toLowerCase() : ''
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export { formatBytes }

export function pickMainFile(files: File[]): File | null {
  const candidates = files.filter((file) => MODEL_EXTENSIONS.has(resolveFileExtension(file.name)))
  if (!candidates.length) {
    return null
  }
  const priority = ['glb', 'gltf', 'fbx']
  return [...candidates].sort((left, right) => {
    const leftRank = priority.indexOf(resolveFileExtension(left.name))
    const rightRank = priority.indexOf(resolveFileExtension(right.name))
    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }
    return right.size - left.size
  })[0] ?? null
}

type MainFileBytes = {
  arrayBuffer: () => Promise<ArrayBuffer>
  text: () => Promise<string>
}

/** Large models are read once and reused by the extension scan and every parser. */
function createMainFileBytes(file: File): MainFileBytes {
  let bufferPromise: Promise<ArrayBuffer> | null = null
  const arrayBuffer = (): Promise<ArrayBuffer> => {
    bufferPromise ??= file.arrayBuffer()
    return bufferPromise
  }
  return {
    arrayBuffer,
    text: async () => new TextDecoder().decode(await arrayBuffer()),
  }
}

function readGltfJson(buffer: ArrayBuffer, extension: string): Record<string, unknown> | null {
  try {
    if (extension === 'gltf') {
      return JSON.parse(new TextDecoder().decode(buffer)) as Record<string, unknown>
    }
    if (extension !== 'glb') {
      return null
    }
    const view = new DataView(buffer)
    if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
      return null
    }
    let offset = 12
    while (offset + 8 <= buffer.byteLength) {
      const chunkLength = view.getUint32(offset, true)
      const chunkType = view.getUint32(offset + 4, true)
      const chunkStart = offset + 8
      if (chunkType === 0x4e4f534a) {
        const text = new TextDecoder().decode(new Uint8Array(buffer, chunkStart, chunkLength))
        return JSON.parse(text) as Record<string, unknown>
      }
      offset = chunkStart + chunkLength
    }
    return null
  } catch {
    return null
  }
}

export async function readGltfExtensionInfo(file: File, extension: string): Promise<GltfExtensionInfo | null> {
  if (extension !== 'glb' && extension !== 'gltf') {
    return null
  }
  const bytes = createMainFileBytes(file)
  const json = readGltfJson(await bytes.arrayBuffer(), extension)
  if (!json) {
    return null
  }
  const toStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
  return {
    used: toStringArray(json.extensionsUsed),
    required: toStringArray(json.extensionsRequired),
    generator: typeof json.generator === 'string' ? json.generator : null,
  }
}

/** Extensions in the file that the engine loader has no decoder for. */
export function findEngineUnsupportedExtensions(info: GltfExtensionInfo | null): string[] {
  if (!info) {
    return []
  }
  const names = new Set([...info.used, ...info.required])
  return Object.keys(ENGINE_UNSUPPORTED_EXTENSIONS).filter((extension) => names.has(extension))
}

export function describeEngineUnsupportedExtension(extension: string): string {
  return ENGINE_UNSUPPORTED_EXTENSIONS[extension] ?? extension
}

type ResourceHandle = {
  map: Map<string, string>
  dispose: () => void
}

function createResourceHandle(files: File[], mainFile: File): ResourceHandle {
  const map = new Map<string, string>()
  const createdUrls: string[] = []

  for (const file of files) {
    if (file === mainFile) {
      continue
    }
    const url = URL.createObjectURL(file)
    createdUrls.push(url)

    const keys = new Set<string>([file.name])
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
    if (relativePath) {
      keys.add(relativePath)
      const withoutRoot = relativePath.split('/').slice(1).join('/')
      if (withoutRoot) {
        keys.add(withoutRoot)
      }
    }

    for (const key of keys) {
      const normalizedKey = key.replace(/^\.\//, '')
      if (!normalizedKey) {
        continue
      }
      map.set(normalizedKey, url)
      map.set(normalizedKey.toLowerCase(), url)
      const baseName = normalizedKey.split('/').pop()
      if (baseName) {
        map.set(baseName, url)
        map.set(baseName.toLowerCase(), url)
      }
    }
  }

  return {
    map,
    dispose: () => {
      for (const url of createdUrls) {
        URL.revokeObjectURL(url)
      }
    },
  }
}

function createLoadingManager(resources: ResourceHandle | null): THREE.LoadingManager {
  const manager = new THREE.LoadingManager()
  if (resources && resources.map.size) {
    manager.setURLModifier((url) => {
      if (/^(blob:|data:|https?:)/i.test(url)) {
        return url
      }
      const cleaned = decodeURIComponent(url.split('?')[0]?.split('#')[0] ?? url)
      const candidates = [cleaned, cleaned.replace(/^\.\//, ''), cleaned.split('/').pop() ?? '']
      for (const candidate of candidates) {
        if (!candidate) {
          continue
        }
        const hit = resources.map.get(candidate) ?? resources.map.get(candidate.toLowerCase())
        if (hit) {
          return hit
        }
      }
      return url
    })
  }
  return manager
}

function collectAnimations(root: THREE.Object3D): THREE.AnimationClip[] {
  const clips = (root as unknown as { animations?: THREE.AnimationClip[] }).animations
  return Array.isArray(clips) ? clips : []
}

function materialList(material: THREE.Material | THREE.Material[] | null | undefined): THREE.Material[] {
  if (!material) {
    return []
  }
  return Array.isArray(material) ? material.filter(Boolean) : [material]
}

function collectMaterialTextures(material: THREE.Material, target: Set<THREE.Texture>): void {
  const record = material as unknown as Record<string, unknown>
  for (const value of Object.values(record)) {
    if (value instanceof THREE.Texture) {
      target.add(value)
    }
  }
}

export function disposeObject3D(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()

  root.traverse((child) => {
    const mesh = child as THREE.Mesh & { isSkinnedMesh?: boolean }
    if (!mesh.isMesh && !mesh.isSkinnedMesh) {
      return
    }
    mesh.geometry?.dispose()
    for (const material of materialList(mesh.material)) {
      materials.add(material)
    }
    const stashed = mesh.userData?.__inspectOriginalMaterial as THREE.Material | THREE.Material[] | undefined
    for (const material of materialList(stashed)) {
      materials.add(material)
    }
  })

  for (const material of materials) {
    collectMaterialTextures(material, textures)
    material.dispose()
  }
  for (const texture of textures) {
    texture.dispose()
  }
}

async function fetchSourceAsFile(url: string): Promise<File> {
  let response: Response
  try {
    response = await fetch(url, { mode: 'cors', credentials: 'omit' })
  } catch (error) {
    throw new Error(
      `请求模型地址失败（可能是跨域 CORS 或网络不可达）：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) {
    throw new Error(`模型地址返回 HTTP ${response.status} ${response.statusText}`)
  }
  const blob = await response.blob()
  const pathname = (() => {
    try {
      return new URL(url, window.location.href).pathname
    } catch {
      return url
    }
  })()
  const fileName = decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? 'remote-model.glb')
  return new File([blob], fileName, { type: blob.type || 'application/octet-stream' })
}

type ParsedModel = {
  scene: THREE.Object3D
  animations: THREE.AnimationClip[]
}

async function parseWithNativeGltf(
  payload: ArrayBuffer | string,
  manager: THREE.LoadingManager,
  renderer: THREE.WebGLRenderer,
): Promise<ParsedModel> {
  const loader = new GLTFLoader(manager)
  const dracoLoader = new DRACOLoader(manager)
  dracoLoader.setDecoderPath(`${DECODER_ASSET_PATH}draco/`)
  loader.setDRACOLoader(dracoLoader)

  const ktx2Loader = new KTX2Loader(manager)
  ktx2Loader.setTranscoderPath(`${DECODER_ASSET_PATH}basis/`)
  ktx2Loader.detectSupport(renderer)
  loader.setKTX2Loader(ktx2Loader)
  loader.setMeshoptDecoder(MeshoptDecoder)

  try {
    const gltf = await loader.parseAsync(payload, '')
    if (!gltf.scene && !(gltf.animations ?? []).length) {
      throw new Error('GLTF 解析结果为空')
    }
    const scene = gltf.scene ?? new THREE.Group()
    return { scene, animations: gltf.animations ?? [] }
  } finally {
    dracoLoader.dispose()
    ktx2Loader.dispose()
  }
}

function parseWithNativeFbx(buffer: ArrayBuffer, manager: THREE.LoadingManager): ParsedModel {
  const loader = new FBXLoader(manager)
  const scene = loader.parse(buffer, '') as THREE.Object3D & { animations?: THREE.AnimationClip[] }
  if (!scene) {
    throw new Error('FBX 解析结果为空')
  }
  return { scene, animations: Array.isArray(scene.animations) ? scene.animations : [] }
}

function parseWithEngineLoader(
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<ParsedModel> {
  return new Promise<ParsedModel>((resolve, reject) => {
    const loader = new EngineLoader()

    const cleanup = (): void => {
      loader.removeEventListener('loaded', handleLoaded)
      loader.removeEventListener('error', handleError)
      if (onProgress) {
        loader.removeEventListener('progress', handleProgress)
      }
    }
    const handleProgress = (payload: { loaded: number; total: number }): void => {
      onProgress?.(payload.loaded, payload.total)
    }
    const handleLoaded = (object: THREE.Object3D | null): void => {
      cleanup()
      if (!object) {
        reject(new Error('引擎 loader 返回了空对象'))
        return
      }
      resolve({ scene: object, animations: collectAnimations(object) })
    }
    const handleError = (error: Error): void => {
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    loader.addEventListener('loaded', handleLoaded)
    loader.addEventListener('error', handleError)
    if (onProgress) {
      loader.addEventListener('progress', handleProgress)
    }
    loader.loadFile(file)
  })
}

/**
 * Mirrors the non-recentering part of the engine's `prepareImportedObject()`
 * (schema/assetImport.ts) so the recentering step can be switched off without
 * losing the rest of the import defaults.
 */
function applyImportDefaultsWithoutRecenter(root: THREE.Object3D): void {
  root.removeFromParent()
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      const geometry = mesh.geometry as THREE.BufferGeometry | undefined
      const morphTargets =
        geometry?.morphAttributes?.position || geometry?.morphAttributes?.normal || geometry?.morphAttributes?.color || null
      if (morphTargets && morphTargets.length > 0 && !mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences = new Array(morphTargets.length).fill(0)
      }
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
    child.matrixAutoUpdate = true
  })
  root.updateMatrixWorld(true)
}

function describeSide(value: THREE.Side): string {
  if (value === THREE.DoubleSide) {
    return 'DoubleSide'
  }
  if (value === THREE.BackSide) {
    return 'BackSide'
  }
  return 'FrontSide'
}

/**
 * Engine import normalization: recenter/ground, scatter alpha cutout — plus the
 * legacy `FrontSide` forcing, kept behind a toggle so the old "back faces
 * disappear" result can still be reproduced for comparison. The engine itself
 * no longer rewrites material `side`.
 */
export function applyEnginePostProcess(root: THREE.Object3D, options: EnginePostProcessOptions): string[] {
  const notices: string[] = []

  if (options.recenter) {
    prepareImportedObject(root)
  } else {
    applyImportDefaultsWithoutRecenter(root)
  }

  if (options.forceFrontSide) {
    let changed = 0
    root.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh?.isMesh && !(mesh as unknown as { isSkinnedMesh?: boolean })?.isSkinnedMesh) {
        return
      }
      for (const material of materialList(mesh.material)) {
        const userData = (material.userData ??= {}) as Record<string, unknown>
        if (userData.__inspectSourceSide === undefined) {
          userData.__inspectSourceSide = material.side
        }
        if (material.side !== THREE.FrontSide) {
          notices.push(`材质「${material.name || material.type}」由 ${describeSide(material.side)} 被强制为 FrontSide（对照开关）`)
          changed += 1
          userData.__inspectForcedFrontSide = true
        }
        material.side = THREE.FrontSide
        material.needsUpdate = true
      }
    })
    if (changed > 0) {
      notices.unshift(`对照开关强制 FrontSide：${changed} 个材质槽位被改写（背向相机处会出现镂空）`)
    }
  }

  if (options.scatterCutout && normalizeScatterMaterials(root)) {
    notices.push('引擎 alpha 规范化：alpha 混合材质被转成 alphaTest = 0.5 的 cutout')
  }

  return notices
}

/** Failure that keeps the file context needed to explain what went wrong. */
export class ModelLoadError extends Error {
  readonly mode: PipelineMode
  readonly extension: string
  readonly extensions: GltfExtensionInfo | null

  constructor(
    message: string,
    context: { mode: PipelineMode; extension: string; extensions: GltfExtensionInfo | null },
  ) {
    super(message)
    this.name = 'ModelLoadError'
    this.mode = context.mode
    this.extension = context.extension
    this.extensions = context.extensions
  }
}

async function loadModelInternal(request: LoadModelRequest): Promise<LoadedModel> {
  const { mode, renderer, postProcess, onProgress } = request
  const notices: string[] = []

  let files: File[]
  if (request.source.kind === 'file') {
    files = request.source.files
  } else {
    files = [await fetchSourceAsFile(request.source.url)]
  }

  const mainFile = pickMainFile(files)
  if (!mainFile) {
    throw new ModelLoadError('没有找到可加载的模型文件（支持 .glb / .gltf / .fbx）', {
      mode,
      extension: '',
      extensions: null,
    })
  }

  const extension = resolveFileExtension(mainFile.name)
  const engineSupported = ENGINE_MODEL_EXTENSIONS.has(extension)
  const bytes = createMainFileBytes(mainFile)
  const extensions = extension === 'glb' || extension === 'gltf'
    ? await readGltfExtensionInfo(mainFile, extension)
    : null
  const resources = createResourceHandle(files, mainFile)
  const manager = createLoadingManager(resources)

  let parsed: ParsedModel
  let parsePath: LoadedModel['parsePath']

  const parseNatively = async (): Promise<ParsedModel> => {
    if (extension === 'glb' || extension === 'gltf') {
      const payload = extension === 'glb' ? await bytes.arrayBuffer() : await bytes.text()
      return parseWithNativeGltf(payload, manager, renderer)
    }
    return parseWithNativeFbx(await bytes.arrayBuffer(), manager)
  }

  try {
    if (mode === 'engine') {
      if (!engineSupported) {
        throw new EngineUnsupportedFormatError(extension)
      }
      parsed = await parseWithEngineLoader(mainFile, onProgress)
      parsePath = 'engine-loader'
    } else {
      parsed = await parseNatively()
      parsePath = 'native'
    }
  } catch (error) {
    if (error instanceof EngineUnsupportedFormatError) {
      // The engine loader cannot parse this format at all. Render the natively
      // parsed model with the engine's *post-processing* applied instead, so the
      // operator can still see what the engine normalization would do.
      notices.push(`${error.message}：以下结果由原生解析 + 引擎等价规范化生成，仅用于对比`)
      parsed = await parseNatively()
      parsePath = 'engine-emulated'
    } else {
      throw new ModelLoadError(error instanceof Error ? error.message : String(error), {
        mode,
        extension,
        extensions,
      })
    }
  } finally {
    // Parsing is done; the object URLs handed to the loader are no longer needed.
    resources.dispose()
  }

  if (mode === 'engine') {
    notices.push(...applyEnginePostProcess(parsed.scene, postProcess))
  }

  if (!engineSupported) {
    notices.unshift(`引擎 loader 不支持 .${extension}，线上会直接报「不支持的文件格式」`)
  }
  const unsupportedExtensions = findEngineUnsupportedExtensions(extensions)
  if (unsupportedExtensions.length) {
    notices.unshift(
      `文件使用了引擎未挂解码器的扩展：${unsupportedExtensions
        .map((name) => `${name}（${describeEngineUnsupportedExtension(name)}）`)
        .join('、')}`,
    )
  }

  return {
    mode,
    root: parsed.scene,
    animations: parsed.animations,
    parsePath,
    notices,
    file: {
      name: mainFile.name,
      extension,
      bytes: mainFile.size,
      sourceKind: request.source.kind,
    },
    engineSupported,
    extensions,
  }
}

export async function loadModel(request: LoadModelRequest): Promise<LoadedModel> {
  try {
    return await loadModelInternal(request)
  } catch (error) {
    if (error instanceof ModelLoadError) {
      throw error
    }
    throw new ModelLoadError(error instanceof Error ? error.message : String(error), {
      mode: request.mode,
      extension: '',
      extensions: null,
    })
  }
}

/** Turns a pipeline failure into a concrete, actionable explanation. */
export function explainLoadFailure(error: unknown): string {
  const context = error instanceof ModelLoadError
    ? { extension: error.extension, extensions: error.extensions }
    : null
  const message = error instanceof Error ? error.message : String(error)
  const hints: string[] = []
  const unsupported = findEngineUnsupportedExtensions(context?.extensions ?? null)
  if (unsupported.length) {
    hints.push(
      `该文件使用 ${unsupported
        .map((name) => `${name}（${describeEngineUnsupportedExtension(name)}）`)
        .join('、')}，而引擎 loader 未挂对应解码器 —— 这通常就是线上加载失败的原因。`,
    )
  }
  if (context && context.extension && !ENGINE_MODEL_EXTENSIONS.has(context.extension)) {
    hints.push(`引擎只支持 glb/fbx，.${context.extension} 需要在导入前转换格式或重新导出为 .glb。`)
  }
  if (!context?.extension) {
    hints.push('请确认文件名带有 .glb / .gltf / .fbx 扩展名；.gltf 需要连同 .bin 与贴图一起选择。')
  }
  if (/DRACOLoader|KTX2Loader|basis|draco/i.test(message)) {
    hints.push('错误信息指向压缩扩展解码器缺失，可切到「原生 three.js」确认文件本身能否正常解码。')
  }
  if (/Unsupported glTF|not supported|undefined/i.test(message)) {
    hints.push('可切到「原生 three.js」对比：若原生能正常渲染，说明问题在引擎的解码/规范化环节。')
  }
  return hints.join('\n')
}
