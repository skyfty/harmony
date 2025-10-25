export type SceneMaterialSide = 'front' | 'back' | 'double'

export type SceneMaterialTextureSlot =
  | 'albedo'
  | 'normal'
  | 'metalness'
  | 'roughness'
  | 'ao'
  | 'emissive'

export type SceneTextureWrapMode = 'ClampToEdgeWrapping' | 'RepeatWrapping' | 'MirroredRepeatWrapping'

export interface SceneTextureVector2 {
  x: number
  y: number
}

export interface SceneMaterialTextureSettings {
  wrapS: SceneTextureWrapMode
  wrapT: SceneTextureWrapMode
  wrapR: SceneTextureWrapMode
  offset: SceneTextureVector2
  repeat: SceneTextureVector2
  rotation: number
  center: SceneTextureVector2
  matrixAutoUpdate: boolean
  generateMipmaps: boolean
  premultiplyAlpha: boolean
  flipY: boolean
}

export const DEFAULT_TEXTURE_SETTINGS: SceneMaterialTextureSettings = {
  wrapS: 'ClampToEdgeWrapping',
  wrapT: 'ClampToEdgeWrapping',
  wrapR: 'ClampToEdgeWrapping',
  offset: { x: 0, y: 0 },
  repeat: { x: 1, y: 1 },
  rotation: 0,
  center: { x: 0, y: 0 },
  matrixAutoUpdate: true,
  generateMipmaps: true,
  premultiplyAlpha: false,
  flipY: true,
}

export function createTextureSettings(overrides?: Partial<SceneMaterialTextureSettings> | null): SceneMaterialTextureSettings {
  const base = DEFAULT_TEXTURE_SETTINGS
  const candidate = overrides ?? null
  return {
    wrapS: candidate?.wrapS ?? base.wrapS,
    wrapT: candidate?.wrapT ?? base.wrapT,
    wrapR: candidate?.wrapR ?? base.wrapR,
    offset: {
      x: candidate?.offset?.x ?? base.offset.x,
      y: candidate?.offset?.y ?? base.offset.y,
    },
    repeat: {
      x: candidate?.repeat?.x ?? base.repeat.x,
      y: candidate?.repeat?.y ?? base.repeat.y,
    },
    rotation: candidate?.rotation ?? base.rotation,
    center: {
      x: candidate?.center?.x ?? base.center.x,
      y: candidate?.center?.y ?? base.center.y,
    },
    matrixAutoUpdate: candidate?.matrixAutoUpdate ?? base.matrixAutoUpdate,
    generateMipmaps: candidate?.generateMipmaps ?? base.generateMipmaps,
    premultiplyAlpha: candidate?.premultiplyAlpha ?? base.premultiplyAlpha,
    flipY: candidate?.flipY ?? base.flipY,
  }
}

export function cloneTextureSettings(settings?: SceneMaterialTextureSettings | null): SceneMaterialTextureSettings {
  return createTextureSettings(settings ?? null)
}

export function textureSettingsSignature(settings?: SceneMaterialTextureSettings | null): string {
  const resolved = createTextureSettings(settings ?? null)
  return [
    resolved.wrapS,
    resolved.wrapT,
    resolved.wrapR,
    resolved.offset.x,
    resolved.offset.y,
    resolved.repeat.x,
    resolved.repeat.y,
    resolved.rotation,
    resolved.center.x,
    resolved.center.y,
    resolved.matrixAutoUpdate ? 1 : 0,
    resolved.generateMipmaps ? 1 : 0,
    resolved.premultiplyAlpha ? 1 : 0,
    resolved.flipY ? 1 : 0,
  ].join('|')
}

export interface SceneMaterialTextureRef {
  assetId: string
  name?: string
  settings?: SceneMaterialTextureSettings
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
