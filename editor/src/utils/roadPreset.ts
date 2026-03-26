import type { RoadComponentProps } from '@schema/components'

function normalizeName(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

export const ROAD_PRESET_FORMAT_VERSION = 1

export type StrictRoadPresetRoadProps = {
  junctionSmoothing: number
  snapToTerrain: boolean
  laneLines: boolean
  shoulders: boolean
  bodyAssetId: string | null
  samplingDensityFactor: number
  smoothingStrengthFactor: number
  minClearance: number
  laneLineWidth?: number
  shoulderWidth?: number
}

export type RoadPresetMaterialPatch = {
  id?: string
  materialId: string | null
  name?: string
  type?: string
  props?: Record<string, unknown>
}

export type RoadPresetData = {
  kind: 'road-preset'
  formatVersion: number
  name: string
  width: number
  roadProps: StrictRoadPresetRoadProps
  materialOrder: string[]
  materialPatches: Record<string, RoadPresetMaterialPatch>
  assetRegistry?: unknown
}

export function buildRoadPresetFilename(name: string): string {
  const normalized = normalizeName(name) || 'Road Preset'
  const sanitized = normalized
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = sanitized.length ? sanitized : 'RoadPreset'
  return `${base}.road`
}

export function isRoadPresetFilename(value: string | null | undefined): boolean {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return raw.endsWith('.road')
}

export function buildRoadComponentPatchFromPreset(roadProps: StrictRoadPresetRoadProps): Partial<RoadComponentProps> {
  return {
    junctionSmoothing: roadProps.junctionSmoothing,
    snapToTerrain: roadProps.snapToTerrain,
    laneLines: roadProps.laneLines,
    shoulders: roadProps.shoulders,
    bodyAssetId: roadProps.bodyAssetId,
    samplingDensityFactor: roadProps.samplingDensityFactor,
    smoothingStrengthFactor: roadProps.smoothingStrengthFactor,
    minClearance: roadProps.minClearance,
    laneLineWidth: roadProps.laneLineWidth,
    shoulderWidth: roadProps.shoulderWidth,
  }
}
