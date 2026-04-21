import {
  type AssetType,
  LOD_COMPONENT_TYPE,
  cloneEnvironmentSettings,
  resolveServerAssetDownloadUrl,
  type SceneAssetSourceType,
  type BehaviorComponentProps,
  type EnvironmentSettings,
  type SceneAssetOverrideEntry,
  type SceneAssetRegistryEntry,
  type SceneResourceSummaryEntry,
  type SceneNode,
  type SceneNodeComponentState,
} from '@schema'
import {
  BEHAVIOR_COMPONENT_TYPE,
  ROAD_COMPONENT_TYPE,
  RIGIDBODY_COMPONENT_TYPE,
  WALL_COMPONENT_TYPE,
  type LodComponentProps,
  type RoadComponentProps,
  type WallComponentProps,
} from '@schema/components'
import type { ProjectAsset } from '@/types/project-asset'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import {
  type ExplicitSceneAssetReference,
  visitExplicitComponentAssetReferences,
  visitExplicitTerrainScatterAssetReferences,
} from './sceneExplicitAssetReferences'
import {
  MATERIAL_TEXTURE_SLOTS,
  type SceneMaterial,
  type SceneMaterialTextureRef,
  type SceneNodeMaterial,
} from '@/types/material'
import type { TerrainScatterStoreSnapshot } from '@schema/terrain-scatter'
import { readServerDownloadBaseUrl } from '@/api/serverApiConfig'
import { shouldExcludeAssetFromRuntimeExport } from '@/utils/assetDependencySubset'
import { normalizeAssetIdWithRegistry } from '@/utils/assetRegistryIdNormalization'

export type SceneAssetDiagnosticSeverity = 'error' | 'warning'

export type SceneAssetDiagnosticCode =
  | 'missing-registry-entry'
  | 'missing-catalog-entry'
  | 'invalid-registry-entry'
  | 'environment-misconfiguration'
  | 'lod-misconfiguration'
  | 'terrain-scatter-misconfiguration'

export type SceneAssetReferenceCategory =
  | 'node'
  | 'component'
  | 'material'
  | 'environment'
  | 'ground'
  | 'planning'
  | 'terrain-scatter'
  | 'terrain-paint'
  | 'scene'

export interface SceneAssetReferenceRecord {
  assetId: string
  path: string
  category: SceneAssetReferenceCategory
  nodeId?: string
  nodeName?: string
  componentType?: string
  note?: string
}

export interface SceneAssetDiagnosticIssue {
  severity: SceneAssetDiagnosticSeverity
  code: SceneAssetDiagnosticCode
  message: string
  assetId?: string
  path?: string
  category?: SceneAssetReferenceCategory
  detail?: string
  references: SceneAssetReferenceRecord[]
}

export interface SceneAssetDiagnosticSummaryItem {
  severity: SceneAssetDiagnosticSeverity
  code: SceneAssetDiagnosticCode
  message: string
  assetId?: string
  locations: string[]
}

export interface SceneAssetDiagnosticsSummary {
  totalIssueCount: number
  blockingIssueCount: number
  warningIssueCount: number
  items: SceneAssetDiagnosticSummaryItem[]
}

export interface SceneAssetValidationReport {
  references: SceneAssetReferenceRecord[]
  issues: SceneAssetDiagnosticIssue[]
  blockingIssueCount: number
  warningIssueCount: number
  hasBlockingIssues: boolean
  summary: SceneAssetDiagnosticsSummary
}

export interface SceneAssetReferenceSummary {
  assetId: string
  assetName?: string | null
  assetType?: AssetType | string | null
  sourceType?: SceneAssetSourceType | string | null
  sourceLabel?: string | null
  resolvedUrl?: string | null
  referenceCount: number
  referencePaths: string[]
  references: SceneAssetReferenceRecord[]
}

type AssetLookupScene = Pick<
  StoredSceneDocument,
  | 'id'
  | 'name'
  | 'nodes'
  | 'environment'
  | 'groundSettings'
  | 'planningData'
  | 'assetCatalog'
  | 'assetRegistry'
  | 'projectOverrideAssets'
  | 'sceneOverrideAssets'
  | 'resourceSummary'
>

const LOCAL_EMBEDDED_ASSET_PREFIX = 'local::'
const ASSET_REFERENCE_SKIP_KEYS = new Set<string>(['__prefabAssetId'])
const ASSET_REFERENCE_EXACT_KEYS = new Set<string>([
  'assetid',
  'assetids',
  'sourceassetid',
  'providerassetid',
  'imageassetid',
  'descriptionassetid',
  'textureassetid',
  'hdriassetid',
  'skycubezipassetid',
  'positivexassetid',
  'negativexassetid',
  'positiveyassetid',
  'negativeyassetid',
  'positivezassetid',
  'negativezassetid',
  'bodyassetid',
  'headassetid',
  'footassetid',
  'bodyendcapassetid',
  'headendcapassetid',
  'footendcapassetid',
  'profileid',
  'modelassetid',
  'billboardassetid',
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeAssetIdCandidate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  let candidate = value.trim()
  if (!candidate) {
    return null
  }
  if (candidate.startsWith('asset://')) {
    candidate = candidate.slice('asset://'.length)
  }
  if (!candidate || candidate.startsWith(LOCAL_EMBEDDED_ASSET_PREFIX)) {
    return null
  }
  if (/^(?:https?:|data:|blob:)/i.test(candidate)) {
    return null
  }
  return candidate.length <= 256 ? candidate : null
}

function isAssetReferenceKey(key: string | null | undefined): boolean {
  if (!key) {
    return false
  }
  const normalized = key.trim().toLowerCase()
  if (!normalized) {
    return false
  }
  return ASSET_REFERENCE_EXACT_KEYS.has(normalized)
    || normalized.endsWith('assetid')
    || normalized.endsWith('assetids')
}

function appendIndexPath(path: string, index: number): string {
  return `${path}[${index}]`
}

function addReference(
  bucket: SceneAssetReferenceRecord[],
  assetId: string | null,
  record: Omit<SceneAssetReferenceRecord, 'assetId'>,
): void {
  if (!assetId) {
    return
  }
  bucket.push({
    assetId,
    ...record,
  })
}

function collectReferencesFromUnknown(
  value: unknown,
  bucket: SceneAssetReferenceRecord[],
  record: Omit<SceneAssetReferenceRecord, 'assetId'>,
  allowDirectAssetValue = false,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const nextPath = appendIndexPath(record.path, index)
      const nextRecord = { ...record, path: nextPath }
      if (isPlainObject(entry) || Array.isArray(entry)) {
        collectReferencesFromUnknown(entry, bucket, nextRecord, allowDirectAssetValue)
        return
      }
      if (allowDirectAssetValue) {
        addReference(bucket, normalizeAssetIdCandidate(entry), nextRecord)
      }
    })
    return
  }
  if (!isPlainObject(value)) {
    if (allowDirectAssetValue) {
      addReference(bucket, normalizeAssetIdCandidate(value), record)
    }
    return
  }
  Object.entries(value).forEach(([key, entry]) => {
    if (ASSET_REFERENCE_SKIP_KEYS.has(key)) {
      return
    }
    const nextPath = record.path ? `${record.path}.${key}` : key
    const nextRecord = { ...record, path: nextPath }
    if (isAssetReferenceKey(key)) {
      if (Array.isArray(entry)) {
        entry.forEach((item, index) => {
          addReference(bucket, normalizeAssetIdCandidate(item), {
            ...nextRecord,
            path: appendIndexPath(nextPath, index),
          })
        })
      } else {
        collectReferencesFromUnknown(entry, bucket, nextRecord, true)
      }
      return
    }
    collectReferencesFromUnknown(entry, bucket, nextRecord, false)
  })
}

function scanNode(node: SceneNode, bucket: SceneAssetReferenceRecord[], parentPath: string): void {
  const nodePath = `${parentPath}${parentPath ? '.' : ''}${node.name ? `${node.name}(${node.id})` : node.id}`
  addReference(bucket, normalizeAssetIdCandidate(node.sourceAssetId), {
    path: `${nodePath}.sourceAssetId`,
    category: 'node',
    nodeId: node.id,
    nodeName: node.name,
  })
  addReference(bucket, normalizeAssetIdCandidate(node.importMetadata?.assetId), {
    path: `${nodePath}.importMetadata.assetId`,
    category: 'node',
    nodeId: node.id,
    nodeName: node.name,
  })
  if (Array.isArray(node.materials)) {
    node.materials.forEach((material, index) => {
      collectMaterialReferences(material, bucket, {
        path: `${nodePath}.materials[${index}]`,
        category: 'material',
        nodeId: node.id,
        nodeName: node.name,
      })
    })
  }
  if (node.components) {
    Object.entries(node.components).forEach(([componentType, component]) => {
      const props = (component as SceneNodeComponentState<Record<string, unknown>> | undefined)?.props
      collectComponentReferences(componentType, props, bucket, {
        path: `${nodePath}.components.${componentType}.props`,
        category: 'component',
        nodeId: node.id,
        nodeName: node.name,
        componentType,
      })
    })
  }
  collectReferencesFromUnknown(node.userData, bucket, {
    path: `${nodePath}.userData`,
    category: 'node',
    nodeId: node.id,
    nodeName: node.name,
  })
  collectReferencesFromUnknown(node.dynamicMesh, bucket, {
    path: `${nodePath}.dynamicMesh`,
    category: node.dynamicMesh?.type === 'Ground' ? 'ground' : 'node',
    nodeId: node.id,
    nodeName: node.name,
  })
  const scatterSnapshot = (node.dynamicMesh as { terrainScatter?: TerrainScatterStoreSnapshot | null } | null | undefined)?.terrainScatter
  visitExplicitTerrainScatterAssetReferences(scatterSnapshot, ({ assetId, path }: ExplicitSceneAssetReference) => {
    addReference(bucket, normalizeAssetIdCandidate(assetId), {
      path: `${nodePath}.dynamicMesh.terrainScatter.${path}`,
      category: 'terrain-scatter',
      nodeId: node.id,
      nodeName: node.name,
      note: 'terrain-scatter-lod-preset',
    })
  })
  if (Array.isArray(node.children)) {
    node.children.forEach((child) => scanNode(child, bucket, `${nodePath}.children`))
  }
}

function collectBehaviorReferences(
  props: Partial<BehaviorComponentProps> | null | undefined,
  bucket: SceneAssetReferenceRecord[],
  record: Omit<SceneAssetReferenceRecord, 'assetId'>,
): void {
  collectReferencesFromUnknown(props, bucket, {
    ...record,
    note: 'behavior-script',
  })
  visitExplicitComponentAssetReferences(BEHAVIOR_COMPONENT_TYPE, props as Record<string, unknown> | undefined, ({ assetId, path }: ExplicitSceneAssetReference) => {
    addReference(bucket, normalizeAssetIdCandidate(assetId), {
      ...record,
      path: `${record.path}.${path}`,
      note: 'behavior-script',
    })
  })
}

function collectWallReferences(
  props: Partial<WallComponentProps> | null | undefined,
  bucket: SceneAssetReferenceRecord[],
  record: Omit<SceneAssetReferenceRecord, 'assetId'>,
): void {
  addReference(bucket, normalizeAssetIdCandidate(props?.bodyAssetId), {
    ...record,
    path: `${record.path}.bodyAssetId`,
  })
  addReference(bucket, normalizeAssetIdCandidate(props?.headAssetId), {
    ...record,
    path: `${record.path}.headAssetId`,
  })
  addReference(bucket, normalizeAssetIdCandidate(props?.footAssetId), {
    ...record,
    path: `${record.path}.footAssetId`,
  })
  addReference(bucket, normalizeAssetIdCandidate(props?.bodyEndCapAssetId), {
    ...record,
    path: `${record.path}.bodyEndCapAssetId`,
  })
  addReference(bucket, normalizeAssetIdCandidate(props?.headEndCapAssetId), {
    ...record,
    path: `${record.path}.headEndCapAssetId`,
  })
  addReference(bucket, normalizeAssetIdCandidate(props?.footEndCapAssetId), {
    ...record,
    path: `${record.path}.footEndCapAssetId`,
  })
  const cornerModels = Array.isArray(props?.cornerModels) ? props.cornerModels : []
  cornerModels.forEach((corner, index) => {
    addReference(bucket, normalizeAssetIdCandidate(corner?.bodyAssetId), {
      ...record,
      path: `${record.path}.cornerModels[${index}].bodyAssetId`,
    })
    addReference(bucket, normalizeAssetIdCandidate(corner?.headAssetId), {
      ...record,
      path: `${record.path}.cornerModels[${index}].headAssetId`,
    })
    addReference(bucket, normalizeAssetIdCandidate(corner?.footAssetId), {
      ...record,
      path: `${record.path}.cornerModels[${index}].footAssetId`,
    })
  })
}

function collectRoadReferences(
  props: Partial<RoadComponentProps> | null | undefined,
  bucket: SceneAssetReferenceRecord[],
  record: Omit<SceneAssetReferenceRecord, 'assetId'>,
): void {
  addReference(bucket, normalizeAssetIdCandidate(props?.bodyAssetId), {
    ...record,
    path: `${record.path}.bodyAssetId`,
  })
}

function collectComponentReferences(
  componentType: string,
  props: Record<string, unknown> | undefined,
  bucket: SceneAssetReferenceRecord[],
  record: Omit<SceneAssetReferenceRecord, 'assetId'>,
): void {
  switch (componentType) {
    case BEHAVIOR_COMPONENT_TYPE:
      collectBehaviorReferences(props as Partial<BehaviorComponentProps> | null | undefined, bucket, record)
      return
    case WALL_COMPONENT_TYPE:
      collectWallReferences(props as Partial<WallComponentProps> | null | undefined, bucket, record)
      break
    case ROAD_COMPONENT_TYPE:
      collectRoadReferences(props as Partial<RoadComponentProps> | null | undefined, bucket, record)
      break
    case LOD_COMPONENT_TYPE:
    case RIGIDBODY_COMPONENT_TYPE:
      break
    default:
      collectReferencesFromUnknown(props, bucket, record)
  }
  visitExplicitComponentAssetReferences(componentType, props, ({ assetId, path }: ExplicitSceneAssetReference) => {
    addReference(bucket, normalizeAssetIdCandidate(assetId), {
      ...record,
      path: `${record.path}.${path}`,
    })
  })
}

function collectMaterialReferences(
  material: SceneMaterial | SceneNodeMaterial,
  bucket: SceneAssetReferenceRecord[],
  record: Omit<SceneAssetReferenceRecord, 'assetId'>,
): void {
  const textures = material?.textures as Partial<Record<(typeof MATERIAL_TEXTURE_SLOTS)[number], SceneMaterialTextureRef | null>> | null | undefined
  if (!textures) {
    return
  }
  MATERIAL_TEXTURE_SLOTS.forEach((slot) => {
    const textureRef = textures[slot]
    if (!textureRef) {
      return
    }
    addReference(bucket, normalizeAssetIdCandidate(textureRef.assetId), {
      ...record,
      path: `${record.path}.textures.${slot}.assetId`,
      note: 'material-texture-slot',
    })
  })
}

function buildReferenceDedupKey(reference: SceneAssetReferenceRecord): string {
  return [
    reference.assetId,
    reference.path,
    reference.category,
    reference.nodeId ?? '',
    reference.nodeName ?? '',
    reference.componentType ?? '',
    reference.note ?? '',
  ].join('::')
}

function dedupeSceneAssetReferenceRecords(references: SceneAssetReferenceRecord[]): SceneAssetReferenceRecord[] {
  const seen = new Set<string>()
  const deduped: SceneAssetReferenceRecord[] = []
  references.forEach((reference) => {
    const key = buildReferenceDedupKey(reference)
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    deduped.push(reference)
  })
  return deduped
}

export function collectSceneAssetReferenceRecords(scene: AssetLookupScene): SceneAssetReferenceRecord[] {
  const references: SceneAssetReferenceRecord[] = []
  scene.nodes.forEach((node) => scanNode(node, references, 'nodes'))
  const normalizedEnvironment = cloneEnvironmentSettings(scene.environment as EnvironmentSettings | null | undefined)
  collectReferencesFromUnknown(normalizedEnvironment, references, {
    path: 'environment',
    category: 'environment',
  })
  collectReferencesFromUnknown(scene.groundSettings, references, {
    path: 'groundSettings',
    category: 'ground',
  })
  return dedupeSceneAssetReferenceRecords(references)
}

function getAssetFromCatalog(catalog: Record<string, ProjectAsset[]>, assetId: string): ProjectAsset | null {
  const normalized = assetId.trim()
  if (!normalized) {
    return null
  }
  for (const assets of Object.values(catalog)) {
    const found = assets.find((asset) => asset.id === normalized)
    if (found) {
      return found
    }
  }
  return null
}

function normalizeDiagnosticAssetId(
  assetId: unknown,
  assetRegistry: Record<string, SceneAssetRegistryEntry>,
): string | null {
  return normalizeAssetIdWithRegistry(assetId, assetRegistry)
}

function getCanonicalAssetFromCatalog(
  scene: AssetLookupScene,
  assetRegistry: Record<string, SceneAssetRegistryEntry>,
  assetId: string,
): { canonicalAssetId: string | null; asset: ProjectAsset | null } {
  const canonicalAssetId = normalizeDiagnosticAssetId(assetId, assetRegistry)
  if (!canonicalAssetId) {
    return { canonicalAssetId: null, asset: null }
  }
  return {
    canonicalAssetId,
    asset: getAssetFromCatalog(scene.assetCatalog ?? {}, canonicalAssetId),
  }
}

function resolveEffectiveRegistryEntry(
  scene: AssetLookupScene,
  assetRegistry: Record<string, SceneAssetRegistryEntry>,
  assetId: string,
): SceneAssetRegistryEntry | null {
  const canonicalAssetId = normalizeDiagnosticAssetId(assetId, assetRegistry) ?? assetId
  const sceneOverride = scene.sceneOverrideAssets?.[canonicalAssetId] ?? scene.sceneOverrideAssets?.[assetId]
  if (sceneOverride) {
    return sceneOverride
  }
  const projectOverride = scene.projectOverrideAssets?.[canonicalAssetId] ?? scene.projectOverrideAssets?.[assetId]
  if (projectOverride) {
    return projectOverride
  }
  return assetRegistry[canonicalAssetId] ?? assetRegistry[assetId] ?? scene.assetRegistry?.[canonicalAssetId] ?? scene.assetRegistry?.[assetId] ?? null
}

function isValidRegistryEntry(entry: SceneAssetRegistryEntry | SceneAssetOverrideEntry | null): boolean {
  if (!entry) {
    return false
  }
  if (entry.sourceType === 'package') {
    const inline = typeof entry.inline === 'string' ? entry.inline.trim() : ''
    const zipPath = typeof entry.zipPath === 'string' ? entry.zipPath.trim() : ''
    return Boolean(inline || zipPath)
  }
  if (entry.sourceType === 'url') {
    const url = entry.url?.trim?.() ?? ''
    return Boolean(url)
  }
  const resolvedUrl = resolveServerAssetDownloadUrl({
    assetBaseUrl: readServerDownloadBaseUrl(),
    fileKey: typeof entry.fileKey === 'string' ? entry.fileKey : null,
    resolvedUrl: entry.resolvedUrl,
  })
  return Boolean(resolvedUrl)
}

function collectCanonicalReferenceMap(
  references: SceneAssetReferenceRecord[],
  assetRegistry: Record<string, SceneAssetRegistryEntry>,
): Map<string, SceneAssetReferenceRecord[]> {
  const map = new Map<string, SceneAssetReferenceRecord[]>()
  references.forEach((reference) => {
    const canonicalAssetId = normalizeDiagnosticAssetId(reference.assetId, assetRegistry) ?? reference.assetId
    const existing = map.get(canonicalAssetId)
    if (existing) {
      existing.push(reference)
    } else {
      map.set(canonicalAssetId, [reference])
    }
  })
  return map
}

function getResourceSummaryEntry(
  scene: AssetLookupScene,
  assetRegistry: Record<string, SceneAssetRegistryEntry>,
  assetId: string,
): SceneResourceSummaryEntry | null {
  const entries = Array.isArray(scene.resourceSummary?.assets) ? scene.resourceSummary.assets : []
  const normalized = assetId.trim()
  const canonicalAssetId = normalizeDiagnosticAssetId(assetId, assetRegistry)
  const candidateIds = Array.from(new Set([canonicalAssetId, normalized].filter((value): value is string => Boolean(value))))
  if (!candidateIds.length) {
    return null
  }
  return entries.find((entry) => {
    const summaryAssetId = typeof entry?.assetId === 'string' ? entry.assetId.trim() : ''
    return summaryAssetId.length > 0 && candidateIds.includes(summaryAssetId)
  }) ?? null
}

function resolveReferenceSummaryAssetType(
  assetId: string,
  catalogAsset: ProjectAsset | null,
  summaryEntry: SceneResourceSummaryEntry | null,
  registryEntry: SceneAssetRegistryEntry | null,
): AssetType | string | null {
  if (catalogAsset?.type) {
    return catalogAsset.type
  }
  if (summaryEntry?.type) {
    return summaryEntry.type
  }
  if (registryEntry?.assetType) {
    return registryEntry.assetType
  }
  const normalized = assetId.trim().toLowerCase()
  const dot = normalized.lastIndexOf('.')
  if (dot > 0 && dot < normalized.length - 1) {
    return normalized.slice(dot + 1)
  }
  return null
}

function resolveReferenceSummarySourceLabel(
  catalogAsset: ProjectAsset | null,
  registryEntry: SceneAssetRegistryEntry | null,
): { sourceType: SceneAssetSourceType | string | null; sourceLabel: string | null; resolvedUrl: string | null } {
  if (registryEntry?.sourceType === 'package') {
    return {
      sourceType: registryEntry.sourceType,
      sourceLabel: registryEntry.zipPath ?? registryEntry.inline ?? null,
      resolvedUrl: null,
    }
  }
  if (registryEntry?.sourceType === 'url') {
    return {
      sourceType: registryEntry.sourceType,
      sourceLabel: registryEntry.url ?? null,
      resolvedUrl: registryEntry.url ?? null,
    }
  }
  if (registryEntry?.sourceType === 'server') {
    const resolvedUrl = registryEntry.resolvedUrl?.trim?.() || null
    return {
      sourceType: registryEntry.sourceType,
      sourceLabel: resolvedUrl ?? registryEntry.fileKey ?? registryEntry.serverAssetId ?? null,
      resolvedUrl,
    }
  }
  const source = catalogAsset?.source ?? null
  const sourceType = source?.type ?? null
  if (source?.type === 'package') {
    const providerId = source.providerId ?? ''
    const originalAssetId = source.originalAssetId ?? catalogAsset?.id ?? ''
    return {
      sourceType,
      sourceLabel: providerId ? `${providerId}::${originalAssetId}` : originalAssetId,
      resolvedUrl: null,
    }
  }
  if (sourceType === 'url') {
    const downloadUrl = catalogAsset?.downloadUrl?.trim?.() || null
    return {
      sourceType,
      sourceLabel: downloadUrl,
      resolvedUrl: downloadUrl,
    }
  }
  if (sourceType === 'local') {
    return {
      sourceType,
      sourceLabel: `local::${catalogAsset?.id ?? ''}`,
      resolvedUrl: null,
    }
  }
  if (sourceType === 'server') {
    const resolvedUrl = resolveServerAssetDownloadUrl({
      assetBaseUrl: readServerDownloadBaseUrl(),
      fileKey: catalogAsset?.fileKey ?? null,
      downloadUrl: catalogAsset?.downloadUrl ?? null,
    }) ?? null
    return {
      sourceType,
      sourceLabel: resolvedUrl ?? catalogAsset?.fileKey ?? catalogAsset?.downloadUrl ?? null,
      resolvedUrl,
    }
  }
  return {
    sourceType,
    sourceLabel: null,
    resolvedUrl: null,
  }
}

export function buildSceneAssetReferenceSummaryMap(
  scene: AssetLookupScene,
  assetRegistry: Record<string, SceneAssetRegistryEntry> = scene.assetRegistry ?? {},
): Map<string, SceneAssetReferenceSummary> {
  const references = collectSceneAssetReferenceRecords(scene)
  const referenceMap = collectCanonicalReferenceMap(references, assetRegistry)
  const summaryMap = new Map<string, SceneAssetReferenceSummary>()

  referenceMap.forEach((assetReferences, assetId) => {
    const { canonicalAssetId, asset: catalogAsset } = getCanonicalAssetFromCatalog(scene, assetRegistry, assetId)
    if (shouldExcludeAssetFromRuntimeExport(catalogAsset)) {
      return
    }
    const registryEntry = resolveEffectiveRegistryEntry(scene, assetRegistry, assetId)
    const summaryEntry = getResourceSummaryEntry(scene, assetRegistry, assetId)
    const { sourceType, sourceLabel, resolvedUrl } = resolveReferenceSummarySourceLabel(catalogAsset, registryEntry)
    summaryMap.set(canonicalAssetId ?? assetId, {
      assetId: canonicalAssetId ?? assetId,
      assetName: catalogAsset?.name ?? summaryEntry?.name ?? registryEntry?.name ?? null,
      assetType: resolveReferenceSummaryAssetType(canonicalAssetId ?? assetId, catalogAsset, summaryEntry, registryEntry),
      sourceType,
      sourceLabel,
      resolvedUrl,
      referenceCount: assetReferences.length,
      referencePaths: assetReferences.map((reference) => reference.path),
      references: assetReferences,
    })
  })

  return summaryMap
}

function buildEnvironmentIssues(scene: AssetLookupScene): SceneAssetDiagnosticIssue[] {
  const issues: SceneAssetDiagnosticIssue[] = []
  const environment = cloneEnvironmentSettings(scene.environment as EnvironmentSettings | null | undefined)
  const background = environment.background
  if (background.mode === 'hdri' && !background.hdriAssetId) {
    issues.push({
      severity: 'error',
      code: 'environment-misconfiguration',
      message: '环境背景已设置为 HDRI，但未配置 hdriAssetId。',
      path: 'environment.background.hdriAssetId',
      category: 'environment',
      references: [],
    })
  }
  if (background.mode !== 'skycube') {
    return issues
  }
  if (background.skycubeFormat === 'zip') {
    if (!background.skycubeZipAssetId) {
      issues.push({
        severity: 'error',
        code: 'environment-misconfiguration',
        message: '环境背景已设置为 SkyCube(zip)，但未配置 skycubeZipAssetId。',
        path: 'environment.background.skycubeZipAssetId',
        category: 'environment',
        references: [],
      })
    }
    return issues
  }
  const faceEntries: Array<[keyof typeof background, string]> = [
    ['positiveXAssetId', '+X'],
    ['negativeXAssetId', '-X'],
    ['positiveYAssetId', '+Y'],
    ['negativeYAssetId', '-Y'],
    ['positiveZAssetId', '+Z'],
    ['negativeZAssetId', '-Z'],
  ]
  faceEntries.forEach(([key, label]) => {
    if (background[key]) {
      return
    }
    issues.push({
      severity: 'error',
      code: 'environment-misconfiguration',
      message: `环境背景已设置为 SkyCube(faces)，但缺少 ${label} 面资源。`,
      path: `environment.background.${key}`,
      category: 'environment',
      references: [],
    })
  })
  return issues
}

function buildStructuralIssues(scene: AssetLookupScene): SceneAssetDiagnosticIssue[] {
  const issues = buildEnvironmentIssues(scene)
  const stack: SceneNode[] = [...scene.nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    const lodState = node.components?.[LOD_COMPONENT_TYPE] as SceneNodeComponentState<LodComponentProps> | undefined
    if (Array.isArray(lodState?.props?.levels)) {
      lodState.props.levels.forEach((level, index) => {
        if (level?.kind === 'billboard' && !normalizeAssetIdCandidate(level.billboardAssetId)) {
          issues.push({
            severity: 'error',
            code: 'lod-misconfiguration',
            message: 'LOD billboard 层缺少 billboardAssetId。',
            path: `nodes.${node.id}.components.${LOD_COMPONENT_TYPE}.props.levels[${index}].billboardAssetId`,
            category: 'component',
            references: [],
          })
        }
      })
    }
    const scatterLayers = (node.dynamicMesh as { terrainScatter?: { layers?: Array<Record<string, unknown>> } } | null | undefined)
      ?.terrainScatter?.layers
    if (Array.isArray(scatterLayers)) {
      scatterLayers.forEach((layer, index) => {
        const assetId = normalizeAssetIdCandidate(layer?.assetId)
        const profileId = normalizeAssetIdCandidate(layer?.profileId)
        if (assetId || profileId) {
          return
        }
        issues.push({
          severity: 'error',
          code: 'terrain-scatter-misconfiguration',
          message: 'Terrain scatter layer 未配置 assetId 或 profileId。',
          path: `nodes.${node.id}.dynamicMesh.terrainScatter.layers[${index}]`,
          category: 'terrain-scatter',
          references: [],
        })
      })
    }
    if (Array.isArray(node.children)) {
      stack.push(...node.children)
    }
  }
  return issues
}

function createIssue(
  severity: SceneAssetDiagnosticSeverity,
  code: SceneAssetDiagnosticCode,
  message: string,
  assetId: string | undefined,
  references: SceneAssetReferenceRecord[],
  detail?: string,
): SceneAssetDiagnosticIssue {
  return {
    severity,
    code,
    message,
    assetId,
    path: references[0]?.path,
    category: references[0]?.category,
    detail,
    references,
  }
}

export function validateSceneAssetReferences(
  scene: AssetLookupScene,
  assetRegistry: Record<string, SceneAssetRegistryEntry>,
): SceneAssetValidationReport {
  const references = collectSceneAssetReferenceRecords(scene)
  const referenceMap = collectCanonicalReferenceMap(references, assetRegistry)
  const issues: SceneAssetDiagnosticIssue[] = [...buildStructuralIssues(scene)]

  referenceMap.forEach((assetReferences, assetId) => {
    const { canonicalAssetId, asset: catalogAsset } = getCanonicalAssetFromCatalog(scene, assetRegistry, assetId)
    if (shouldExcludeAssetFromRuntimeExport(catalogAsset)) {
      return
    }
    const entry = resolveEffectiveRegistryEntry(scene, assetRegistry, assetId)
    if (!entry) {
      const issueAssetId = canonicalAssetId ?? assetId
      issues.push(createIssue(
        'error',
        catalogAsset ? 'missing-registry-entry' : 'missing-catalog-entry',
        catalogAsset
          ? `资产 ${issueAssetId} 被场景引用，但导出 registry 中没有对应条目。`
          : `资产 ${issueAssetId} 被场景引用，但既不在资产目录中，也没有可用的导出 registry 条目。`,
        issueAssetId,
        assetReferences,
      ))
      return
    }
    if (!isValidRegistryEntry(entry)) {
      const issueAssetId = canonicalAssetId ?? assetId
      issues.push(createIssue(
        'error',
        'invalid-registry-entry',
        `资产 ${issueAssetId} 的导出 registry 条目不完整，运行时无法解析资源地址。`,
        issueAssetId,
        assetReferences,
        `sourceType=${entry.sourceType}`,
      ))
    }
  })

  const blockingIssueCount = issues.filter((issue) => issue.severity === 'error').length
  const warningIssueCount = issues.filter((issue) => issue.severity === 'warning').length
  const summary = buildSceneAssetDiagnosticsSummary(issues)
  return {
    references,
    issues,
    blockingIssueCount,
    warningIssueCount,
    hasBlockingIssues: blockingIssueCount > 0,
    summary,
  }
}

export function buildSceneAssetDiagnosticsSummary(
  issues: SceneAssetDiagnosticIssue[],
  maxItems = 8,
): SceneAssetDiagnosticsSummary {
  return {
    totalIssueCount: issues.length,
    blockingIssueCount: issues.filter((issue) => issue.severity === 'error').length,
    warningIssueCount: issues.filter((issue) => issue.severity === 'warning').length,
    items: issues.slice(0, maxItems).map((issue) => ({
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      assetId: issue.assetId,
      locations: issue.references.slice(0, 3).map((reference) => reference.path),
    })),
  }
}

export function formatSceneAssetDiagnosticsReport(report: SceneAssetValidationReport): string {
  if (!report.issues.length) {
    return '未发现资产有效性问题。'
  }
  const lines = report.issues.slice(0, 8).map((issue, index) => {
    const locations = issue.references.slice(0, 2).map((reference) => reference.path).join('；')
    const suffix = locations ? ` -> ${locations}` : ''
    const assetText = issue.assetId ? ` [${issue.assetId}]` : ''
    return `${index + 1}. ${issue.message}${assetText}${suffix}`
  })
  const remaining = report.issues.length - lines.length
  if (remaining > 0) {
    lines.push(`另有 ${remaining} 条问题，请查看控制台中的 scene asset diagnostics 日志。`)
  }
  return lines.join('\n')
}
