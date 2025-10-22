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

export type SceneMaterialType = 'mesh-standard'

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
