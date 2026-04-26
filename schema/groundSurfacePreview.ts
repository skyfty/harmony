import * as THREE from 'three'
import type {
  GroundDynamicMesh,
  SceneNode,
} from './index'
import { resolveGroundWorkingSpanMeters } from './index'
import { stableSerialize } from './stableSerialize'
// resolveEnabledComponentState removed with Landforms feature
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

type RuntimeCanvasLike = {
  width: number
  height: number
  getContext: (contextId: '2d') => Canvas2DContext | null
}

type CanvasLike = OffscreenCanvas | HTMLCanvasElement | RuntimeCanvasLike

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

type GroundSurfacePreviewStructureSignature = {
  width: number
  depth: number
  textureDataUrl: string | null
  maxResolution: number
}

type GroundSurfacePreviewRuntimeState = {
  canvas: CanvasLike
  texture: THREE.Texture | null
  structureSignature: string
  chunkSignatureByKey: Map<string, string>
}

type GroundSurfaceChunkPixelRect = {
  drawX: number
  drawY: number
  drawRight: number
  drawBottom: number
  drawWidth: number
  drawHeight: number
}

type GroundSurfacePreviewPerfBucket = {
  count: number
  totalMs: number
  maxMs: number
  lastMs: number
  lastDetails: Record<string, unknown>
}

type GroundSurfacePreviewPerfStats = Record<string, GroundSurfacePreviewPerfBucket>

export type GroundSurfacePreviewLoaders = {
  loadTerrainPaintTextureFromAssetId: (assetId: string, options: { colorSpace: 'srgb' | 'none' }) => Promise<THREE.Texture | null>
  loadGroundSurfaceBaseTextureFromUrl: (url: string) => Promise<THREE.Texture | null>
}

export type GroundSurfacePreviewOptions = {
  maxResolution?: number
  previewRevision?: number
  applyToMaterialMap?: boolean
  reuseCanvas?: CanvasLike | null
  seedTexture?: THREE.Texture | null
  chunkKeys?: Iterable<string> | null
  preserveCanvas?: boolean
}

const GROUND_SURFACE_PREVIEW_LIVE_TEXTURE_KEY = '__groundSurfacePreviewLiveTexture'
const groundSurfacePreviewShaderStateByMaterial = new WeakMap<THREE.MeshStandardMaterial, GroundSurfacePreviewShaderState>()
const groundSurfacePreviewStateByGroundObject = new WeakMap<THREE.Object3D, GroundSurfacePreviewRuntimeState>()

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

function buildGroundSurfacePreviewStructureSignature(definition: GroundDynamicMesh, options: GroundSurfacePreviewOptions): string {
  const spanMeters = resolveGroundWorkingSpanMeters(definition)
  return stableSerialize({
    width: normalizeDimension(spanMeters),
    depth: normalizeDimension(spanMeters),
    textureDataUrl: definition.textureDataUrl ?? null,
    maxResolution: options.maxResolution ?? DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION,
  } satisfies GroundSurfacePreviewStructureSignature)
}

function getGroundSurfaceChunkSignature(chunkRef: { textureAssetId?: string | null; revision?: number } | null | undefined): string {
  const textureAssetId = typeof chunkRef?.textureAssetId === 'string' ? chunkRef.textureAssetId.trim() : ''
  if (!textureAssetId) {
    return ''
  }
  const revision = Number.isFinite(chunkRef?.revision) ? Math.max(0, Math.trunc(Number(chunkRef?.revision))) : 0
  return `${textureAssetId}|${revision}`
}

function resolveGroundSurfaceChunkDrawEntries(
  definition: GroundDynamicMesh,
  chunkKeys?: Iterable<string> | null,
): GroundSurfaceChunkDrawEntry[] {
  const chunkMap = definition.groundSurfaceChunks ?? {}
  const entries: GroundSurfaceChunkDrawEntry[] = []
  const keys = chunkKeys ? Array.from(chunkKeys) : Object.keys(chunkMap)
  for (const chunkKey of keys) {
    const normalizedChunkKey = typeof chunkKey === 'string' ? chunkKey.trim() : ''
    if (!normalizedChunkKey) {
      continue
    }
    const parts = parseTerrainPaintChunkKey(normalizedChunkKey)
    if (!parts) {
      continue
    }
    const bounds = resolveTerrainPaintChunkBounds(definition, parts.chunkRow, parts.chunkColumn)
    if (!bounds) {
      continue
    }
    const textureAssetId = typeof chunkMap[normalizedChunkKey]?.textureAssetId === 'string'
      ? chunkMap[normalizedChunkKey].textureAssetId.trim()
      : ''
    entries.push({
      chunkKey: normalizedChunkKey,
      textureAssetId,
      bounds,
    })
  }
  return entries
}

function resolveGroundSurfacePreviewDirtyChunkKeys(
  previousState: GroundSurfacePreviewRuntimeState | null,
  definition: GroundDynamicMesh,
): string[] {
  if (!previousState) {
    return []
  }
  const nextChunks = definition.groundSurfaceChunks ?? {}
  const dirtyKeys = new Set<string>()
  for (const [chunkKey, chunkRef] of Object.entries(nextChunks)) {
    const nextSignature = getGroundSurfaceChunkSignature(chunkRef)
    if (!nextSignature) {
      continue
    }
    if (previousState.chunkSignatureByKey.get(chunkKey) !== nextSignature) {
      dirtyKeys.add(chunkKey)
    }
  }
  for (const previousKey of previousState.chunkSignatureByKey.keys()) {
    if (!Object.prototype.hasOwnProperty.call(nextChunks, previousKey)) {
      dirtyKeys.add(previousKey)
    }
  }
  return Array.from(dirtyKeys)
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


function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  if (value <= min) {
    return min
  }
  if (value >= max) {
    return max
  }
  return Math.trunc(value)
}

function resolveGroundChunkPixelRect(
  bounds: TerrainPaintChunkBounds,
  groundWidth: number,
  groundDepth: number,
  halfWidth: number,
  halfDepth: number,
  canvasWidth: number,
  canvasHeight: number,
): GroundSurfaceChunkPixelRect | null {
  if (!(canvasWidth > 0) || !(canvasHeight > 0)) {
    return null
  }
  const minPxX = ((bounds.minX + halfWidth) / groundWidth) * canvasWidth
  const minPxY = ((bounds.minZ + halfDepth) / groundDepth) * canvasHeight
  const maxPxX = ((bounds.minX + bounds.width + halfWidth) / groundWidth) * canvasWidth
  const maxPxY = ((bounds.minZ + bounds.depth + halfDepth) / groundDepth) * canvasHeight
  const drawX = clampInt(Math.floor(minPxX), 0, Math.max(0, canvasWidth - 1))
  const drawY = clampInt(Math.floor(minPxY), 0, Math.max(0, canvasHeight - 1))
  const drawRight = clampInt(Math.ceil(maxPxX), drawX + 1, canvasWidth)
  const drawBottom = clampInt(Math.ceil(maxPxY), drawY + 1, canvasHeight)
  const drawWidth = drawRight - drawX
  const drawHeight = drawBottom - drawY
  if (drawWidth <= 0 || drawHeight <= 0) {
    return null
  }
  return {
    drawX,
    drawY,
    drawRight,
    drawBottom,
    drawWidth,
    drawHeight,
  }
}

function createWeChatOffscreenCanvas(width: number, height: number): CanvasLike | null {
  const globalScope = globalThis as typeof globalThis & {
    wx?: {
      createOffscreenCanvas?: (options?: { type?: '2d'; width?: number; height?: number }) => RuntimeCanvasLike | null
      getSystemInfoSync?: () => unknown
    }
  }
  const factory = globalScope.wx?.createOffscreenCanvas
  if (typeof factory !== 'function') {
    return null
  }
  try {
    const canvas = factory({ type: '2d', width, height }) ?? factory()
    if (!canvas || typeof canvas.getContext !== 'function') {
      return null
    }
    canvas.width = width
    canvas.height = height
    return canvas
  } catch (error) {
    console.warn('[groundSurfacePreview] Failed to create WeChat offscreen canvas', {
      width,
      height,
      error,
    })
    return null
  }
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
  const weChatCanvas = createWeChatOffscreenCanvas(normalizedWidth, normalizedHeight)
  if (weChatCanvas) {
    const context = weChatCanvas.getContext('2d') as Canvas2DContext | null
    if (context) {
      console.log('[groundSurfacePreview] Using WeChat offscreen canvas for preview composition', {
        width: normalizedWidth,
        height: normalizedHeight,
      })
      return { canvas: weChatCanvas, context }
    }
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas')
    canvas.width = normalizedWidth
    canvas.height = normalizedHeight
    const context = canvas.getContext('2d') as Canvas2DContext | null
    if (context) {
      return { canvas, context }
    }
  }
  console.warn('[groundSurfacePreview] Unable to create composition canvas', {
    width: normalizedWidth,
    height: normalizedHeight,
    hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    hasWeChatOffscreenCanvas: Boolean((globalThis as { wx?: { createOffscreenCanvas?: unknown } }).wx?.createOffscreenCanvas),
    hasDocumentCanvas: typeof document !== 'undefined' && typeof document.createElement === 'function',
  })
  return null
}

function computePreviewTextureSize(definition: GroundDynamicMesh, maxResolution: number): { width: number; height: number } {
  const spanMeters = resolveGroundWorkingSpanMeters(definition)
  const groundWidth = normalizeDimension(spanMeters)
  const groundDepth = normalizeDimension(spanMeters)
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
    console.warn('[groundSurfacePreview] Texture missing drawable image source', {
      textureUuid: texture?.uuid ?? null,
      imageType: texture?.image ? (texture.image as { constructor?: { name?: string } }).constructor?.name ?? typeof texture.image : null,
    })
    return null
  }
  const size = resolveCanvasImageSourceSize(source)
  if (!size) {
    const candidate = source as { width?: number; height?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; constructor?: { name?: string } }
    console.warn('[groundSurfacePreview] Texture image source has invalid size', {
      textureUuid: texture?.uuid ?? null,
      sourceType: candidate.constructor?.name ?? typeof source,
      width: candidate.width ?? candidate.videoWidth ?? candidate.naturalWidth ?? null,
      height: candidate.height ?? candidate.videoHeight ?? candidate.naturalHeight ?? null,
    })
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
  const spanMeters = resolveGroundWorkingSpanMeters(definition)
  const width = Math.max(1e-6, normalizeDimension(spanMeters))
  const depth = Math.max(1e-6, normalizeDimension(spanMeters))
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
  let liveTexture = getGroundSurfacePreviewLiveTexture(groundObject)
  const seedTexture = null
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

  // Restoring edge pixels from a stable base avoids transparent seams at chunk joins during live paint.
  let boundaryRestoreSource: CanvasImageSource | null = seedSource
  if (!boundaryRestoreSource && canReuseCanvas) {
    const snapshot = createCompositionCanvas(width, height)
    if (snapshot) {
      snapshot.context.drawImage(canvas as unknown as CanvasImageSource, 0, 0, width, height)
      boundaryRestoreSource = snapshot.canvas as unknown as CanvasImageSource
    }
  }

  const spanMeters = resolveGroundWorkingSpanMeters(dynamicMesh)
  const groundWidth = Math.max(1e-6, normalizeDimension(spanMeters))
  const groundDepth = Math.max(1e-6, normalizeDimension(spanMeters))
  const halfWidth = groundWidth * 0.5
  const halfDepth = groundDepth * 0.5
  for (const preview of validPreviews) {
    const drawRect = resolveGroundChunkPixelRect(
      preview.bounds,
      groundWidth,
      groundDepth,
      halfWidth,
      halfDepth,
      width,
      height,
    )
    if (!drawRect) {
      continue
    }
    const { drawX, drawY, drawRight, drawBottom, drawWidth, drawHeight } = drawRect

    // Feathered brush pixels can sit on chunk boundaries; restore a 1px safety ring from base pixels.
    const clearX = Math.max(0, drawX - 1)
    const clearY = Math.max(0, drawY - 1)
    const clearRight = Math.min(width, drawRight + 1)
    const clearBottom = Math.min(height, drawBottom + 1)
    const clearWidth = clearRight - clearX
    const clearHeight = clearBottom - clearY
    if (clearWidth > 0 && clearHeight > 0) {
      if (boundaryRestoreSource) {
        context.save()
        context.beginPath()
        context.rect(clearX, clearY, clearWidth, clearHeight)
        context.clip()
        context.globalCompositeOperation = 'source-over'
        context.drawImage(boundaryRestoreSource, 0, 0, width, height)
        context.restore()
      } else {
        // Avoid punching transparent gutters when no base texture is available yet.
        context.clearRect(drawX, drawY, drawWidth, drawHeight)
      }
    }

    // Use copy in a clipped chunk rect so repeated live syncs overwrite pixels instead of alpha-compositing.
    context.save()
    context.beginPath()
    context.rect(drawX, drawY, drawWidth, drawHeight)
    context.clip()
    context.globalCompositeOperation = 'copy'
    context.drawImage(preview.canvas as unknown as CanvasImageSource, drawX, drawY, drawWidth, drawHeight)
    context.restore()
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
  groundSurfacePreviewStateByGroundObject.delete(root)
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
  chunkKeys?: Iterable<string> | null
}): Promise<boolean> {
  const { context, width, height, definition, loaders, shouldAbort, chunkKeys } = params
  const composeStartTime = nowMs()
  const chunkEntries = resolveGroundSurfaceChunkDrawEntries(definition, chunkKeys)
  if (!chunkEntries.length) {
    return false
  }

  const spanMeters = resolveGroundWorkingSpanMeters(definition)
  const groundWidth = Math.max(1e-6, normalizeDimension(spanMeters))
  const groundDepth = Math.max(1e-6, normalizeDimension(spanMeters))
  const halfWidth = groundWidth * 0.5
  const halfDepth = groundDepth * 0.5
  const drawableChunks = chunkEntries.filter((entry) => typeof entry.textureAssetId === 'string' && entry.textureAssetId.trim().length)

  let drewAny = false
  let drawnChunkCount = 0
  let totalSourcePixels = 0
  let batchCount = 0
  const batchSize = Math.max(1, Math.min(GROUND_SURFACE_PREVIEW_TERRAIN_CHUNK_LOAD_CONCURRENCY, Math.max(1, drawableChunks.length)))

  for (let batchStart = 0; batchStart < chunkEntries.length; batchStart += batchSize) {
    if (shouldAbort()) {
      console.log('[groundSurfacePreview] Aborting chunk composition before batch', {
        batchStart,
        drawableChunkCount: chunkEntries.length,
      })
      return false
    }
    const batch = chunkEntries.slice(batchStart, batchStart + batchSize)
    batchCount += 1
    const loadedBatch = await Promise.all(batch.map(async (entry) => {
      const textureAssetId = entry.textureAssetId.trim()
      if (!textureAssetId) {
        return {
          entry,
          loaded: null,
        }
      }
      try {
        const texture = await loaders.loadTerrainPaintTextureFromAssetId(textureAssetId, { colorSpace: 'srgb' })
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
      console.log('[groundSurfacePreview] Aborting chunk composition after batch load', {
        batchStart,
        drawableChunkCount: chunkEntries.length,
      })
      return false
    }
    for (const { entry, loaded } of loadedBatch) {
      const drawRect = resolveGroundChunkPixelRect(
        entry.bounds,
        groundWidth,
        groundDepth,
        halfWidth,
        halfDepth,
        width,
        height,
      )
      if (!drawRect) {
        continue
      }
      const { drawX, drawY, drawWidth, drawHeight } = drawRect
      if (!loaded) {
        context.clearRect(drawX, drawY, drawWidth, drawHeight)
        continue
      }
      context.clearRect(drawX, drawY, drawWidth, drawHeight)
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

  if (!drewAny && drawableChunks.length) {
    console.warn('[groundSurfacePreview] No terrain paint chunks were drawable', {
      drawableChunkCount: drawableChunks.length,
      chunkAssetIds: drawableChunks.slice(0, 8).map((entry) => entry.textureAssetId),
    })
  }

  return drewAny
}

function buildGroundSurfacePreviewSignature(definition: GroundDynamicMesh, options: GroundSurfacePreviewOptions): string {
  return stableSerialize({
    width: normalizeDimension(resolveGroundWorkingSpanMeters(definition)),
    depth: normalizeDimension(resolveGroundWorkingSpanMeters(definition)),
    textureDataUrl: definition.textureDataUrl ?? null,
    groundSurfaceChunks: definition.groundSurfaceChunks ?? null,
    previewRevision: options.previewRevision ?? 0,
    maxResolution: options.maxResolution ?? DEFAULT_GROUND_SURFACE_PREVIEW_MAX_RESOLUTION,
  })
}

export async function composeGroundSurfacePreviewCanvas(
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
    console.warn('[groundSurfacePreview] Preview canvas composition unavailable', {
      previewWidth: previewSize.width,
      previewHeight: previewSize.height,
      previewRevision: options.previewRevision ?? null,
    })
    return null
  }
  const { canvas, context } = composition
  const width = (canvas as HTMLCanvasElement).width ?? (canvas as OffscreenCanvas).width
  const height = (canvas as HTMLCanvasElement).height ?? (canvas as OffscreenCanvas).height
  if (!options.preserveCanvas) {
    context.clearRect(0, 0, width, height)
  }
  if (seedImageSource && !options.preserveCanvas) {
    context.drawImage(seedImageSource, 0, 0, width, height)
  }


  await composeGroundSurfaceChunksIntoCanvas({
    context,
    width,
    height,
    definition,
    loaders,
    shouldAbort,
    chunkKeys: options.chunkKeys ?? null,
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
  definition: GroundDynamicMesh,
  loaders: GroundSurfacePreviewLoaders,
  options: GroundSurfacePreviewOptions,
  existingTexture: THREE.Texture | null = null,
  shouldAbort: () => boolean = () => false,
): Promise<THREE.Texture | null> {
  const result = await composeGroundSurfacePreviewCanvas(definition, loaders, options, shouldAbort)
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
        // Cache miss can be transient while assets hydrate; allow future retries.
        terrainTextureCache.delete(key)
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

  return {
    ...terrainLoader,
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
    return false
  }
  const hasTerrainPaint = Boolean(
    Object.values(dynamicMesh.groundSurfaceChunks ?? {}).some((chunkRef) => typeof chunkRef?.textureAssetId === 'string' && chunkRef.textureAssetId.trim().length),
  )
  if (!hasTerrainPaint) {
    restoreGroundSurfacePreviewMaterialMap(groundObject)
    return false
  }
  const signature = buildGroundSurfacePreviewSignature(dynamicMesh, options)
  const structureSignature = buildGroundSurfacePreviewStructureSignature(dynamicMesh, options)
  const nextChunkSignatureByKey = new Map<string, string>()
  for (const [chunkKey, chunkRef] of Object.entries(dynamicMesh.groundSurfaceChunks ?? {})) {
    nextChunkSignatureByKey.set(chunkKey, getGroundSurfaceChunkSignature(chunkRef))
  }
  const previousState = groundSurfacePreviewStateByGroundObject.get(groundObject) ?? null
  const dirtyChunkKeys = previousState && previousState.structureSignature === structureSignature
    ? resolveGroundSurfacePreviewDirtyChunkKeys(previousState, dynamicMesh)
    : []
  const token = getToken()
  let pending = groundSurfacePreviewRequests.get(signature)
  if (!pending) {
    if (
      previousState
      && previousState.structureSignature === structureSignature
      && previousState.canvas
      && dirtyChunkKeys.length > 0
    ) {
      pending = (async () => {
        const result = await composeGroundSurfacePreviewCanvas(dynamicMesh, loaders, {
          ...options,
          reuseCanvas: previousState.canvas,
          preserveCanvas: true,
          chunkKeys: dirtyChunkKeys,
        }, () => getToken() !== token)
        if (!result) {
          return null
        }
        const nextTexture = previousState.texture && previousState.texture.image === result.canvas
          ? configureGroundSurfacePreviewTexture(previousState.texture, result.canvas)
          : configureGroundSurfacePreviewTexture(new THREE.CanvasTexture(result.canvas as unknown as HTMLCanvasElement), result.canvas)
        groundSurfacePreviewStateByGroundObject.set(groundObject, {
          canvas: result.canvas,
          texture: nextTexture,
          structureSignature,
          chunkSignatureByKey: nextChunkSignatureByKey,
        })
        return nextTexture
      })()
    } else {
      pending = composeGroundSurfacePreviewTexture(dynamicMesh, loaders, options, null, () => getToken() !== token)
    }
    groundSurfacePreviewRequests.set(signature, pending)
  }
  pending.then((texture) => {
    groundSurfacePreviewRequests.delete(signature)
    if (getToken() !== token) {
      console.log('[groundSurfacePreview] Dropping composed preview because token changed', {
        previewRevision: options.previewRevision ?? null,
      })
      texture?.dispose()
      return
    }
    if (!texture) {
      console.log('[groundSurfacePreview] preview missing texture', {
        previewRevision: options.previewRevision ?? null,
        hasTerrainPaint,
        terrainPaintChunkCount: Object.keys(dynamicMesh.groundSurfaceChunks ?? {}).length,
        surfaceRevision: Number.isFinite((dynamicMesh as { surfaceRevision?: number }).surfaceRevision)
          ? Math.trunc((dynamicMesh as { surfaceRevision?: number }).surfaceRevision as number)
          : null,
      })
      return
    }
    const canvas = texture.image as CanvasLike
    groundSurfacePreviewStateByGroundObject.set(groundObject, {
      canvas,
      texture,
      structureSignature,
      chunkSignatureByKey: nextChunkSignatureByKey,
    })
    if (options.applyToMaterialMap === true) {
      applyGroundSurfacePreviewToMaterialMap(groundObject, texture, dynamicMesh)
    }
    releaseGroundSurfacePreviewLiveTextureIfDifferent(groundObject, texture)
  }).catch((error) => {
    groundSurfacePreviewRequests.delete(signature)
    console.warn('[groundSurfacePreview] Failed to compose surface preview texture', error)
  })
  return true
}
