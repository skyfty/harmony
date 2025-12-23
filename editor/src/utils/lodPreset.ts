import { generateUuid } from '@/utils/uuid'
import type { LodComponentProps } from '@schema/components'
import { clampLodComponentProps } from '@schema/components'

export const LOD_PRESET_FORMAT_VERSION = 1

export interface LodPresetData {
  formatVersion: number
  id: string
  name: string
  props: LodComponentProps
}

function normalizeName(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

export function createLodPresetData(payload: { name: string; props: LodComponentProps }): LodPresetData {
  const normalizedName = normalizeName(payload.name) || 'LOD Preset'
  const props = clampLodComponentProps(payload.props)
  return {
    formatVersion: LOD_PRESET_FORMAT_VERSION,
    id: generateUuid(),
    name: normalizedName,
    props,
  }
}

export function serializeLodPreset(payload: { name: string; props: LodComponentProps }): string {
  const normalized = createLodPresetData(payload)
  return JSON.stringify(normalized, null, 2)
}

export function deserializeLodPreset(raw: string): LodPresetData {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid LOD preset JSON: ${(error as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LOD preset payload must be an object')
  }
  const candidate = parsed as Partial<LodPresetData> & { props?: unknown; name?: unknown; formatVersion?: unknown }
  const formatVersion = Number.isFinite(candidate.formatVersion)
    ? Number(candidate.formatVersion)
    : LOD_PRESET_FORMAT_VERSION
  if (formatVersion !== LOD_PRESET_FORMAT_VERSION) {
    throw new Error(`Unsupported LOD preset version: ${candidate.formatVersion}`)
  }
  const propsCandidate = candidate.props && typeof candidate.props === 'object'
    ? (candidate.props as Partial<LodComponentProps>)
    : null
  const name = normalizeName(typeof candidate.name === 'string' ? candidate.name : '') || 'LOD Preset'
  const props = clampLodComponentProps(propsCandidate)
  return {
    formatVersion: LOD_PRESET_FORMAT_VERSION,
    id: typeof candidate.id === 'string' && candidate.id.trim().length ? candidate.id.trim() : generateUuid(),
    name,
    props,
  }
}

export function buildLodPresetFilename(name: string): string {
  const normalized = normalizeName(name) || 'LOD Preset'
  const sanitized = normalized
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = sanitized.length ? sanitized : 'LODPreset'
  // Use .prefab so it shows up under the existing Prefabs category.
  return `${base}.prefab`
}
