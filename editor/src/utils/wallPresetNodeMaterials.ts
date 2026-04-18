import type {
  SceneMaterialProps,
  SceneMaterialTextureRef,
  SceneMaterialType,
  SceneNodeMaterial,
} from '@schema'
import { DEFAULT_SCENE_MATERIAL_TYPE } from '@/types/material'
import type { WallPresetData, WallPresetMaterialPatch } from '@/utils/wallPreset'
import { normalizeMaterialLikeTextureAssetIds } from '@/utils/assetRegistryIdNormalization'

function normalizeOptionalString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length ? normalized : null
}

function cloneTextureRef(ref: SceneMaterialTextureRef | null | undefined): SceneMaterialTextureRef | null {
  if (!ref) {
    return null
  }
  return {
    assetId: ref.assetId,
    name: ref.name,
    settings: ref.settings
      ? {
          wrapS: ref.settings.wrapS,
          wrapT: ref.settings.wrapT,
          wrapR: ref.settings.wrapR,
          offset: { x: ref.settings.offset.x, y: ref.settings.offset.y },
          repeat: { x: ref.settings.repeat.x, y: ref.settings.repeat.y },
          tileSizeMeters: { x: ref.settings.tileSizeMeters.x, y: ref.settings.tileSizeMeters.y },
          rotation: ref.settings.rotation,
          center: { x: ref.settings.center.x, y: ref.settings.center.y },
          matrixAutoUpdate: ref.settings.matrixAutoUpdate,
          generateMipmaps: ref.settings.generateMipmaps,
          premultiplyAlpha: ref.settings.premultiplyAlpha,
          flipY: ref.settings.flipY,
        }
      : undefined,
  }
}

function createDefaultMaterialProps(): SceneMaterialProps {
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

const DEFAULT_LOCAL_WALL_PREVIEW_PROPS = createDefaultMaterialProps()

export function hasMeaningfulWallPreviewMaterialOverride(material: SceneNodeMaterial | null | undefined): boolean {
  if (!material) {
    return false
  }
  if (normalizeOptionalString(material.type) && material.type !== DEFAULT_SCENE_MATERIAL_TYPE) {
    return true
  }
  return !materialPropsEqual(material, DEFAULT_LOCAL_WALL_PREVIEW_PROPS)
}

export function filterWallPreviewMaterialOverrides(options: {
  materials: readonly SceneNodeMaterial[] | null | undefined
  bodyAssetId?: string | null
  bodyMaterialConfigId?: string | null
}): SceneNodeMaterial[] {
  const bodyAssetId = normalizeOptionalString(options.bodyAssetId)
  const bodyMaterialConfigId = normalizeOptionalString(options.bodyMaterialConfigId)

  return (options.materials ?? []).filter((entry): entry is SceneNodeMaterial => {
    if (!hasMeaningfulWallPreviewMaterialOverride(entry)) {
      return false
    }
    const entryId = normalizeOptionalString(entry?.id)
    if (bodyAssetId && bodyMaterialConfigId && entryId === bodyMaterialConfigId) {
      return false
    }
    return true
  })
}

function mergeMaterialProps(base: SceneMaterialProps, overrides?: Partial<SceneMaterialProps> | null): SceneMaterialProps {
  if (!overrides) {
    return {
      ...base,
      textures: {
        ...base.textures,
      },
    }
  }

  const next: SceneMaterialProps = {
    ...base,
    ...overrides,
    textures: {
      ...base.textures,
    },
  }

  if (overrides.textures) {
    const sourceTextures = overrides.textures as Record<string, SceneMaterialTextureRef | null | undefined>
    Object.keys(sourceTextures).forEach((key) => {
      next.textures[key as keyof SceneMaterialProps['textures']] = cloneTextureRef(sourceTextures[key] ?? null)
    })
  }

  return next
}

function createNodeMaterialFromPatch(
  slotId: string,
  patch: WallPresetMaterialPatch,
  presetAssetRegistry: WallPresetData['assetRegistry'] | null | undefined,
) : SceneNodeMaterial | null {
  const baseProps = createDefaultMaterialProps()
  const normalizedPatchProps = normalizeMaterialLikeTextureAssetIds(
    ((patch.props ?? null) as Partial<SceneMaterialProps> | null),
    (presetAssetRegistry ?? null) as Record<string, unknown> | null,
  )
  const mergedProps = mergeMaterialProps(baseProps, normalizedPatchProps)

  const nextMaterial: SceneNodeMaterial = {
    id: slotId,
    name: typeof patch.name === 'string' && patch.name.trim().length ? patch.name.trim() : undefined,
    type: (typeof patch.type === 'string' && patch.type.trim().length ? patch.type.trim() : DEFAULT_SCENE_MATERIAL_TYPE) as SceneMaterialType,
    ...mergedProps,
  }

  return hasMeaningfulWallPreviewMaterialOverride(nextMaterial) ? nextMaterial : null
}

export function buildWallNodeMaterialsFromPreset(
  preset: WallPresetData | null | undefined,
): SceneNodeMaterial[] {
  if (!preset) {
    return []
  }

  const materials = (preset.materialOrder ?? [])
    .map((slotId) => {
      const normalizedId = typeof slotId === 'string' ? slotId.trim() : ''
      if (!normalizedId) {
        return null
      }
      const patch = preset.materialPatches?.[normalizedId]
      if (!patch) {
        return null
      }
      return createNodeMaterialFromPatch(normalizedId, patch, preset.assetRegistry)
    })
    .filter((entry): entry is SceneNodeMaterial => Boolean(entry))

  return filterWallPreviewMaterialOverrides({
    materials,
    bodyAssetId: preset.wallProps.bodyAssetId,
    bodyMaterialConfigId: preset.wallProps.bodyMaterialConfigId,
  })
}
