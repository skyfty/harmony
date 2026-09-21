import type {
  RuntimeResourceBudgetEstimateInput,
  RuntimeResourceBudgetProfileId,
  RuntimeResourceBudgetReport,
  RuntimeResourceGeometryInput,
  RuntimeResourceTextureInput,
  RuntimeTargetPlatform,
} from '@schema/core'
import {
  estimateRuntimeResourceBudget,
  normalizeRuntimeResourceBudgetProfileId,
  normalizeRuntimeTargetPlatform,
} from '@schema/core'
import type { ProjectAsset } from '@/types/project-asset'
import type { StoredSceneDocument } from '@/types/stored-scene-document'

export interface EditorRuntimeBudgetViewport {
  width: number
  height: number
  pixelRatio: number
  hasPostProcessing?: boolean
}

export interface EditorRuntimeBudgetOptions {
  scene?: StoredSceneDocument | null
  viewport?: EditorRuntimeBudgetViewport
  sceneDocumentBytes?: number
  effectsGroundBytes?: number
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function findProjectAsset(
  scene: StoredSceneDocument | null | undefined,
  assetId: string,
): ProjectAsset | null {
  const normalized = assetId.trim()
  if (!normalized) {
    return null
  }
  for (const assets of Object.values(scene?.assetCatalog ?? {})) {
    const found = assets.find((asset) => asset.id === normalized)
    if (found) {
      return found
    }
  }
  return null
}

function buildTextureInputs(scene: StoredSceneDocument | null | undefined): RuntimeResourceTextureInput[] {
  const entries = Array.isArray(scene?.resourceSummary?.assets) ? scene.resourceSummary.assets : []
  const inputs: RuntimeResourceTextureInput[] = []

  for (const entry of entries) {
    const assetId = typeof entry?.assetId === 'string' ? entry.assetId.trim() : ''
    if (!assetId) {
      continue
    }

    const asset = findProjectAsset(scene, assetId)
    const type = asset?.type ?? entry.type ?? null
    if (!type || !['image', 'texture', 'hdri', 'mesh', 'model'].includes(type)) {
      continue
    }
    if (type === 'mesh' || type === 'model') {
      continue
    }

    inputs.push({
      assetId,
      name: asset?.name ?? entry.name ?? assetId,
      kind: type === 'hdri' ? 'hdri' : type === 'image' || type === 'texture' ? 'standard' : 'standard',
      width: asset?.imageWidth ?? null,
      height: asset?.imageHeight ?? null,
      encodedBytes: toFiniteNumber(entry.bytes, 0),
      mipmap: true,
      faces: 1,
    })
  }

  return inputs
}

function buildGeometryInputs(scene: StoredSceneDocument | null | undefined): RuntimeResourceGeometryInput[] {
  const entries = Array.isArray(scene?.resourceSummary?.assets) ? scene.resourceSummary.assets : []
  const inputs: RuntimeResourceGeometryInput[] = []

  for (const entry of entries) {
    const assetId = typeof entry?.assetId === 'string' ? entry.assetId.trim() : ''
    if (!assetId) {
      continue
    }

    const asset = findProjectAsset(scene, assetId)
    const type = asset?.type ?? entry.type ?? null
    if (type !== 'model' && type !== 'mesh') {
      continue
    }

    const stats = asset?.metadata?.modelStats ?? null
    inputs.push({
      assetId,
      name: asset?.name ?? entry.name ?? assetId,
      vertexCount: stats?.vertexCount ?? null,
      indexCount: typeof stats?.faceCount === 'number' ? stats.faceCount * 3 : null,
      encodedBytes: toFiniteNumber(entry.bytes, 0),
      instanceCount: 1,
    })
  }

  return inputs
}

export function buildEditorRuntimeResourceBudgetInput(
  options: EditorRuntimeBudgetOptions,
): RuntimeResourceBudgetEstimateInput {
  const scene = options.scene ?? null
  const textures = buildTextureInputs(scene)
  const geometries = buildGeometryInputs(scene)
  const viewport = options.viewport

  return {
    resourceSummaryBytes: toFiniteNumber(scene?.resourceSummary?.totalBytes, 0),
    sceneDocumentBytes: toFiniteNumber(options.sceneDocumentBytes, 0),
    textures,
    geometries,
    effectsGroundBytes: toFiniteNumber(options.effectsGroundBytes, 0),
    viewport: viewport
      ? {
          width: Math.max(1, toFiniteNumber(viewport.width, 1)),
          height: Math.max(1, toFiniteNumber(viewport.height, 1)),
          pixelRatio: Math.max(1, toFiniteNumber(viewport.pixelRatio, 1)),
          hasPostProcessing: viewport.hasPostProcessing,
        }
      : undefined,
  }
}

export function estimateEditorSceneRuntimeBudget(
  options: EditorRuntimeBudgetOptions & {
    profileId?: RuntimeResourceBudgetProfileId
    targetPlatform?: RuntimeTargetPlatform
  },
): RuntimeResourceBudgetReport {
  const profileId = normalizeRuntimeResourceBudgetProfileId(options.profileId)
  const targetPlatform = normalizeRuntimeTargetPlatform(options.targetPlatform)
  return estimateRuntimeResourceBudget({
    ...buildEditorRuntimeResourceBudgetInput(options),
    profileId,
    targetPlatform,
  })
}

export function estimateEditorProjectRuntimeBudget(
  options: EditorRuntimeBudgetOptions & {
    scenes: Array<StoredSceneDocument | null | undefined>
    profileId?: RuntimeResourceBudgetProfileId
    targetPlatform?: RuntimeTargetPlatform
  },
): RuntimeResourceBudgetReport {
  const scenes = options.scenes.filter((scene): scene is StoredSceneDocument => Boolean(scene))
  const seenTextures = new Set<string>()
  const seenGeometries = new Set<string>()
  const textures: RuntimeResourceTextureInput[] = []
  const geometries: RuntimeResourceGeometryInput[] = []
  let resourceSummaryBytes = 0
  let sceneDocumentBytes = toFiniteNumber(options.sceneDocumentBytes, 0)
  let effectsGroundBytes = toFiniteNumber(options.effectsGroundBytes, 0)

  for (const scene of scenes) {
    const input = buildEditorRuntimeResourceBudgetInput({ scene })
    resourceSummaryBytes += toFiniteNumber(input.resourceSummaryBytes, 0)
    sceneDocumentBytes += toFiniteNumber(input.sceneDocumentBytes, 0)
    effectsGroundBytes += toFiniteNumber(input.effectsGroundBytes, 0)

    for (const texture of input.textures ?? []) {
      const key = `texture:${texture.assetId ?? texture.name ?? ''}`
      if (seenTextures.has(key)) {
        continue
      }
      seenTextures.add(key)
      textures.push(texture)
    }
    for (const geometry of input.geometries ?? []) {
      const key = `geometry:${geometry.assetId ?? geometry.name ?? ''}`
      if (seenGeometries.has(key)) {
        continue
      }
      seenGeometries.add(key)
      geometries.push(geometry)
    }
  }

  const viewport = options.viewport
  return estimateRuntimeResourceBudget({
    profileId: normalizeRuntimeResourceBudgetProfileId(options.profileId),
    targetPlatform: normalizeRuntimeTargetPlatform(options.targetPlatform),
    resourceSummaryBytes,
    sceneDocumentBytes,
    textures,
    geometries,
    effectsGroundBytes,
    viewport: viewport
      ? {
          width: Math.max(1, toFiniteNumber(viewport.width, 1)),
          height: Math.max(1, toFiniteNumber(viewport.height, 1)),
          pixelRatio: Math.max(1, toFiniteNumber(viewport.pixelRatio, 1)),
          hasPostProcessing: viewport.hasPostProcessing,
        }
      : undefined,
  })
}
