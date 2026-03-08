import * as THREE from 'three'
import type {
  GroundDynamicMesh,
  SceneNode,
} from '@schema'
import {
  ensureTerrainScatterStore,
  getTerrainScatterStore,
  loadTerrainScatterSnapshot,
  removeTerrainScatterLayer,
  replaceTerrainScatterInstances,
  serializeTerrainScatterStore,
  upsertTerrainScatterLayer,
  type TerrainScatterCategory,
  type TerrainScatterInstance,
  type TerrainScatterStore,
  type TerrainScatterStoreSnapshot,
} from '@schema/terrain-scatter'
import { sampleGroundHeight, sampleGroundNormal } from '@schema/groundMesh'
import { computeGroundBaseHeightAtVertex } from '@schema/groundGeneration'
import {
  buildRandom,
  generateUniformCandidatesInPolygon,
  getPointsBounds,
  hashSeedFromString,
  polygonCentroid,
  selectFarthestPointsFromCandidates,
} from '@/utils/scatterSampling'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'
import { computeOccupancyMinDistance, computeOccupancyTargetCount } from '@/utils/scatterOccupancy'
import type { PlanningImageData, PlanningPolygonData, PlanningPolylineData, PlanningSceneData } from '@/types/planning-scene-data'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { getCachedModelObject, getOrLoadModelObject } from '@schema/modelObjectCache'
import { useSceneStore } from '@/stores/sceneStore'
import { loadObjectFromFile } from '@schema/assetImport'
import {
  GUIDE_ROUTE_COMPONENT_TYPE,
  PLANNING_IMAGES_COMPONENT_TYPE,
  RIGIDBODY_COMPONENT_TYPE,
  WATER_COMPONENT_TYPE,
  WATER_PRESETS,
  WALL_COMPONENT_TYPE,
  clampPlanningImagesComponentProps,
  type WaterPresetId,
} from '@schema/components'
import { generateUuid } from '@/utils/uuid'
import { releaseScatterInstance } from '@/utils/terrainScatterRuntime'


export type PlanningConversionProgress = {
  step: string
  progress: number
}

export type ConvertPlanningToSceneOptions = {
  sceneStore: ReturnType<typeof useSceneStore>
  planningData: PlanningSceneData
  overwriteExisting: boolean
  onProgress?: (payload: PlanningConversionProgress) => void
  signal?: AbortSignal
}

const PLANNING_CONVERSION_ROOT_TAG = 'planningConversionRoot'
export const PLANNING_CONVERSION_SOURCE = 'planning-conversion'
const PLANNING_PIXELS_PER_METER = 10
const PLANNING_IMAGE_HEIGHT_OFFSET_M = 0.02
const PLANNING_IMAGE_STACK_OFFSET_M = 0.002
const PLANNING_TERRAIN_WATER_SURFACE_OFFSET_M = 0.1
const WATER_OPACITY_EPSILON = 1e-3

export function isPlanningImageConversionNode(node: SceneNode | null | undefined): boolean {
  if (!node || typeof node !== 'object') {
    return false
  }
  const userData = node.userData as Record<string, unknown> | undefined
  return userData?.source === PLANNING_CONVERSION_SOURCE && userData?.kind === 'image'
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// findNodeById removed (unused)

// collectSubtreeIds removed (unused)

function uuidToBytes(uuid: string): Uint8Array | null {
  const normalized = uuid.trim().toLowerCase()
  if (!UUID_V4_PATTERN.test(normalized) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
    return null
  }
  const hex = normalized.replace(/-/g, '')
  if (hex.length !== 32) return null
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Deterministic UUID (v5) for derived planning nodes (e.g. multi-feature road components, air walls).
// Keeps ids stable across conversions without needing extra persisted mapping.
const PLANNING_UUID_NAMESPACE = '6f1a7f2f-40c6-4b6d-9c0e-6c760f0b8d4a'

async function stableUuidV5(name: string, namespaceUuid = PLANNING_UUID_NAMESPACE): Promise<string> {
  const ns = uuidToBytes(namespaceUuid)
  if (!ns) {
    // Should never happen; fallback to random UUID.
    return generateUuid()
  }

  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
  const nameBytes = encoder ? encoder.encode(name) : new Uint8Array(Array.from(name, (c) => c.charCodeAt(0) & 0xff))
  const input = new Uint8Array(ns.length + nameBytes.length)
  input.set(ns, 0)
  input.set(nameBytes, ns.length)

  const cryptoRef = typeof crypto !== 'undefined' ? crypto : undefined
  const subtle = cryptoRef?.subtle
  if (!subtle || typeof subtle.digest !== 'function') {
    // No deterministic digest available; fall back to random.
    return generateUuid()
  }

  const hash = new Uint8Array(await subtle.digest('SHA-1', input))
  const bytes = hash.slice(0, 16)
  // Set version (5) and variant (RFC 4122)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return bytesToUuid(bytes)
}

// Air walls are invisible collision boundaries.
// Use fixed dimensions (do not depend on wall-layer settings).
const AIR_WALL_HEIGHT_M = 3
const AIR_WALL_THICKNESS_M = 0.02
const AIR_WALL_WIDTH_M = 0.25

type SnapshotWithUpdatedAt = {
  metadata?: {
    updatedAt?: number | null
  } | null
}

type RawScatterPayload = {
  providerAssetId?: string
  assetId?: string
  category?: TerrainScatterCategory
  name?: string
  thumbnail?: string | null
  densityPercent?: number
  footprintAreaM2?: number
  footprintMaxSizeM?: number
}

type NodeComponentWithId = {
  id?: string
}

type PlanningPolygonAny = PlanningPolygonData & {
  scatter?: RawScatterPayload
}

type PlanningPolylineAny = PlanningPolylineData & {
  scatter?: RawScatterPayload
}

function getNodeComponent(node: SceneNode, componentType: string): NodeComponentWithId | undefined {
  const components = node.components as Record<string, NodeComponentWithId | undefined> | undefined
  return components?.[componentType]
}

function monotonicUpdatedAt(previousSnapshot: SnapshotWithUpdatedAt | null | undefined, nextUpdatedAt: number | null | undefined): number {
  const prev = Number(previousSnapshot?.metadata?.updatedAt)
  const next = Number(nextUpdatedAt)
  if (!Number.isFinite(prev)) {
    return Number.isFinite(next) ? next : Date.now()
  }
  if (!Number.isFinite(next)) {
    return prev + 1
  }
  return next <= prev ? prev + 1 : next
}

// Safety cap to avoid runaway instance generation on huge polygons.
// NOTE: This should be high enough so densityPercent behaves proportionally for common use-cases.
const MAX_SCATTER_INSTANCES_PER_POLYGON = 20000

type LayerKind = 'terrain' | 'guide-route' | 'green'

type PlanningPoint = { id?: string; x: number; y: number }

const planningWaterPresetIds = new Set<WaterPresetId>(WATER_PRESETS.map((preset) => preset.id))

function normalizePlanningWaterPresetId(value: unknown): WaterPresetId | null {
  return typeof value === 'string' && planningWaterPresetIds.has(value as WaterPresetId)
    ? value as WaterPresetId
    : null
}

function ensureAirWall(sceneStore: ConvertPlanningToSceneOptions['sceneStore'], node: SceneNode) {
  const component = getNodeComponent(node, WALL_COMPONENT_TYPE)
  if (component?.id) {
    sceneStore.updateNodeComponentProps(node.id, component.id, { isAirWall: true })
  }
  ensureStaticRigidbody(sceneStore, node)
}

async function createAirWallFromSegments(options: {
  sceneStore: ConvertPlanningToSceneOptions['sceneStore']
  rootNodeId: string
  name: string
  planningLayerId: string
  ownerFeatureId: string
  ownerFeatureKind: 'green'
  segments: Array<{ start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }>
}) {
  const { sceneStore, rootNodeId, name, planningLayerId, ownerFeatureId, ownerFeatureKind, segments } = options
  if (!segments.length) return null

  const nodeId = await stableUuidV5(`planning:airwall:${ownerFeatureKind}:${ownerFeatureId}`)
  const wall = sceneStore.createWallNode({
    nodeId,
    segments,
    dimensions: { height: AIR_WALL_HEIGHT_M, thickness: AIR_WALL_THICKNESS_M, width: AIR_WALL_WIDTH_M },
    name,
  })
  if (!wall) return null

  sceneStore.moveNode({
    nodeId: wall.id,
    targetId: rootNodeId,
    position: 'inside',
    recenterSkipGroupIds: [rootNodeId],
  })
  sceneStore.setNodeLocked(wall.id, true)
  ensureAirWall(sceneStore, wall)
  sceneStore.updateNodeUserData(wall.id, {
    source: PLANNING_CONVERSION_SOURCE,
    planningLayerId,
    kind: 'airWall',
    ownerFeatureId,
    ownerFeatureKind,
  })
  return wall
}

function ensureStaticRigidbody(sceneStore: ConvertPlanningToSceneOptions['sceneStore'], node: SceneNode) {
  const existing = getNodeComponent(node, RIGIDBODY_COMPONENT_TYPE)
  if (existing?.id) {
    sceneStore.updateNodeComponentProps(node.id, existing.id, { bodyType: 'STATIC', mass: 0 })
    return
  }

  const result = sceneStore.addNodeComponent<typeof RIGIDBODY_COMPONENT_TYPE>(node.id, RIGIDBODY_COMPONENT_TYPE)
  const created = result?.component as { id?: string } | undefined
  if (created?.id) {
    sceneStore.updateNodeComponentProps(node.id, created.id, { bodyType: 'STATIC', mass: 0 })
  }
}

function toCssHex(color: number): string {
  const normalized = Number.isFinite(color) ? Math.max(0, Math.min(0xffffff, Math.floor(color))) : 0
  return `#${normalized.toString(16).padStart(6, '0')}`
}

function ensurePrimaryMaterialId(sceneStore: ConvertPlanningToSceneOptions['sceneStore'], node: SceneNode): string | null {
  const primary = node.materials?.[0] ?? sceneStore.addNodeMaterial(node.id)
  return primary?.id ?? null
}

function applyWaterPresetAppearance(
  sceneStore: ConvertPlanningToSceneOptions['sceneStore'],
  node: SceneNode,
  presetId: WaterPresetId,
): Record<string, unknown> {
  const preset = WATER_PRESETS.find((entry) => entry.id === presetId)
  if (!preset) {
    return {}
  }

  const component = getNodeComponent(node, WATER_COMPONENT_TYPE)
  if (component?.id) {
    sceneStore.updateNodeComponentProps(node.id, component.id, {
      implementationMode: 'static',
      distortionScale: preset.distortionScale,
      size: preset.size,
      flowSpeed: preset.flowSpeed,
      waveStrength: preset.waveStrength,
    })
  }

  const materialId = ensurePrimaryMaterialId(sceneStore, node)
  if (materialId) {
    sceneStore.updateNodeMaterialProps(node.id, materialId, {
      color: toCssHex(preset.waterColor),
      opacity: preset.alpha,
      transparent: preset.alpha < 1 - WATER_OPACITY_EPSILON,
    })
  }

  return {
    waterPresetId: preset.id,
    waterPresetParams: {
      distortionScale: preset.distortionScale,
      size: preset.size,
      flowSpeed: preset.flowSpeed,
      waveStrength: preset.waveStrength,
      waterColor: preset.waterColor,
      alpha: preset.alpha,
    },
  }
}

async function createTerrainWaterSurface(options: {
  sceneStore: ConvertPlanningToSceneOptions['sceneStore']
  rootNodeId: string
  planningLayerId: string
  poly: PlanningPolygonAny
  groundWidth: number
  groundDepth: number
  groundHeightAt: (x: number, z: number) => number
}): Promise<SceneNode | null> {
  const presetId = normalizePlanningWaterPresetId(options.poly.terrainWaterPresetId)
  const terrainHeight = Number(options.poly.terrainHeightMeters)
  if (!presetId || !Number.isFinite(terrainHeight) || terrainHeight >= 0) {
    return null
  }

  const contour = options.poly.points
    .map((point) => toWorldPoint(point, options.groundWidth, options.groundDepth, 0))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z))

  if (contour.length < 3) {
    return null
  }

  const bounds = getPointsBounds(options.poly.points)
  const centroid2d = polygonCentroid(options.poly.points)
    ?? (bounds
      ? { x: bounds.minX + bounds.width * 0.5, y: bounds.minY + bounds.height * 0.5 }
      : null)
  if (!centroid2d) {
    return null
  }

  const worldCenter = toWorldPoint(centroid2d, options.groundWidth, options.groundDepth, 0)
  const surfaceY = options.groundHeightAt(worldCenter.x, worldCenter.z) - PLANNING_TERRAIN_WATER_SURFACE_OFFSET_M
  const points = contour.map((point) => ({ x: point.x, y: surfaceY, z: point.z }))

  const nodeId = await stableUuidV5(`planning:terrain-water:${options.poly.id}`)
  const waterNode = options.sceneStore.createWaterSurfaceMeshNode({
    nodeId,
    points,
    buildShape: 'polygon',
    name: `${options.poly.name?.trim() || 'Terrain'} Water`,
  })

  if (!waterNode) {
    return null
  }

  options.sceneStore.moveNode({
    nodeId: waterNode.id,
    targetId: options.rootNodeId,
    position: 'inside',
    recenterSkipGroupIds: [options.rootNodeId],
  })
  options.sceneStore.setNodeLocked(waterNode.id, true)

  const presetUserData = applyWaterPresetAppearance(options.sceneStore, waterNode, presetId)
  const previousUserData = waterNode.userData && typeof waterNode.userData === 'object' && !Array.isArray(waterNode.userData)
    ? waterNode.userData as Record<string, unknown>
    : {}

  options.sceneStore.updateNodeUserData(waterNode.id, {
    ...previousUserData,
    ...presetUserData,
    source: PLANNING_CONVERSION_SOURCE,
    planningLayerId: options.planningLayerId,
    kind: 'terrainWater',
    planningFeatureId: options.poly.id,
  })

  return waterNode
}

type ScatterAssignment = {
  assetId: string
  category: TerrainScatterCategory
  name?: string
  densityPercent?: number
  footprintAreaM2?: number
  footprintMaxSizeM?: number
}

function computeFootprintFromCachedModelBounds(assetId: string): { footprintAreaM2: number; footprintMaxSizeM: number } | null {
  const group = getCachedModelObject(assetId)
  const box = group?.boundingBox
  if (!group || !box || box.isEmpty()) {
    return null
  }
  const sizeX = Math.abs(box.max.x - box.min.x)
  const sizeZ = Math.abs(box.max.z - box.min.z)
  if (!Number.isFinite(sizeX) || !Number.isFinite(sizeZ) || sizeX <= 1e-4 || sizeZ <= 1e-4) {
    return null
  }
  const footprintAreaM2 = Math.max(0.0001, sizeX * sizeZ)
  const footprintMaxSizeM = Math.max(0.01, Math.max(sizeX, sizeZ))
  return { footprintAreaM2, footprintMaxSizeM }
}

async function ensureModelBoundsCachedForAssetId(assetId: string, assetCacheStore: ReturnType<typeof useAssetCacheStore>): Promise<void> {
  if (!assetId) {
    return
  }
  if (getCachedModelObject(assetId)) {
    return
  }
  try {
    await assetCacheStore.loadFromIndexedDb(assetId)
  } catch (_error) {
    return
  }
  const file = assetCacheStore.createFileFromCache(assetId)
  if (!file) {
    return
  }
  try {
    const ext = useSceneStore().getAsset(assetId)?.extension ?? undefined
    await getOrLoadModelObject(assetId, async () => loadObjectFromFile(file, ext))
  } catch (_error) {
    // noop
  } finally {
    assetCacheStore.releaseInMemoryBlob(assetId)
  }
}

function defaultFootprintAreaM2(assetId: string | null, category: TerrainScatterCategory): number {
  void category
  if (assetId) {
    const cached = computeFootprintFromCachedModelBounds(assetId)
    if (cached) {
      return cached.footprintAreaM2
    }
  }
  return 1
}

function clampFootprintAreaM2(assetId: string | null, category: TerrainScatterCategory, value: number | null | undefined): number {
  const num = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(num) || num <= 0) {
    return defaultFootprintAreaM2(assetId, category)
  }
  return Math.min(1e6, Math.max(0.0001, num))
}

function defaultFootprintMaxSizeM(assetId: string | null, category: TerrainScatterCategory): number {
  void category
  if (assetId) {
    const cached = computeFootprintFromCachedModelBounds(assetId)
    if (cached) {
      return cached.footprintMaxSizeM
    }
  }
  return 1
}

function clampFootprintMaxSizeM(assetId: string | null, category: TerrainScatterCategory, value: number | null | undefined, fallbackAreaM2?: number): number {
  const num = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(num) || num <= 0) {
    if (Number.isFinite(fallbackAreaM2) && (fallbackAreaM2 as number) > 0) {
      return Math.max(0.05, Math.sqrt(fallbackAreaM2 as number))
    }
    return defaultFootprintMaxSizeM(assetId, category)
  }
  return Math.min(1000, Math.max(0.01, num))
}

function emitProgress(options: ConvertPlanningToSceneOptions, step: string, progress: number) {
  options.onProgress?.({ step, progress: clampProgress(progress) })
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return
  // DOMException gives a stable .name === 'AbortError' across browsers.
  throw new DOMException('Aborted', 'AbortError')
}

async function yieldToMainThread(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  throwIfAborted(signal)
}

function nowMs(): number {
  // performance.now is monotonic and high-resolution in browsers.
  const p = typeof performance !== 'undefined' ? performance : undefined
  return typeof p?.now === 'function' ? p.now() : Date.now()
}

function createYieldController(options: { signal?: AbortSignal; minIntervalMs?: number }) {
  const minIntervalMs = Math.max(0, options.minIntervalMs ?? 12)
  let lastYieldAt = nowMs()
  return {
    async maybeYield(force = false) {
      throwIfAborted(options.signal)
      const t = nowMs()
      if (!force && t - lastYieldAt < minIntervalMs) return
      lastYieldAt = t
      await yieldToMainThread(options.signal)
    },
  }
}

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function findPlanningConversionRootIds(nodes: SceneNode[]): string[] {
  const ids: string[] = []
  const visit = (list: SceneNode[]) => {
    for (const node of list) {
      const userData = node.userData ?? {}
      if (userData[PLANNING_CONVERSION_ROOT_TAG] === true) {
        ids.push(node.id)
      }
      if (node.children?.length) {
        visit(node.children)
      }
    }
  }
  visit(nodes)
  return ids
}

export async function clearPlanningGeneratedContent(sceneStore: ConvertPlanningToSceneOptions['sceneStore']) {
  // 1) Remove previously converted scene nodes (walls/roads/floors/etc.).
  // Remove both:
  // - the conversion roots (which removes their subtrees)
  // - any stray planning-conversion nodes that may have been moved out of the root
  const idsToRemove: string[] = []
  const visit = (list: SceneNode[]) => {
    for (const node of list) {
      if (!node) continue
      const userData = node.userData ?? {}
      if (userData[PLANNING_CONVERSION_ROOT_TAG] === true || userData.source === PLANNING_CONVERSION_SOURCE) {
        idsToRemove.push(node.id)
        // No need to descend; removeSceneNodes handles subtrees.
        continue
      }
      if (node.children?.length) {
        visit(node.children)
      }
    }
  }
  visit(sceneStore.nodes)
  if (idsToRemove.length) {
    sceneStore.removeSceneNodes(idsToRemove)
  }

  const groundNode = findGroundNode(sceneStore.nodes)
  if (groundNode?.dynamicMesh?.type === 'Ground') {
    let nextGroundDynamicMesh: GroundDynamicMesh = groundNode.dynamicMesh
    const resetContours = resetGroundPlanningContours(nextGroundDynamicMesh)
    if (resetContours.changed) {
      nextGroundDynamicMesh = resetContours.definition
    }

    const prevSnapshot = nextGroundDynamicMesh.terrainScatter ?? null
    const storeLocal = ensureScatterStore(groundNode.id, prevSnapshot)
    removePlanningScatterLayers(storeLocal)
    const snapshot = serializeTerrainScatterStore(storeLocal)
    snapshot.metadata.updatedAt = monotonicUpdatedAt(prevSnapshot, snapshot.metadata.updatedAt)
    const next = {
      ...nextGroundDynamicMesh,
      terrainScatter: snapshot,
    }
    sceneStore.updateNodeDynamicMesh(groundNode.id, next)
  }
}

function resetGroundPlanningContours(definition: GroundDynamicMesh): { definition: GroundDynamicMesh; changed: boolean } {
  const hadPlanningContours = Boolean(
    (definition.planningMetadata?.contourBounds && isBoundsValid(definition.planningMetadata?.contourBounds))
    || Object.keys(definition.planningHeightMap ?? {}).length,
  )
  if (!hadPlanningContours) {
    return { definition, changed: false }
  }

  return {
    changed: true,
    definition: {
      ...definition,
      planningHeightMap: {},
      planningMetadata: {
        ...(definition.planningMetadata ?? {}),
        contourBounds: null,
        generatedAt: Date.now(),
      },
    },
  }
}

function resolveLayerOrderFromPlanningData(planningData: PlanningSceneData): string[] {
  return planningData.layers.map((layer) => layer.id)
}

function resolveLayerKindFromPlanningData(planningData: PlanningSceneData, layerId: string): LayerKind | null {
  return planningData.layers.find((layer) => layer.id === layerId)?.kind ?? null
}

function resolveLayerNameFromPlanningData(planningData: PlanningSceneData, layerId: string): string | null {
  const name = planningData.layers.find((layer) => layer.id === layerId)?.name
  if (typeof name === 'string' && name.trim()) {
    return name.trim()
  }
  return null
}

// resolveLayerColorFromPlanningData removed (unused)

function findGroundNode(nodes: SceneNode[]): SceneNode | null {
  const visit = (list: SceneNode[]): SceneNode | null => {
    for (const node of list) {
      if (node?.dynamicMesh?.type === 'Ground') {
        return node
      }
      const child = visit(Array.isArray(node.children) ? node.children : [])
      if (child) {
        return child
      }
    }
    return null
  }

  return visit(nodes)
}

function resolvePlanningUnitsToMeters(planningData: PlanningSceneData, groundWidth: number, groundDepth: number): number {
  const referenceSize = Math.max(1, Math.abs(Number(groundWidth)), Math.abs(Number(groundDepth)))
  let maxCoordinate = 0

  const scanPoints = (points: PlanningPoint[] | undefined) => {
    if (!Array.isArray(points)) return
    for (const point of points) {
      if (!point) continue
      const x = Number(point.x)
      const y = Number(point.y)
      if (Number.isFinite(x)) {
        maxCoordinate = Math.max(maxCoordinate, Math.abs(x))
      }
      if (Number.isFinite(y)) {
        maxCoordinate = Math.max(maxCoordinate, Math.abs(y))
      }
    }
  }

  const scanImages = (images: PlanningImageData[] | undefined) => {
    if (!Array.isArray(images)) return
    for (const image of images) {
      if (!image) continue
      const x = Number(image.position?.x)
      const y = Number(image.position?.y)
      const width = Number(image.width)
      const height = Number(image.height)
      const scale = Number(image.scale)
      if (Number.isFinite(x)) {
        maxCoordinate = Math.max(maxCoordinate, Math.abs(x))
      }
      if (Number.isFinite(y)) {
        maxCoordinate = Math.max(maxCoordinate, Math.abs(y))
      }
      if (Number.isFinite(x) && Number.isFinite(width) && Number.isFinite(scale)) {
        maxCoordinate = Math.max(maxCoordinate, Math.abs(x + width * scale))
      }
      if (Number.isFinite(y) && Number.isFinite(height) && Number.isFinite(scale)) {
        maxCoordinate = Math.max(maxCoordinate, Math.abs(y + height * scale))
      }
    }
  }

  planningData.polygons.forEach((poly) => scanPoints(poly.points))
  planningData.polylines.forEach((line) => scanPoints(line.points))
  scanImages(planningData.images)

  if (maxCoordinate <= 0 || !Number.isFinite(referenceSize) || referenceSize <= 0) {
    return 1
  }

  const ratio = maxCoordinate / referenceSize

  // When planning data is stored in canvas pixels (1m = 10px), coordinates will be
  // roughly an order of magnitude larger than the ground size in meters. Detect that
  // pattern and scale down to meters; otherwise leave data untouched.
  if (ratio >= PLANNING_PIXELS_PER_METER * 0.5) {
    return 1 / PLANNING_PIXELS_PER_METER
  }

  return 1
}

function normalizePlanningPoints(points: PlanningPoint[] | undefined, unitsToMeters: number): PlanningPoint[] {
  const scale = Number.isFinite(unitsToMeters) && unitsToMeters > 0 ? unitsToMeters : 1
  if (!Array.isArray(points) || points.length === 0) return []
  return points.map((point) => {
    const x = Number(point?.x)
    const y = Number(point?.y)
    return {
      ...point,
      x: Number.isFinite(x) ? x * scale : 0,
      y: Number.isFinite(y) ? y * scale : 0,
    }
  })
}

function clamp01(value: number, fallback = 1): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.min(1, Math.max(0, numeric))
}

function toWorldPoint(
  p: PlanningPoint,
  groundWidth: number,
  groundDepth: number,
  y = 0,
): { x: number; y: number; z: number } {
  return {
    x: p.x - groundWidth * 0.5,
    y,
    z: p.y - groundDepth * 0.5,
  }
}

function polygonEdges(points: PlanningPoint[]): Array<{ start: PlanningPoint; end: PlanningPoint }> {
  if (!Array.isArray(points) || points.length < 2) return []
  const edges: Array<{ start: PlanningPoint; end: PlanningPoint }> = []
  for (let i = 0; i < points.length; i += 1) {
    const start = points[i]!
    const end = points[(i + 1) % points.length]!
    edges.push({ start, end })
  }
  return edges
}

function normalizeScatter(raw: RawScatterPayload | null | undefined): ScatterAssignment | null {
  if (!raw) return null
  const assetId = typeof raw.assetId === 'string' ? raw.assetId.trim() : ''
  const category = raw.category ?? null
  if (!assetId || !category) return null
  const name = typeof raw.name === 'string' ? raw.name : undefined
  const densityPercent = typeof raw.densityPercent === 'number' ? raw.densityPercent : Number.NaN
  const normalizedDensity = Number.isFinite(densityPercent)
    ? THREE.MathUtils.clamp(Math.round(densityPercent), 0, 100)
    : 50
  const footprintAreaM2 = clampFootprintAreaM2(assetId, category, raw.footprintAreaM2)
  const footprintMaxSizeM = clampFootprintMaxSizeM(assetId, category, raw.footprintMaxSizeM, footprintAreaM2)
  return { assetId, category, name, densityPercent: normalizedDensity, footprintAreaM2, footprintMaxSizeM }
}

function extractScatterAssetId(raw: RawScatterPayload | null | undefined): string | null {
  const assetId = typeof raw?.assetId === 'string' ? raw.assetId.trim() : ''
  return assetId.length ? assetId : null
}

function polygonArea2D(points: PlanningPoint[]): number {
  if (points.length < 3) return 0
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) * 0.5
}

const PLANNING_TERRAIN_CONTOUR_BLEND_METERS = 2
const PLANNING_TERRAIN_CONTOUR_BLEND_METERS_MAX = 20
const PLANNING_TERRAIN_CONTOUR_MAX_ABS_HEIGHT = 1000
const PLANNING_TERRAIN_CONTOUR_SMOOTH_PASSES = 3
const PLANNING_TERRAIN_CONTOUR_SMOOTH_RADIUS = 2
type GroundContourBounds = { minRow: number; maxRow: number; minColumn: number; maxColumn: number }

function clampFiniteNumber(raw: number | null | undefined, fallback: number, min: number, max: number): number {
  const num = typeof raw === 'number' ? raw : Number.NaN
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

function normalizeContourHeightMeters(raw: number | null | undefined): number {
  const clamped = clampFiniteNumber(raw, 0, -PLANNING_TERRAIN_CONTOUR_MAX_ABS_HEIGHT, PLANNING_TERRAIN_CONTOUR_MAX_ABS_HEIGHT)
  const rounded = Math.round(clamped * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}

function normalizeContourBlendMeters(raw: number | null | undefined, fallback = PLANNING_TERRAIN_CONTOUR_BLEND_METERS): number {
  const normalizedFallback = clampFiniteNumber(fallback, PLANNING_TERRAIN_CONTOUR_BLEND_METERS, 0, PLANNING_TERRAIN_CONTOUR_BLEND_METERS_MAX)
  const clamped = clampFiniteNumber(raw, normalizedFallback, 0, PLANNING_TERRAIN_CONTOUR_BLEND_METERS_MAX)
  const rounded = Math.round(clamped * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function unionBounds(a: GroundContourBounds | null, b: GroundContourBounds | null): GroundContourBounds | null {
  if (!a) return b
  if (!b) return a
  return {
    minRow: Math.min(a.minRow, b.minRow),
    maxRow: Math.max(a.maxRow, b.maxRow),
    minColumn: Math.min(a.minColumn, b.minColumn),
    maxColumn: Math.max(a.maxColumn, b.maxColumn),
  }
}

function isBoundsValid(b: GroundContourBounds | null | undefined): b is GroundContourBounds {
  return Boolean(
    b
    && Number.isFinite(b.minRow)
    && Number.isFinite(b.maxRow)
    && Number.isFinite(b.minColumn)
    && Number.isFinite(b.maxColumn)
    && b.maxRow >= b.minRow
    && b.maxColumn >= b.minColumn,
  )
}

function isPointOnSegment2D(
  point: { x: number; y: number },
  start: PlanningPoint,
  end: PlanningPoint,
  epsilon = 1e-8,
): boolean {
  const ax = Number(start?.x)
  const ay = Number(start?.y)
  const bx = Number(end?.x)
  const by = Number(end?.y)
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
    return false
  }
  const abx = bx - ax
  const aby = by - ay
  const apx = point.x - ax
  const apy = point.y - ay
  const cross = abx * apy - aby * apx
  if (Math.abs(cross) > epsilon) {
    return false
  }
  const dot = apx * abx + apy * aby
  if (dot < -epsilon) {
    return false
  }
  const lenSq = abx * abx + aby * aby
  if (dot - lenSq > epsilon) {
    return false
  }
  return true
}

function planningPointInPolygon(point: { x: number; y: number }, polygon: PlanningPoint[]): boolean {
  // Use nonzero winding rule to match PlanningDialog/SVG fill behavior.
  // Treat boundary points as inside so contour edges do not crack on raster grid alignment.
  let windingNumber = 0
  const n = polygon.length
  if (n < 3) {
    return false
  }

  for (let i = 0; i < n; i += 1) {
    const a = polygon[i]
    const b = polygon[(i + 1) % n]
    if (!a || !b) {
      continue
    }
    if (isPointOnSegment2D(point, a, b)) {
      return true
    }

    const isLeft = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y)
    if (a.y <= point.y) {
      if (b.y > point.y && isLeft > 0) {
        windingNumber += 1
      }
    } else if (b.y <= point.y && isLeft < 0) {
      windingNumber -= 1
    }
  }

  return windingNumber !== 0
}

function distancePointToSegment2D(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax
  const aby = by - ay
  const lenSq = abx * abx + aby * aby
  if (lenSq <= 1e-14) {
    const dx = px - ax
    const dy = py - ay
    return Math.sqrt(dx * dx + dy * dy)
  }
  let t = ((px - ax) * abx + (py - ay) * aby) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * abx
  const cy = ay + t * aby
  const dx = px - cx
  const dy = py - cy
  return Math.sqrt(dx * dx + dy * dy)
}

function signedDistanceToPolygon(px: number, py: number, polygon: PlanningPoint[]): number {
  const n = polygon.length
  if (n < 3) return Number.POSITIVE_INFINITY
  let minDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < n; i += 1) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % n]!
    const d = distancePointToSegment2D(px, py, a.x, a.y, b.x, b.y)
    if (d < minDist) minDist = d
  }
  const inside = planningPointInPolygon({ x: px, y: py }, polygon)
  return inside ? minDist : -minDist
}

function contourSmoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0
  let t = (x - edge0) / (edge1 - edge0)
  t = Math.max(0, Math.min(1, t))
  return t * t * (3 - 2 * t)
}

function sanitizePlanningContourPoints(points: PlanningPoint[]): PlanningPoint[] {
  if (!Array.isArray(points) || points.length < 3) {
    return []
  }
  const deduped: PlanningPoint[] = []
  const duplicateEpsilonSq = 1e-12

  for (const raw of points) {
    const x = Number(raw?.x)
    const y = Number(raw?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue
    }
    const candidate: PlanningPoint = { id: raw?.id, x, y }
    const prev = deduped[deduped.length - 1]
    if (prev) {
      const dx = candidate.x - prev.x
      const dy = candidate.y - prev.y
      if (dx * dx + dy * dy <= duplicateEpsilonSq) {
        continue
      }
    }
    deduped.push(candidate)
  }

  while (deduped.length >= 2) {
    const first = deduped[0]!
    const last = deduped[deduped.length - 1]!
    const dx = first.x - last.x
    const dy = first.y - last.y
    if (dx * dx + dy * dy > duplicateEpsilonSq) {
      break
    }
    deduped.pop()
  }

  if (deduped.length < 3) {
    return []
  }

  const area = polygonArea2D(deduped)
  if (!Number.isFinite(area) || area <= 1e-8) {
    return []
  }
  return deduped
}

function polygonBounds(points: PlanningPoint[]): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (!Array.isArray(points) || points.length < 3) return null
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    const x = Number(p?.x)
    const y = Number(p?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null
  return { minX, maxX, minY, maxY }
}

function boundsFromPlanningPolygon(definition: GroundDynamicMesh, polyPoints: PlanningPoint[], marginMeters: number): GroundContourBounds | null {
  const bounds = polygonBounds(polyPoints)
  if (!bounds) return null
  const cell = Math.max(1e-6, Number(definition.cellSize) || 1)
  const margin = Math.max(0, marginMeters)
  const minCol = Math.floor((bounds.minX - margin) / cell)
  const maxCol = Math.ceil((bounds.maxX + margin) / cell)
  const minRow = Math.floor((bounds.minY - margin) / cell)
  const maxRow = Math.ceil((bounds.maxY + margin) / cell)
  return {
    minRow: clampInt(minRow, 0, Math.trunc(definition.rows)),
    maxRow: clampInt(maxRow, 0, Math.trunc(definition.rows)),
    minColumn: clampInt(minCol, 0, Math.trunc(definition.columns)),
    maxColumn: clampInt(maxCol, 0, Math.trunc(definition.columns)),
  }
}

function setHeightOverrideValueForContours(
  definition: GroundDynamicMesh,
  map: Record<string, number>,
  row: number,
  column: number,
  value: number,
): void {
  const key = `${row}:${column}`
  const base = computeGroundBaseHeightAtVertex(definition, row, column)
  let rounded = Math.round(value * 100) / 100
  let baseRounded = Math.round(base * 100) / 100
  if (Object.is(rounded, -0)) rounded = 0
  if (Object.is(baseRounded, -0)) baseRounded = 0
  if (rounded === baseRounded) {
    delete map[key]
    return
  }
  map[key] = rounded
}

/**
 * Separable box-blur applied in-place on a dense 2-D height grid.
 *
 * Three passes of box blur approximate a Gaussian blur (central-limit theorem).
 * Each pass uses a running-sum / prefix-sum approach so the cost is O(rows×cols)
 * regardless of radius.
 *
 * Boundary handling: values outside the grid are clamped to the nearest edge
 * value so terrain edges don't collapse toward zero.
 *
 * An optional `weightGrid` (same dimensions) records the maximum polygon-blend
 * weight at each vertex.  After blurring, vertices that had zero weight (i.e.
 * not covered by any terrain polygon) are restored to zero so the blur doesn't
 * bleed terrain height into empty areas.
 */
async function blurHeightGrid(
  grid: Float32Array,
  rows: number,
  cols: number,
  radius: number,
  passes: number,
  weightGrid: Float32Array | null,
  signal?: AbortSignal,
  yieldController?: ReturnType<typeof createYieldController>,
): Promise<void> {
  if (passes <= 0 || radius <= 0 || rows <= 1 || cols <= 1) return

  const tmp = new Float32Array(rows * cols)
  const r = Math.max(1, Math.round(radius))
  const kernelSize = 2 * r + 1

  for (let pass = 0; pass < passes; pass += 1) {
    // --- horizontal pass: read grid → write tmp ---
    for (let row = 0; row < rows; row += 1) {
      if ((row & 63) === 0) {
        throwIfAborted(signal)
        await yieldController?.maybeYield()
      }
      const rowOff = row * cols
      // Build initial running sum for the window centred on col=0.
      let sum = 0
      for (let k = -r; k <= r; k += 1) {
        const c = Math.max(0, Math.min(cols - 1, k))
        sum += grid[rowOff + c]!
      }
      tmp[rowOff] = sum / kernelSize

      for (let col = 1; col < cols; col += 1) {
        // Add new right-edge value, subtract old left-edge value.
        const addCol = Math.min(cols - 1, col + r)
        const subCol = Math.max(0, col - r - 1)
        sum += grid[rowOff + addCol]! - grid[rowOff + subCol]!
        tmp[rowOff + col] = sum / kernelSize
      }
    }

    // --- vertical pass: read tmp → write grid ---
    for (let col = 0; col < cols; col += 1) {
      if ((col & 63) === 0) {
        throwIfAborted(signal)
        await yieldController?.maybeYield()
      }
      let sum = 0
      for (let k = -r; k <= r; k += 1) {
        const rr = Math.max(0, Math.min(rows - 1, k))
        sum += tmp[rr * cols + col]!
      }
      grid[col] = sum / kernelSize

      for (let row = 1; row < rows; row += 1) {
        const addRow = Math.min(rows - 1, row + r)
        const subRow = Math.max(0, row - r - 1)
        sum += tmp[addRow * cols + col]! - tmp[subRow * cols + col]!
        grid[row * cols + col] = sum / kernelSize
      }
    }
  }

  // Restore zero-weight vertices so blur doesn't bleed into uncovered areas.
  if (weightGrid) {
    for (let i = 0; i < grid.length; i += 1) {
      const w = weightGrid[i]!
      if (w <= 1e-9) {
        grid[i] = 0
      } else if (w < 1) {
        // Gradually reduce influence for partially-covered vertices.
        grid[i] = grid[i]! * w
      }
    }
  }
}

async function applyPlanningTerrainContoursToGround(options: {
  definition: GroundDynamicMesh
  contourPolygons: PlanningPolygonAny[]
  signal?: AbortSignal
  yieldController: ReturnType<typeof createYieldController>
  blendMeters?: number
  smoothingPasses?: number
  smoothingRadius?: number
}): Promise<GroundDynamicMesh> {
  const defaultBlendMeters = normalizeContourBlendMeters(options.blendMeters, PLANNING_TERRAIN_CONTOUR_BLEND_METERS)
  const definition = options.definition
  const polygons = (Array.isArray(options.contourPolygons) ? options.contourPolygons : [])
    .map((poly) => ({
      poly,
      points: sanitizePlanningContourPoints(poly?.points ?? []),
      blendMeters: normalizeContourBlendMeters(poly.terrainBlendMeters, defaultBlendMeters),
      height: normalizeContourHeightMeters(poly.terrainHeightMeters),
      area: 0,
    }))
    .filter((item) => item.points.length >= 3)

  // Compute area and sort: larger (outer) polygons first, then by height ascending.
  for (const item of polygons) {
    item.area = polygonArea2D(item.points)
  }
  polygons.sort((a, b) => {
    const areaDiff = b.area - a.area
    if (Math.abs(areaDiff) > 1e-6) return areaDiff
    return a.height - b.height
  })

  const previousBoundsRaw = definition?.planningMetadata?.contourBounds
  const previousBounds: GroundContourBounds | null = isBoundsValid(previousBoundsRaw) ? previousBoundsRaw : null

  let nextBounds: GroundContourBounds | null = null
  for (const item of polygons) {
    const b = boundsFromPlanningPolygon(definition, item.points, item.blendMeters)
    nextBounds = unionBounds(nextBounds, b)
  }

  const rewriteBounds = unionBounds(previousBounds, nextBounds)
  if (!rewriteBounds) {
    const cleared = { ...definition }
    cleared.planningHeightMap = {}
    cleared.planningMetadata = {
      ...(cleared.planningMetadata ?? {}),
      contourBounds: null,
      generatedAt: Date.now(),
    }
    return cleared
  }

  const minRow = rewriteBounds.minRow
  const maxRow = rewriteBounds.maxRow
  const minCol = rewriteBounds.minColumn
  const maxCol = rewriteBounds.maxColumn
  const rows = maxRow - minRow + 1
  const cols = maxCol - minCol + 1

  const cell = Math.max(1e-6, Number(definition.cellSize) || 1)

  // --- Phase 1: Pre-compute per-polygon blend-factor grids via SDF ---
  interface PolyGrid {
    blendGrid: Float32Array
    height: number
    r0: number
    r1: number
    c0: number
    c1: number
    localCols: number
  }
  const polyGrids: PolyGrid[] = []

  for (let polyIndex = 0; polyIndex < polygons.length; polyIndex += 1) {
    throwIfAborted(options.signal)
    const { points, blendMeters, height } = polygons[polyIndex]!

    const polyBounds = boundsFromPlanningPolygon(definition, points, blendMeters)
    if (!polyBounds) {
      await options.yieldController.maybeYield()
      continue
    }
    const r0 = Math.max(minRow, polyBounds.minRow)
    const r1 = Math.min(maxRow, polyBounds.maxRow)
    const c0 = Math.max(minCol, polyBounds.minColumn)
    const c1 = Math.min(maxCol, polyBounds.maxColumn)
    if (r1 < r0 || c1 < c0) {
      await options.yieldController.maybeYield()
      continue
    }

    const localRows = r1 - r0 + 1
    const localCols = c1 - c0 + 1
    const outerBlend = Math.max(cell * 0.5, blendMeters)

    // Pass 1: compute raw SDF values and find the polygon's inradius (max interior SDF).
    const sdfGrid = new Float32Array(localRows * localCols)
    let maxSDF = 0

    for (let row = r0; row <= r1; row += 1) {
      if ((row & 31) === 0) {
        await options.yieldController.maybeYield()
      }
      const py = row * cell
      const localRow = row - r0
      for (let col = c0; col <= c1; col += 1) {
        const px = col * cell
        const sdf = signedDistanceToPolygon(px, py, points)
        const idx = localRow * localCols + (col - c0)
        sdfGrid[idx] = sdf
        if (sdf > maxSDF) maxSDF = sdf
      }
    }

    // Pass 2: convert SDF to blend factors.
    // The blend ramps from 0 (at outerBlend distance outside the edge) to 1 (at the deepest
    // interior point), producing a smooth mountain shape instead of a flat plateau with steep walls.
    const innerBlend = Math.max(outerBlend, maxSDF)
    const blendGrid = new Float32Array(localRows * localCols)
    for (let i = 0; i < sdfGrid.length; i += 1) {
      blendGrid[i] = contourSmoothstep(-outerBlend, innerBlend, sdfGrid[i]!)
    }

    polyGrids.push({ blendGrid, height, r0, r1, c0, c1, localCols })
  }

  // --- Phase 2: Compose heights via iterative lerp across sorted polygons ---
  const heightGrid = new Float32Array(rows * cols)
  // Track maximum blend weight at each vertex for post-blur masking.
  const weightGrid = new Float32Array(rows * cols)

  for (let row = minRow; row <= maxRow; row += 1) {
    if ((row & 63) === 0) {
      throwIfAborted(options.signal)
      await options.yieldController.maybeYield()
    }
    const globalRow = row - minRow
    for (let col = minCol; col <= maxCol; col += 1) {
      const globalCol = col - minCol
      let h = 0
      let maxWeight = 0
      for (let gi = 0; gi < polyGrids.length; gi += 1) {
        const pg = polyGrids[gi]!
        if (row < pg.r0 || row > pg.r1 || col < pg.c0 || col > pg.c1) {
          continue
        }
        const localRow = row - pg.r0
        const localCol = col - pg.c0
        const blend = pg.blendGrid[localRow * pg.localCols + localCol]!
        if (blend <= 1e-9) continue
        // Iterative lerp: smoothly transition from current height toward this polygon's target.
        h = h + (pg.height - h) * blend
        if (blend > maxWeight) maxWeight = blend
      }
      const idx = globalRow * cols + globalCol
      heightGrid[idx] = h
      weightGrid[idx] = maxWeight
    }
  }

  // --- Phase 2.5: Smooth the composed height grid to soften polygon edges ---
  const smoothPasses = Math.max(0, Math.round(options.smoothingPasses ?? PLANNING_TERRAIN_CONTOUR_SMOOTH_PASSES))
  const smoothRadius = Math.max(0, Math.round(options.smoothingRadius ?? PLANNING_TERRAIN_CONTOUR_SMOOTH_RADIUS))
  if (smoothPasses > 0 && smoothRadius > 0) {
    await blurHeightGrid(heightGrid, rows, cols, smoothRadius, smoothPasses, weightGrid, options.signal, options.yieldController)
  }

  // --- Phase 3: Write final heights into planningHeightMap ---
  const nextHeightMap = { ...(definition.planningHeightMap ?? {}) }
  for (let row = minRow; row <= maxRow; row += 1) {
    if ((row & 63) === 0) {
      await options.yieldController.maybeYield()
    }
    const localRow = row - minRow
    for (let col = minCol; col <= maxCol; col += 1) {
      const localCol = col - minCol
      const h = heightGrid[localRow * cols + localCol]!
      const base = computeGroundBaseHeightAtVertex(definition, row, col)
      setHeightOverrideValueForContours(definition, nextHeightMap, row, col, base + h)
    }
  }

  const next = {
    ...definition,
    planningHeightMap: nextHeightMap,
    planningMetadata: {
      ...(definition.planningMetadata ?? {}),
      contourBounds: nextBounds,
      generatedAt: Date.now(),
    },
  }
  return next
}

function ensureScatterStore(groundNodeId: string, snapshot: TerrainScatterStoreSnapshot | null | undefined): TerrainScatterStore {
  let store = getTerrainScatterStore(groundNodeId) ?? ensureTerrainScatterStore(groundNodeId)
  if (snapshot) {
    const snapshotUpdatedAt = Number(snapshot.metadata?.updatedAt)
    const storeUpdatedAt = Number(store.metadata?.updatedAt)
    const hasSnapshotUpdatedAt = Number.isFinite(snapshotUpdatedAt)
    const hasStoreUpdatedAt = Number.isFinite(storeUpdatedAt)
    const shouldHydrate = hasSnapshotUpdatedAt
      ? (!hasStoreUpdatedAt || snapshotUpdatedAt !== storeUpdatedAt)
      : true

    if (shouldHydrate) {
      // IMPORTANT: release existing runtime bindings BEFORE rehydrating the store.
      // Otherwise we'd overwrite in-memory instances (with binding info) and leak instanced slots.
      try {
        for (const layer of Array.from(store.layers.values())) {
          for (const instance of layer.instances ?? []) {
            releaseScatterInstance(instance)
          }
        }
      } catch {
        // ignore
      }

      try {
        store = loadTerrainScatterSnapshot(groundNodeId, snapshot)
      } catch (_error) {
        // ignore invalid snapshot
        store = ensureTerrainScatterStore(groundNodeId)
      }
    }
  }
  return store
}

// Reference to avoid "declared but never read" compile error during refactor.
void ensureScatterStore

function removePlanningScatterLayers(store: TerrainScatterStore) {
  const layersToRemove: string[] = []
  store.layers.forEach((layer) => {
    const payload = layer.params?.payload
    if (payload?.source === PLANNING_CONVERSION_SOURCE) {
      layersToRemove.push(layer.id)
      // Release runtime bindings immediately so instancing cache count updates now.
      for (const instance of layer.instances ?? []) {
        releaseScatterInstance(instance)
      }
    }
  })
  layersToRemove.forEach((id) => removeTerrainScatterLayer(store, id))
}

function upsertPlanningScatterLayer(
  store: TerrainScatterStore,
  payload: { category: TerrainScatterCategory; assetId: string; label?: string },
) {
  const layerId = `planning:${payload.category}:${payload.assetId}`
  const preset = (terrainScatterPresets && terrainScatterPresets[payload.category]) ? terrainScatterPresets[payload.category] : null
  return upsertTerrainScatterLayer(store, {
    id: layerId,
    label: payload.label ?? 'Planning Scatter',
    category: payload.category,
    assetId: payload.assetId,
    profileId: null,
    params: {
      alignToNormal: true,
      randomYaw: true,
      minSlope: 0,
      maxSlope: 90,
      minHeight: -10000,
      maxHeight: 10000,
      minScale: preset?.minScale ?? 0.85,
      maxScale: preset?.maxScale ?? 1.15,
      density: 1,
      seed: null,
      jitter: {
        position: 0.25,
        rotation: 1,
        scale: 0.25,
      },
      payload: {
        source: PLANNING_CONVERSION_SOURCE,
      },
    },
  })
}



export async function convertPlanningTo3DScene(options: ConvertPlanningToSceneOptions): Promise<{ rootNodeId: string }> {
  const { sceneStore, planningData } = options
  const assetCacheStore = useAssetCacheStore()

  const yieldController = createYieldController({ signal: options.signal, minIntervalMs: 12 })

  return await sceneStore.withScenePatchesSuppressed(async () => {
    throwIfAborted(options.signal)
    emitProgress(options, 'Preparing…', 0)


  // Ensure ground exists when missing.
  const groundWidth = Number(sceneStore.groundSettings?.width ?? 100)
  const groundDepth = Number(sceneStore.groundSettings?.depth ?? 100)

  const planningUnitsToMeters = resolvePlanningUnitsToMeters(planningData, groundWidth, groundDepth)

  if (!findGroundNode(sceneStore.nodes)) {
    emitProgress(options, 'Creating ground…', 5)
    sceneStore.setGroundDimensions({ width: groundWidth, depth: groundDepth })
    await yieldController.maybeYield(true)
  }

  if (options.overwriteExisting) {
    emitProgress(options, 'Removing existing converted content…', 10)
    await clearPlanningGeneratedContent(sceneStore)
    await yieldController.maybeYield(true)
  }

  emitProgress(options, 'Creating root group…', 15)
  const root = sceneStore.addSceneNode({
    nodeType: 'Group',
    object: new THREE.Group(),
    name: 'Planning 3D Scene',
    canPrefab: false,
    userData: {
      [PLANNING_CONVERSION_ROOT_TAG]: true,
      source: PLANNING_CONVERSION_SOURCE,
      createdAt: Date.now(),
    },
  })
  sceneStore.setNodeLocked(root.id, true)
  await yieldController.maybeYield(true)

  // Collect features
  const rawPolygons = planningData.polygons as PlanningPolygonAny[]
  const rawPolylines = planningData.polylines as PlanningPolylineAny[]

  const polygons = rawPolygons.map((poly) => ({
    ...poly,
    points: normalizePlanningPoints(poly?.points, planningUnitsToMeters),
  }))

  const polylines = rawPolylines.map((line) => ({
    ...line,
    points: normalizePlanningPoints(line?.points, planningUnitsToMeters),
    waypoints: Array.isArray(line.waypoints) ? line.waypoints : undefined,
  }))

  // Planning image layers in PlanningDialog already use the dialog's world-space
  // coordinates/sizes (`position`, `width * scale`, `height * scale`).
  // Convert them directly so the 3D helper planes exactly match the editor overlay.
  const images = Array.isArray(planningData.images) ? planningData.images : []

  const referencedScatterAssetIds = new Set<string>()
  for (const poly of polygons) {
    const id = extractScatterAssetId(poly.scatter)
    if (id) referencedScatterAssetIds.add(id)
  }
  for (const line of polylines) {
    const id = extractScatterAssetId(line.scatter)
    if (id) referencedScatterAssetIds.add(id)
  }
  if (referencedScatterAssetIds.size) {
    emitProgress(options, 'Caching scatter models…', 18)
    for (const assetId of referencedScatterAssetIds) {
      throwIfAborted(options.signal)
      await ensureModelBoundsCachedForAssetId(assetId, assetCacheStore)
      await yieldController.maybeYield()
    }
  }

  const layerOrder: string[] = resolveLayerOrderFromPlanningData(planningData)

  const featuresByLayer = new Map<string, { polygons: PlanningPolygonAny[]; polylines: PlanningPolylineAny[] }>()
  layerOrder.forEach((id) => featuresByLayer.set(id, { polygons: [], polylines: [] }))

  polygons.forEach((poly) => {
    if (featuresByLayer.has(poly.layerId)) featuresByLayer.get(poly.layerId)!.polygons.push(poly)
  })
  polylines.forEach((line) => {
    if (featuresByLayer.has(line.layerId)) featuresByLayer.get(line.layerId)!.polylines.push(line)
  })

  const totalUnits = polygons.length + polylines.length + images.length
  let doneUnits = 0

  // Terrain scatter preparation
  let store: TerrainScatterStore = ensureTerrainScatterStore(findGroundNode(sceneStore.nodes)?.id ?? 'ground')
  let previousSnapshot: TerrainScatterStoreSnapshot | null = null
  const groundNode = findGroundNode(sceneStore.nodes)
  const groundDynamicMesh = groundNode?.dynamicMesh
  let groundDefinition: GroundDynamicMesh | null = groundDynamicMesh?.type === 'Ground' ? (groundDynamicMesh as GroundDynamicMesh) : null

  // Terrain contour sculpting: additive height deltas from terrain-layer polygons.
  // Apply BEFORE other conversions so walls/roads/water sample the updated ground height.
  if (groundNode && groundDefinition) {
    const resetContours = resetGroundPlanningContours(groundDefinition)
    const hadPlanningContours = resetContours.changed

    if (hadPlanningContours) {
      const clearedPlanning = resetContours.definition
      groundDefinition = clearedPlanning
      sceneStore.updateNodeDynamicMesh(groundNode.id, clearedPlanning)
      await yieldController.maybeYield(true)
    }

    const contourPolygons = polygons.filter((poly) => {
      if (!poly?.points || poly.points.length < 3) return false
      return resolveLayerKindFromPlanningData(planningData, poly.layerId) === 'terrain'
    })

    if (contourPolygons.length || hadPlanningContours) {
      emitProgress(options, 'Sculpting terrain…', 19)
      await yieldController.maybeYield(true)
      try {
        const next = await applyPlanningTerrainContoursToGround({
          definition: groundDefinition,
          contourPolygons,
          signal: options.signal,
          yieldController,
          blendMeters: PLANNING_TERRAIN_CONTOUR_BLEND_METERS,
          smoothingPasses: PLANNING_TERRAIN_CONTOUR_SMOOTH_PASSES,
          smoothingRadius: PLANNING_TERRAIN_CONTOUR_SMOOTH_RADIUS,
        })
        groundDefinition = next
        sceneStore.updateNodeDynamicMesh(groundNode.id, next)
        doneUnits += contourPolygons.length
      } catch (err) {
        console.warn('Failed to apply planning terrain contours', err)
      }
      await yieldController.maybeYield(true)
    }
  }

  const groundHeightAt = (x: number, z: number) => (groundDefinition ? sampleGroundHeight(groundDefinition, x, z) : 0)

  const emitUnitProgress = (label: string, unitFraction: number) => {
    const base = 20
    const span = 75
    const safeUnitFraction = Math.min(1, Math.max(0, unitFraction))
    const fraction = totalUnits > 0 ? (doneUnits + safeUnitFraction) / totalUnits : 1
    emitProgress(options, label, base + span * fraction)
  }
  const updateProgressForUnit = async (label: string) => {
    doneUnits += 1
    emitUnitProgress(label, 0)
    await yieldController.maybeYield()
  }

  if (images.length) {
    const imageEntries: Array<Record<string, unknown>> = []
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      throwIfAborted(options.signal)
      const image = images[imageIndex]!
      const unitLabel = `Converting planning image: ${image.name?.trim() || image.id}`
      emitUnitProgress(unitLabel, 0)
      try {
        const width = Math.max(1e-3, Math.abs(Number(image.width) * Number(image.scale)))
        const height = Math.max(1e-3, Math.abs(Number(image.height) * Number(image.scale)))
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          continue
        }

        const center = {
          x: Number(image.position?.x) + width * 0.5,
          y: Number(image.position?.y) + height * 0.5,
        }
        const worldCenter = toWorldPoint(center, groundWidth, groundDepth, 0)
        const groundY = groundHeightAt(worldCenter.x, worldCenter.z)
        imageEntries.push({
          id: image.id,
          name: image.name?.trim() || `Planning Image ${imageIndex + 1}`,
          imageHash: typeof image.imageHash === 'string' ? image.imageHash.trim() : '',
          sourceUrl: typeof image.url === 'string' ? image.url.trim() : '',
          mimeType: image.mimeType ?? undefined,
          filename: image.filename ?? undefined,
          position: {
            x: worldCenter.x,
            y: groundY + PLANNING_IMAGE_HEIGHT_OFFSET_M + imageIndex * PLANNING_IMAGE_STACK_OFFSET_M,
            z: worldCenter.z,
          },
          size: {
            width,
            height,
          },
          visible: image.visible !== false,
          opacity: clamp01(image.opacity, 1),
        })
      } catch (error) {
        console.warn('Failed to convert planning image to planning image component entry', image, error)
      } finally {
        await updateProgressForUnit(unitLabel)
      }
    }

    const normalizedImageProps = clampPlanningImagesComponentProps({ images: imageEntries as any })
    if (normalizedImageProps.images.length) {
      const nodeId = await stableUuidV5('planning:images')
      const runtime = new THREE.Group()
      runtime.name = 'Planning Images'
      runtime.userData = {
        ...(runtime.userData ?? {}),
        editorOnly: true,
      }
      const componentId = generateUuid()
      const imageNode = sceneStore.addSceneNode({
        nodeId,
        nodeType: 'Group',
        object: runtime,
        name: 'Planning Images',
        parentId: root.id,
        editorFlags: {
          editorOnly: true,
          ignoreGridSnapping: true,
        },
        userData: {
          source: PLANNING_CONVERSION_SOURCE,
          kind: 'image',
          planningImageCount: normalizedImageProps.images.length,
        },
        components: {
          [PLANNING_IMAGES_COMPONENT_TYPE]: {
            id: componentId,
            type: PLANNING_IMAGES_COMPONENT_TYPE,
            enabled: true,
            props: normalizedImageProps,
          },
        },
      })
      if (imageNode) {
        sceneStore.setNodeLocked(imageNode.id, true)
      }
    }
  }

  // Convert layer-by-layer
  for (const layerId of layerOrder) {
    throwIfAborted(options.signal)
    const kind = resolveLayerKindFromPlanningData(planningData, layerId)
    if (!kind) continue

    const group = featuresByLayer.get(layerId)!

    if (kind === 'terrain') {
      for (const poly of group.polygons) {
        throwIfAborted(options.signal)
        await yieldController.maybeYield()
        await createTerrainWaterSurface({
          sceneStore,
          rootNodeId: root.id,
          planningLayerId: layerId,
          poly,
          groundWidth,
          groundDepth,
          groundHeightAt,
        })
      }
    } else if (kind === 'guide-route') {
      const layerName = resolveLayerNameFromPlanningData(planningData, layerId)

      for (const line of group.polylines) {
        const label = `Converting guide route: ${line.name?.trim() || line.id}`
        emitUnitProgress(label, 0)
        try {
          throwIfAborted(options.signal)

          const names = Array.isArray(line.waypoints) ? line.waypoints : []
          const points: Array<{ x: number; y: number; z: number }> = []
          const waypoints: Array<{ name?: string; dock?: boolean }> = []
          const duplicateEpsilon = 1e-10

          for (let i = 0; i < (line.points ?? []).length; i += 1) {
            if ((i & 63) === 0) {
              await yieldController.maybeYield()
            }
            const point = line.points[i]
            if (!point) continue

            const world = toWorldPoint(point, groundWidth, groundDepth, 0)
            const y = groundHeightAt(world.x, world.z)

            const previous = points[points.length - 1]
            if (previous) {
              const dx = world.x - previous.x
              const dz = world.z - previous.z
              if (dx * dx + dz * dz <= duplicateEpsilon) {
                continue
              }
            }

            points.push({ x: world.x, y, z: world.z })
            waypoints.push({ name: names[i]?.name, dock: names[i]?.dock === true })
          }

          if (points.length < 2) {
            continue
          }

          const nodeName = line.name?.trim()
            ? line.name.trim()
            : (layerName ? `${layerName} Guide Route` : 'Planning Guide Route')

          const guideRouteNode = sceneStore.createGuideRouteNode({
            nodeId: line.id,
            points,
            waypoints,
            name: nodeName,
          })

          if (!guideRouteNode) {
            continue
          }

          sceneStore.moveNode({
            nodeId: guideRouteNode.id,
            targetId: root.id,
            position: 'inside',
            recenterSkipGroupIds: [root.id],
          })
          sceneStore.updateNodeUserData(guideRouteNode.id, {
            source: PLANNING_CONVERSION_SOURCE,
            planningLayerId: layerId,
            kind: 'guide-route',
            planningFeatureId: line.id,
          })

          // Safety: ensure guideRoute component exists for identification.
          const component = guideRouteNode.components?.[GUIDE_ROUTE_COMPONENT_TYPE] as { id?: string } | undefined
          if (!component?.id) {
            sceneStore.addNodeComponent<typeof GUIDE_ROUTE_COMPONENT_TYPE>(guideRouteNode.id, GUIDE_ROUTE_COMPONENT_TYPE)
          }

          sceneStore.setNodeLocked(guideRouteNode.id, true)
        } finally {
          await updateProgressForUnit(label)
        }
      }
    } else if (kind === 'green') {
      const layerName = resolveLayerNameFromPlanningData(planningData, layerId)
      for (const poly of group.polygons) { 
        throwIfAborted(options.signal)
        const unitLabel = `Converting greenery: ${poly.name?.trim() || poly.id}`
        emitUnitProgress(unitLabel, 0)
        await yieldController.maybeYield()

        if (Boolean(poly.airWallEnabled)) {
          const baseName = poly.name?.trim()
            ? poly.name.trim()
            : (layerName ? `${layerName} Green` : 'Planning Green')
          const segments = polygonEdges(poly.points).map((edge) => {
            const start = toWorldPoint(edge.start, groundWidth, groundDepth, 0)
            const end = toWorldPoint(edge.end, groundWidth, groundDepth, 0)
            start.y = groundHeightAt(start.x, start.z)
            end.y = groundHeightAt(end.x, end.z)
            return { start, end }
          })
          await createAirWallFromSegments({
            sceneStore,
            rootNodeId: root.id,
            name: `${baseName} (Air Wall)`,
            planningLayerId: layerId,
            ownerFeatureId: poly.id,
            ownerFeatureKind: 'green',
            segments,
          })
        }

        const scatter = normalizeScatter(poly.scatter)
        if (scatter) {
          const preset = terrainScatterPresets[scatter.category] ?? {
            label: 'Scatter',
            icon: 'mdi-cube-outline',
            minScale: 0.9,
            maxScale: 1.1,
          }
          const layer = upsertPlanningScatterLayer(store, {
            category: scatter.category,
            assetId: scatter.assetId,
            label: scatter.name ?? 'Planning Scatter',
          })

          if (!layer) {
            // If upsert failed for any reason, ensure we remain idempotent and continue.
            await updateProgressForUnit(unitLabel)
            continue
          }

          const layerParams = layer.params as {
            alignToNormal?: boolean
            randomYaw?: boolean
            minSlope?: number
            maxSlope?: number
            minHeight?: number
            maxHeight?: number
            minScale?: number
            maxScale?: number
            seed?: number | null
          }

          const densityPercent = Number.isFinite(scatter.densityPercent) ? Number(scatter.densityPercent) : 50

          // Estimate capacity from:
          // - polygon area
          // - model footprint (bounding-box base area)
          const presetMinScale = Number.isFinite(preset.minScale) ? Number(preset.minScale) : 1
          const presetMaxScale = Number.isFinite(preset.maxScale) ? Number(preset.maxScale) : 1
          const minScaleForCapacity = Number.isFinite(layerParams.minScale) ? Number(layerParams.minScale) : presetMinScale
          const maxScaleForCapacity = Number.isFinite(layerParams.maxScale) ? Number(layerParams.maxScale) : presetMaxScale
          const baseFootprintAreaM2 = clampFootprintAreaM2(scatter.assetId, scatter.category, scatter.footprintAreaM2)
          const baseFootprintMaxSizeM = clampFootprintMaxSizeM(
            scatter.assetId,
            scatter.category,
            scatter.footprintMaxSizeM,
            baseFootprintAreaM2,
          )

          // New semantics:
          // - densityPercent (0-100) is the occupancy percentage of a non-overlap-like packing capacity.
          // - capacity is estimated by polygonArea / (footprintArea * E[scale^2])
          //   (assuming uniform scale distribution in [minScale, maxScale]).
          const area = polygonArea2D(poly.points)

          const minScale = minScaleForCapacity
          const maxScale = maxScaleForCapacity
          const { targetCount } = computeOccupancyTargetCount({
            areaM2: area,
            footprintAreaM2: baseFootprintAreaM2,
            densityPercent,
            minScale,
            maxScale,
            maxCap: MAX_SCATTER_INSTANCES_PER_POLYGON,
          })

          if (targetCount <= 0) {
            // Still remove previously generated instances for this feature to stay idempotent.
            const existingRaw = Array.isArray(layer.instances) ? (layer.instances as TerrainScatterInstance[]) : []
            const removed = existingRaw.filter((instance) => {
              const meta = instance.metadata
              if (!meta) return false
              return meta.source === PLANNING_CONVERSION_SOURCE && meta.featureId === poly.id
            })
            removed.forEach((instance) => releaseScatterInstance(instance))
            const existing = existingRaw.filter((instance) => {
              const meta = instance.metadata
              if (!meta) return true
              return !(meta.source === PLANNING_CONVERSION_SOURCE && meta.featureId === poly.id)
            })
            replaceTerrainScatterInstances(store, layer.id, existing)
            await updateProgressForUnit(unitLabel)
            continue
          }
          if (targetCount > 0) {
            const { minDistance } = computeOccupancyMinDistance({
              footprintMaxSizeM: baseFootprintMaxSizeM,
              minScale,
              maxScale,
              minFloor: 0.05,
            })

            const seedBase = layerParams.seed != null
              ? Math.floor(Number(layerParams.seed))
              : hashSeedFromString(`${PLANNING_CONVERSION_SOURCE}:${layer.id}:${poly.id}`)
            const randomProps = buildRandom(hashSeedFromString(`${seedBase}:props`))

            const minHeight = Number.isFinite(layerParams.minHeight) ? Number(layerParams.minHeight) : -10000
            const maxHeight = Number.isFinite(layerParams.maxHeight) ? Number(layerParams.maxHeight) : 10000
            const minSlope = Number.isFinite(layerParams.minSlope) ? Number(layerParams.minSlope) : 0
            const maxSlope = Number.isFinite(layerParams.maxSlope) ? Number(layerParams.maxSlope) : 90
            const randomYawEnabled = layerParams.randomYaw !== false

            const existingRaw = Array.isArray(layer.instances) ? (layer.instances as TerrainScatterInstance[]) : []
            // Keep conversion idempotent per feature even when overwriteExisting=false.
            const removed = existingRaw.filter((instance) => {
              const meta = instance.metadata
              if (!meta) return false
              return meta.source === PLANNING_CONVERSION_SOURCE && meta.featureId === poly.id
            })
            removed.forEach((instance) => releaseScatterInstance(instance))
            const existing = existingRaw.filter((instance) => {
              const meta = instance.metadata
              if (!meta) return true
              return !(meta.source === PLANNING_CONVERSION_SOURCE && meta.featureId === poly.id)
            })

            const bounds = getPointsBounds(poly.points)
            const centroid = polygonCentroid(poly.points)
              ?? (bounds ? { x: bounds.minX + bounds.width * 0.5, y: bounds.minY + bounds.height * 0.5 } : null)

            const additions: TerrainScatterInstance[] = []
            const acceptedSamples: PlanningPoint[] = []

            const cellSize = minDistance
            const cellKey = (p: PlanningPoint) => {
              const cx = Math.floor(p.x / cellSize)
              const cy = Math.floor(p.y / cellSize)
              return `${cx},${cy}`
            }
            const spatial = new Map<string, PlanningPoint[]>()
            const addToSpatial = (p: PlanningPoint) => {
              const key = cellKey(p)
              const bucket = spatial.get(key)
              if (bucket) bucket.push(p)
              else spatial.set(key, [p])
            }
            const isFarEnough = (p: PlanningPoint) => {
              const cx = Math.floor(p.x / cellSize)
              const cy = Math.floor(p.y / cellSize)
              const minDistSq = minDistance * minDistance
              for (let dx = -1; dx <= 1; dx += 1) {
                for (let dy = -1; dy <= 1; dy += 1) {
                  const bucket = spatial.get(`${cx + dx},${cy + dy}`)
                  if (!bucket) continue
                  for (const q of bucket) {
                    const ox = p.x - q.x
                    const oy = p.y - q.y
                    if (ox * ox + oy * oy < minDistSq) {
                      return false
                    }
                  }
                }
              }
              return true
            }

            const MAX_PASSES = 5
            for (let pass = 0; pass < MAX_PASSES && acceptedSamples.length < targetCount; pass += 1) {
              if (!centroid) {
                break
              }

              throwIfAborted(options.signal)
              emitUnitProgress(`${unitLabel} (pass ${pass + 1}/${MAX_PASSES})`, Math.min(0.85, acceptedSamples.length / Math.max(1, targetCount)))
              await yieldController.maybeYield(true)

              const needed = targetCount - acceptedSamples.length
              const randomPoints = buildRandom(hashSeedFromString(`${seedBase}:points:${pass}`))
              const maxAttemptsMultiplier = 4 + pass * 2
              const maxCandidates = Math.min(
                60000,
                Math.max(2000, Math.ceil((targetCount + 10) * (12 + pass * 6))),
              )

              const candidates = generateUniformCandidatesInPolygon(
                poly.points,
                randomPoints,
                maxCandidates,
                { maxAttemptsMultiplier },
              )
              if (!candidates.length) {
                continue
              }

              await yieldController.maybeYield()

              const filtered: PlanningPoint[] = []
              for (let i = 0; i < candidates.length; i += 1) {
                if ((i & 2047) === 0) {
                  throwIfAborted(options.signal)
                  emitUnitProgress(unitLabel, Math.min(0.9, acceptedSamples.length / Math.max(1, targetCount)))
                  await yieldController.maybeYield()
                }
                const p = candidates[i] as PlanningPoint
                if (isFarEnough(p)) {
                  filtered.push(p)
                }
              }
              if (!filtered.length) {
                continue
              }

              const selected = selectFarthestPointsFromCandidates(filtered, needed, minDistance, centroid)
              if (!selected.length) {
                continue
              }

              for (const sample of selected) {
                if ((acceptedSamples.length & 127) === 0) {
                  throwIfAborted(options.signal)
                  emitUnitProgress(unitLabel, Math.min(0.95, acceptedSamples.length / Math.max(1, targetCount)))
                  await yieldController.maybeYield()
                }
                const localXZ = toWorldPoint(sample as PlanningPoint, groundWidth, groundDepth, 0)
                const height = groundDefinition ? sampleGroundHeight(groundDefinition, localXZ.x, localXZ.z) : 0
                if (height < minHeight || height > maxHeight) {
                  continue
                }
                const normal = groundDefinition ? sampleGroundNormal(groundDefinition, localXZ.x, localXZ.z) : null
                const slopeDeg = normal ? (Math.acos(THREE.MathUtils.clamp(normal.y, -1, 1)) * (180 / Math.PI)) : 0
                if (slopeDeg < minSlope || slopeDeg > maxSlope) {
                  continue
                }

                const samplePoint: PlanningPoint = { x: sample.x, y: sample.y }
                if (!isFarEnough(samplePoint)) {
                  continue
                }

                acceptedSamples.push(samplePoint)
                addToSpatial(samplePoint)

                const yaw = randomYawEnabled ? (randomProps() * Math.PI * 2) : 0
                const scaleFactor = THREE.MathUtils.lerp(minScale, maxScale, randomProps())
                additions.push({
                  id: generateUuid(),
                  assetId: scatter.assetId,
                  layerId: layer.id,
                  profileId: layer.profileId ?? scatter.assetId,
                  seed: Math.floor(randomProps() * Number.MAX_SAFE_INTEGER),
                  localPosition: { x: localXZ.x, y: height, z: localXZ.z },
                  localRotation: { x: 0, y: yaw, z: 0 },
                  localScale: { x: scaleFactor, y: scaleFactor, z: scaleFactor },
                  groundCoords: {
                    x: localXZ.x,
                    z: localXZ.z,
                    height,
                    normal: normal ? { x: normal.x, y: normal.y, z: normal.z } : null,
                  },
                  binding: null,
                  metadata: {
                    source: PLANNING_CONVERSION_SOURCE,
                    featureId: poly.id,
                  },
                })

                if (acceptedSamples.length >= targetCount) {
                  break
                }
              }
            }

            replaceTerrainScatterInstances(store, layer.id, [...existing, ...additions])
          }
        }

        await updateProgressForUnit(unitLabel)
      }
    }
  }

  const finalGround = findGroundNode(sceneStore.nodes)
  if (finalGround?.dynamicMesh?.type === 'Ground') {
    emitProgress(options, 'Applying scatter…', 96)
    await yieldController.maybeYield(true)
    if (store) {
      const snapshot = serializeTerrainScatterStore(store)
      snapshot.metadata.updatedAt = monotonicUpdatedAt(previousSnapshot, snapshot.metadata.updatedAt)
      const next = {
        ...finalGround.dynamicMesh,
        terrainScatter: snapshot,
      }
      sceneStore.updateNodeDynamicMesh(finalGround.id, next)
    }
    await yieldController.maybeYield(true)
  }

  // Ensure runtime objects/components are synced so the converted content shows up immediately.
  // Conversion creates/moves many nodes; some runtime consumers require an explicit refresh.
  emitProgress(options, 'Refreshing scene…', 98)
  await yieldController.maybeYield(true)

  emitProgress(options, 'Done', 100)
  return { rootNodeId: root.id }
  })
}
