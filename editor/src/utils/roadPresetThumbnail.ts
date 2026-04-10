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

function buildRoadPresetThumbnailDefinition(preset: RoadPresetData): RoadDynamicMesh {
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

export async function renderRoadPresetThumbnailDataUrl(options: RenderRoadPresetThumbnailOptions): Promise<string | null> {
  const definition = buildRoadPresetThumbnailDefinition(options.preset)
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
  applyMaterialOverrides(group, nodeMaterials, materialOverrideOptions)

  const dataUrl = renderObjectThumbnailDataUrl({
    object: group,
    width: options.width,
    height: options.height,
  })
  disposeThumbnailObject(group)
  return dataUrl
}