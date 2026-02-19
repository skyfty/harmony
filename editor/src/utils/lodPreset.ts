import { generateUuid } from '@/utils/uuid'
import type { LodComponentProps } from '@schema/components'
import { clampLodComponentProps } from '@schema/components/definitions/lodComponent'

export const LOD_PRESET_FORMAT_VERSION = 1

export interface LodPresetAssetReference {
  assetId: string
  type: 'model' | 'mesh'
  name?: string
  downloadUrl?: string | null
  description?: string | null
  filename?: string | null
  thumbnail?: string | null
}

export interface LodPresetData {
  formatVersion: number
  id: string
  name: string
  props: LodComponentProps
  assetRefs?: LodPresetAssetReference[]
}

function normalizeName(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

function normalizeAssetId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length ? text : null
}

function normalizeAssetRefs(value: unknown): LodPresetAssetReference[] {
  if (!Array.isArray(value)) {
    return []
  }
  const out: LodPresetAssetReference[] = []
  const seen = new Set<string>()
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return
    }
    const record = entry as Record<string, unknown>
    const assetId = normalizeAssetId(record.assetId)
    if (!assetId || seen.has(assetId)) {
      return
    }
    const typeRaw = normalizeAssetId(record.type)
    const type = typeRaw === 'mesh' ? 'mesh' : typeRaw === 'model' ? 'model' : null
    if (!type) {
      return
    }
    seen.add(assetId)
    out.push({
      assetId,
      type,
      name: normalizeOptionalText(record.name) ?? undefined,
      downloadUrl: normalizeOptionalText(record.downloadUrl),
      description: normalizeOptionalText(record.description),
      filename: normalizeOptionalText(record.filename),
      thumbnail: normalizeOptionalText(record.thumbnail),
    })
  })
  return out
}

export function createLodPresetData(payload: {
  name: string
  props: LodComponentProps
  assetRefs?: LodPresetAssetReference[]
}): LodPresetData {
  const normalizedName = normalizeName(payload.name) || 'LOD Preset'
  const props = clampLodComponentProps(payload.props)
  const assetRefs = normalizeAssetRefs(payload.assetRefs)
  return {
    formatVersion: LOD_PRESET_FORMAT_VERSION,
    id: generateUuid(),
    name: normalizedName,
    props,
    ...(assetRefs.length ? { assetRefs } : null),
  }
}

export function serializeLodPreset(payload: {
  name: string
  props: LodComponentProps
  assetRefs?: LodPresetAssetReference[]
}): string {
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
  const candidate = parsed as Partial<LodPresetData> & {
    props?: unknown
    name?: unknown
    formatVersion?: unknown
    assetRefs?: unknown
  }
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
  const assetRefs = normalizeAssetRefs(candidate.assetRefs)
  return {
    formatVersion: LOD_PRESET_FORMAT_VERSION,
    id: typeof candidate.id === 'string' && candidate.id.trim().length ? candidate.id.trim() : generateUuid(),
    name,
    props,
    ...(assetRefs.length ? { assetRefs } : null),
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
  // LOD presets are stored as JSON assets with a .lod extension.
  return `${base}.lod`
}
