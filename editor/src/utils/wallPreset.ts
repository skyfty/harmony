function normalizeName(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

export const WALL_PRESET_FORMAT_VERSION = 8

export type WallForwardAxis = '+x' | '-x' | '+z' | '-z'
export type WallUvAxis = 'auto' | 'u' | 'v'
export type WallRenderMode = 'stretch' | 'repeatInstances'

export type WallModelOrientation = {
  forwardAxis: WallForwardAxis
  yawDeg: number
}

export type WallOffsetLocal = {
  x: number
  y: number
  z: number
}

export type StrictWallPresetCornerModelRule = {
  bodyAssetId: string | null
  headAssetId: string | null
  footAssetId: string | null
  bodyOffsetLocal: WallOffsetLocal
  headOffsetLocal: WallOffsetLocal
  footOffsetLocal: WallOffsetLocal
  bodyForwardAxis: WallForwardAxis
  bodyYawDeg: number
  headForwardAxis: WallForwardAxis
  headYawDeg: number
  footForwardAxis: WallForwardAxis
  footYawDeg: number
  angle: number
  tolerance: number
  jointTrim: {
    start: number
    end: number
  }
}

export type StrictWallPresetWallProps = {
  height: number
  width: number
  thickness: number
  wallBaseOffsetLocal: WallOffsetLocal
  bodyMaterialConfigId: string | null
  wallRenderMode: WallRenderMode
  repeatInstanceStep: number
  isAirWall: boolean
  bodyAssetId: string | null
  bodyOrientation: WallModelOrientation
  bodyUvAxis: WallUvAxis
  headAssetId: string | null
  headAssetHeight: number
  headOrientation: WallModelOrientation
  headUvAxis: WallUvAxis
  footAssetId: string | null
  footAssetHeight: number
  footOrientation: WallModelOrientation
  footUvAxis: WallUvAxis
  bodyEndCapAssetId: string | null
  bodyEndCapOffsetLocal: WallOffsetLocal
  bodyEndCapOrientation: WallModelOrientation
  headEndCapAssetId: string | null
  headEndCapOffsetLocal: WallOffsetLocal
  headEndCapOrientation: WallModelOrientation
  footEndCapAssetId: string | null
  footEndCapOffsetLocal: WallOffsetLocal
  footEndCapOrientation: WallModelOrientation
  cornerModels: StrictWallPresetCornerModelRule[]
}

export type WallPresetMaterialPatch = {
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

export type WallPresetData = {
  kind: 'wall-preset'
  formatVersion: number
  name: string
  wallProps: StrictWallPresetWallProps
  /** Order of node material slots to apply (SceneNodeMaterial.id). */
  materialOrder: string[]
  /** Patches keyed by SceneNodeMaterial.id. */
  materialPatches: Record<string, WallPresetMaterialPatch>
  assetRegistry?: unknown
  /** Optional dependency helpers (validated by sceneStore). */
  assetIndex?: unknown
}

export function buildWallPresetFilename(name: string): string {
  const normalized = normalizeName(name) || 'Wall Preset'
  const sanitized = normalized
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = sanitized.length ? sanitized : 'WallPreset'
  return `${base}.wall`
}

export function isWallPresetFilename(value: string | null | undefined): boolean {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return raw.endsWith('.wall')
}
