import * as THREE from 'three'
import type { RoadDynamicMesh, SceneMaterial, SceneMaterialTextureRef } from '@schema'
import { applyMaterialOverrides, type MaterialTextureAssignmentOptions } from '@schema/material'
import { createRoadGroup } from '@schema/roadMesh'
import type { RoadPresetData } from '@/utils/roadPreset'
import { buildRoadNodeMaterialsFromPreset } from '@/utils/roadPresetNodeMaterials'
import { disposeThumbnailObject, renderObjectThumbnailDataUrl } from '@/utils/objectThumbnailRenderer'

type RenderRoadPresetThumbnailOptions = {
  preset: RoadPresetData
  sharedMaterials: readonly SceneMaterial[]
  resolveTexture: (ref: SceneMaterialTextureRef) => Promise<THREE.Texture | null>
  width: number
  height: number
}

export function buildRoadPresetPreviewDefinition(preset: RoadPresetData): RoadDynamicMesh {
  return {
    type: 'Road',
    width: Math.max(0.2, preset.width),
    vertices: [
      [-5.5, -3.8],
      [-1.8, -1.2],
      [1.4, 1.6],
      [5.8, 3.9],
    ],
    segments: [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
      { a: 2, b: 3 },
    ],
  }
}

function buildTextureRefKey(ref: SceneMaterialTextureRef): string {
  const assetId = typeof ref.assetId === 'string' ? ref.assetId.trim() : ''
  const name = typeof ref.name === 'string' ? ref.name.trim() : ''
  return JSON.stringify({
    assetId,
    name,
    settings: ref.settings ?? null,
  })
}

async function preloadRoadPresetTextures(
  refs: readonly SceneMaterialTextureRef[],
  resolveTexture: (ref: SceneMaterialTextureRef) => Promise<THREE.Texture | null>,
): Promise<Map<string, THREE.Texture | null>> {
  const resolved = new Map<string, THREE.Texture | null>()

  await Promise.all(refs.map(async (ref) => {
    const key = buildTextureRefKey(ref)
    try {
      const texture = await resolveTexture(ref)
      resolved.set(key, texture)
    } catch {
      resolved.set(key, null)
    }
  }))

  return resolved
}

export async function renderRoadPresetThumbnailDataUrl(options: RenderRoadPresetThumbnailOptions): Promise<string | null> {
  const definition = buildRoadPresetPreviewDefinition(options.preset)
  const group = createRoadGroup(definition, {
    junctionSmoothing: options.preset.roadProps.junctionSmoothing,
    laneLines: options.preset.roadProps.laneLines,
    shoulders: options.preset.roadProps.shoulders,
    materialConfigId: options.preset.materialOrder?.[0] ?? null,
    samplingDensityFactor: options.preset.roadProps.samplingDensityFactor,
    smoothingStrengthFactor: options.preset.roadProps.smoothingStrengthFactor,
    minClearance: options.preset.roadProps.minClearance,
    laneLineWidth: options.preset.roadProps.laneLineWidth,
    shoulderWidth: options.preset.roadProps.shoulderWidth,
  })

  const nodeMaterials = buildRoadNodeMaterialsFromPreset(options.preset, options.sharedMaterials)
  const materialOverrideOptions: MaterialTextureAssignmentOptions = {
    resolveTexture: options.resolveTexture,
  }
  if (nodeMaterials.length > 0) {
    const textureRefs = nodeMaterials.flatMap((material) => Object.values(material.textures ?? {}).filter((ref): ref is SceneMaterialTextureRef => Boolean(ref)))
    const resolvedTextures = await preloadRoadPresetTextures(textureRefs, options.resolveTexture)
    materialOverrideOptions.resolveTexture = async (ref) => {
      return resolvedTextures.get(buildTextureRefKey(ref)) ?? null
    }
    applyMaterialOverrides(group, nodeMaterials, materialOverrideOptions)
    await Promise.resolve()
  }

  const dataUrl = renderObjectThumbnailDataUrl({
    object: group,
    width: options.width,
    height: options.height,
  })
  disposeThumbnailObject(group)
  return dataUrl
}