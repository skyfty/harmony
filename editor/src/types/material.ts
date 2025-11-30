export type {
  SceneMaterial,
  SceneMaterialProps,
  SceneMaterialSide,
  SceneMaterialTextureRef,
  SceneMaterialTextureSettings,
  SceneMaterialType,
  SceneNodeMaterial,
  SceneTextureWrapMode,
} from '@harmony/schema'

export {
  cloneTextureSettings,
  createTextureSettings,
  DEFAULT_SCENE_MATERIAL_ID,
  DEFAULT_SCENE_MATERIAL_TYPE,
  DEFAULT_TEXTURE_SETTINGS,
  DEFAULT_TEXTURE_SETTINGS_SIGNATURE,
  MATERIAL_TEXTURE_SLOTS,
  applyMaterialConfigToMaterial,
  applyMaterialOverrides,
  disposeMaterialOverrides,
  ensureMaterialType,
  ensureMeshMaterialsUnique,
  resetMaterialOverrides,
  textureSettingsSignature,
} from '@schema/material'

export type {
  MaterialBaselineState,
  MaterialTextureAssignmentOptions,
  MeshStandardTextureKey,
} from '@schema/material'

