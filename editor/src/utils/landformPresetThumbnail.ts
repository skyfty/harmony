import * as THREE from 'three'
import type { LandformDynamicMesh, SceneMaterialTextureRef } from '@schema'
import { applyMaterialOverrides, type MaterialTextureAssignmentOptions } from '@schema/material'
import { createLandformGroup } from '@schema/landformMesh'
import type { LandformPresetData } from '@/utils/landformPreset'
import { buildLandformNodeMaterialsFromPreset } from '@/utils/landformPresetNodeMaterials'
import { disposeThumbnailObject, renderObjectThumbnailDataUrl } from '@/utils/objectThumbnailRenderer'

const LANDFORM_PRESET_CENTER_HEIGHT = 0.42
const LANDFORM_PRESET_RING_POINTS: Array<{ x: number; z: number; y: number }> = [
  { x: -4.6, z: -1.8, y: 0.04 },
  { x: -2.6, z: 3.8, y: 0.22 },
  { x: 1.2, z: 4.8, y: 0.16 },
  { x: 4.4, z: 2.4, y: 0.08 },
  { x: 4.9, z: -1.4, y: 0.05 },
  { x: 2.2, z: -4.6, y: 0.1 },
  { x: -1.4, z: -5.0, y: 0.18 },
  { x: -4.8, z: -3.3, y: 0.09 },
]

type RenderLandformPresetThumbnailOptions = {
  preset: LandformPresetData
  resolveTexture: (ref: SceneMaterialTextureRef) => THREE.Texture | null | Promise<THREE.Texture | null>
  width: number
  height: number
}

export function buildLandformPresetPreviewDefinition(preset: LandformPresetData): LandformDynamicMesh {
  const uvScale = {
    x: Math.max(1e-3, preset.landformProps.uvScale.x),
    y: Math.max(1e-3, preset.landformProps.uvScale.y),
  }
  const enableFeather = preset.landformProps.enableFeather
  const footprint = LANDFORM_PRESET_RING_POINTS.map((point) => [point.x, point.z] as [number, number])
  const surfaceVertices = [
    { x: 0, y: LANDFORM_PRESET_CENTER_HEIGHT, z: 0 },
    ...LANDFORM_PRESET_RING_POINTS.map((point) => ({ x: point.x, y: point.y, z: point.z })),
  ]
  const surfaceUvs = surfaceVertices.map((point) => ({
    x: point.x / uvScale.x,
    y: point.z / uvScale.y,
  }))
  const surfaceFeather = enableFeather
    ? [1, ...LANDFORM_PRESET_RING_POINTS.map(() => 0)]
    : surfaceVertices.map(() => 1)
  const surfaceIndices: number[] = []
  for (let index = 1; index <= LANDFORM_PRESET_RING_POINTS.length; index += 1) {
    const next = index === LANDFORM_PRESET_RING_POINTS.length ? 1 : index + 1
    surfaceIndices.push(0, index, next)
  }

  return {
    type: 'Landform',
    footprint,
    surfaceVertices,
    surfaceIndices,
    surfaceUvs,
    surfaceFeather,
    materialConfigId: preset.materialSlotId,
    enableFeather,
    feather: preset.landformProps.feather,
    uvScale,
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

async function preloadLandformPresetTextures(
  refs: readonly SceneMaterialTextureRef[],
  resolveTexture: (ref: SceneMaterialTextureRef) => THREE.Texture | null | Promise<THREE.Texture | null>,
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

export async function renderLandformPresetThumbnailDataUrl(options: RenderLandformPresetThumbnailOptions): Promise<string | null> {
  const definition = buildLandformPresetPreviewDefinition(options.preset)
  const group = createLandformGroup(definition)

  const nodeMaterials = buildLandformNodeMaterialsFromPreset(options.preset)
  const materialOverrideOptions: MaterialTextureAssignmentOptions = {
    resolveTexture: options.resolveTexture,
  }
  if (nodeMaterials.length > 0) {
    const textureRefs = nodeMaterials.flatMap((material) => Object.values(material.textures ?? {}).filter((ref): ref is SceneMaterialTextureRef => Boolean(ref)))
    const resolvedTextures = await preloadLandformPresetTextures(textureRefs, options.resolveTexture)
    materialOverrideOptions.resolveTexture = (ref) => resolvedTextures.get(buildTextureRefKey(ref)) ?? null
    applyMaterialOverrides(group, nodeMaterials, materialOverrideOptions)
    await Promise.resolve()
  }

  group.rotation.x = -0.08
  const dataUrl = renderObjectThumbnailDataUrl({
    object: group,
    width: options.width,
    height: options.height,
  })
  disposeThumbnailObject(group)
  return dataUrl
}