import * as THREE from 'three'
import type {
  GroundDynamicMesh,
  SceneNode,
} from './index'
import { stableSerialize } from './stableSerialize'
import { resolveEnabledComponentState } from './componentRuntimeUtils'
import {
  LANDFORMS_COMPONENT_TYPE,
  clampLandformsComponentProps,
  type LandformsBlendMode,
  type LandformsComponentProps,
  type LandformsLayer,
} from './components'
import {
  LANDFORMS_PREVIEW_SIGNATURE_USERDATA_KEY,
  clearLandformsPreviewForGround,
  getLandformsPreviewTexture,
  setLandformsPreviewTexture,
  type LandformsPreviewLoaders,
} from './landformsPreview'
import {
  parseTerrainPaintChunkKey,
  type TerrainPaintChunkBounds,
  resolveTerrainPaintChunkBounds,
} from './terrainPaintTiles'

const DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION = 1024
const MIN_GROUND_SURFACE_PREVIEW_RESOLUTION = 256
const GROUND_SURFACE_PREVIEW_TERRAIN_CHUNK_LOAD_CONCURRENCY = 6
const groundSurfacePreviewRequests = new Map<string, Promise<THREE.Texture | null>>()
const GROUND_SURFACE_PREVIEW_DEBUG_FLAG_KEY = '__HARMONY_GROUND_SURFACE_PREVIEW_DEBUG__'
const GROUND_SURFACE_PREVIEW_STATS_KEY = '__HARMONY_GROUND_SURFACE_PREVIEW_STATS__'

type Canvas2DContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

type CanvasLike = OffscreenCanvas | HTMLCanvasElement

export type GroundSurfaceLiveChunkPreview = {
  chunkKey: string
  bounds: TerrainPaintChunkBounds
  canvas: CanvasLike
  revision: number
}

export type GroundSurfacePreviewCanvasResult = {
  canvas: CanvasLike
  width: number
  height: number
}

type GroundSurfacePreviewCompiledShader = {
  uniforms: Record<string, { value: any }>
  vertexShader: string
  fragmentShader: string
}

type LoadedPreviewSource = {
  source: CanvasImageSource
  width: number
  height: number
}

type GroundSurfaceChunkDrawEntry = {
  chunkKey: string
  textureAssetId: string
  bounds: TerrainPaintChunkBounds
}

type GroundSurfacePreviewPerfBucket = {
  count: number
  totalMs: number
  maxMs: number
  lastMs: number
  lastDetails: Record<string, unknown>
}

type GroundSurfacePreviewPerfStats = Record<string, GroundSurfacePreviewPerfBucket>

export type GroundSurfacePreviewLoaders = LandformsPreviewLoaders & {
  loadTerrainPaintTextureFromAssetId: (assetId: string, options: { colorSpace: 'srgb' | 'none' }) => Promise<THREE.Texture | null>
  loadGroundSurfaceBaseTextureFromUrl: (url: string) => Promise<THREE.Texture | null>
}

export type GroundSurfacePreviewOptions = {
  maxResolution?: number
  previewRevision?: number
  applyToMaterialMap?: boolean
  reuseCanvas?: CanvasLike | null
  seedTexture?: THREE.Texture | null
}

const GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY = '__groundSurfacePreviewLiveTexture'
const groundSurfacePreviewShaderStateByMaterial = new WeakMap<THREE.MeshStandardMaterial, GroundSurfacePreviewShaderState>()

type GroundSurfacePreviewShaderState = {
  installed: boolean
  shader: GroundSurfacePreviewCompiledShader | null
  overlayTexture: THREE.Texture | null
  overlayBounds: THREE.Vector4
  defaultTransparentTexture: THREE.DataTexture
  originalOnBeforeCompile: THREE.MeshStandardMaterial['onBeforeCompile']
  originalCustomProgramCacheKey?: THREE.MeshStandardMaterial['customProgramCacheKey']
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function recordGroundSurfacePreviewPerf(stage: string, durationMs: number, details: Record<string, unknown> = {}): void {
  const globalScope = globalThis as Record<string, unknown>
  let stats = globalScope[GROUND_SURFACE_PREVIEW_STATS_KEY] as GroundSurfacePreviewPerfStats | undefined
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
    stats = {}
    globalScope[GROUND_SURFACE_PREVIEW_STATS_KEY] = stats
  }
  const bucket = stats[stage] ?? {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
    lastDetails: {},
  }
  bucket.count += 1
  bucket.totalMs += durationMs
  bucket.maxMs = Math.max(bucket.maxMs, durationMs)
  bucket.lastMs = durationMs
  bucket.lastDetails = details
  stats[stage] = bucket
  if (globalScope[GROUND_SURFACE_PREVIEW_DEBUG_FLAG_KEY] === true) {
    console.debug('[groundSurfacePreview]', stage, {
      durationMs: Math.round(durationMs * 100) / 100,
      ...details,
    })
  }
}

function resolveTextureImageSource(texture: THREE.Texture | null | undefined): CanvasImageSource | null {
  const image = texture?.image as CanvasImageSource | undefined
  return image ?? null
}

function getGroundSurfacePreviewLiveTexture(root: THREE.Object3D | null | undefined): THREE.Texture | null {
  return ((root?.userData as Record<string, unknown> | undefined)?.[GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY] as THREE.Texture | null | undefined) ?? null
}

function clearGroundSurfacePreviewLiveTexture(root: THREE.Object3D | null | undefined): void {
  const texture = getGroundSurfacePreviewLiveTexture(root)
  if (texture) {
    texture.dispose()
  }
  if (root?.userData) {
    delete (root.userData as Record<string, unknown>)[GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY]
  }
}

function setGroundSurfacePreviewLiveTexture(root: THREE.Object3D | null | undefined, texture: THREE.Texture | null): void {
  if (!root?.userData) {
    return
  }
  if (texture) {
    ;(root.userData as Record<string, unknown>)[GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY] = texture
    return
  }
  delete (root.userData as Record<string, unknown>)[GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY]
}

function releaseGroundSurfacePreviewLiveTextureIfDifferent(root: THREE.Object3D | null | undefined, nextTexture: THREE.Texture | null): void {
  const liveTexture = getGroundSurfacePreviewLiveTexture(root)
  if (!liveTexture || liveTexture === nextTexture) {
    return
  }
  liveTexture.dispose()
  if (root?.userData) {
    delete (root.userData as Record<string, unknown>)[GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY]
  }
}

function normalizeFinite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function normalizeDimension(value: number): number {
  return Math.max(1, normalizeFinite(value, 1))
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value <= 0) {
    return 0
  }
  if (value >= 1) {
    return 1
  }
  return value
}

function createCompositionCanvas(width: number, height: number): { canvas: CanvasLike; context: Canvas2DContext } | null {
  const normalizedWidth = Math.max(1, Math.round(width))
  const normalizedHeight = Math.max(1, Math.round(height))
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(normalizedWidth, normalizedHeight)
    const context = canvas.getContext('2d')
    if (context) {
      return { canvas, context }
    }
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas')
    canvas.width = normalizedWidth
    canvas.height = normalizedHeight
    const context = canvas.getContext('2d')
    if (context) {
      return { canvas, context }
    }
  }
  return null
}

function computePreviewTextureSize(definition: GroundDynamicMesh, maxResolution: number): { width: number; height: number } {
  const groundWidth = normalizeDimension(definition.width)
  const groundDepth = normalizeDimension(definition.depth)
  const maxDimension = Math.max(groundWidth, groundDepth, 1)
  const normalizedMax = Math.max(MIN_GROUND_SURFACE_PREVIEW_RESOLUTION, Math.round(maxResolution))
  const width = Math.max(
    MIN_GROUND_SURFACE_PREVIEW_RESOLUTION,
    Math.round((groundWidth / maxDimension) * normalizedMax),
  )
  const height = Math.max(
    MIN_GROUND_SURFACE_PREVIEW_RESOLUTION,
    Math.round((groundDepth / maxDimension) * normalizedMax),
  )
  return { width, height }
}

function resolveLayerCompositeOperation(mode: LandformsBlendMode): GlobalCompositeOperation {
  switch (mode) {
    case 'multiply':
      return 'multiply'
    case 'screen':
      return 'screen'
    case 'overlay':
      return 'overlay'
    default:
      return 'source-over'
  }
}

function applyLayerMask(context: Canvas2DContext, layer: LandformsLayer, width: number, height: number): void {
  const shape = layer.mask.shape
  if (shape === 'none') {
    return
  }
  const centerX = width * normalizeFinite(layer.mask.center.x, 0.5)
  const centerY = height * normalizeFinite(layer.mask.center.y, 0.5)
  const sizeX = width * Math.max(0, normalizeFinite(layer.mask.size.x, 1))
  const sizeY = height * Math.max(0, normalizeFinite(layer.mask.size.y, 1))
  context.beginPath()
  if (shape === 'circle') {
    context.ellipse(centerX, centerY, Math.max(1, sizeX * 0.5), Math.max(1, sizeY * 0.5), 0, 0, Math.PI * 2)
  } else {
    context.rect(centerX - sizeX * 0.5, centerY - sizeY * 0.5, Math.max(1, sizeX), Math.max(1, sizeY))
  }
  context.clip()
}

function drawLayerTiled(
  context: Canvas2DContext,
  image: CanvasImageSource,
  layer: LandformsLayer,
  width: number,
  height: number,
): void {
  const repeatX = Math.max(0.001, normalizeFinite(layer.tileScale.x, 1))
  const repeatY = Math.max(0.001, normalizeFinite(layer.tileScale.y, 1))
  const tileWidth = layer.worldSpace ? width / repeatX : Math.min(width, height) / repeatX
  const tileHeight = layer.worldSpace ? height / repeatY : Math.min(width, height) / repeatY
  const offsetX = normalizeFinite(layer.offset.x, 0) * tileWidth
  const offsetY = normalizeFinite(layer.offset.y, 0) * tileHeight
  const drawStartX = -tileWidth * 2 + offsetX
  const drawStartY = -tileHeight * 2 + offsetY
  const drawEndX = width + tileWidth * 2
  const drawEndY = height + tileHeight * 2
  for (let y = drawStartY; y < drawEndY; y += tileHeight) {
    for (let x = drawStartX; x < drawEndX; x += tileWidth) {
      context.drawImage(image, x, y, tileWidth, tileHeight)
    }
  }
}

function resolveCanvasImageSourceSize(source: CanvasImageSource): { width: number; height: number } | null {
  const candidate = source as { width?: number; height?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number }
  const width = candidate.width ?? candidate.videoWidth ?? candidate.naturalWidth ?? 0
  const height = candidate.height ?? candidate.videoHeight ?? candidate.naturalHeight ?? 0
  if (!(width > 0) || !(height > 0)) {
    return null
  }
  return { width, height }
}

function loadPreviewSourceFromTexture(texture: THREE.Texture | null): LoadedPreviewSource | null {
  const startTime = nowMs()
  const source = (texture?.image as CanvasImageSource | undefined) ?? null
  if (!source) {
    return null
  }
  const size = resolveCanvasImageSourceSize(source)
  if (!size) {
    return null
  }
  recordGroundSurfacePreviewPerf('load-texture-source', nowMs() - startTime, {
    textureUuid: texture?.uuid ?? null,
    width: size.width,
    height: size.height,
  })
  return {
    source,
    width: size.width,
    height: size.height,
  }
}

function createDefaultTransparentOverlayTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat)
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function getOrCreateGroundSurfacePreviewShaderState(material: THREE.MeshStandardMaterial): GroundSurfacePreviewShaderState {
  const existing = groundSurfacePreviewShaderStateByMaterial.get(material)
  if (existing) {
    return existing
  }
  const created: GroundSurfacePreviewShaderState = {
    installed: false,
    shader: null,
    overlayTexture: null,
    overlayBounds: new THREE.Vector4(-0.5, -0.5, 1, 1),
    defaultTransparentTexture: createDefaultTransparentOverlayTexture(),
    originalOnBeforeCompile: material.onBeforeCompile,
    originalCustomProgramCacheKey: material.customProgramCacheKey,
  }
  groundSurfacePreviewShaderStateByMaterial.set(material, created)
  return created
}

function updateGroundSurfacePreviewShaderUniforms(state: GroundSurfacePreviewShaderState): void {
  const shader = state.shader
  if (!shader) {
    return
  }
  const overlayTexture = state.overlayTexture ?? state.defaultTransparentTexture
  if (shader.uniforms.uHarmonyGroundOverlayEnabled) {
    shader.uniforms.uHarmonyGroundOverlayEnabled.value = state.overlayTexture ? 1 : 0
  }
  if (shader.uniforms.uHarmonyGroundOverlayTexture) {
    shader.uniforms.uHarmonyGroundOverlayTexture.value = overlayTexture
  }
  if (shader.uniforms.uHarmonyGroundOverlayBounds) {
    shader.uniforms.uHarmonyGroundOverlayBounds.value.copy(state.overlayBounds)
  }
}

function installGroundSurfacePreviewShaderHooks(material: THREE.MeshStandardMaterial): GroundSurfacePreviewShaderState {
  const state = getOrCreateGroundSurfacePreviewShaderState(material)
  if (state.installed) {
    return state
  }
  material.customProgramCacheKey = () => {
    const originalKey = state.originalCustomProgramCacheKey?.call(material) ?? ''
    return `${originalKey}|harmony-ground-surface-overlay-v1`
  }
  material.onBeforeCompile = (shader, renderer) => {
    state.originalOnBeforeCompile?.call(material, shader, renderer)
    state.shader = shader
    shader.uniforms.uHarmonyGroundOverlayEnabled = { value: 0 }
    shader.uniforms.uHarmonyGroundOverlayTexture = { value: state.defaultTransparentTexture }
    shader.uniforms.uHarmonyGroundOverlayBounds = { value: state.overlayBounds }
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        'varying vec2 vHarmonyGroundOverlayLocalXZ;\nvoid main() {',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvHarmonyGroundOverlayLocalXZ = position.xz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        [
          'uniform float uHarmonyGroundOverlayEnabled;',
          'uniform sampler2D uHarmonyGroundOverlayTexture;',
          'uniform vec4 uHarmonyGroundOverlayBounds;',
          'varying vec2 vHarmonyGroundOverlayLocalXZ;',
          'void main() {',
        ].join('\n'),
      )
      .replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          'if (uHarmonyGroundOverlayEnabled > 0.5) {',
          '  vec2 harmonyOverlayUvRaw = (vHarmonyGroundOverlayLocalXZ - uHarmonyGroundOverlayBounds.xy) / max(uHarmonyGroundOverlayBounds.zw, vec2(1e-5));',
          '  // Match ground mesh UVs: U grows with +X, V decreases as +Z moves "down" across the canvas.',
          '  vec2 harmonyOverlayUv = vec2(harmonyOverlayUvRaw.x, 1.0 - harmonyOverlayUvRaw.y);',
          '  bool harmonyOverlayInside = harmonyOverlayUv.x >= 0.0 && harmonyOverlayUv.x <= 1.0 && harmonyOverlayUv.y >= 0.0 && harmonyOverlayUv.y <= 1.0;',
          '  if (harmonyOverlayInside) {',
          '    vec4 harmonyOverlaySample = texture2D(uHarmonyGroundOverlayTexture, harmonyOverlayUv);',
          '    float harmonyOverlayAlpha = clamp(harmonyOverlaySample.a, 0.0, 1.0);',
          '    diffuseColor.rgb = mix(diffuseColor.rgb, harmonyOverlaySample.rgb, harmonyOverlayAlpha);',
          '  }',
          '}',
        ].join('\n'),
      )
    updateGroundSurfacePreviewShaderUniforms(state)
  }
  state.installed = true
  material.needsUpdate = true
  return state
}

function forEachGroundPreviewMaterial(root: THREE.Object3D, visitor: (material: THREE.MeshStandardMaterial) => void): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => {
        if (entry instanceof THREE.MeshStandardMaterial) {
          visitor(entry)
        }
      })
      return
    }
    if (material instanceof THREE.MeshStandardMaterial) {
      visitor(material)
    }
  })
}

function applyGroundSurfacePreviewToMaterialMap(root: THREE.Object3D, texture: THREE.Texture, definition: GroundDynamicMesh): void {
  const width = Math.max(1e-6, normalizeDimension(definition.width))
  const depth = Math.max(1e-6, normalizeDimension(definition.depth))
  forEachGroundPreviewMaterial(root, (material) => {
    const state = installGroundSurfacePreviewShaderHooks(material)
    state.overlayTexture = texture
    state.overlayBounds.set(-width * 0.5, -depth * 0.5, width, depth)
    updateGroundSurfacePreviewShaderUniforms(state)
  })
}

export function syncGroundSurfaceLiveChunkPreviews(params: {
  groundObject: THREE.Object3D
  groundNode: SceneNode
  dynamicMesh: GroundDynamicMesh
  chunkPreviews: GroundSurfaceLiveChunkPreview[]
  maxResolution?: number
  applyToMaterialMap?: boolean
}): boolean {
  const { groundObject, groundNode, dynamicMesh, chunkPreviews, maxResolution, applyToMaterialMap } = params
  if (!groundObject || !groundNode || dynamicMesh.type !== 'Ground') {
    return false
  }
  const validPreviews = chunkPreviews.filter((entry) => entry?.canvas && Number.isFinite(entry.bounds?.width) && Number.isFinite(entry.bounds?.depth))
  if (!validPreviews.length) {
    return false
  }

  const previewSize = computePreviewTextureSize(dynamicMesh, maxResolution ?? DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION)
  const persistedTexture = getLandformsPreviewTexture(groundObject)
  let liveTexture = getGroundSurfacePreviewLiveTexture(groundObject)
  const seedTexture = persistedTexture ?? liveTexture
  const seedSource = resolveTextureImageSource(seedTexture)
  const seedSize = seedSource ? resolveCanvasImageSourceSize(seedSource) : null
  const targetWidth = Math.max(previewSize.width, seedSize?.width ?? 0)
  const targetHeight = Math.max(previewSize.height, seedSize?.height ?? 0)
  const existingCanvas = liveTexture?.image as CanvasLike | undefined
  const canReuseCanvas = Boolean(
    existingCanvas
    && 'getContext' in existingCanvas
    && (((existingCanvas as HTMLCanvasElement).width ?? (existingCanvas as OffscreenCanvas).width) === targetWidth)
    && (((existingCanvas as HTMLCanvasElement).height ?? (existingCanvas as OffscreenCanvas).height) === targetHeight),
  )
  const composition = canReuseCanvas
    ? (() => {
      const context = existingCanvas!.getContext('2d') as Canvas2DContext | null
      return context ? { canvas: existingCanvas!, context } : null
    })()
    : createCompositionCanvas(targetWidth, targetHeight)
  if (!composition) {
    return false
  }

  const { canvas, context } = composition
  const width = (canvas as HTMLCanvasElement).width ?? (canvas as OffscreenCanvas).width
  const height = (canvas as HTMLCanvasElement).height ?? (canvas as OffscreenCanvas).height
  if (!canReuseCanvas) {
    context.clearRect(0, 0, width, height)
    if (seedSource) {
      context.drawImage(seedSource, 0, 0, width, height)
    }
  }

  const groundWidth = Math.max(1e-6, normalizeDimension(dynamicMesh.width))
  const groundDepth = Math.max(1e-6, normalizeDimension(dynamicMesh.depth))
  const halfWidth = groundWidth * 0.5
  const halfDepth = groundDepth * 0.5
  for (const preview of validPreviews) {
    const drawX = Math.floor(((preview.bounds.minX + halfWidth) / groundWidth) * width)
    const drawY = Math.floor(((preview.bounds.minZ + halfDepth) / groundDepth) * height)
    const drawWidth = Math.max(1, Math.ceil((preview.bounds.width / groundWidth) * width))
    const drawHeight = Math.max(1, Math.ceil((preview.bounds.depth / groundDepth) * height))
    // Replace the whole chunk footprint each live update.
    // Using source-over here repeatedly compounds edge alpha and makes strokes look sharper until final rebuild.
    context.clearRect(drawX, drawY, drawWidth, drawHeight)
    context.drawImage(preview.canvas, drawX, drawY, drawWidth, drawHeight)
  }

  const nextTexture = liveTexture && canReuseCanvas
    ? configureGroundSurfacePreviewTexture(liveTexture, canvas)
    : configureGroundSurfacePreviewTexture(new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement), canvas)
  if (liveTexture && nextTexture !== liveTexture) {
    liveTexture.dispose()
  }
  liveTexture = nextTexture
  setGroundSurfacePreviewLiveTexture(groundObject, liveTexture)
  if (applyToMaterialMap === true) {
    applyGroundSurfacePreviewToMaterialMap(groundObject, liveTexture, dynamicMesh)
  }
  return true
}

export function restoreGroundSurfacePreviewMaterialMap(root: THREE.Object3D | null | undefined): void {
  if (!root) {
    return
  }
  clearGroundSurfacePreviewLiveTexture(root)
  forEachGroundPreviewMaterial(root, (material) => {
    const state = groundSurfacePreviewShaderStateByMaterial.get(material)
    if (!state) {
      return
    }
    state.overlayTexture = null
    updateGroundSurfacePreviewShaderUniforms(state)
  })
}

async function composeGroundSurfaceChunksIntoCanvas(params: {
  context: Canvas2DContext
  width: number
  height: number
  definition: GroundDynamicMesh
  loaders: GroundSurfacePreviewLoaders
  shouldAbort: () => boolean
}): Promise<boolean> {
  const { context, width, height, definition, loaders, shouldAbort } = params
  const composeStartTime = nowMs()
  const chunkEntries = Object.entries(definition.groundSurfaceChunks ?? {})
    .filter(([, chunkRef]) => typeof chunkRef?.textureAssetId === 'string' && chunkRef.textureAssetId.trim().length)
  if (!chunkEntries.length) {
    return false
  }

  const groundWidth = Math.max(1e-6, normalizeDimension(definition.width))
  const groundDepth = Math.max(1e-6, normalizeDimension(definition.depth))
  const halfWidth = groundWidth * 0.5
  const halfDepth = groundDepth * 0.5
  const drawableChunks: GroundSurfaceChunkDrawEntry[] = []
  for (const [chunkKey, chunkRef] of chunkEntries) {
    const parts = parseTerrainPaintChunkKey(chunkKey)
    if (!parts) {
      continue
    }
    const bounds = resolveTerrainPaintChunkBounds(definition, parts.chunkRow, parts.chunkColumn)
    if (!bounds) {
      continue
    }
    const textureAssetId = chunkRef?.textureAssetId?.trim() ?? ''
    if (!textureAssetId) {
      continue
    }
    drawableChunks.push({
      chunkKey,
      textureAssetId,
      bounds,
    })
  }
  if (!drawableChunks.length) {
    return false
  }

  let drewAny = false
  let drawnChunkCount = 0
  let totalSourcePixels = 0
  let batchCount = 0
  const batchSize = Math.max(1, Math.min(GROUND_SURFACE_PREVIEW_TERRAIN_CHUNK_LOAD_CONCURRENCY, drawableChunks.length))

  for (let batchStart = 0; batchStart < drawableChunks.length; batchStart += batchSize) {
    if (shouldAbort()) {
      return false
    }
    const batch = drawableChunks.slice(batchStart, batchStart + batchSize)
    batchCount += 1
    const loadedBatch = await Promise.all(batch.map(async (entry) => {
      try {
        const texture = await loaders.loadTerrainPaintTextureFromAssetId(entry.textureAssetId, { colorSpace: 'srgb' })
        return {
          entry,
          loaded: loadPreviewSourceFromTexture(texture),
        }
      } catch (error) {
        console.warn('[groundSurfacePreview] Failed to load terrain paint texture during compose', entry.textureAssetId, {
          chunkKey: entry.chunkKey,
          error,
        })
        return {
          entry,
          loaded: null,
        }
      }
    }))
    if (shouldAbort()) {
      return false
    }
    for (const { entry, loaded } of loadedBatch) {
      if (!loaded) {
        continue
      }
      const drawX = Math.floor(((entry.bounds.minX + halfWidth) / groundWidth) * width)
      const drawY = Math.floor(((entry.bounds.minZ + halfDepth) / groundDepth) * height)
      const drawWidth = Math.max(1, Math.ceil((entry.bounds.width / groundWidth) * width))
      const drawHeight = Math.max(1, Math.ceil((entry.bounds.depth / groundDepth) * height))
      context.drawImage(loaded.source, drawX, drawY, drawWidth, drawHeight)
      drewAny = true
      drawnChunkCount += 1
      totalSourcePixels += loaded.width * loaded.height
    }
  }

  recordGroundSurfacePreviewPerf('compose-ground-surface-chunks', nowMs() - composeStartTime, {
    chunkEntryCount: chunkEntries.length,
    drawableChunkCount: drawableChunks.length,
    drawnChunkCount,
    batchCount,
    batchSize,
    previewWidth: width,
    previewHeight: height,
    totalSourcePixels,
  })

  return drewAny
}

function buildGroundSurfacePreviewSignature(groundNode: SceneNode, definition: GroundDynamicMesh, options: GroundSurfacePreviewOptions): string {
  const component = resolveEnabledComponentState<LandformsComponentProps>(groundNode, LANDFORMS_COMPONENT_TYPE)
  const props = component ? clampLandformsComponentProps(component.props) : { layers: [] }
  return stableSerialize({
    width: normalizeDimension(definition.width),
    depth: normalizeDimension(definition.depth),
    textureDataUrl: definition.textureDataUrl ?? null,
    groundSurfaceChunks: definition.groundSurfaceChunks ?? null,
    landforms: props.layers.filter((layer) => layer.enabled && typeof layer.assetId === 'string' && layer.assetId.trim().length),
    previewRevision: options.previewRevision ?? 0,
    maxResolution: options.maxResolution ?? DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION,
  })
}

export async function composeGroundSurfacePreviewCanvas(
  groundNode: SceneNode,
  definition: GroundDynamicMesh,
  loaders: GroundSurfacePreviewLoaders,
  options: GroundSurfacePreviewOptions,
  shouldAbort: () => boolean = () => false,
): Promise<GroundSurfacePreviewCanvasResult | null> {
  const composeStartTime = nowMs()
  const previewSize = computePreviewTextureSize(definition, options.maxResolution ?? DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION)
  const reuseCanvas = options.reuseCanvas
  const seedTexture = options.seedTexture ?? null
  const seedImageSource = resolveTextureImageSource(seedTexture)
  const canReuseCanvas = Boolean(
    reuseCanvas
    && (((reuseCanvas as HTMLCanvasElement).width ?? (reuseCanvas as OffscreenCanvas).width) === previewSize.width)
    && (((reuseCanvas as HTMLCanvasElement).height ?? (reuseCanvas as OffscreenCanvas).height) === previewSize.height),
  )
  const canSeedFromTexture = Boolean(!canReuseCanvas && seedImageSource)
  const composition = canReuseCanvas
    ? (() => {
      const context = reuseCanvas!.getContext('2d') as Canvas2DContext | null
      return context ? { canvas: reuseCanvas!, context } : null
    })()
    : createCompositionCanvas(previewSize.width, previewSize.height)
  if (!composition) {
    return null
  }
  const { canvas, context } = composition
  const width = (canvas as HTMLCanvasElement).width ?? (canvas as OffscreenCanvas).width
  const height = (canvas as HTMLCanvasElement).height ?? (canvas as OffscreenCanvas).height
  context.clearRect(0, 0, width, height)
  if (seedImageSource) {
    context.drawImage(seedImageSource, 0, 0, width, height)
  }

  const component = resolveEnabledComponentState<LandformsComponentProps>(groundNode, LANDFORMS_COMPONENT_TYPE)
  if (component) {
    const props = clampLandformsComponentProps(component.props)
    const activeLayers = props.layers.filter((entry) => entry.enabled && typeof entry.assetId === 'string' && entry.assetId.trim().length)
    const landformsComposeStartTime = nowMs()
    let drawnLayerCount = 0
    let totalLandformsSourcePixels = 0
    for (const layer of activeLayers) {
      const texture = await loaders.loadLandformsTextureFromAssetId(layer.assetId!.trim())
      if (shouldAbort()) {
        return null
      }
      const loaded = loadPreviewSourceFromTexture(texture)
      if (!loaded) {
        continue
      }
      context.save()
      context.globalAlpha = clamp01(normalizeFinite(layer.opacity, 1))
      context.globalCompositeOperation = resolveLayerCompositeOperation(layer.blendMode)
      applyLayerMask(context, layer, width, height)
      context.translate(width * 0.5, height * 0.5)
      context.rotate((normalizeFinite(layer.rotationDeg, 0) * Math.PI) / 180)
      context.translate(-width * 0.5, -height * 0.5)
      drawLayerTiled(context, loaded.source, layer, width, height)
      context.restore()
      drawnLayerCount += 1
      totalLandformsSourcePixels += loaded.width * loaded.height
    }
    if (activeLayers.length) {
      recordGroundSurfacePreviewPerf('compose-landforms-layers', nowMs() - landformsComposeStartTime, {
        layerCount: activeLayers.length,
        drawnLayerCount,
        previewWidth: width,
        previewHeight: height,
        totalSourcePixels: totalLandformsSourcePixels,
      })
    }
  }

  await composeGroundSurfaceChunksIntoCanvas({
    context,
    width,
    height,
    definition,
    loaders,
    shouldAbort,
  })
  if (shouldAbort()) {
    return null
  }

  recordGroundSurfacePreviewPerf('compose-preview-canvas', nowMs() - composeStartTime, {
    width,
    height,
    seededFromTexture: canSeedFromTexture,
    previewRevision: options.previewRevision ?? 0,
  })
  return { canvas, width, height }
}

function configureGroundSurfacePreviewTexture(texture: THREE.Texture, canvas: CanvasLike): THREE.Texture {
  texture.image = canvas as unknown as HTMLCanvasElement
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  ;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
  texture.needsUpdate = true
  return texture
}

async function composeGroundSurfacePreviewTexture(
  groundNode: SceneNode,
  definition: GroundDynamicMesh,
  loaders: GroundSurfacePreviewLoaders,
  options: GroundSurfacePreviewOptions,
  existingTexture: THREE.Texture | null = null,
  shouldAbort: () => boolean = () => false,
): Promise<THREE.Texture | null> {
  const result = await composeGroundSurfacePreviewCanvas(groundNode, definition, loaders, options, shouldAbort)
  if (!result) {
    return null
  }
  if (existingTexture) {
    return configureGroundSurfacePreviewTexture(existingTexture, result.canvas)
  }
  return configureGroundSurfacePreviewTexture(new THREE.CanvasTexture(result.canvas as unknown as HTMLCanvasElement), result.canvas)
}

export async function convertGroundSurfacePreviewCanvasToBlob(canvas: CanvasLike): Promise<Blob | null> {
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    return await canvas.convertToBlob({ type: 'image/png' })
  }
  if ('toBlob' in canvas && typeof canvas.toBlob === 'function') {
    return await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    })
  }
  return null
}

export function createDefaultGroundSurfacePreviewLoaders(
  resolveAssetUrlFromCache: (assetId: string) => Promise<{ url: string | null } | null>,
): GroundSurfacePreviewLoaders {
  const textureLoader = new THREE.TextureLoader()
  const terrainTextureCache = new Map<string, Promise<THREE.Texture | null>>()
  const landformsTextureCache = new Map<string, Promise<THREE.Texture | null>>()
  const baseTextureCache = new Map<string, Promise<THREE.Texture | null>>()

  function loadTerrainTextureCached(assetId: string, options: { colorSpace: 'srgb' | 'none' }): Promise<THREE.Texture | null> {
    const key = `${assetId}|${options.colorSpace}`
    const cached = terrainTextureCache.get(key)
    if (cached) {
      recordGroundSurfacePreviewPerf('load-terrain-texture-cache-hit', 0, {
        assetId,
        colorSpace: options.colorSpace,
      })
      return cached
    }
    const pending = (async () => {
      const loadStartTime = nowMs()
      const resolved = await resolveAssetUrlFromCache(assetId)
      if (!resolved?.url) {
        return null
      }
      try {
        const texture = await textureLoader.loadAsync(resolved.url)
        ;(texture as any).colorSpace = options.colorSpace === 'none'
          ? ((THREE as any).NoColorSpace ?? undefined)
          : ((THREE as any).SRGBColorSpace ?? (texture as any).colorSpace)
        texture.needsUpdate = true
        recordGroundSurfacePreviewPerf('load-terrain-texture', nowMs() - loadStartTime, {
          assetId,
          colorSpace: options.colorSpace,
          width: (texture.image as { width?: number } | undefined)?.width ?? null,
          height: (texture.image as { height?: number } | undefined)?.height ?? null,
        })
        return texture
      } catch (error) {
        console.warn('[groundSurfacePreview] Failed to load terrain paint texture', assetId, error)
        terrainTextureCache.delete(key)
        return null
      }
    })()
    terrainTextureCache.set(key, pending)
    return pending
  }

  function loadLandformsTextureCached(assetId: string): Promise<THREE.Texture | null> {
    const key = assetId
    const cached = landformsTextureCache.get(key)
    if (cached) {
      return cached
    }
    const pending = (async () => {
      const resolved = await resolveAssetUrlFromCache(assetId)
      if (!resolved?.url) {
        return null
      }
      try {
        const texture = await textureLoader.loadAsync(resolved.url)
        ;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
        texture.needsUpdate = true
        return texture
      } catch (error) {
        console.warn('[groundSurfacePreview] Failed to load landforms texture', assetId, error)
        landformsTextureCache.delete(key)
        return null
      }
    })()
    landformsTextureCache.set(key, pending)
    return pending
  }

  function loadGroundBaseTextureCached(url: string): Promise<THREE.Texture | null> {
    const key = url
    const cached = baseTextureCache.get(key)
    if (cached) {
      return cached
    }
    const pending = (async () => {
      try {
        const texture = await textureLoader.loadAsync(url)
        ;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
        texture.needsUpdate = true
        return texture
      } catch (error) {
        console.warn('[groundSurfacePreview] Failed to load ground base texture', url, error)
        baseTextureCache.delete(key)
        return null
      }
    })()
    baseTextureCache.set(key, pending)
    return pending
  }

  const terrainLoader: Pick<GroundSurfacePreviewLoaders, 'loadTerrainPaintTextureFromAssetId'> = {
    async loadTerrainPaintTextureFromAssetId(assetId: string, options: { colorSpace: 'srgb' | 'none' }) {
      return await loadTerrainTextureCached(assetId, options)
    },
  }

  const landformsLoader: LandformsPreviewLoaders = {
    async loadLandformsTextureFromAssetId(assetId) {
      return await loadLandformsTextureCached(assetId)
    },
  }

  return {
    ...terrainLoader,
    ...landformsLoader,
    async loadGroundSurfaceBaseTextureFromUrl(url) {
      const normalized = typeof url === 'string' ? url.trim() : ''
      if (!normalized) {
        return null
      }
      return await loadGroundBaseTextureCached(normalized)
    },
  }
}

export function syncGroundSurfacePreviewForGround(
  groundObject: THREE.Object3D,
  groundNode: SceneNode,
  dynamicMesh: GroundDynamicMesh,
  loaders: GroundSurfacePreviewLoaders,
  getToken: () => number,
  options: GroundSurfacePreviewOptions = {},
): boolean {
  if (!groundObject || !groundNode || dynamicMesh.type !== 'Ground') {
    restoreGroundSurfacePreviewMaterialMap(groundObject)
    clearLandformsPreviewForGround(groundObject)
    return false
  }
  const hasTerrainPaint = Boolean(
    Object.values(dynamicMesh.groundSurfaceChunks ?? {}).some((chunkRef) => typeof chunkRef?.textureAssetId === 'string' && chunkRef.textureAssetId.trim().length),
  )
  const component = resolveEnabledComponentState<LandformsComponentProps>(groundNode, LANDFORMS_COMPONENT_TYPE)
  const landformsProps = component ? clampLandformsComponentProps(component.props) : null
  const hasLandforms = Boolean(landformsProps?.layers?.some((layer) => layer.enabled && typeof layer.assetId === 'string' && layer.assetId.trim().length))
  if (!hasTerrainPaint && !hasLandforms) {
    restoreGroundSurfacePreviewMaterialMap(groundObject)
    clearLandformsPreviewForGround(groundObject)
    return false
  }
  const signature = buildGroundSurfacePreviewSignature(groundNode, dynamicMesh, options)
  const currentSignature = ((groundObject.userData as any)?.[LANDFORMS_PREVIEW_SIGNATURE_USERDATA_KEY] as string | null | undefined) ?? null
  const currentTexture = getLandformsPreviewTexture(groundObject)
  if (currentSignature === signature && currentTexture) {
    if (options.applyToMaterialMap === true) {
      applyGroundSurfacePreviewToMaterialMap(groundObject, currentTexture, dynamicMesh)
    }
    releaseGroundSurfacePreviewLiveTextureIfDifferent(groundObject, currentTexture)
    return true
  }
  const token = getToken()
  let pending = groundSurfacePreviewRequests.get(signature)
  if (!pending) {
    pending = composeGroundSurfacePreviewTexture(groundNode, dynamicMesh, loaders, options, null, () => getToken() !== token)
    groundSurfacePreviewRequests.set(signature, pending)
  }
  pending.then((texture) => {
    groundSurfacePreviewRequests.delete(signature)
    if (getToken() !== token) {
      texture?.dispose()
      return
    }
    if (!texture) {
      console.log('[groundSurfacePreview] preview missing texture', {
        previewRevision: options.previewRevision ?? null,
      })
      return
    }
    if (options.applyToMaterialMap === true) {
      applyGroundSurfacePreviewToMaterialMap(groundObject, texture, dynamicMesh)
    }
    setLandformsPreviewTexture(groundObject, signature, texture)
    releaseGroundSurfacePreviewLiveTextureIfDifferent(groundObject, texture)
  }).catch((error) => {
    groundSurfacePreviewRequests.delete(signature)
    console.warn('[groundSurfacePreview] Failed to compose surface preview texture', error)
  })
  return true
}
