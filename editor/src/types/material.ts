export type SceneMaterialSide = 'front' | 'back' | 'double'

export type SceneMaterialTextureSlot =
  | 'albedo'
  | 'normal'
  | 'metalness'
  | 'roughness'
  | 'ao'
  | 'emissive'

export interface SceneMaterialTextureRef {
  assetId: string
  name?: string
}

export const MATERIAL_CLASS_NAMES = [
  'MeshBasicMaterial',
  'MeshNormalMaterial',
  'MeshLambertMaterial',
  'MeshMatcapMaterial',
  'MeshPhongMaterial',
  'MeshToonMaterial',
  'MeshStandardMaterial',
  'MeshPhysicalMaterial',
] as const

export type SceneMaterialType = (typeof MATERIAL_CLASS_NAMES)[number]

export const DEFAULT_SCENE_MATERIAL_ID = '__scene_default_material__'

export const DEFAULT_SCENE_MATERIAL_TYPE: SceneMaterialType = 'MeshStandardMaterial'

function isSceneMaterialType(value: unknown): value is SceneMaterialType {
  return typeof value === 'string' && MATERIAL_CLASS_NAMES.includes(value as SceneMaterialType)
}

export function normalizeSceneMaterialType(type?: SceneMaterialType | string | null): SceneMaterialType {
  if (!type) {
    return DEFAULT_SCENE_MATERIAL_TYPE
  }
  if (isSceneMaterialType(type)) {
    return type
  }
  return DEFAULT_SCENE_MATERIAL_TYPE
}

export interface SceneMaterialProps {
  color: string
  transparent: boolean
  opacity: number
  side: SceneMaterialSide
  wireframe: boolean
  metalness: number
  roughness: number
  emissive: string
  emissiveIntensity: number
  aoStrength: number
  envMapIntensity: number
  textures: Partial<Record<SceneMaterialTextureSlot, SceneMaterialTextureRef | null>>
}

export interface SceneMaterial extends SceneMaterialProps {
  id: string
  name: string
  description?: string
  type: SceneMaterialType
  createdAt: string
  updatedAt: string
}

export interface SceneNodeMaterial extends SceneMaterialProps {
  id: string
  materialId: string | null
  type: SceneMaterialType
  name?: string
}
