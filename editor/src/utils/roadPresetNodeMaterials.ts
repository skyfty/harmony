import type {
  SceneMaterial,
  SceneMaterialProps,
  SceneMaterialTextureRef,
  SceneMaterialType,
  SceneNodeMaterial,
} from '@schema'
import { DEFAULT_SCENE_MATERIAL_TYPE } from '@/types/material'
import type { RoadPresetData, RoadPresetMaterialPatch } from '@/utils/roadPreset'

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
  patch: RoadPresetMaterialPatch,
  sharedMaterials: readonly SceneMaterial[],
): SceneNodeMaterial {
  const sharedMaterialId = patch.materialId === null ? null : typeof patch.materialId === 'string' ? patch.materialId.trim() : null
  const sharedMaterial = sharedMaterialId
    ? (sharedMaterials.find((entry) => entry.id === sharedMaterialId) ?? null)
    : null

  const baseProps = sharedMaterial ? mergeMaterialProps(createDefaultMaterialProps(), sharedMaterial) : createDefaultMaterialProps()
  const mergedProps = sharedMaterial && patch.props && Object.keys(patch.props).length
    ? baseProps
    : mergeMaterialProps(baseProps, (patch.props ?? null) as Partial<SceneMaterialProps> | null)

  return {
    id: slotId,
    materialId: sharedMaterial?.id ?? null,
    name: typeof patch.name === 'string' && patch.name.trim().length ? patch.name.trim() : sharedMaterial?.name,
    type: (typeof patch.type === 'string' && patch.type.trim().length ? patch.type.trim() : sharedMaterial?.type ?? DEFAULT_SCENE_MATERIAL_TYPE) as SceneMaterialType,
    ...mergedProps,
  }
}

export function buildRoadNodeMaterialsFromPreset(
  preset: RoadPresetData | null | undefined,
  sharedMaterials: readonly SceneMaterial[],
): SceneNodeMaterial[] {
  if (!preset) {
    return []
  }

  return (preset.materialOrder ?? [])
    .map((slotId) => {
      const normalizedId = typeof slotId === 'string' ? slotId.trim() : ''
      if (!normalizedId) {
        return null
      }
      const patch = preset.materialPatches?.[normalizedId]
      if (!patch) {
        return null
      }
      return createNodeMaterialFromPatch(normalizedId, patch, sharedMaterials)
    })
    .filter((entry): entry is SceneNodeMaterial => Boolean(entry))
}
