function normalizeName(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

export const FLOOR_PRESET_FORMAT_VERSION = 1

export type StrictFloorPresetFloorProps = {
  smooth: number
  thickness: number
  sideUvScale: { x: number; y: number }
}

export type StrictFloorPresetMaterialConfig = {
  topBottomMaterialConfigId: string
  sideMaterialConfigId: string
}

export type FloorPresetMaterialPatch = {
  /** Node material slot id (SceneNodeMaterial.id). Provided as record key; repeated here for clarity in devtools. */
  id?: string
  /** Shared material id if this slot references a shared material definition. */
  materialId: string | null
  /** Optional local display name override. */
  name?: string
  /** Material type override. */
  type?: string
  /** Only used for local materials (materialId === null). */
  props?: Record<string, unknown>
}

export type FloorPresetData = {
  kind: 'floor-preset'
  formatVersion: number
  name: string
  floorProps: StrictFloorPresetFloorProps
  materialConfig: StrictFloorPresetMaterialConfig
  /** Order of node material slots to apply (SceneNodeMaterial.id). */
  materialOrder: string[]
  /** Patches keyed by SceneNodeMaterial.id. */
  materialPatches: Record<string, FloorPresetMaterialPatch>
  /** Optional dependency helpers (validated by sceneStore). */
  assetIndex?: unknown
  packageAssetMap?: unknown
}

export function buildFloorPresetFilename(name: string): string {
  const normalized = normalizeName(name) || 'Floor Preset'
  const sanitized = normalized
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = sanitized.length ? sanitized : 'FloorPreset'
  return `${base}.floor`
}

export function isFloorPresetFilename(value: string | null | undefined): boolean {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return raw.endsWith('.floor')
}
