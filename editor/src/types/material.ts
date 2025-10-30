import  {
  type SceneMaterialTextureSettings,
} from '@harmony/schema'

export type {
  SceneMaterialType,
  SceneMaterial,
  SceneMaterialProps,
  SceneMaterialSide,
  SceneMaterialTextureRef,
  SceneMaterialTextureSettings,
  SceneMaterialTextureSlot,
  SceneNodeMaterial,
  SceneTextureVector2,
  SceneTextureWrapMode,
} from '@harmony/schema'

const DEFAULT_TEXTURE_SETTINGS: SceneMaterialTextureSettings = {
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

export const DEFAULT_SCENE_MATERIAL_ID = '__scene_default_material__'

export const DEFAULT_SCENE_MATERIAL_TYPE = 'MeshStandardMaterial'

