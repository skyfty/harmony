import * as THREE from 'three'
import type { SceneAssetRegistryEntry, SceneMaterialTextureSlot } from '@schema'
import { disposeMaterialTextures } from '@schema/material'
import { applyMaterialConfigToMaterial, createTextureSettings } from '@/types/material'
import type {
  SceneMaterial,
  SceneMaterialProps,
  SceneMaterialSide,
  SceneMaterialTextureRef,
  SceneMaterialTextureSettings,
  SceneMaterialType,
} from '@/types/material'
import type { ProjectAsset } from '@/types/project-asset'
import { sanitizeSceneAssetRegistry } from '@/utils/assetDependencySubset'
import { disposeThumbnailObject, renderObjectThumbnailDataUrl } from '@/utils/objectThumbnailRenderer'

const MATERIAL_ASSET_FORMAT = 'harmony-material'
const MATERIAL_ASSET_VERSION = 1
const TEXTURE_SLOTS: SceneMaterialTextureSlot[] = ['albedo', 'normal', 'metalness', 'roughness', 'ao', 'emissive', 'displacement']

const DEFAULT_PROPS: SceneMaterialProps = {
  color: '#ffffff',
  transparent: false,
  opacity: 1,
  side: 'front',
  wireframe: false,
  metalness: 0.1,
  roughness: 1,
  emissive: '#000000',
  emissiveIntensity: 0,
  aoStrength: 1,
  envMapIntensity: 1,
  textures: createEmptyTextureMap(),
}

export type MaterialAssetDocument = {
  format: typeof MATERIAL_ASSET_FORMAT
  version: typeof MATERIAL_ASSET_VERSION
  name: string
  description?: string
  type?: SceneMaterialType
  props: SceneMaterialProps
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
}

export type ParsedMaterialAsset = {
  props: SceneMaterialProps
  name?: string
  description?: string
  type?: SceneMaterialType
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
}

function createEmptyTextureMap(): Partial<Record<SceneMaterialTextureSlot, SceneMaterialTextureRef | null>> {
  return {
    albedo: null,
    normal: null,
    metalness: null,
    roughness: null,
    ao: null,
    emissive: null,
    displacement: null,
  }
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}

function normalizeHexColor(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw.length) {
    return fallback
  }
  const normalized = raw.startsWith('#') ? raw : `#${raw}`
  return /^#([0-9a-fA-F]{6})$/.test(normalized) ? `#${normalized.slice(1).toLowerCase()}` : fallback
}

function cloneTextureRef(ref?: SceneMaterialTextureRef | null): SceneMaterialTextureRef | null {
  if (!ref) {
    return null
  }
  return {
    assetId: ref.assetId,
    name: ref.name,
    settings: ref.settings ? createTextureSettings(ref.settings) : undefined,
  }
}

function cloneMaterialProps(props: SceneMaterialProps): SceneMaterialProps {
  const textures = createEmptyTextureMap()
  TEXTURE_SLOTS.forEach((slot) => {
    textures[slot] = cloneTextureRef(props.textures?.[slot] ?? null)
  })
  return {
    color: props.color,
    transparent: props.transparent,
    opacity: props.opacity,
    side: props.side,
    wireframe: props.wireframe,
    metalness: props.metalness,
    roughness: props.roughness,
    emissive: props.emissive,
    emissiveIntensity: props.emissiveIntensity,
    aoStrength: props.aoStrength,
    envMapIntensity: props.envMapIntensity,
    textures,
  }
}

function sanitizeMaterialType(value: unknown): SceneMaterialType | undefined {
  return typeof value === 'string' && value.trim().length ? (value.trim() as SceneMaterialType) : undefined
}

export function buildMaterialAssetFilename(name: string): string {
  const trimmed = name.trim() || 'material'
  const normalized = trimmed.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()
  const base = normalized.length ? normalized : 'material'
  return base.toLowerCase().endsWith('.material') ? base : `${base}.material`
}

export function collectMaterialAssetDependencyIds(material: Pick<SceneMaterialProps, 'textures'> | SceneMaterial): string[] {
  const bucket = new Set<string>()
  TEXTURE_SLOTS.forEach((slot) => {
    const assetId = typeof material.textures?.[slot]?.assetId === 'string' ? material.textures[slot]?.assetId.trim() : ''
    if (assetId) {
      bucket.add(assetId)
    }
  })
  return Array.from(bucket)
}

export function createMaterialAssetDocument(
  material: Pick<SceneMaterial, 'name' | 'description' | 'type'> & SceneMaterialProps,
  options: { assetRegistry?: Record<string, SceneAssetRegistryEntry> | null } = {},
): MaterialAssetDocument {
  const assetRegistry = options.assetRegistry ? sanitizeSceneAssetRegistry(options.assetRegistry) : undefined
  return {
    format: MATERIAL_ASSET_FORMAT,
    version: MATERIAL_ASSET_VERSION,
    name: material.name,
    description: material.description,
    type: material.type,
    props: cloneMaterialProps(material),
    assetRegistry,
  }
}

export function serializeMaterialAsset(
  material: Pick<SceneMaterial, 'name' | 'description' | 'type'> & SceneMaterialProps,
  options: { assetRegistry?: Record<string, SceneAssetRegistryEntry> | null } = {},
): string {
  return JSON.stringify(createMaterialAssetDocument(material, options), null, 2)
}

export function parseMaterialAssetDocument(data: unknown): ParsedMaterialAsset | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const sourceRecord = data as Record<string, unknown>
  const payload = sourceRecord.props
  const source = payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : sourceRecord

  const texturesInput = source.textures && typeof source.textures === 'object'
    ? (source.textures as Record<string, unknown>)
    : {}
  const textures = createEmptyTextureMap()
  TEXTURE_SLOTS.forEach((slot) => {
    const entry = texturesInput[slot]
    if (!entry || typeof entry !== 'object') {
      textures[slot] = null
      return
    }
    const ref = entry as Record<string, unknown>
    if (typeof ref.assetId === 'string' && ref.assetId.trim().length) {
      const settings = typeof ref.settings === 'object' && ref.settings
        ? createTextureSettings(ref.settings as Partial<SceneMaterialTextureSettings>)
        : undefined
      textures[slot] = {
        assetId: ref.assetId.trim(),
        name: typeof ref.name === 'string' ? ref.name : undefined,
        settings,
      }
      return
    }
    textures[slot] = null
  })

  const props: SceneMaterialProps = {
    color: normalizeHexColor(source.color, DEFAULT_PROPS.color),
    transparent: typeof source.transparent === 'boolean' ? source.transparent : DEFAULT_PROPS.transparent,
    opacity: clampNumber(Number(source.opacity ?? DEFAULT_PROPS.opacity), 0, 1, DEFAULT_PROPS.opacity),
    side: (typeof source.side === 'string' && ['front', 'back', 'double'].includes(source.side)
      ? source.side
      : DEFAULT_PROPS.side) as SceneMaterialSide,
    wireframe: typeof source.wireframe === 'boolean' ? source.wireframe : DEFAULT_PROPS.wireframe,
    metalness: clampNumber(Number(source.metalness ?? DEFAULT_PROPS.metalness), 0, 1, DEFAULT_PROPS.metalness),
    roughness: clampNumber(Number(source.roughness ?? DEFAULT_PROPS.roughness), 0, 1, DEFAULT_PROPS.roughness),
    emissive: normalizeHexColor(source.emissive, DEFAULT_PROPS.emissive),
    emissiveIntensity: clampNumber(Number(source.emissiveIntensity ?? DEFAULT_PROPS.emissiveIntensity), 0, 16, DEFAULT_PROPS.emissiveIntensity),
    aoStrength: clampNumber(Number(source.aoStrength ?? DEFAULT_PROPS.aoStrength), 0, 4, DEFAULT_PROPS.aoStrength),
    envMapIntensity: clampNumber(Number(source.envMapIntensity ?? DEFAULT_PROPS.envMapIntensity), 0, 8, DEFAULT_PROPS.envMapIntensity),
    textures,
  }

  const name = typeof sourceRecord.name === 'string' ? sourceRecord.name : undefined
  const description = typeof sourceRecord.description === 'string' ? sourceRecord.description : undefined
  const type = sanitizeMaterialType(sourceRecord.type ?? source.type)
  const assetRegistry = sanitizeSceneAssetRegistry(sourceRecord.assetRegistry)

  return { props, name, description, type, assetRegistry }
}

async function ensureMaterialTextureFile(
  assetCacheStore: {
    ensureAssetFile: (assetId: string, options?: { asset?: ProjectAsset | null }) => Promise<File | null>
  },
  assetId: string,
  getAsset?: (assetId: string) => ProjectAsset | null,
): Promise<File | null> {
  const asset = getAsset?.(assetId) ?? null
  return await assetCacheStore.ensureAssetFile(assetId, { asset })
}

export function createMaterialAssetTextureResolver(options: {
  assetCacheStore: {
    ensureAssetFile: (assetId: string, options?: { asset?: ProjectAsset | null }) => Promise<File | null>
  }
  getAsset?: (assetId: string) => ProjectAsset | null
}): (ref: SceneMaterialTextureRef) => Promise<THREE.Texture | null> {
  return async (ref: SceneMaterialTextureRef): Promise<THREE.Texture | null> => {
    const assetId = typeof ref?.assetId === 'string' ? ref.assetId.trim() : ''
    if (!assetId) {
      return null
    }
    const file = await ensureMaterialTextureFile(options.assetCacheStore, assetId, options.getAsset)
    if (!file) {
      return null
    }
    const blobUrl = URL.createObjectURL(file)
    try {
      const texture = await new THREE.TextureLoader().loadAsync(blobUrl)
      texture.name = ref.name ?? file.name ?? assetId
      texture.needsUpdate = true
      return texture
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }
}

export async function renderMaterialThumbnailDataUrl(options: {
  material: Pick<SceneMaterial, 'name' | 'type'> & SceneMaterialProps
  resolveTexture?: (ref: SceneMaterialTextureRef) => Promise<THREE.Texture | null>
  width: number
  height: number
}): Promise<string> {
  const geometry = new THREE.SphereGeometry(1.0, 64, 64)
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.1,
    roughness: 0.8,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.y = Math.PI / 5
  mesh.rotation.x = -Math.PI / 12
  try {
    const resolveTexture = options.resolveTexture
    const resolvedTextures = new Map<string, THREE.Texture | null>()
    if (resolveTexture) {
      await Promise.all(
        TEXTURE_SLOTS.map(async (slot) => {
          const ref = options.material.textures?.[slot] ?? null
          const assetId = typeof ref?.assetId === 'string' ? ref.assetId.trim() : ''
          if (!ref || !assetId || resolvedTextures.has(assetId)) {
            return
          }
          resolvedTextures.set(assetId, await resolveTexture(ref))
        }),
      )
    }
    const materialConfig: SceneMaterial = {
      id: 'material-thumbnail',
      name: options.material.name,
      description: undefined,
      type: options.material.type,
      createdAt: '',
      updatedAt: '',
      ...cloneMaterialProps(options.material),
    }
    applyMaterialConfigToMaterial(material, materialConfig, {
      resolveTexture: async (ref) => resolvedTextures.get(ref.assetId) ?? null,
    })
    await Promise.resolve()
    const pedestal = new THREE.Mesh(
      new THREE.CircleGeometry(0.78, 48),
      new THREE.ShadowMaterial({ opacity: 0.12 }),
    )
    pedestal.rotation.x = -Math.PI / 2
    pedestal.position.y = -1.08

    const root = new THREE.Group()
    root.add(mesh)
    root.add(pedestal)
      const dataUrl = renderObjectThumbnailDataUrl({
      object: root,
      width: options.width,
      height: options.height,
        cameraFitPadding: 0.72,
    })
    root.remove(mesh)
    root.remove(pedestal)
    pedestal.geometry.dispose()
    ;(pedestal.material as THREE.Material).dispose()
    return dataUrl
  } finally {
    disposeThumbnailObject(mesh)
    geometry.dispose()
    disposeMaterialTextures(material)
    material.dispose()
  }
}