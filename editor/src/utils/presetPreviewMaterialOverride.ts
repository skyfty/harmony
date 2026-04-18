import type { SceneMaterialProps, SceneMaterialTextureRef, SceneNodeMaterial } from '@schema'
import { DEFAULT_SCENE_MATERIAL_TYPE } from '@/types/material'

function normalizeOptionalString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length ? normalized : null
}

function textureRefEquals(a: SceneMaterialTextureRef | null | undefined, b: SceneMaterialTextureRef | null | undefined): boolean {
  if (!a && !b) {
    return true
  }
  if (!a || !b) {
    return false
  }

  const aAssetId = normalizeOptionalString(a.assetId)
  const bAssetId = normalizeOptionalString(b.assetId)
  const aName = normalizeOptionalString(a.name)
  const bName = normalizeOptionalString(b.name)
  if (aAssetId !== bAssetId || aName !== bName) {
    return false
  }

  const aSettings = a.settings ?? null
  const bSettings = b.settings ?? null
  if (!aSettings && !bSettings) {
    return true
  }
  if (!aSettings || !bSettings) {
    return false
  }

  return aSettings.wrapS === bSettings.wrapS
    && aSettings.wrapT === bSettings.wrapT
    && aSettings.wrapR === bSettings.wrapR
    && aSettings.offset.x === bSettings.offset.x
    && aSettings.offset.y === bSettings.offset.y
    && aSettings.repeat.x === bSettings.repeat.x
    && aSettings.repeat.y === bSettings.repeat.y
    && aSettings.tileSizeMeters.x === bSettings.tileSizeMeters.x
    && aSettings.tileSizeMeters.y === bSettings.tileSizeMeters.y
    && aSettings.rotation === bSettings.rotation
    && aSettings.center.x === bSettings.center.x
    && aSettings.center.y === bSettings.center.y
    && aSettings.matrixAutoUpdate === bSettings.matrixAutoUpdate
    && aSettings.generateMipmaps === bSettings.generateMipmaps
    && aSettings.premultiplyAlpha === bSettings.premultiplyAlpha
    && aSettings.flipY === bSettings.flipY
}

function materialPropsEqual(a: SceneMaterialProps, b: SceneMaterialProps): boolean {
  return a.color === b.color
    && a.transparent === b.transparent
    && a.opacity === b.opacity
    && a.side === b.side
    && a.wireframe === b.wireframe
    && a.metalness === b.metalness
    && a.roughness === b.roughness
    && a.emissive === b.emissive
    && a.emissiveIntensity === b.emissiveIntensity
    && a.aoStrength === b.aoStrength
    && a.envMapIntensity === b.envMapIntensity
    && textureRefEquals(a.textures.albedo, b.textures.albedo)
    && textureRefEquals(a.textures.normal, b.textures.normal)
    && textureRefEquals(a.textures.metalness, b.textures.metalness)
    && textureRefEquals(a.textures.roughness, b.textures.roughness)
    && textureRefEquals(a.textures.ao, b.textures.ao)
    && textureRefEquals(a.textures.emissive, b.textures.emissive)
    && textureRefEquals(a.textures.displacement, b.textures.displacement)
}

export function createDefaultPreviewMaterialProps(): SceneMaterialProps {
  return {
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
    textures: {
      albedo: null,
      normal: null,
      metalness: null,
      roughness: null,
      ao: null,
      emissive: null,
      displacement: null,
    },
  }
}

const DEFAULT_LOCAL_PREVIEW_PROPS = createDefaultPreviewMaterialProps()

export function hasMeaningfulPreviewMaterialOverride(material: SceneNodeMaterial | null | undefined): boolean {
  if (!material) {
    return false
  }
  if (normalizeOptionalString(material.type) && material.type !== DEFAULT_SCENE_MATERIAL_TYPE) {
    return true
  }
  return !materialPropsEqual(material, DEFAULT_LOCAL_PREVIEW_PROPS)
}