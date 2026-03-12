import * as THREE from 'three'
import {
  getTerrainPaintChunkPageLogicalId,
  TERRAIN_PAINT_MAX_LAYER_COUNT,
  TERRAIN_PAINT_PAGE_COUNT,
  type GroundDynamicMesh,
  type TerrainPaintChannel,
  type TerrainPaintSettings,
} from './index'

const terrainPaintShaderStateByMaterial = new WeakMap<THREE.Material, TerrainPaintShaderState>()

const TERRAIN_PAINT_SLOT_INDICES = Array.from({ length: TERRAIN_PAINT_MAX_LAYER_COUNT - 1 }, (_, index) => index + 1)
const TERRAIN_PAINT_PAGE_INDICES = Array.from({ length: TERRAIN_PAINT_PAGE_COUNT }, (_, index) => index)
const TERRAIN_PAINT_WEIGHT_COMPONENTS = ['r', 'g', 'b', 'a'] as const

type TerrainPaintShaderState = {
  shader: any
  chunkBounds: THREE.Vector4
  layerTextures: Map<number, THREE.Texture>
  weightmaps: Map<string, Array<THREE.Texture | null>>
  defaultWeightmaps: THREE.DataTexture[]
  defaultWhite: THREE.DataTexture
}

function createDefaultWhiteTexture(): THREE.DataTexture {
  const data = new Uint8Array([255, 255, 255, 255])
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
  texture.needsUpdate = true
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  ;(texture as any).colorSpace = (THREE as any).NoColorSpace ?? undefined
  return texture
}

function createDefaultWeightmapTexture(pageIndex: number): THREE.DataTexture {
  const data = pageIndex === 0 ? new Uint8Array([255, 0, 0, 0]) : new Uint8Array([0, 0, 0, 0])
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
  texture.needsUpdate = true
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  ;(texture as any).colorSpace = (THREE as any).NoColorSpace ?? undefined
  return texture
}

function createShaderState(): TerrainPaintShaderState {
  return {
    shader: null,
    chunkBounds: new THREE.Vector4(0, 0, 1, 1),
    layerTextures: new Map(),
    weightmaps: new Map(),
    defaultWeightmaps: TERRAIN_PAINT_PAGE_INDICES.map((pageIndex) => createDefaultWeightmapTexture(pageIndex)),
    defaultWhite: createDefaultWhiteTexture(),
  }
}

function getOrCreateShaderState(material: THREE.Material): TerrainPaintShaderState {
  const existing = terrainPaintShaderStateByMaterial.get(material)
  if (existing) {
    return existing
  }

  const state = createShaderState()
  terrainPaintShaderStateByMaterial.set(material, state)
  return state
}

function resolveTerrainPaintSlotIndex(slotOrChannel: number | TerrainPaintChannel): number {
  if (typeof slotOrChannel === 'number' && Number.isFinite(slotOrChannel)) {
    return Math.max(0, Math.min(TERRAIN_PAINT_MAX_LAYER_COUNT - 1, Math.trunc(slotOrChannel)))
  }
  if (slotOrChannel === 'r') {
    return 0
  }
  if (slotOrChannel === 'g') {
    return 1
  }
  if (slotOrChannel === 'b') {
    return 2
  }
  if (slotOrChannel === 'a') {
    return 3
  }
  return 0
}

function resolveTerrainPaintPageIndex(pageIndex: number): number {
  if (!Number.isFinite(pageIndex)) {
    return 0
  }
  return Math.max(0, Math.min(TERRAIN_PAINT_PAGE_COUNT - 1, Math.trunc(pageIndex)))
}

function resolveChunkWeightmaps(state: TerrainPaintShaderState, chunkKey: string): Array<THREE.Texture | null> {
  const existing = state.weightmaps.get(chunkKey)
  if (existing) {
    return existing
  }
  const next = TERRAIN_PAINT_PAGE_INDICES.map(() => null as THREE.Texture | null)
  state.weightmaps.set(chunkKey, next)
  return next
}

function buildTerrainPaintFragmentDeclarations(): string {
  const declarations: string[] = [
    'uniform float uTerrainPaintEnabled;',
    'uniform vec4 uTerrainPaintChunkBounds;',
  ]
  TERRAIN_PAINT_PAGE_INDICES.forEach((pageIndex) => {
    declarations.push(`uniform sampler2D uTerrainPaintWeightmap${pageIndex};`)
  })
  TERRAIN_PAINT_SLOT_INDICES.forEach((slotIndex) => {
    declarations.push(`uniform sampler2D uTerrainPaintLayer${slotIndex};`)
    declarations.push(`uniform float uTerrainPaintHasLayer${slotIndex};`)
  })
  declarations.push('varying vec2 vTerrainPaintLocalXZ;')
  return declarations.join('\n')
}

function buildTerrainPaintFragmentBody(): string {
  const lines: string[] = [
    '#include <map_fragment>',
    'if (uTerrainPaintEnabled > 0.5) {',
    '  vec2 minXZ = uTerrainPaintChunkBounds.xy;',
    '  vec2 sizeXZ = max(uTerrainPaintChunkBounds.zw, vec2(0.000001));',
    '  vec2 wmUv = clamp((vTerrainPaintLocalXZ - minXZ) / sizeXZ, 0.0, 1.0);',
    '  vec2 layerUv = wmUv;',
    '#ifdef USE_UV',
    '  layerUv = vUv;',
    '#endif',
  ]
  TERRAIN_PAINT_PAGE_INDICES.forEach((pageIndex) => {
    lines.push(`  vec4 terrainPaintWeight${pageIndex} = texture2D(uTerrainPaintWeightmap${pageIndex}, wmUv);`)
  })
  lines.push('  vec3 terrainPaintBaseColor = diffuseColor.rgb;')
  lines.push('  vec3 terrainPaintAccumColor = terrainPaintBaseColor * terrainPaintWeight0.r;')
  TERRAIN_PAINT_SLOT_INDICES.forEach((slotIndex) => {
    const pageIndex = Math.floor(slotIndex / 4)
    const component = TERRAIN_PAINT_WEIGHT_COMPONENTS[slotIndex % 4]
    lines.push(`  float terrainPaintWeightSlot${slotIndex} = terrainPaintWeight${pageIndex}.${component};`)
    lines.push(`  if (terrainPaintWeightSlot${slotIndex} > 0.0001) {`)
    lines.push(`    vec3 terrainPaintLayerColor${slotIndex} = mix(terrainPaintBaseColor, texture2D(uTerrainPaintLayer${slotIndex}, layerUv).rgb, uTerrainPaintHasLayer${slotIndex});`)
    lines.push(`    terrainPaintAccumColor += terrainPaintLayerColor${slotIndex} * terrainPaintWeightSlot${slotIndex};`)
    lines.push('  }')
  })
  lines.push('  diffuseColor.rgb = terrainPaintAccumColor;')
  lines.push('}')
  return lines.join('\n')
}

const TERRAIN_PAINT_FRAGMENT_DECLARATIONS = buildTerrainPaintFragmentDeclarations()
const TERRAIN_PAINT_FRAGMENT_BODY = buildTerrainPaintFragmentBody()

function installShaderHooks(material: THREE.MeshStandardMaterial): TerrainPaintShaderState {
  const state = getOrCreateShaderState(material)
  if (state.shader) {
    return state
  }

  material.customProgramCacheKey = () => 'harmony-terrain-paint-v2'
  material.onBeforeCompile = (shader) => {
    state.shader = shader
    shader.uniforms.uTerrainPaintEnabled = { value: 0 }
    shader.uniforms.uTerrainPaintChunkBounds = { value: state.chunkBounds }
    TERRAIN_PAINT_PAGE_INDICES.forEach((pageIndex) => {
      shader.uniforms[`uTerrainPaintWeightmap${pageIndex}`] = { value: state.defaultWeightmaps[pageIndex] }
    })
    TERRAIN_PAINT_SLOT_INDICES.forEach((slotIndex) => {
      shader.uniforms[`uTerrainPaintLayer${slotIndex}`] = { value: state.defaultWhite }
      shader.uniforms[`uTerrainPaintHasLayer${slotIndex}`] = { value: 0 }
    })

    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vTerrainPaintLocalXZ;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvTerrainPaintLocalXZ = position.xz;')

    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${TERRAIN_PAINT_FRAGMENT_DECLARATIONS}\nvoid main() {`)
      .replace('#include <map_fragment>', TERRAIN_PAINT_FRAGMENT_BODY)
  }

  material.needsUpdate = true
  return state
}

function resolveChunkKeyFromMesh(mesh: THREE.Object3D): string | null {
  const chunk = (mesh.userData as any)?.groundChunk
  const row = typeof chunk?.chunkRow === 'number' ? chunk.chunkRow : null
  const col = typeof chunk?.chunkColumn === 'number' ? chunk.chunkColumn : null
  if (row === null || col === null) {
    return null
  }
  return `${row}:${col}`
}

function computeChunkBounds(definition: GroundDynamicMesh, mesh: THREE.Object3D): THREE.Vector4 | null {
  const chunk = (mesh.userData as any)?.groundChunk
  if (!chunk) {
    return null
  }
  const cellSize = Number.isFinite(definition.cellSize) && definition.cellSize > 0 ? definition.cellSize : 1
  const halfWidth = definition.width * 0.5
  const halfDepth = definition.depth * 0.5
  const startColumn = typeof chunk.startColumn === 'number' ? chunk.startColumn : 0
  const startRow = typeof chunk.startRow === 'number' ? chunk.startRow : 0
  const columns = typeof chunk.columns === 'number' ? chunk.columns : 0
  const rows = typeof chunk.rows === 'number' ? chunk.rows : 0
  const minX = -halfWidth + startColumn * cellSize
  const minZ = -halfDepth + startRow * cellSize
  const width = Math.max(1e-6, columns * cellSize)
  const depth = Math.max(1e-6, rows * cellSize)
  return new THREE.Vector4(minX, minZ, width, depth)
}

function collectActiveLayerSlots(settings: TerrainPaintSettings | null | undefined): Set<number> {
  const activeSlots = new Set<number>()
  const layers = Array.isArray(settings?.layers) ? settings.layers : []
  for (const layer of layers) {
    const slotIndex = typeof layer?.slotIndex === 'number' ? Math.trunc(layer.slotIndex) : resolveTerrainPaintSlotIndex(layer?.channel ?? 'r')
    if (slotIndex <= 0 || slotIndex >= TERRAIN_PAINT_MAX_LAYER_COUNT) {
      continue
    }
    if (layer?.enabled === false) {
      continue
    }
    activeSlots.add(slotIndex)
  }
  return activeSlots
}

export function ensureTerrainPaintPreviewInstalled(
  root: THREE.Object3D,
  definition: GroundDynamicMesh,
  settings: TerrainPaintSettings | null,
): void {
  if (!root) {
    return
  }
  ;(root.userData as any).__terrainPaintDefinition = definition
  ;(root.userData as any).__terrainPaintSettings = settings

  const materialSet = new Set<THREE.MeshStandardMaterial>()

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => {
        if (entry && entry instanceof THREE.MeshStandardMaterial) {
          materialSet.add(entry)
        }
      })
      return
    }
    if (material && material instanceof THREE.MeshStandardMaterial) {
      materialSet.add(material)
    }
  })
  if (materialSet.size === 0) {
    return
  }

  const materials = Array.from(materialSet)
  materials.forEach((material) => {
    installShaderHooks(material)
  })
  ;(root.userData as any).groundMaterials = materials
  ;(root.userData as any).groundMaterial = materials[0]

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    if (typeof (mesh.userData as any).__terrainPaintBound === 'boolean') {
      return
    }
    ;(mesh.userData as any).__terrainPaintBound = true
    mesh.onBeforeRender = (_renderer, _scene, _camera, _geometry, mat) => {
      if (!(mat instanceof THREE.MeshStandardMaterial)) {
        return
      }
      const state = getOrCreateShaderState(mat)
      if (!state.shader) {
        return
      }
      const def = (root.userData as any).__terrainPaintDefinition as GroundDynamicMesh | undefined
      const currentSettings = (root.userData as any).__terrainPaintSettings as TerrainPaintSettings | null | undefined
      if (!def) {
        return
      }
      const enabled = Boolean(currentSettings && currentSettings.version === 2)
      const activeLayerSlots = collectActiveLayerSlots(currentSettings)
      const bounds = computeChunkBounds(def, mesh)
      if (bounds) {
        state.chunkBounds.copy(bounds)
      }
      const chunkKey = resolveChunkKeyFromMesh(mesh)
      const chunkWeightmaps = chunkKey ? state.weightmaps.get(chunkKey) : null

      state.shader.uniforms.uTerrainPaintEnabled.value = enabled ? 1 : 0
      state.shader.uniforms.uTerrainPaintChunkBounds.value = state.chunkBounds
      TERRAIN_PAINT_PAGE_INDICES.forEach((pageIndex) => {
        state.shader.uniforms[`uTerrainPaintWeightmap${pageIndex}`].value = enabled
          ? chunkWeightmaps?.[pageIndex] ?? state.defaultWeightmaps[pageIndex]
          : state.defaultWeightmaps[pageIndex]
      })
      TERRAIN_PAINT_SLOT_INDICES.forEach((slotIndex) => {
        const active = enabled && activeLayerSlots.has(slotIndex)
        const texture = active ? state.layerTextures.get(slotIndex) ?? state.defaultWhite : state.defaultWhite
        state.shader.uniforms[`uTerrainPaintLayer${slotIndex}`].value = texture
        state.shader.uniforms[`uTerrainPaintHasLayer${slotIndex}`].value = active && state.layerTextures.has(slotIndex) ? 1 : 0
      })
    }
  })
}

export function setTerrainPaintPreviewWeightmapTexture(
  material: THREE.Material,
  chunkKey: string,
  texture: THREE.Texture | null,
  pageIndex = 0,
): void {
  const state = getOrCreateShaderState(material)
  if (!chunkKey) {
    return
  }
  const normalizedPageIndex = resolveTerrainPaintPageIndex(pageIndex)
  if (!texture) {
    const pages = state.weightmaps.get(chunkKey)
    if (!pages) {
      return
    }
    pages[normalizedPageIndex] = null
    if (pages.some(Boolean)) {
      state.weightmaps.set(chunkKey, pages)
    } else {
      state.weightmaps.delete(chunkKey)
    }
    return
  }
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  ;(texture as any).colorSpace = (THREE as any).NoColorSpace ?? undefined
  texture.needsUpdate = true
  const pages = resolveChunkWeightmaps(state, chunkKey)
  pages[normalizedPageIndex] = texture
  state.weightmaps.set(chunkKey, pages)
}

export function updateTerrainPaintPreviewWeightmap(
  material: THREE.Material,
  chunkKey: string,
  data: Uint8ClampedArray,
  resolution: number,
  pageIndex = 0,
): void {
  const state = getOrCreateShaderState(material)
  const normalizedPageIndex = resolveTerrainPaintPageIndex(pageIndex)
  const res = Math.max(1, Math.round(resolution))
  const bytes = new Uint8Array(data.buffer as unknown as ArrayBuffer, data.byteOffset, data.byteLength)
  const pages = resolveChunkWeightmaps(state, chunkKey)
  const existing = pages[normalizedPageIndex]
  const existingData = existing instanceof THREE.DataTexture ? existing : null
  let texture = existingData
  if (!texture || texture.image.width !== res || texture.image.height !== res) {
    texture = new THREE.DataTexture(bytes as unknown as BufferSource, res, res, THREE.RGBAFormat)
    texture.needsUpdate = true
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    ;(texture as any).colorSpace = (THREE as any).NoColorSpace ?? undefined
    pages[normalizedPageIndex] = texture
    state.weightmaps.set(chunkKey, pages)
    return
  }
  texture.image.data = bytes as unknown as Uint8Array
  texture.needsUpdate = true
  pages[normalizedPageIndex] = texture
  state.weightmaps.set(chunkKey, pages)
}

export function updateTerrainPaintPreviewLayerTexture(
  material: THREE.Material,
  slotOrChannel: number | TerrainPaintChannel,
  texture: THREE.Texture | null,
): void {
  const state = getOrCreateShaderState(material)
  const slotIndex = resolveTerrainPaintSlotIndex(slotOrChannel)
  if (slotIndex <= 0) {
    return
  }
  if (texture) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    ;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
    texture.needsUpdate = true
    state.layerTextures.set(slotIndex, texture)
    return
  }
  state.layerTextures.delete(slotIndex)
}

export async function decodeWeightmapToData(blob: Blob, resolution: number): Promise<Uint8ClampedArray> {
  const res = Math.max(1, Math.round(resolution))
  if (blob.type === 'application/octet-stream' || blob.type === 'binary/octet-stream' || blob.type === '' || blob.type === 'undefined') {
    const expectedLength = res * res * 4
    const buffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    if (bytes.length === expectedLength) {
      return new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + expectedLength))
    }
    if (bytes.length >= 10 && bytes[0] === 0x48 && bytes[1] === 0x57 && bytes[2] === 0x50 && bytes[3] === 0x31) {
      const view = new DataView(buffer)
      const storedRes = view.getUint16(4, true)
      const payloadLen = view.getUint32(6, true)
      const offset = 10
      if (storedRes !== res) {
        throw new Error(`Weightmap resolution mismatch: expected ${res}, got ${storedRes}`)
      }
      if (payloadLen !== expectedLength) {
        throw new Error(`Weightmap payload length mismatch: expected ${expectedLength}, got ${payloadLen}`)
      }
      if (offset + payloadLen > bytes.length) {
        throw new Error('Weightmap payload truncated')
      }
      const payload = bytes.subarray(offset, offset + payloadLen)
      return new Uint8ClampedArray(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength))
    }
  }
  throw new Error('Unsupported weightmap format: only the binary HWP1 weightmap format is supported')
}

export function encodeWeightmapToBinary(data: Uint8ClampedArray, resolution: number): Blob {
  const res = Math.max(1, Math.round(resolution))
  const expectedLength = res * res * 4
  const src = new Uint8Array(data.buffer as unknown as ArrayBuffer, data.byteOffset, data.byteLength)
  if (src.byteLength !== expectedLength) {
    throw new Error(`Weightmap byte length mismatch: expected ${expectedLength}, got ${src.byteLength}`)
  }
  const headerSize = 10
  const out = new Uint8Array(headerSize + expectedLength)
  out[0] = 0x48
  out[1] = 0x57
  out[2] = 0x50
  out[3] = 0x31
  const view = new DataView(out.buffer)
  view.setUint16(4, res, true)
  view.setUint32(6, expectedLength, true)
  out.set(src, headerSize)
  return new Blob([out], { type: 'application/octet-stream' })
}

export type AssetLoader = (assetId: string) => Promise<Blob | null>
export type TextureLoader = (assetId: string) => Promise<THREE.Texture | null>

export async function loadTerrainPaintAssets(
  root: THREE.Object3D,
  definition: GroundDynamicMesh,
  settings: TerrainPaintSettings,
  assetLoader: AssetLoader,
  textureLoader: TextureLoader,
): Promise<void> {
  ensureTerrainPaintPreviewInstalled(root, definition, settings)
  const materials = (root.userData as any).groundMaterials as THREE.Material[] | undefined
  const material = (root.userData as any).groundMaterial as THREE.Material | undefined
  const targets = (materials && materials.length ? materials : material ? [material] : []) as THREE.Material[]
  if (!targets.length) {
    return
  }

  TERRAIN_PAINT_SLOT_INDICES.forEach((slotIndex) => {
    targets.forEach((target) => {
      updateTerrainPaintPreviewLayerTexture(target, slotIndex, null)
    })
  })

  if (settings.layers) {
    for (const layer of settings.layers) {
      const slotIndex = typeof layer?.slotIndex === 'number' ? Math.trunc(layer.slotIndex) : resolveTerrainPaintSlotIndex(layer?.channel ?? 'r')
      if (slotIndex <= 0 || slotIndex >= TERRAIN_PAINT_MAX_LAYER_COUNT || layer?.enabled === false) {
        continue
      }
      const tex = await textureLoader(layer.textureAssetId)
      if (tex) {
        targets.forEach((target) => {
          updateTerrainPaintPreviewLayerTexture(target, slotIndex, tex)
        })
      }
    }
  }

  if (settings.chunks) {
    const promises = Object.entries(settings.chunks).map(async ([chunkKey, chunkRef]) => {
      for (const pageIndex of TERRAIN_PAINT_PAGE_INDICES) {
        const logicalId = getTerrainPaintChunkPageLogicalId(chunkRef, pageIndex)
        if (!logicalId) {
          targets.forEach((target) => {
            setTerrainPaintPreviewWeightmapTexture(target, chunkKey, null, pageIndex)
          })
          continue
        }
        const blob = await assetLoader(logicalId)
        if (!blob) {
          targets.forEach((target) => {
            setTerrainPaintPreviewWeightmapTexture(target, chunkKey, null, pageIndex)
          })
          continue
        }
        try {
          const data = await decodeWeightmapToData(blob, settings.weightmapResolution)
          targets.forEach((target) => {
            updateTerrainPaintPreviewWeightmap(target, chunkKey, data, settings.weightmapResolution, pageIndex)
          })
        } catch (error) {
          console.warn(`Failed to decode weightmap for chunk ${chunkKey} page ${pageIndex}`, error)
        }
      }
    })
    await Promise.all(promises)
  }
}

export function cloneTerrainPaintPreviewMaterialsOnce(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    if ((mesh.userData as any)?.__terrainPaintPreviewMaterialCloned) {
      return
    }
    const mat = mesh.material
    if (Array.isArray(mat)) {
      let changed = false
      const cloned = mat.map((entry) => {
        if (entry instanceof THREE.MeshStandardMaterial) {
          changed = true
          return entry.clone()
        }
        return entry
      })
      if (changed) {
        mesh.material = cloned
      }
    } else if (mat instanceof THREE.MeshStandardMaterial) {
      mesh.material = mat.clone()
    }
    ;(mesh.userData as any).__terrainPaintPreviewMaterialCloned = true
  })
}

export function collectVisibleChunkMaterials(root: THREE.Object3D): {
  visibleChunkMaterials: Map<string, THREE.MeshStandardMaterial[]>
  visibleMaterials: Set<THREE.MeshStandardMaterial>
} {
  const visibleChunkMaterials = new Map<string, THREE.MeshStandardMaterial[]>()
  const visibleMaterials = new Set<THREE.MeshStandardMaterial>()
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const chunk = (mesh.userData as any)?.groundChunk
    const row = typeof chunk?.chunkRow === 'number' ? chunk.chunkRow : null
    const col = typeof chunk?.chunkColumn === 'number' ? chunk.chunkColumn : null
    if (row === null || col === null) {
      return
    }
    const chunkKey = `${row}:${col}`
    const materials: THREE.MeshStandardMaterial[] = []
    const mat = mesh.material
    if (Array.isArray(mat)) {
      for (const entry of mat) {
        if (entry instanceof THREE.MeshStandardMaterial) {
          materials.push(entry)
        }
      }
    } else if (mat instanceof THREE.MeshStandardMaterial) {
      materials.push(mat)
    }
    if (!materials.length) {
      return
    }
    const existing = visibleChunkMaterials.get(chunkKey)
    if (existing) {
      for (const material of materials) {
        if (!existing.includes(material)) {
          existing.push(material)
        }
        visibleMaterials.add(material)
      }
      return
    }
    visibleChunkMaterials.set(chunkKey, materials)
    for (const material of materials) {
      visibleMaterials.add(material)
    }
  })
  return { visibleChunkMaterials, visibleMaterials }
}

const terrainPaintLayerTextureRequests = new Map<string, Promise<THREE.Texture | null>>()
const terrainPaintLayerTextureCache = new Map<string, THREE.Texture | null>()
const terrainPaintChunkWeightmapRequests = new Map<string, Promise<Uint8ClampedArray | null>>()
const terrainPaintChunkWeightmapDataCache = new Map<string, Uint8ClampedArray | null>()
const terrainPaintChunkRefKeys = new Map<string, string>()

export type TerrainPaintLoaders = {
  loadTerrainPaintTextureFromAssetId: (assetId: string, options: { colorSpace: 'srgb' | 'none' }) => Promise<THREE.Texture | null>
  loadTerrainPaintWeightmapDataFromAssetId: (assetId: string, resolution: number) => Promise<Uint8ClampedArray | null>
}

export function createDefaultTerrainPaintLoaders(
  resolveAssetUrlFromCache: (assetId: string) => Promise<{ url: string | null } | null>,
): TerrainPaintLoaders {
  const loader = new THREE.TextureLoader()

  async function loadTerrainPaintTextureFromAssetId(assetId: string, options: { colorSpace: 'srgb' | 'none' }) {
    const resolved = await resolveAssetUrlFromCache(assetId)
    if (!resolved?.url) {
      return null
    }
    try {
      const texture = await loader.loadAsync(resolved.url)
      if (options.colorSpace === 'srgb') {
        ;(texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? (texture as any).colorSpace
      } else {
        ;(texture as any).colorSpace = (THREE as any).NoColorSpace ?? undefined
      }
      texture.needsUpdate = true
      return texture
    } catch (error) {
      console.warn('[terrainPaintPreview] Failed to load terrain paint texture', assetId, error)
      return null
    }
  }

  async function loadTerrainPaintWeightmapDataFromAssetId(assetId: string, resolution: number) {
    const resolved = await resolveAssetUrlFromCache(assetId)
    if (!resolved?.url) {
      return null
    }
    try {
      const response = await fetch(resolved.url, { credentials: 'include' })
      if (!response.ok) {
        return null
      }
      const blob = await response.blob()
      return await decodeWeightmapToData(blob, resolution)
    } catch (error) {
      console.warn('[terrainPaintPreview] Failed to load terrain paint weightmap', assetId, error)
      return null
    }
  }

  return {
    loadTerrainPaintTextureFromAssetId,
    loadTerrainPaintWeightmapDataFromAssetId,
  }
}

export function syncTerrainPaintPreviewForGround(
  groundObject: THREE.Object3D,
  dynamicMesh: GroundDynamicMesh,
  loaders: TerrainPaintLoaders,
  getToken: () => number,
): void {
  const settings: TerrainPaintSettings | null = (dynamicMesh as any)?.terrainPaint ?? null

  cloneTerrainPaintPreviewMaterialsOnce(groundObject)
  ensureTerrainPaintPreviewInstalled(groundObject, dynamicMesh, settings)

  const { visibleChunkMaterials, visibleMaterials } = collectVisibleChunkMaterials(groundObject)
  if (!visibleMaterials.size) {
    return
  }
  const targets = Array.from(visibleMaterials)
  const token = getToken()
  const layers = Array.isArray(settings?.layers) ? settings.layers : []

  for (const slotIndex of TERRAIN_PAINT_SLOT_INDICES) {
    const layer = layers.find((candidate: any) => {
      const candidateSlotIndex = typeof candidate?.slotIndex === 'number'
        ? Math.trunc(candidate.slotIndex)
        : resolveTerrainPaintSlotIndex(candidate?.channel ?? 'r')
      return candidateSlotIndex === slotIndex && candidate?.enabled !== false
    })
    const assetId = typeof layer?.textureAssetId === 'string' ? layer.textureAssetId.trim() : ''
    if (!assetId) {
      targets.forEach((target) => {
        updateTerrainPaintPreviewLayerTexture(target, slotIndex, null)
      })
      continue
    }
    const cachedTexture = terrainPaintLayerTextureCache.get(assetId)
    if (cachedTexture !== undefined) {
      targets.forEach((target) => {
        updateTerrainPaintPreviewLayerTexture(target, slotIndex, cachedTexture)
      })
      continue
    }
    let pending = terrainPaintLayerTextureRequests.get(assetId)
    if (!pending) {
      pending = loaders.loadTerrainPaintTextureFromAssetId(assetId, { colorSpace: 'srgb' })
      terrainPaintLayerTextureRequests.set(assetId, pending)
    }
    pending.then((texture) => {
      terrainPaintLayerTextureCache.set(assetId, texture)
      if (getToken() !== token) {
        return
      }
      targets.forEach((target) => {
        updateTerrainPaintPreviewLayerTexture(target, slotIndex, texture)
      })
    })
  }

  const chunks = settings?.chunks && typeof settings.chunks === 'object' ? settings.chunks : null
  if (!chunks) {
    return
  }

  for (const [chunkKey, chunkTargets] of visibleChunkMaterials) {
    const ref = (chunks as any)[chunkKey]
    const logicalIds = TERRAIN_PAINT_PAGE_INDICES.map((pageIndex) => getTerrainPaintChunkPageLogicalId(ref, pageIndex))
    const refKey = logicalIds.join('|')
    const previousRefKey = terrainPaintChunkRefKeys.get(chunkKey)
    if (previousRefKey !== refKey) {
      terrainPaintChunkRefKeys.set(chunkKey, refKey)
      chunkTargets.forEach((target) => {
        TERRAIN_PAINT_PAGE_INDICES.forEach((pageIndex) => {
          setTerrainPaintPreviewWeightmapTexture(target, chunkKey, null, pageIndex)
        })
      })
    }

    TERRAIN_PAINT_PAGE_INDICES.forEach((pageIndex) => {
      const logicalId = logicalIds[pageIndex] ?? ''
      if (!logicalId.length) {
        chunkTargets.forEach((target) => {
          setTerrainPaintPreviewWeightmapTexture(target, chunkKey, null, pageIndex)
        })
        return
      }
      const cacheKey = `${pageIndex}:${logicalId}:${settings?.weightmapResolution ?? 256}`
      const cachedData = terrainPaintChunkWeightmapDataCache.get(cacheKey)
      if (cachedData !== undefined) {
        if (cachedData) {
          chunkTargets.forEach((target) => {
            updateTerrainPaintPreviewWeightmap(target, chunkKey, cachedData, settings?.weightmapResolution ?? 256, pageIndex)
          })
        } else {
          chunkTargets.forEach((target) => {
            setTerrainPaintPreviewWeightmapTexture(target, chunkKey, null, pageIndex)
          })
        }
        return
      }

      let pending = terrainPaintChunkWeightmapRequests.get(cacheKey)
      if (!pending) {
        pending = loaders.loadTerrainPaintWeightmapDataFromAssetId(logicalId, settings?.weightmapResolution ?? 256)
        terrainPaintChunkWeightmapRequests.set(cacheKey, pending)
      }
      pending.then((data) => {
        terrainPaintChunkWeightmapDataCache.set(cacheKey, data)
        if (getToken() !== token) {
          return
        }
        if (terrainPaintChunkRefKeys.get(chunkKey) !== refKey) {
          return
        }
        if (data) {
          chunkTargets.forEach((target) => {
            updateTerrainPaintPreviewWeightmap(target, chunkKey, data, settings?.weightmapResolution ?? 256, pageIndex)
          })
        } else {
          chunkTargets.forEach((target) => {
            setTerrainPaintPreviewWeightmapTexture(target, chunkKey, null, pageIndex)
          })
        }
      })
    })
  }
}
