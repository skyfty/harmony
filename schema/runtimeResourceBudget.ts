export type RuntimeResourceBudgetProfileId = 'low' | 'mid-high' | 'high'
export type RuntimeTargetPlatform = 'ios' | 'android' | 'both'
export type RuntimeMemoryWarningLevel = 'moderate' | 'low' | 'critical'
export type RuntimeMemoryGuardState = 'normal' | 'moderate' | 'critical'

export type RuntimeResourceBudgetCategory =
  | 'textures'
  | 'geometry'
  | 'renderTargets'
  | 'assetBuffers'
  | 'runtimeBase'
  | 'effectsGround'

export interface RuntimeResourceBudgetProfile {
  id: RuntimeResourceBudgetProfileId
  totalBudgetBytes: number
  warningRatio: number
  criticalRatio: number
  categoryBudgets: Record<RuntimeResourceBudgetCategory, number>
}

export interface RuntimeResourceTextureInput {
  assetId?: string | null
  name?: string | null
  kind?: 'standard' | 'hdri' | 'skycube' | 'ktx2'
  width?: number | null
  height?: number | null
  encodedBytes: number
  mipmap?: boolean
  faces?: number
}

export interface RuntimeResourceGeometryInput {
  assetId?: string | null
  name?: string | null
  vertexCount?: number | null
  indexCount?: number | null
  vertexBytes?: number
  indexBytes?: number
  instanceCount?: number
  encodedBytes?: number
}

export interface RuntimeResourceBudgetEstimateInput {
  profileId?: RuntimeResourceBudgetProfileId
  targetPlatform?: RuntimeTargetPlatform
  resourceSummaryBytes?: number
  sceneDocumentBytes?: number
  textures?: RuntimeResourceTextureInput[]
  geometries?: RuntimeResourceGeometryInput[]
  effectsGroundBytes?: number
  viewport?: {
    width: number
    height: number
    pixelRatio: number
    hasPostProcessing?: boolean
  }
}

export interface RuntimeResourceCategoryEstimate {
  category: RuntimeResourceBudgetCategory
  bytes: number
  budgetBytes: number
  ratio: number
  level: 'ok' | 'warning' | 'critical'
}

export interface RuntimeResourceTopConsumer {
  assetId: string | null
  name: string | null
  category: RuntimeResourceBudgetCategory
  bytes: number
}

export interface RuntimeResourceBudgetReport {
  profileId: RuntimeResourceBudgetProfileId
  targetPlatform: RuntimeTargetPlatform
  generatedAt: string
  totalBytes: number
  totalBudgetBytes: number
  warningBytes: number
  criticalBytes: number
  totalRatio: number
  level: 'ok' | 'warning' | 'critical'
  warningCategories: RuntimeResourceBudgetCategory[]
  criticalCategories: RuntimeResourceBudgetCategory[]
  categories: RuntimeResourceCategoryEstimate[]
  topConsumers: RuntimeResourceTopConsumer[]
}

const MIB = 1024 * 1024
const DEFAULT_WARNING_RATIO = 0.7
const DEFAULT_CRITICAL_RATIO = 0.9

export const RUNTIME_RESOURCE_BUDGET_PROFILES: Record<RuntimeResourceBudgetProfileId, RuntimeResourceBudgetProfile> = {
  low: {
    id: 'low',
    totalBudgetBytes: 500 * MIB,
    warningRatio: DEFAULT_WARNING_RATIO,
    criticalRatio: DEFAULT_CRITICAL_RATIO,
    categoryBudgets: {
      runtimeBase: 96 * MIB,
      textures: 160 * MIB,
      geometry: 124 * MIB,
      renderTargets: 76 * MIB,
      assetBuffers: 34 * MIB,
      effectsGround: 10 * MIB,
    },
  },
  'mid-high': {
    id: 'mid-high',
    totalBudgetBytes: 700 * MIB,
    warningRatio: DEFAULT_WARNING_RATIO,
    criticalRatio: DEFAULT_CRITICAL_RATIO,
    categoryBudgets: {
      runtimeBase: 96 * MIB,
      textures: 224 * MIB,
      geometry: 176 * MIB,
      renderTargets: 112 * MIB,
      assetBuffers: 76 * MIB,
      effectsGround: 16 * MIB,
    },
  },
  high: {
    id: 'high',
    totalBudgetBytes: 900 * MIB,
    warningRatio: DEFAULT_WARNING_RATIO,
    criticalRatio: DEFAULT_CRITICAL_RATIO,
    categoryBudgets: {
      runtimeBase: 120 * MIB,
      textures: 300 * MIB,
      geometry: 224 * MIB,
      renderTargets: 150 * MIB,
      assetBuffers: 86 * MIB,
      effectsGround: 20 * MIB,
    },
  },
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function isRuntimeResourceBudgetProfileId(value: unknown): value is RuntimeResourceBudgetProfileId {
  return value === 'low' || value === 'mid-high' || value === 'high'
}

export function normalizeRuntimeResourceBudgetProfileId(
  value: unknown,
): RuntimeResourceBudgetProfileId {
  return isRuntimeResourceBudgetProfileId(value) ? value : 'mid-high'
}

export function normalizeRuntimeTargetPlatform(value: unknown): RuntimeTargetPlatform {
  return value === 'ios' || value === 'android' || value === 'both' ? value : 'both'
}

export function createRuntimeResourceBudgetProfile(
  profileId: RuntimeResourceBudgetProfileId = 'mid-high',
): RuntimeResourceBudgetProfile {
  return RUNTIME_RESOURCE_BUDGET_PROFILES[normalizeRuntimeResourceBudgetProfileId(profileId)]
}

export function estimateTextureBytes(texture: RuntimeResourceTextureInput): number {
  const encodedBytes = Math.max(0, toFiniteNumber(texture.encodedBytes, 0))
  const width = Math.max(0, toFiniteNumber(texture.width, 0))
  const height = Math.max(0, toFiniteNumber(texture.height, 0))
  if (width <= 0 || height <= 0) {
    return Math.ceil(encodedBytes * 4)
  }

  const faces = Math.max(1, toFiniteNumber(texture.faces, 1))
  const mipmapBytes = texture.mipmap === true ? Math.ceil(width * height * 4 * (4 / 3)) : width * height * 4
  const isEnvironment = texture.kind === 'hdri' || texture.kind === 'skycube'
  const baseBytes = isEnvironment ? width * height * 4 : mipmapBytes
  return Math.ceil(baseBytes * faces)
}

export function estimateModelGeometryBytes(input: {
  vertexCount?: number | null
  indexCount?: number | null
  instanceCount?: number
}): number {
  const vertexCount = Math.max(0, toFiniteNumber(input.vertexCount, 0))
  const indexCount = Math.max(0, toFiniteNumber(input.indexCount, 0))
  const instanceCount = Math.max(1, toFiniteNumber(input.instanceCount, 1))
  const base = Math.ceil(vertexCount * 32 + indexCount * 2)
  return Math.ceil(base * instanceCount)
}

export function estimateGeometryInputBytes(geometry: RuntimeResourceGeometryInput): number {
  if (
    (typeof geometry.vertexBytes === 'number' && geometry.vertexBytes >= 0)
    || (typeof geometry.indexBytes === 'number' && geometry.indexBytes >= 0)
  ) {
    const vertexBytes = Math.max(0, toFiniteNumber(geometry.vertexBytes, 0))
    const indexBytes = Math.max(0, toFiniteNumber(geometry.indexBytes, 0))
    const instanceCount = Math.max(1, toFiniteNumber(geometry.instanceCount, 1))
    return Math.ceil((vertexBytes + indexBytes) * instanceCount)
  }

  const fallbackBytes = Math.max(0, toFiniteNumber(geometry.encodedBytes, 0))
  return Math.ceil(
    estimateModelGeometryBytes({
      vertexCount: geometry.vertexCount,
      indexCount: geometry.indexCount,
      instanceCount: geometry.instanceCount,
    }) + fallbackBytes,
  )
}

function resolveLevel(ratio: number, warningRatio: number, criticalRatio: number): 'ok' | 'warning' | 'critical' {
  if (ratio >= criticalRatio) {
    return 'critical'
  }
  if (ratio >= warningRatio) {
    return 'warning'
  }
  return 'ok'
}

function buildCategoryEstimate(
  category: RuntimeResourceBudgetCategory,
  bytes: number,
  budgetBytes: number,
  warningRatio: number,
  criticalRatio: number,
): RuntimeResourceCategoryEstimate {
  const safeBudget = Math.max(1, budgetBytes)
  return {
    category,
    bytes,
    budgetBytes: safeBudget,
    ratio: clampRatio(bytes / safeBudget),
    level: resolveLevel(bytes / safeBudget, warningRatio, criticalRatio),
  }
}

export function estimateRuntimeResourceBudget(
  input: RuntimeResourceBudgetEstimateInput,
): RuntimeResourceBudgetReport {
  const profile = createRuntimeResourceBudgetProfile(input.profileId)
  const targetPlatform = normalizeRuntimeTargetPlatform(input.targetPlatform)
  const textures = Array.isArray(input.textures) ? input.textures : []
  const geometries = Array.isArray(input.geometries) ? input.geometries : []

  const textureBytes = textures.reduce((sum, texture) => sum + estimateTextureBytes(texture), 0)
  const geometryBytes = geometries.reduce((sum, geometry) => sum + estimateGeometryInputBytes(geometry), 0)

  const viewport = input.viewport ?? null
  const viewportWidth = viewport ? Math.max(1, toFiniteNumber(viewport.width, 1)) : 1
  const viewportHeight = viewport ? Math.max(1, toFiniteNumber(viewport.height, 1)) : 1
  const pixelRatio = viewport ? Math.max(1, toFiniteNumber(viewport.pixelRatio, 1)) : 1
  const renderTargetBytes = Math.ceil(viewportWidth * viewportHeight * pixelRatio * pixelRatio * 4 * 2)
    + (viewport?.hasPostProcessing ? Math.ceil(viewportWidth * viewportHeight * pixelRatio * pixelRatio * 4 * 2) : 0)

  const resourceSummaryBytes = Math.max(0, toFiniteNumber(input.resourceSummaryBytes, 0))
  const sceneDocumentBytes = Math.max(0, toFiniteNumber(input.sceneDocumentBytes, 0))
  const assetBufferBytes = Math.ceil(resourceSummaryBytes * 1.25 + sceneDocumentBytes * 2)

  const effectsGroundBytes = Math.max(0, toFiniteNumber(input.effectsGroundBytes, 0))

  const categoryBytes: Record<RuntimeResourceBudgetCategory, number> = {
    textures: textureBytes,
    geometry: geometryBytes,
    renderTargets: renderTargetBytes,
    assetBuffers: assetBufferBytes,
    runtimeBase: profile.categoryBudgets.runtimeBase,
    effectsGround: effectsGroundBytes,
  }
  const totalBytes = Object.values(categoryBytes).reduce((sum, value) => sum + value, 0)
  const categories = (Object.keys(categoryBytes) as RuntimeResourceBudgetCategory[]).map((category) => {
    const estimate = buildCategoryEstimate(
      category,
      categoryBytes[category],
      profile.categoryBudgets[category],
      profile.warningRatio,
      profile.criticalRatio,
    )
    if (category === 'runtimeBase') {
      estimate.level = 'ok'
    }
    return estimate
  })

  const topConsumers = [
    ...textures.map((texture) => ({
      assetId: typeof texture.assetId === 'string' ? texture.assetId.trim() : null,
      name: typeof texture.name === 'string' ? texture.name.trim() : null,
      category: 'textures' as const,
      bytes: estimateTextureBytes(texture),
    })),
    ...geometries.map((geometry) => ({
      assetId: typeof geometry.assetId === 'string' ? geometry.assetId.trim() : null,
      name: typeof geometry.name === 'string' ? geometry.name.trim() : null,
      category: 'geometry' as const,
      bytes: estimateGeometryInputBytes(geometry),
    })),
  ]
    .filter((item) => item.bytes > 0)
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 12)

  const totalRatio = clampRatio(totalBytes / Math.max(1, profile.totalBudgetBytes))
  const warningBytes = Math.ceil(profile.totalBudgetBytes * profile.warningRatio)
  const criticalBytes = Math.ceil(profile.totalBudgetBytes * profile.criticalRatio)

  return {
    profileId: profile.id,
    targetPlatform,
    generatedAt: new Date().toISOString(),
    totalBytes,
    totalBudgetBytes: profile.totalBudgetBytes,
    warningBytes,
    criticalBytes,
    totalRatio,
    level: resolveLevel(totalRatio, profile.warningRatio, profile.criticalRatio),
    warningCategories: categories
      .filter((category) => category.level === 'warning' || category.level === 'critical')
      .map((category) => category.category),
    criticalCategories: categories
      .filter((category) => category.level === 'critical')
      .map((category) => category.category),
    categories,
    topConsumers,
  }
}

export function resolveRuntimeMemoryGuardStateForWarning(params: {
  platform: string
  level?: number | null
  previousState: RuntimeMemoryGuardState
  warningCount: number
  now: number
  lastWarningAt: number
}): RuntimeMemoryGuardState {
  const platform = params.platform.toLowerCase()
  const level = typeof params.level === 'number' && Number.isFinite(params.level) ? params.level : null

  if (platform === 'android' && level !== null) {
    if (level >= 15) {
      return 'critical'
    }
    if (level >= 10) {
      return 'critical'
    }
    if (level >= 5) {
      return 'moderate'
    }
  }

  if (params.previousState === 'moderate' && params.warningCount >= 2 && params.now - params.lastWarningAt <= 10_000) {
    return 'critical'
  }
  return 'moderate'
}
