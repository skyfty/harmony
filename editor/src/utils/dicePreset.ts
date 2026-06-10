import { type SceneAssetRegistryEntry } from '@schema/core'
import { sanitizeSceneAssetRegistry } from '@/utils/assetDependencySubset'
import { normalizeAssetIdWithRegistry } from '@/utils/assetRegistryIdNormalization'
import { generateUuid } from '@/utils/uuid'

export const DICE_PRESET_FORMAT_VERSION = 1

export interface DicePresetAssetReference {
  assetId: string
  type: 'model' | 'mesh' | 'lod'
  name?: string
  downloadUrl?: string | null
  description?: string | null
  filename?: string | null
  thumbnail?: string | null
}

export interface DicePresetData {
  formatVersion: number
  id: string
  name: string
  assetRefs?: DicePresetAssetReference[]
  assetRegistry?: Record<string, SceneAssetRegistryEntry>
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

function normalizeAssetRefs(value: unknown): DicePresetAssetReference[] {
  if (!Array.isArray(value)) {
    return []
  }
  const out: DicePresetAssetReference[] = []
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
    const type =
      typeRaw === 'mesh'
        ? 'mesh'
        : typeRaw === 'model'
          ? 'model'
          : typeRaw === 'lod'
            ? 'lod'
            : null
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

export function createDicePresetData(payload: {
  name: string
  assetRefs: DicePresetAssetReference[]
  assetRegistry?: Record<string, SceneAssetRegistryEntry> | null
}): DicePresetData {
  const normalizedName = normalizeName(payload.name) || 'Dice Preset'
  const assetRefs = normalizeAssetRefs(payload.assetRefs)
  const assetRegistry = sanitizeSceneAssetRegistry(payload.assetRegistry)
  return {
    formatVersion: DICE_PRESET_FORMAT_VERSION,
    id: generateUuid(),
    name: normalizedName,
    ...(assetRefs.length ? { assetRefs } : null),
    ...(assetRegistry ? { assetRegistry } : null),
  }
}

export function serializeDicePreset(payload: {
  name: string
  assetRefs: DicePresetAssetReference[]
  assetRegistry?: Record<string, SceneAssetRegistryEntry> | null
}): string {
  const normalized = createDicePresetData(payload)
  return JSON.stringify(normalized, null, 2)
}

export function deserializeDicePreset(raw: string): DicePresetData {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid Dice preset JSON: ${(error as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Dice preset payload must be an object')
  }
  const candidate = parsed as Partial<DicePresetData> & {
    name?: unknown
    formatVersion?: unknown
    assetRefs?: unknown
  }
  const formatVersion = Number.isFinite(candidate.formatVersion)
    ? Number(candidate.formatVersion)
    : DICE_PRESET_FORMAT_VERSION
  if (formatVersion !== DICE_PRESET_FORMAT_VERSION) {
    throw new Error(`Unsupported Dice preset version: ${candidate.formatVersion}`)
  }
  const name = normalizeName(typeof candidate.name === 'string' ? candidate.name : '') || 'Dice Preset'
  const assetRefs = normalizeAssetRefs(candidate.assetRefs)
  const assetRegistry = sanitizeSceneAssetRegistry(candidate.assetRegistry)
  return {
    formatVersion: DICE_PRESET_FORMAT_VERSION,
    id: typeof candidate.id === 'string' && candidate.id.trim().length ? candidate.id.trim() : generateUuid(),
    name,
    ...(assetRefs.length ? { assetRefs } : null),
    ...(assetRegistry ? { assetRegistry } : null),
  }
}

export function buildDicePresetFilename(name: string): string {
  const normalized = normalizeName(name) || 'Dice Preset'
  const sanitized = normalized
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = sanitized.length ? sanitized : 'DicePreset'
  return `${base}.dice`
}

export function isDicePresetFilename(value: string | null | undefined): boolean {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return raw.endsWith('.dice')
}

export function resolveFirstDiceAssetId(
  preset: DicePresetData | { assetRefs?: DicePresetAssetReference[] } | null | undefined,
): string | null {
  const refs = preset?.assetRefs ?? []
  for (const ref of refs) {
    const id = normalizeAssetIdWithRegistry(ref.assetId, preset && 'assetRegistry' in preset ? preset.assetRegistry : undefined)
    if (id) {
      return id
    }
  }
  return null
}
