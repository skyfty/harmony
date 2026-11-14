import * as THREE from 'three'
import type {
  SceneMaterialType,
  SceneMaterialTextureSlot,
  SceneNode,
  SceneNodeMaterial,
} from '@schema/core'
import {
  applyHouseRigMaterialEnvironmentPreview,
  HOUSE_RIG_COMPONENT_TYPE,
  normalizeHouseRigComponentProps,
} from '@schema/houseRig'
import { applyMaterialOverrides } from '@schema/material'
import { buildAssetObjectPathIndex } from '@schema/sceneGraph/lightweightImportPatch'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { createMaterialAssetTextureResolver } from '@/utils/materialAsset'
import type { HouseRigPartBinding } from '@schema/houseRig'
import { createDefaultPreviewMaterialProps } from '@/utils/presetPreviewMaterialOverride'

export type HouseRigMaterialSource = 'override' | 'builtin' | 'default'

export interface HouseRigPartMaterialView {
  material: SceneNodeMaterial
  source: HouseRigMaterialSource
  sourceLabel: string
  hasBuiltInTextures: boolean
  inheritedTextureSlots: SceneMaterialTextureSlot[]
}

type HouseRigRuntimeMaterialRecord = {
  material: SceneNodeMaterial
  textureSlots: SceneMaterialTextureSlot[]
}

type HouseRigRuntimeMaterialLookup = {
  pathIndex: Map<string, THREE.Object3D>
  byName: Map<string, THREE.Object3D[]>
}

const SUPPORTED_RUNTIME_MATERIAL_TYPES = new Set<SceneMaterialType>([
  'MeshBasicMaterial',
  'MeshNormalMaterial',
  'MeshLambertMaterial',
  'MeshMatcapMaterial',
  'MeshPhongMaterial',
  'MeshToonMaterial',
  'MeshStandardMaterial',
  'MeshPhysicalMaterial',
])

const RUNTIME_TEXTURE_SLOT_PROPERTIES: Record<SceneMaterialTextureSlot, string> = {
  albedo: 'map',
  normal: 'normalMap',
  metalness: 'metalnessMap',
  roughness: 'roughnessMap',
  ao: 'aoMap',
  emissive: 'emissiveMap',
  displacement: 'displacementMap',
}

export interface HouseRigMaterialOverrideOptions {
  environmentMap?: THREE.Texture | null
}

export { applyHouseRigMaterialEnvironmentPreview }

function buildRuntimeMaterialLookup(object: THREE.Object3D): HouseRigRuntimeMaterialLookup {
  const pathIndex = buildAssetObjectPathIndex(object)
  const byName = new Map<string, THREE.Object3D[]>()
  pathIndex.forEach((target) => {
    const mesh = target as THREE.Mesh
    if (!mesh?.isMesh || !mesh.name) {
      return
    }
    const entries = byName.get(mesh.name) ?? []
    entries.push(mesh)
    byName.set(mesh.name, entries)
  })
  return { pathIndex, byName }
}

function resolveRuntimePartObject(
  lookup: HouseRigRuntimeMaterialLookup,
  part: HouseRigPartBinding,
): THREE.Object3D | null {
  const candidates = lookup.byName.get(part.meshName)
  return (part.objectPath ? lookup.pathIndex.get(part.objectPath) : null)
    ?? (candidates?.length === 1 ? candidates[0] : null)
    ?? null
}

function readHexColor(value: unknown, fallback: string): string {
  return value instanceof THREE.Color ? `#${value.getHexString()}` : fallback
}

function readFiniteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function resolveRuntimeMaterialType(material: THREE.Material): SceneMaterialType {
  const type = material.type as SceneMaterialType
  return SUPPORTED_RUNTIME_MATERIAL_TYPES.has(type) ? type : 'MeshStandardMaterial'
}

function resolveRuntimeMaterialSide(side: THREE.Side): 'front' | 'back' | 'double' {
  if (side === THREE.BackSide) {
    return 'back'
  }
  if (side === THREE.DoubleSide) {
    return 'double'
  }
  return 'front'
}

function resolveRuntimeMaterialTextureSlots(
  material: THREE.Material | null | undefined,
): SceneMaterialTextureSlot[] {
  if (!material) {
    return []
  }
  const record = material as unknown as Record<string, unknown>
  return (Object.entries(RUNTIME_TEXTURE_SLOT_PROPERTIES) as Array<[SceneMaterialTextureSlot, string]>)
    .filter(([, property]) => Boolean(record[property]))
    .map(([slot]) => slot)
}

function createDefaultHouseRigMaterial(part: HouseRigPartBinding): SceneNodeMaterial {
  return {
    id: `house-rig-default:${part.key}`,
    name: `${part.meshName || `Part ${part.key}`} 默认材质`,
    type: 'MeshStandardMaterial',
    ...createDefaultPreviewMaterialProps(),
    textureOverrides: [],
    thumbnail: null,
  }
}

export function createHouseRigDefaultMaterial(part: HouseRigPartBinding): SceneNodeMaterial {
  return createDefaultHouseRigMaterial(part)
}

/**
 * Builds a serializable House Rig material override seed from the material the
 * imported part currently renders. Embedded model textures stay inherited by
 * leaving the texture override list empty.
 */
export function createHouseRigMaterialSeedFromThreeMaterial(
  material: THREE.Material,
  part: HouseRigPartBinding,
): SceneNodeMaterial {
  const typed = material as THREE.Material & {
    color?: THREE.Color
    emissive?: THREE.Color
    specular?: THREE.Color
    attenuationColor?: THREE.Color
    metalness?: number
    roughness?: number
    shininess?: number
    transmission?: number
    thickness?: number
    ior?: number
    clearcoat?: number
    clearcoatRoughness?: number
    attenuationDistance?: number
    emissiveIntensity?: number
    aoStrength?: number
    envMapIntensity?: number
    wireframe?: boolean
  }
  return {
    id: `house-rig-runtime:${part.key}`,
    name: material.name?.trim()
      || part.meshName
      || `Part ${part.key}`,
    type: resolveRuntimeMaterialType(material),
    color: readHexColor(typed.color, '#ffffff'),
    transparent: material.transparent,
    opacity: readFiniteNumber(material.opacity, 1),
    alphaTest: readFiniteNumber(material.alphaTest, 0),
    side: resolveRuntimeMaterialSide(material.side),
    wireframe: !!typed.wireframe,
    metalness: readFiniteNumber(typed.metalness, 0.1),
    roughness: readFiniteNumber(typed.roughness, 1),
    specular: readHexColor(typed.specular, '#111111'),
    shininess: readFiniteNumber(typed.shininess, 30),
    transmission: readFiniteNumber(typed.transmission, 0),
    thickness: readFiniteNumber(typed.thickness, 0),
    ior: readFiniteNumber(typed.ior, 1.5),
    clearcoat: readFiniteNumber(typed.clearcoat, 0),
    clearcoatRoughness: readFiniteNumber(typed.clearcoatRoughness, 0),
    attenuationColor: readHexColor(typed.attenuationColor, '#ffffff'),
    attenuationDistance: readFiniteNumber(typed.attenuationDistance, 0),
    emissive: readHexColor(typed.emissive, '#000000'),
    emissiveIntensity: readFiniteNumber(typed.emissiveIntensity, 0),
    aoStrength: readFiniteNumber(typed.aoStrength, 1),
    envMapIntensity: readFiniteNumber(typed.envMapIntensity, 1),
    textures: {},
    textureOverrides: [],
    thumbnail: null,
  }
}

export function buildHouseRigRuntimeMaterialSeedMap(
  object: THREE.Object3D | null | undefined,
  parts: readonly HouseRigPartBinding[],
): Map<string, SceneNodeMaterial> {
  const records = buildHouseRigRuntimeMaterialRecordMap(object, parts)
  return new Map(
    Array.from(records.entries()).map(([key, record]) => [key, record.material]),
  )
}

function buildHouseRigRuntimeMaterialRecordMap(
  object: THREE.Object3D | null | undefined,
  parts: readonly HouseRigPartBinding[],
): Map<string, HouseRigRuntimeMaterialRecord> {
  const records = new Map<string, HouseRigRuntimeMaterialRecord>()
  if (!object) {
    return records
  }
  const lookup = buildRuntimeMaterialLookup(object)
  parts.forEach((part) => {
    const target = resolveRuntimePartObject(lookup, part) as THREE.Mesh | null
    if (!target?.isMesh || !target.material) {
      return
    }
    const material = Array.isArray(target.material) ? target.material[0] : target.material
    if (material) {
      records.set(part.key, {
        material: createHouseRigMaterialSeedFromThreeMaterial(material, part),
        textureSlots: resolveRuntimeMaterialTextureSlots(material),
      })
    }
  })
  return records
}

export function createHouseRigPartMaterialView(
  part: HouseRigPartBinding,
  builtInMaterial: SceneNodeMaterial | null,
  inheritedTextureSlots: readonly SceneMaterialTextureSlot[] = [],
): HouseRigPartMaterialView {
  const textureSlots = Array.from(new Set(inheritedTextureSlots))
  const material = part.material ?? builtInMaterial ?? createDefaultHouseRigMaterial(part)
  const source: HouseRigMaterialSource = part.material
    ? 'override'
    : builtInMaterial
      ? 'builtin'
      : 'default'
  const materialName = material.name?.trim() || material.type
  return {
    material,
    source,
    sourceLabel: source === 'override'
      ? `覆盖材质：${materialName}`
      : source === 'builtin'
        ? `内置材质：${materialName}`
        : '默认材质',
    hasBuiltInTextures: textureSlots.length > 0,
    inheritedTextureSlots: textureSlots,
  }
}

export function buildHouseRigPartMaterialViewMap(
  object: THREE.Object3D | null | undefined,
  parts: readonly HouseRigPartBinding[],
): Map<string, HouseRigPartMaterialView> {
  const records = buildHouseRigRuntimeMaterialRecordMap(object, parts)
  return new Map(parts.map((part) => [
    part.key,
    createHouseRigPartMaterialView(
      part,
      records.get(part.key)?.material ?? null,
      records.get(part.key)?.textureSlots ?? [],
    ),
  ]))
}

export async function applyHouseRigMaterialOverridesToEditorObject(
  node: SceneNode,
  object: THREE.Object3D,
  options: HouseRigMaterialOverrideOptions = {},
): Promise<void> {
  const rawState = node.components?.[HOUSE_RIG_COMPONENT_TYPE] as
    | { enabled?: boolean; props?: Record<string, unknown> }
    | undefined
  if (!rawState || rawState.enabled === false || !rawState.props) {
    return
  }
  const props = normalizeHouseRigComponentProps(rawState.props, node)
  const configured = props.parts.filter((part) => part.material)
  if (!configured.length) {
    return
  }
  const lookup = buildRuntimeMaterialLookup(object)
  const assetCacheStore = useAssetCacheStore()
  const resolveTexture = createMaterialAssetTextureResolver({
    assetCacheStore,
  })
  for (const part of configured) {
    const material = part.material as SceneNodeMaterial | null
    if (!material) {
      continue
    }
    const target = resolveRuntimePartObject(lookup, part)
    if (!target) {
      continue
    }
    applyMaterialOverrides(target, [material], {
      inheritUnspecifiedTextures: true,
      resolveTexture,
    })
    applyHouseRigMaterialEnvironmentPreview(
      target,
      material,
      options.environmentMap,
    )
  }
}
