function normalizeName(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

export const LANDFORM_PRESET_FORMAT_VERSION = 3

export type StrictLandformPresetProps = {
  enableFeather: boolean
  feather: number
  uvScale: { x: number; y: number }
}

export type LandformPresetMaterialPatch = {
  id?: string
  name?: string
  type?: string
  props?: Record<string, unknown>
}

export type LandformPresetData = {
  kind: 'landform-preset'
  formatVersion: number
  name: string
  landformProps: StrictLandformPresetProps
  materialSlotId: string
  materialPatch: LandformPresetMaterialPatch
  assetRegistry?: unknown
}

export function buildLandformPresetFilename(name: string): string {
  const normalized = normalizeName(name) || 'Landform Preset'
  const sanitized = normalized
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = sanitized.length ? sanitized : 'LandformPreset'
  return `${base}.landform`
}

export function isLandformPresetFilename(value: string | null | undefined): boolean {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return raw.endsWith('.landform')
}