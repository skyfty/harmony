import type {
  SceneMaterialProps,
  SceneMaterialTextureRef,
  SceneMaterialType,
  SceneNodeMaterial,
} from '@schema'
import { DEFAULT_SCENE_MATERIAL_TYPE } from '@/types/material'
import type { LandformPresetData, LandformPresetMaterialPatch } from '@/utils/landformPreset'
import {
  createDefaultPreviewMaterialProps,
  hasMeaningfulPreviewMaterialOverride,
} from '@/utils/presetPreviewMaterialOverride'

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
  patch: LandformPresetMaterialPatch,
): SceneNodeMaterial | null {
  const baseProps = createDefaultPreviewMaterialProps()
  const mergedProps = mergeMaterialProps(baseProps, (patch.props ?? null) as Partial<SceneMaterialProps> | null)

  const nextMaterial: SceneNodeMaterial = {
    id: slotId,
    name: typeof patch.name === 'string' && patch.name.trim().length ? patch.name.trim() : undefined,
    type: (typeof patch.type === 'string' && patch.type.trim().length ? patch.type.trim() : DEFAULT_SCENE_MATERIAL_TYPE) as SceneMaterialType,
    ...mergedProps,
  }

  return hasMeaningfulPreviewMaterialOverride(nextMaterial) ? nextMaterial : null
}

export function buildLandformNodeMaterialsFromPreset(
  preset: LandformPresetData | null | undefined,
): SceneNodeMaterial[] {
  if (!preset) {
    return []
  }

  const slotId = typeof preset.materialSlotId === 'string' ? preset.materialSlotId.trim() : ''
  if (!slotId) {
    return []
  }

  const nodeMaterial = createNodeMaterialFromPatch(slotId, preset.materialPatch)
  return nodeMaterial ? [nodeMaterial] : []
}
