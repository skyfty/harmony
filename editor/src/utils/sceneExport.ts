import * as THREE from 'three'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { SceneNodeMaterial } from '@/types/material'
import { createPrimitiveGeometry, type EnvironmentSettings, type GroundDynamicMesh, type NodeComponentType, type SceneAssetPreloadInfo, type SceneAssetRegistryEntry, type SceneJsonExportDocument, type SceneLoadProgressHints, type SceneNode, type SceneNodeComponentMap, type SceneNodeComponentState, type SceneOutlineMesh, type SceneOutlineMeshMap, type ScenePunchPoint } from '@schema/core'
import type { TerrainScatterStoreSnapshot } from '@schema/terrain-scatter'
import type { SceneExportEventReporter, SceneExportOptions } from '@/types/scene-export'
import type { SceneAssetValidationReport } from '@/utils/sceneAssetDiagnostics'
import { findObjectByPath } from '@schema/modelAssetLoader'
import { getCachedModelObject, getOrLoadModelObject } from '@schema/modelObjectCache'
import { loadObjectFromFile } from '@schema/assetImport'
import { useSceneStore } from '@/stores/sceneStore'
import { buildSourceAssetRegistryForExport } from '@/stores/sceneStore'
import { calculateSourceSceneResourceSummary, cloneSceneDocumentForExport } from '@/stores/sceneStore'
import { validateSceneAssetReferences } from '@/utils/sceneAssetDiagnostics'
import { fetchResourceAsset } from '@/api/resourceAssets'
import { mapServerAssetToProjectAsset } from '@/api/serverAssetTypes'

import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { buildOutlineMeshFromObject } from '@/utils/outlineMesh'
import {
  DEFAULT_CONVEX_SIMPLIFY_CONFIG,
  buildConservativeConvexGeometryFromObject,
  geometryStats,
} from '@/utils/convexSimplify'
import {
  resolveNodeScaleFactors,
  buildBoxShapeFromObject,
  buildSphereShapeFromObject,
  buildCylinderShapeFromObject,
  buildCapsuleShapeFromObject,
} from '@/utils/rigidbodyCollider'
import { createGroundMesh } from '@schema/groundMesh'
import { createWallGroup } from '@schema/wallMesh'
import { extractCompiledStaticMeshMetadataFromUserData, createCompiledStaticMeshRuntimeMesh } from '@schema/compiledStaticMesh'
import { isRoadDynamicMesh } from '@schema/roadCollision'
import {
  RIGIDBODY_COMPONENT_TYPE,
  COUPON_COMPONENT_TYPE,
  type RigidbodyComponentProps,
  type RigidbodyComponentMetadata,
  type RigidbodyConvexSimplifyConfig,
  type RigidbodyPhysicsShape,
  type RigidbodyColliderType,
  PRELOADABLE_COMPONENT_TYPE,
  type PreloadableComponentProps,
  WALL_COMPONENT_TYPE,
  type WallComponentProps,
  clampWallProps,
  clampRigidbodyComponentProps,
  parseCouponComponentSpec,
  RIGIDBODY_METADATA_KEY,
  VEHICLE_COMPONENT_TYPE,
  resolveModelCollisionComponentPropsFromNode,
} from '@schema/components'
import { isGroundDynamicMesh } from '@schema/groundHeightfield'

const sceneNodePositionHelper = new THREE.Vector3()
const sceneNodeQuaternionHelper = new THREE.Quaternion()
const sceneNodeScaleHelper = new THREE.Vector3()
const sceneNodeEulerHelper = new THREE.Euler()
const sceneNodeLocalMatrixHelper = new THREE.Matrix4()
const sceneNodeInverseWorldMatrixHelper = new THREE.Matrix4()
const sceneNodeConvexPointHelper = new THREE.Vector3()
const sceneNodeConvexBoundsHelper = new THREE.Box3()
const sceneNodeConvexCenterHelper = new THREE.Vector3()

type SceneNodeWorldTransform = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

function countSceneNodeCategory(
  nodes: SceneNode[] | null | undefined,
  predicate: (node: SceneNode) => boolean,
): number {
  if (!Array.isArray(nodes) || !nodes.length) {
    return 0
  }
  let count = 0
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    if (predicate(current)) {
      count += 1
    }
    if (Array.isArray(current.children) && current.children.length > 0) {
      stack.push(...current.children)
    }
  }
  return count
}

function countSceneLoadProgressHints(nodes: SceneNode[] | null | undefined): SceneLoadProgressHints {
  const nodeCount = countSceneNodes(nodes)
  const previewIndexNodeCount = nodeCount
  const physicsRelevantNodeCount = countSceneNodeCategory(nodes, (node) => Boolean(
    node.components?.[RIGIDBODY_COMPONENT_TYPE]?.enabled !== false
    || node.dynamicMesh?.type === 'Ground'
    || node.dynamicMesh?.type === 'Road'
    || node.dynamicMesh?.type === 'Wall'
    || node.dynamicMesh?.type === 'Floor'
    || node.dynamicMesh?.type === 'Landform'
    || node.dynamicMesh?.type === 'GuideRoute'
    || Boolean(resolveModelCollisionComponentPropsFromNode(node)?.faces?.length),
  ))
  const vehicleNodeCount = countSceneNodeCategory(nodes, (node) => Boolean(node.components?.[VEHICLE_COMPONENT_TYPE]?.enabled !== false))
  let terrainScatterGroundCount = 0
  let terrainScatterLayerCount = 0
  let terrainScatterInstanceCount = 0
  if (Array.isArray(nodes) && nodes.length) {
    const stack: SceneNode[] = [...nodes]
    while (stack.length) {
      const current = stack.pop()
      if (!current) {
        continue
      }
      if (current.dynamicMesh?.type === 'Ground') {
        const snapshot = (current.dynamicMesh as GroundDynamicMesh & { terrainScatter?: TerrainScatterStoreSnapshot | null }).terrainScatter
        if (snapshot && Array.isArray(snapshot.layers) && snapshot.layers.length) {
          terrainScatterGroundCount += 1
          terrainScatterLayerCount += snapshot.layers.length
          snapshot.layers.forEach((layer) => {
            if (Array.isArray(layer.instances)) {
              terrainScatterInstanceCount += layer.instances.length
            }
          })
        }
      }
      if (Array.isArray(current.children) && current.children.length) {
        stack.push(...current.children)
      }
    }
  }
  return {
    nodeCount,
    previewIndexNodeCount,
    physicsRelevantNodeCount,
    vehicleNodeCount,
    terrainScatterGroundCount,
    terrainScatterLayerCount,
    terrainScatterInstanceCount,
  }
}

function findGroundNode(nodes: SceneNode[]): SceneNode | null {
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    if (current.dynamicMesh?.type === 'Ground') {
      return current
    }
    if (current.children?.length) {
      stack.push(...current.children)
    }
  }
  return null
}

function getSceneNodeLocalMatrix(node: SceneNode): THREE.Matrix4 {
  const position = node.position as { x?: unknown; y?: unknown; z?: unknown } | undefined
  const rotation = node.rotation as { x?: unknown; y?: unknown; z?: unknown } | undefined
  const scale = node.scale as { x?: unknown; y?: unknown; z?: unknown } | undefined

  sceneNodePositionHelper.set(
    typeof position?.x === 'number' && Number.isFinite(position.x) ? position.x : 0,
    typeof position?.y === 'number' && Number.isFinite(position.y) ? position.y : 0,
    typeof position?.z === 'number' && Number.isFinite(position.z) ? position.z : 0,
  )
  sceneNodeEulerHelper.set(
    typeof rotation?.x === 'number' && Number.isFinite(rotation.x) ? rotation.x : 0,
    typeof rotation?.y === 'number' && Number.isFinite(rotation.y) ? rotation.y : 0,
    typeof rotation?.z === 'number' && Number.isFinite(rotation.z) ? rotation.z : 0,
    'XYZ',
  )
  sceneNodeQuaternionHelper.setFromEuler(sceneNodeEulerHelper).normalize()
  sceneNodeScaleHelper.set(
    typeof scale?.x === 'number' && Number.isFinite(scale.x) ? Math.abs(scale.x) : 1,
    typeof scale?.y === 'number' && Number.isFinite(scale.y) ? Math.abs(scale.y) : 1,
    typeof scale?.z === 'number' && Number.isFinite(scale.z) ? Math.abs(scale.z) : 1,
  )

  return sceneNodeLocalMatrixHelper.compose(
    sceneNodePositionHelper,
    sceneNodeQuaternionHelper,
    sceneNodeScaleHelper,
  ).clone()
}

function buildSceneNodeWorldTransformMap(nodes: SceneNode[]): Map<string, SceneNodeWorldTransform> {
  const map = new Map<string, SceneNodeWorldTransform>()

  const visit = (node: SceneNode, parentWorldMatrix?: THREE.Matrix4): void => {
    const localMatrix = getSceneNodeLocalMatrix(node)
    const worldMatrix = parentWorldMatrix
      ? parentWorldMatrix.clone().multiply(localMatrix)
      : localMatrix.clone()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    worldMatrix.decompose(position, quaternion, scale)
    map.set(node.id, { position, quaternion, scale })

    if (Array.isArray(node.children) && node.children.length) {
      for (const child of node.children) {
        visit(child, worldMatrix)
      }
    }
  }

  for (const node of nodes) {
    visit(node)
  }

  return map
}

export function collectPunchPointsFromNodes(nodes: SceneNode[]): ScenePunchPoint[] {
  if (!Array.isArray(nodes) || !nodes.length) {
    return []
  }
  const points: ScenePunchPoint[] = []
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    const behaviors = current.components?.behavior?.props?.behaviors
    if (Array.isArray(behaviors) && behaviors.some((entry) => entry?.script?.type === 'punch')) {
      points.push({
        nodeId: current.id,
        nodeName: typeof current.name === 'string' ? current.name : '',
      })
    }
    if (Array.isArray(current.children) && current.children.length) {
      stack.push(...current.children)
    }
  }
  return points
}

export function collectCouponIdsFromNodes(nodes: SceneNode[]): string[] {
  if (!Array.isArray(nodes) || !nodes.length) {
    return []
  }
  const couponIds = new Set<string>()
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    const component = current.components?.[COUPON_COMPONENT_TYPE]
    const couponSpec = component?.props ? parseCouponComponentSpec((component.props as { couponJson?: unknown }).couponJson as string | null | undefined) : null
    if (couponSpec?.id) {
      couponIds.add(couponSpec.id)
    }
    if (Array.isArray(current.children) && current.children.length) {
      stack.push(...current.children)
    }
  }
  return Array.from(couponIds)
}

export interface PreparedSceneExportBundle {
  document: SceneJsonExportDocument
  diagnostics: SceneAssetValidationReport
}

async function patchUnknownExportRegistryEntries(
  snapshot: StoredSceneDocument,
  assetRegistry: Record<string, SceneAssetRegistryEntry>,
): Promise<Record<string, SceneAssetRegistryEntry>> {
  const unknownAssetIds = Array.isArray(snapshot.resourceSummary?.unknownAssetIds)
    ? snapshot.resourceSummary.unknownAssetIds
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0)
    : []

  if (!unknownAssetIds.length) {
    return assetRegistry
  }

  let nextAssetRegistry = assetRegistry
  await Promise.all(
    unknownAssetIds.map(async (assetId) => {
      try {
        const registryEntry = assetRegistry[assetId]
        const serverAssetId =
          registryEntry?.sourceType === 'server' && typeof registryEntry.serverAssetId === 'string' && registryEntry.serverAssetId.trim().length
            ? registryEntry.serverAssetId.trim()
            : assetId
        const serverAsset = await fetchResourceAsset(serverAssetId)
        const mappedAsset = mapServerAssetToProjectAsset(serverAsset)
        const downloadUrl = typeof mappedAsset.downloadUrl === 'string' ? mappedAsset.downloadUrl.trim() : ''
        if (!downloadUrl) {
          return
        }
        if (nextAssetRegistry === assetRegistry) {
          nextAssetRegistry = { ...assetRegistry }
        }
        nextAssetRegistry[assetId] = {
          ...(nextAssetRegistry[assetId] ?? {}),
          sourceType: 'url',
          url: downloadUrl,
        }
      } catch (error) {
        console.warn('Failed to resolve export asset download URL', {
          registryAssetId: assetId,
          serverAssetId: assetRegistry[assetId]?.sourceType === 'server' && typeof assetRegistry[assetId]?.serverAssetId === 'string'
            ? assetRegistry[assetId].serverAssetId
            : assetId,
          sourceType: assetRegistry[assetId]?.sourceType ?? null,
          error,
        })
        // Keep unresolved ids so diagnostics can surface the real export blocker.
      }
    }),
  )

  return nextAssetRegistry
}

type NodeExportProgressTracker = {
  reportEvent: SceneExportEventReporter
  sceneId: string
  sceneName: string
  processed: number
  total: number
}

function countSceneNodes(nodes: SceneNode[] | null | undefined): number {
  if (!Array.isArray(nodes) || !nodes.length) {
    return 0
  }
  let count = 0
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    count += 1
    if (Array.isArray(current.children) && current.children.length > 0) {
      stack.push(...current.children)
    }
  }
  return count
}

function describeSceneNode(node: SceneNode): string {
  const nodeName = typeof node.name === 'string' ? node.name.trim() : ''
  return nodeName || node.id || 'unnamed-node'
}

function createNodeExportProgressTracker(
  document: SceneJsonExportDocument,
  reportEvent?: SceneExportEventReporter,
): NodeExportProgressTracker | null {
  if (!reportEvent) {
    return null
  }
  const total = countSceneNodes(document.nodes)
  if (total <= 0) {
    return null
  }
  return {
    reportEvent,
    sceneId: document.id,
    sceneName: document.name || document.id,
    processed: 0,
    total,
  }
}

function reportNodeExportStart(progress: NodeExportProgressTracker | null): void {
  if (!progress) {
    return
  }
  progress.reportEvent({
    phase: 'node',
    level: 'info',
    status: 'running',
    sceneId: progress.sceneId,
    sceneName: progress.sceneName,
    current: 0,
    total: progress.total,
    message: `开始处理场景节点 (${progress.total})`,
  })
}

function reportNodeExportProgress(
  progress: NodeExportProgressTracker | null,
  node: SceneNode,
  status: 'completed' | 'skipped',
  detail?: string,
): void {
  if (!progress) {
    return
  }
  progress.processed += 1
  progress.reportEvent({
    phase: 'node',
    level: status === 'skipped' ? 'warning' : 'info',
    status,
    sceneId: progress.sceneId,
    sceneName: progress.sceneName,
    nodeId: node.id,
    nodeName: node.name || node.id,
    current: progress.processed,
    total: progress.total,
    detail,
    message: status === 'skipped'
      ? `跳过节点 ${describeSceneNode(node)}`
      : `已处理节点 ${describeSceneNode(node)}`,
  })
}

function reportNodeExportDone(progress: NodeExportProgressTracker | null): void {
  if (!progress) {
    return
  }
  progress.reportEvent({
    phase: 'node',
    level: 'success',
    status: 'completed',
    sceneId: progress.sceneId,
    sceneName: progress.sceneName,
    current: progress.processed,
    total: progress.total,
    message: `场景节点处理完成 (${progress.processed}/${progress.total})`,
  })
}

export async function prepareJsonSceneExport(
  snapshot: StoredSceneDocument,
  options: SceneExportOptions,
  reportEvent?: SceneExportEventReporter,
): Promise<SceneJsonExportDocument> {
  const bundle = await prepareJsonSceneExportBundle(snapshot, options, reportEvent)
  return bundle.document
}

export async function prepareJsonSceneExportBundle(
  snapshot: StoredSceneDocument,
  options: SceneExportOptions,
  reportEvent?: SceneExportEventReporter,
): Promise<PreparedSceneExportBundle> {
  const baseAssetRegistry = await buildSourceAssetRegistryForExport(snapshot)
  const assetRegistry = await patchUnknownExportRegistryEntries(snapshot, baseAssetRegistry)

  const environment: EnvironmentSettings | undefined = snapshot.environment ? { ...snapshot.environment } : undefined

  const exportDocument: SceneJsonExportDocument = {
    id: snapshot.id,
    name: snapshot.name,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    environment,
    nodes: snapshot.nodes,
    groundSettings: snapshot.groundSettings,
    assetRegistry,
    projectOverrideAssets: snapshot.projectOverrideAssets,
    sceneOverrideAssets: snapshot.sceneOverrideAssets,
    resourceSummary: snapshot.resourceSummary,
    lazyLoadMeshes: options.lazyLoadMeshes ?? true,
  }
  const punchPoints = collectPunchPointsFromNodes(snapshot.nodes)
  if (punchPoints.length) {
    exportDocument.punchPoints = punchPoints
  }
  const couponIds = collectCouponIdsFromNodes(snapshot.nodes)
  if (couponIds.length) {
    exportDocument.couponIds = couponIds
  }
  const sanitizedDocument = await sanitizeSceneDocumentForJsonExport(exportDocument, options, reportEvent)
  const diagnostics = validateSceneAssetReferences(
    {
      ...snapshot,
      nodes: sanitizedDocument.nodes,
      environment: sanitizedDocument.environment,
      groundSettings: sanitizedDocument.groundSettings ?? snapshot.groundSettings,
      assetRegistry,
      projectOverrideAssets: sanitizedDocument.projectOverrideAssets,
      sceneOverrideAssets: sanitizedDocument.sceneOverrideAssets,
    },
    assetRegistry,
  )
  return {
    document: sanitizedDocument,
    diagnostics,
  }
}

export async function prepareStoredSceneJsonExport(
  snapshot: StoredSceneDocument,
  options: SceneExportOptions,
  reportEvent?: SceneExportEventReporter,
): Promise<SceneJsonExportDocument> {
  const bundle = await prepareStoredSceneJsonExportBundle(snapshot, options, reportEvent)
  return bundle.document
}

export async function prepareStoredSceneJsonExportBundle(
  snapshot: StoredSceneDocument,
  options: SceneExportOptions,
  reportEvent?: SceneExportEventReporter,
): Promise<PreparedSceneExportBundle> {
  const exportableScene = await cloneSceneDocumentForExport(snapshot)
  exportableScene.resourceSummary = await calculateSourceSceneResourceSummary(exportableScene)
  return await prepareJsonSceneExportBundle(exportableScene, options, reportEvent)
}

type OutlineCandidate = {
  sourceNode: SceneNode
  sanitizedNode: SceneNode
}

type RigidbodyExportCandidate = {
  node: SceneNode
  component: SceneNodeComponentState<RigidbodyComponentProps>
}

async function sanitizeSceneDocumentForJsonExport(
  document: SceneJsonExportDocument,
  options: SceneExportOptions,
  reportEvent?: SceneExportEventReporter,
): Promise<SceneJsonExportDocument> {
  const removedNodeIds = new Set<string>()
  const outlineCandidates: OutlineCandidate[] = []
  const rigidbodyCandidates: RigidbodyExportCandidate[] = []
  const nodeProgress = createNodeExportProgressTracker(document, reportEvent)
  reportNodeExportStart(nodeProgress)
  const sanitizedNodes = sanitizeNodesForJsonExport(
    document.nodes,
    options,
    removedNodeIds,
    outlineCandidates,
    rigidbodyCandidates,
    nodeProgress,
  )

  let outlineMeshMap: SceneOutlineMeshMap | undefined
  if (options.lazyLoadMeshes) {
    outlineMeshMap = await generateOutlineMeshesForCandidates(outlineCandidates, options)
  }

  await applyRigidbodyMetadata(sanitizedNodes, rigidbodyCandidates)

  const sanitizedDocument: SceneJsonExportDocument = {
    ...document,
    nodes: sanitizedNodes,
  }
  sanitizedDocument.loadProgressHints = countSceneLoadProgressHints(sanitizedNodes)
  const assetPreload = buildSceneAssetPreloadInfo(sanitizedNodes, options)
  if (assetPreload) {
    sanitizedDocument.assetPreload = assetPreload
  }
  if (!options.lazyLoadMeshes) {
    if ('outlineMeshMap' in sanitizedDocument) {
      delete sanitizedDocument.outlineMeshMap
    }
  } else if (outlineMeshMap && Object.keys(outlineMeshMap).length > 0) {
    sanitizedDocument.outlineMeshMap = outlineMeshMap
  } else if ('outlineMeshMap' in sanitizedDocument) {
    delete sanitizedDocument.outlineMeshMap
  }

  reportNodeExportDone(nodeProgress)

  return sanitizedDocument
}

function sanitizeNodesForJsonExport(
  nodes: SceneNode[],
  options: SceneExportOptions,
  removedNodeIds: Set<string>,
  outlineCandidates: OutlineCandidate[],
  rigidbodyCandidates: RigidbodyExportCandidate[],
  nodeProgress?: NodeExportProgressTracker | null,
): SceneNode[] {
  const result: SceneNode[] = []
  for (const node of nodes) {
    const excludeReason = getNodeJsonExportExclusionReason(node, options)
    if (excludeReason) {
      collectNodeTreeIds(node, removedNodeIds)
      reportNodeExportProgress(nodeProgress ?? null, node, 'skipped', excludeReason)
      continue
    }
    const sanitized = sanitizeNodeForJsonExport(
      node,
      options,
      removedNodeIds,
      outlineCandidates,
      rigidbodyCandidates,
      nodeProgress,
    )
    result.push(sanitized)
  }
  return result
}

import { isPlanningImageConversionNode } from '@/utils/planningToScene'

function getNodeJsonExportExclusionReason(node: SceneNode, options: SceneExportOptions): string | null {
  if (!options.includeHiddenNodes && node.visible === false) {
    return 'hidden node excluded'
  }
  if (!options.includeLights && (node.nodeType === 'Light' || Boolean(node.light))) {
    return 'light node excluded'
  }
  if (node.nodeType === 'Environment') {
    return 'environment node excluded'
  }
  if (isPlanningImageConversionNode(node)) {
    return 'planning conversion helper excluded'
  }
  return null
}

function shouldGenerateOutlineMeshForNode(node: SceneNode, options: SceneExportOptions): boolean {
  if (!options.lazyLoadMeshes) {
    return false
  }
  if (!node.sourceAssetId || typeof node.sourceAssetId !== 'string') {
    return false
  }
  if (node.dynamicMesh) {
    return false
  }
  if (node.editorFlags?.editorOnly) {
    return false
  }
  return true
}

function sanitizeNodeForJsonExport(
  node: SceneNode,
  options: SceneExportOptions,
  removedNodeIds: Set<string>,
  outlineCandidates: OutlineCandidate[],
  rigidbodyCandidates: RigidbodyExportCandidate[],
  nodeProgress?: NodeExportProgressTracker | null,
): SceneNode {
  const sanitized: SceneNode = { ...node }

  if ('outlineMesh' in sanitized) {
    delete sanitized.outlineMesh
  }

  if (node.children?.length) {
    const children = sanitizeNodesForJsonExport(
      node.children,
      options,
      removedNodeIds,
      outlineCandidates,
      rigidbodyCandidates,
      nodeProgress,
    )
    if (children.length) {
      sanitized.children = children
    } else {
      delete sanitized.children
    }
  } else if ('children' in sanitized) {
    delete sanitized.children
  }

  if (node.materials?.length) {
    sanitized.materials = node.materials.map((material) => sanitizeSceneNodeMaterial(material))
  } else if ('materials' in sanitized) {
    delete sanitized.materials
  }

  if (!options.includeExtras) {
    if ('components' in sanitized) {
      delete sanitized.components
    }
    if (!options.lazyLoadMeshes) {
      if ('importMetadata' in sanitized) {
        delete sanitized.importMetadata
      }
      if ('sourceAssetId' in sanitized) {
        delete sanitized.sourceAssetId
      }
    }
  } else if (componentMapHasEntries(sanitized.components)) {
    const clonedComponents = cloneNodeComponentMap(sanitized.components!)
    const filteredComponents = sanitizeNodeComponentsForJsonExport(clonedComponents, options)
    if (componentMapHasEntries(filteredComponents)) {
      sanitized.components = filteredComponents
      const rigidbodyComponent = filteredComponents[RIGIDBODY_COMPONENT_TYPE] as
        | SceneNodeComponentState<RigidbodyComponentProps>
        | undefined
      if (rigidbodyComponent?.enabled) {
        rigidbodyCandidates.push({ node, component: rigidbodyComponent })
      }
    } else {
      delete sanitized.components
    }
  }

  if (shouldGenerateOutlineMeshForNode(node, options)) {
    outlineCandidates.push({ sourceNode: node, sanitizedNode: sanitized })
  }

  reportNodeExportProgress(
    nodeProgress ?? null,
    node,
    'completed',
    `类型：${node.nodeType || 'Unknown'}`,
  )

  return sanitized
}

async function generateOutlineMeshesForCandidates(
  candidates: OutlineCandidate[],
  options: SceneExportOptions,
): Promise<SceneOutlineMeshMap> {
  const outlineMeshMap: SceneOutlineMeshMap = {}
  if (!candidates.length || !options.lazyLoadMeshes) {
    return outlineMeshMap
  }
  const assetCacheStore = useAssetCacheStore()

  for (const entry of candidates) {
    const assetId = entry.sourceNode.sourceAssetId
    if (!assetId) {
      continue
    }

    if (!outlineMeshMap[assetId]) {
      let baseGroup = getCachedModelObject(assetId)
      if (!baseGroup) {
        const asset = useSceneStore().getAsset(assetId)
        const file = await assetCacheStore.ensureAssetFile(assetId, { asset })
        if (file) {
          const ext = asset?.extension ?? undefined
          baseGroup = await getOrLoadModelObject(assetId, () => loadObjectFromFile(file, ext))
        }
      }
      if (!baseGroup) {
        continue
      }
      const baseObject = baseGroup.object
      baseObject.updateMatrixWorld(true)
      const targetSource = findObjectByPath(baseObject, entry.sourceNode.importMetadata?.objectPath ?? null) ?? baseObject
      const targetClone = targetSource.clone(true)
      targetClone.updateMatrixWorld(true)

      const outline = buildOutlineMeshFromObject(targetClone)
      if (!outline) {
        continue
      }

      outlineMeshMap[assetId] = outline
    }

    if (!entry.sanitizedNode.sourceAssetId) {
      entry.sanitizedNode.sourceAssetId = entry.sourceNode.sourceAssetId
    }
    if (!entry.sanitizedNode.importMetadata && entry.sourceNode.importMetadata) {
      entry.sanitizedNode.importMetadata = { ...entry.sourceNode.importMetadata }
    }
  }

  return outlineMeshMap
}

async function applyRigidbodyMetadata(nodes: SceneNode[], candidates: RigidbodyExportCandidate[]): Promise<void> {
  if (!candidates.length) {
    return
  }
  const nodeLookup = buildSceneNodeLookup(nodes)
  const worldTransformMap = buildSceneNodeWorldTransformMap(nodes)
  const groundNode = findGroundNode(nodes)
  const assetCacheStore = useAssetCacheStore()
  for (const entry of candidates) {
    const samplingNode = resolveRigidbodySamplingNode(entry, nodeLookup)
    if (!samplingNode || isGroundDynamicMesh(samplingNode.dynamicMesh)) {
      continue
    }
    if (isRoadDynamicMesh(samplingNode.dynamicMesh)) {
      const rigidbodyMetadata = entry.component.metadata?.[RIGIDBODY_METADATA_KEY] as RigidbodyComponentMetadata | undefined
      if (rigidbodyMetadata?.shape) {
        const { shape: _shape, ...rest } = rigidbodyMetadata
        entry.component.metadata = {
          ...(entry.component.metadata ? { ...entry.component.metadata } : {}),
          [RIGIDBODY_METADATA_KEY]: rest,
        }
      }
      continue
    }
    const existingRigidbodyMetadata = entry.component.metadata?.[RIGIDBODY_METADATA_KEY] as RigidbodyComponentMetadata | undefined
    if (existingRigidbodyMetadata?.shape) {
      continue
    }
    const hostWorldTransform = worldTransformMap.get(entry.node.id) ?? null
    const sourceWorldTransform = worldTransformMap.get(samplingNode.id) ?? hostWorldTransform
    const samplingObject = await buildRigidbodySamplingObject(samplingNode, assetCacheStore, groundNode, sourceWorldTransform)
    if (!samplingObject) {
      continue
    }
    const nodeScale = hostWorldTransform
      ? {
          x: Math.max(1e-4, Math.abs(hostWorldTransform.scale.x) || 1),
          y: Math.max(1e-4, Math.abs(hostWorldTransform.scale.y) || 1),
          z: Math.max(1e-4, Math.abs(hostWorldTransform.scale.z) || 1),
        }
      : resolveNodeScaleFactors(entry.node)

    let shape: RigidbodyPhysicsShape | null = null

    let generatedConvexSimplify: RigidbodyConvexSimplifyConfig | undefined
    const buildConvex = () => {
      const base = DEFAULT_CONVEX_SIMPLIFY_CONFIG as unknown as RigidbodyConvexSimplifyConfig
      const config: RigidbodyConvexSimplifyConfig = {
        version: 1,
        primary: { ...base.primary },
        fallback: { ...base.fallback },
        limits: { ...base.limits },
      }

      const primaryBuilt = buildConservativeConvexGeometryFromObject(samplingObject, config.primary)
      if (!primaryBuilt) {
        return null
      }

      let usedPass: 'primary' | 'fallback' = 'primary'
      let outline = primaryBuilt.outline
      const primaryGeometryStats = geometryStats(primaryBuilt.geometry)
      primaryBuilt.geometry.dispose()

      if (primaryGeometryStats.vertices > config.limits.maxVertices || primaryGeometryStats.faces > config.limits.maxFaces) {
        const fallbackBuilt = buildConservativeConvexGeometryFromObject(samplingObject, config.fallback)
        if (fallbackBuilt) {
          usedPass = 'fallback'
          outline = fallbackBuilt.outline
          fallbackBuilt.geometry.dispose()
        }
      }

      config.usedPass = usedPass
      generatedConvexSimplify = config
      return buildConvexShapeFromOutline(outline, nodeScale, sourceWorldTransform)
    }

    const buildBox = () => buildBoxShapeFromObject(samplingObject, nodeScale)
    const buildSphere = () => buildSphereShapeFromObject(samplingObject, nodeScale)
    const buildCylinder = () => buildCylinderShapeFromObject(samplingObject, nodeScale)
    const buildCapsule = () => buildCapsuleShapeFromObject(samplingObject, nodeScale)
    const rigidbodyProps = clampRigidbodyComponentProps(entry.component.props)
    const builderPriority: Record<RigidbodyColliderType, Array<() => RigidbodyPhysicsShape | null>> = {
      convex: [buildConvex, buildBox, buildSphere, buildCylinder],
      box: [buildBox, buildConvex, buildSphere, buildCylinder],
      sphere: [buildSphere, buildConvex, buildBox, buildCylinder],
      cylinder: [buildCylinder, buildConvex, buildBox, buildSphere],
      capsule: [buildCapsule, buildConvex, buildBox, buildSphere],
    }
    const builders = builderPriority[rigidbodyProps.colliderType]
    for (const builder of builders) {
      shape = builder()
      if (shape) {
        break
      }
    }
    if (!shape) {
      continue
    }
    entry.component.metadata = mergeRigidbodyMetadata(
      entry.component.metadata,
      shape,
      shape.kind === 'convex' ? generatedConvexSimplify : undefined,
    )
  }
}

function buildSceneNodeLookup(nodes: SceneNode[]): Map<string, SceneNode> {
  const lookup = new Map<string, SceneNode>()
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const current = stack.pop()
    if (!current?.id) {
      continue
    }
    if (!lookup.has(current.id)) {
      lookup.set(current.id, current)
    }
    if (Array.isArray(current.children) && current.children.length) {
      for (const child of current.children) {
        stack.push(child)
      }
    }
  }
  return lookup
}

function resolveRigidbodySamplingNode(
  entry: RigidbodyExportCandidate,
  lookup: Map<string, SceneNode>,
): SceneNode | null {
  const rawTargetId = entry.component.props?.targetNodeId
  const targetNodeId = typeof rawTargetId === 'string' ? rawTargetId.trim() : null
  if (targetNodeId) {
    const resolved = lookup.get(targetNodeId)
    if (resolved) {
      return resolved
    }
  }
  return entry.node
}

function mergeRigidbodyMetadata(
  existing: Record<string, unknown> | undefined,
  shape: RigidbodyPhysicsShape,
  convexSimplify?: RigidbodyConvexSimplifyConfig,
): Record<string, unknown> {
  const nextMetadata: Record<string, unknown> = existing ? { ...existing } : {}
  const payload: RigidbodyComponentMetadata = {
    shape,
    generatedAt: new Date().toISOString(),
    convexSimplify,
  }
  nextMetadata[RIGIDBODY_METADATA_KEY] = payload
  return nextMetadata
}

async function buildRigidbodySamplingObject(
  node: SceneNode,
  assetCacheStore: ReturnType<typeof useAssetCacheStore>,
  groundNode: SceneNode | null,
  transform?: SceneNodeWorldTransform | null,
): Promise<THREE.Object3D | null> {
  let sourceObject: THREE.Object3D | null = null
  if (node.sourceAssetId) {
    sourceObject = await loadAssetObjectForNode(node, assetCacheStore)
  } else if (node.dynamicMesh?.type) {
    sourceObject = buildDynamicMeshObject(node, groundNode)
  } else if (node.nodeType === 'Group') {
    const empty = new THREE.Object3D()
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        const childObject = await buildRigidbodySamplingObject(child, assetCacheStore, groundNode)
        if (!childObject) {
          continue
        }
        applyPositionAndRotationToObject(childObject, child)
        childObject.updateMatrixWorld(true)
        empty.add(childObject)
      }
    }
    if (empty.children.length > 0) {
      sourceObject = empty
    }
  } else {
    sourceObject = buildPrimitiveObject(node)
  }

  if (!sourceObject) {
    return null
  }

  const root = new THREE.Group()
  root.add(sourceObject)
  if (transform) {
    root.position.copy(transform.position)
    root.quaternion.copy(transform.quaternion)
    root.scale.copy(transform.scale)
  } else {
    applyScaleToObject(root, node)
  }
  root.updateMatrixWorld(true)
  return root
}

function getFiniteComponent(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function applyPositionAndRotationToObject(object: THREE.Object3D, node: SceneNode): void {
  const position = node.position as { x?: unknown; y?: unknown; z?: unknown } | undefined
  object.position.set(
    getFiniteComponent(position?.x),
    getFiniteComponent(position?.y),
    getFiniteComponent(position?.z),
  )

  const rotation = node.rotation as { x?: unknown; y?: unknown; z?: unknown } | undefined
  object.rotation.set(
    getFiniteComponent(rotation?.x),
    getFiniteComponent(rotation?.y),
    getFiniteComponent(rotation?.z),
  )
}

async function loadAssetObjectForNode(
  node: SceneNode,
  assetCacheStore: ReturnType<typeof useAssetCacheStore>,
): Promise<THREE.Object3D | null> {
  const assetId = node.sourceAssetId
  if (!assetId) {
    return null
  }

  let baseGroup = getCachedModelObject(assetId)
  if (!baseGroup) {
    const asset = useSceneStore().getAsset(assetId)
    const file = await assetCacheStore.ensureAssetFile(assetId, { asset })
    if (file) {
      const ext = asset?.extension ?? undefined
      baseGroup = await getOrLoadModelObject(assetId, () => loadObjectFromFile(file, ext))
    }
  }

  const baseObject = baseGroup?.object ?? null
  if (!baseObject) {
    return null
  }
  const target = findObjectByPath(baseObject, node.importMetadata?.objectPath ?? null) ?? baseObject
  const clone = target.clone(true)
  clone.updateMatrixWorld(true)
  return clone
}

function buildDynamicMeshObject(node: SceneNode, _groundNode: SceneNode | null): THREE.Object3D | null {
  const mesh = node.dynamicMesh
  if (!mesh) {
    return null
  }
  switch (mesh.type) {
    case 'Ground':
      {
        const ground = createGroundMesh(mesh)
        ground.updateMatrixWorld(true)
        return ground
      }
    case 'Wall': {
      const wallComponent = node.components?.[WALL_COMPONENT_TYPE] as SceneNodeComponentState<WallComponentProps> | undefined
      const wallProps = wallComponent
        ? clampWallProps(wallComponent.props as Partial<WallComponentProps> | null | undefined)
        : null
      return createWallGroup(mesh, {
        headAssetHeight: wallProps?.headAssetHeight,
        footAssetHeight: wallProps?.footAssetHeight,
      }).clone(true)
    }
    case 'Road':
      {
        const compiled = extractCompiledStaticMeshMetadataFromUserData(node.userData)
        if (!compiled) {
          return null
        }
        const roadMesh = createCompiledStaticMeshRuntimeMesh(compiled, {
          name: node.name ?? compiled.name ?? 'Road',
        })
        roadMesh.updateMatrixWorld(true)
        return roadMesh
      }
    default:
      return null
  }
}

function buildPrimitiveObject(node: SceneNode): THREE.Object3D | null {
  const geometry = createPrimitiveGeometry(node.nodeType)
  if (!geometry) {
    return null
  }
  const material = new THREE.MeshBasicMaterial({ color: '#cccccc', wireframe: true })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.updateMatrixWorld(true)
  return mesh
}

function applyScaleToObject(object: THREE.Object3D, node: SceneNode): void {
  const scale = node.scale
  if (scale) {
    object.scale.set(
      Number.isFinite(scale.x) ? scale.x : 1,
      Number.isFinite(scale.y) ? scale.y : 1,
      Number.isFinite(scale.z) ? scale.z : 1,
    )
  } else {
    object.scale.setScalar(1)
  }
}

function buildConvexShapeFromOutline(
  outline: SceneOutlineMesh,
  scaleFactors: { x: number; y: number; z: number },
  worldTransform: SceneNodeWorldTransform | null,
): RigidbodyPhysicsShape | null {
  const positions = Array.isArray(outline.positions) ? outline.positions : []
  if (positions.length < 12) {
    return null
  }
  const safeScaleX = Math.max(1e-4, Math.abs(scaleFactors.x) || 1)
  const safeScaleY = Math.max(1e-4, Math.abs(scaleFactors.y) || 1)
  const safeScaleZ = Math.max(1e-4, Math.abs(scaleFactors.z) || 1)
  if (worldTransform) {
    sceneNodePositionHelper.copy(worldTransform.position)
    sceneNodeQuaternionHelper.copy(worldTransform.quaternion)
    sceneNodeScaleHelper.set(
      safeScaleX,
      safeScaleY,
      safeScaleZ,
    )
    sceneNodeInverseWorldMatrixHelper.compose(
      sceneNodePositionHelper,
      sceneNodeQuaternionHelper,
      sceneNodeScaleHelper,
    ).invert()
  } else {
    sceneNodeInverseWorldMatrixHelper.identity()
  }

  const localPoints: THREE.Vector3[] = []
  for (let index = 0; index < positions.length; index += 3) {
    const vx = positions[index]
    const vy = positions[index + 1]
    const vz = positions[index + 2]
    if ([vx, vy, vz].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      sceneNodeConvexPointHelper.set(vx as number, vy as number, vz as number)
      if (worldTransform) {
        sceneNodeConvexPointHelper.applyMatrix4(sceneNodeInverseWorldMatrixHelper)
      }
      localPoints.push(sceneNodeConvexPointHelper.clone())
    }
  }
  if (localPoints.length < 4) {
    return null
  }

  const indices = Array.isArray(outline.indices) ? outline.indices : null
  const faces: number[][] = []
  if (indices && indices.length >= 3) {
    for (let index = 0; index + 2 < indices.length; index += 3) {
      const a = indices[index]
      const b = indices[index + 1]
      const c = indices[index + 2]
      if ([a, b, c].every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0)) {
        faces.push([a as number, b as number, c as number])
      }
    }
  } else {
    for (let index = 0; index + 2 < localPoints.length; index += 3) {
      faces.push([index, index + 1, index + 2])
    }
  }

  if (!faces.length) {
    return null
  }

  sceneNodeConvexBoundsHelper.setFromPoints(localPoints)
  if (sceneNodeConvexBoundsHelper.isEmpty()) {
    return null
  }
  sceneNodeConvexBoundsHelper.getCenter(sceneNodeConvexCenterHelper)

  const vertices: [number, number, number][] = localPoints.map((point) => ([
    point.x - sceneNodeConvexCenterHelper.x,
    point.y - sceneNodeConvexCenterHelper.y,
    point.z - sceneNodeConvexCenterHelper.z,
  ]))

  return {
    kind: 'convex',
    vertices,
    faces,
    offset: [
      sceneNodeConvexCenterHelper.x,
      sceneNodeConvexCenterHelper.y,
      sceneNodeConvexCenterHelper.z,
    ],
    applyScale: true,
  }
}

function componentMapHasEntries(components?: SceneNodeComponentMap | null): boolean {
  return Boolean(components && Object.keys(components).length)
}

function cloneNodeComponentState(component: SceneNodeComponentState): SceneNodeComponentState {
  // 深度克隆 metadata 以确保完整复制
  let clonedMetadata: Record<string, unknown> | undefined
  if (component.metadata) {
    try {
      clonedMetadata = structuredClone(component.metadata)
    } catch (_error) {
      // 如果 structuredClone 失败，尝试使用 JSON 序列化
      try {
        clonedMetadata = JSON.parse(JSON.stringify(component.metadata)) as Record<string, unknown>
      } catch (_jsonError) {
        // 如果都失败了，使用浅拷贝作为最后手段
        console.warn('Failed to deeply clone component metadata for export, using shallow copy', _jsonError)
        clonedMetadata = { ...component.metadata }
      }
    }
  }
  
  return {
    ...component,
    props: { ...(component.props ?? {}) },
    metadata: clonedMetadata,
  }
}

function cloneNodeComponentMap(components: SceneNodeComponentMap): SceneNodeComponentMap {
  const cloned: SceneNodeComponentMap = {}
  Object.entries(components).forEach(([type, component]) => {
    if (!component) {
      return
    }
    cloned[type as NodeComponentType] = cloneNodeComponentState(component)
  })
  return cloned
}

function sanitizeNodeComponentsForJsonExport(
  components: SceneNodeComponentMap,
  options: SceneExportOptions,
): SceneNodeComponentMap {
  const filtered: SceneNodeComponentMap = {}
  Object.entries(components).forEach(([type, component]) => {
    if (!component) {
      return
    }
    if (!options.includeSkeletons && /skeleton/i.test(component.type)) {
      return
    }
    filtered[type as NodeComponentType] = component
  })
  return filtered
}

function collectNodeTreeIds(node: SceneNode, bucket: Set<string>) {
  bucket.add(node.id)
  if (node.children?.length) {
    for (const child of node.children) {
      collectNodeTreeIds(child, bucket)
    }
  }
}

function sanitizeSceneNodeMaterial(material: SceneNodeMaterial): SceneNodeMaterial {
  const existingTextures = material.textures ?? {}
  return {
    ...material,
    textures: { ...existingTextures },
  }
}

function shouldIncludeNodeForAssetPreload(node: SceneNode): boolean {
  if (node.visible === false) {
    return false
  }
  if (node.editorFlags?.editorOnly) {
    return false
  }
  if (node.nodeType === 'Light' || Boolean(node.light)) {
    return false
  }
  if (node.nodeType === 'Environment') {
    return false
  }
  return true
}

function collectEssentialAssetIdsFromNodeIds(
  nodeIds: Set<string>,
  nodeLookup: Map<string, SceneNode>,
): Set<string> {
  const assetIds = new Set<string>()
  nodeIds.forEach((nodeId) => {
    const node = nodeLookup.get(nodeId) ?? null
    if (!node) {
      return
    }
    if (!shouldIncludeNodeForAssetPreload(node)) {
      return
    }
    addAssetIdToSet(assetIds, node.sourceAssetId ?? null)
  })
  return assetIds
}

function buildSceneAssetPreloadInfo(
  nodes: SceneNode[] | null | undefined,
  options: SceneExportOptions,
): SceneAssetPreloadInfo | undefined {
  const nodeList: SceneNode[] = Array.isArray(nodes) ? [...nodes] : []

  const nodeLookup = new Map<string, SceneNode>()
  const preloadableRootNodeIds = new Set<string>()
  {
    const stack: SceneNode[] = [...nodeList]
    while (stack.length) {
      const node = stack.pop()
      if (!node) {
        continue
      }
      nodeLookup.set(node.id, node)
      const preloadable = node.components?.[PRELOADABLE_COMPONENT_TYPE] as
        | SceneNodeComponentState<PreloadableComponentProps>
        | undefined
      if (preloadable?.enabled) {
        preloadableRootNodeIds.add(node.id)
      }

      if (Array.isArray(node.children) && node.children.length) {
        stack.push(...node.children)
      }
    }
  }

  const meshAssetIds = collectSourceAssetIds(nodeList)
  const scatterAssetIds = collectScatterAssetIds(nodeList)
  scatterAssetIds.forEach((assetId) => meshAssetIds.add(assetId))

  // Build essential node ids from multiple sources, then resolve to asset ids in one place.
  // - Preloadable nodes and their subtrees
  const essentialNodeIds = new Set<string>()
  if (preloadableRootNodeIds.size) {
    preloadableRootNodeIds.forEach((nodeId) => {
      const root = nodeLookup.get(nodeId) ?? null
      if (!root) {
        return
      }
      collectNodeTreeIds(root, essentialNodeIds)
    })
  }
  const essentialAssetIds = collectEssentialAssetIdsFromNodeIds(essentialNodeIds, nodeLookup)
  essentialAssetIds.forEach((assetId) => meshAssetIds.add(assetId))

  if (!meshAssetIds.size) {
    return undefined
  }
  const lazyLoad = options.lazyLoadMeshes ?? true
  const essentialSet = new Set<string>()
  if (lazyLoad) {
    scatterAssetIds.forEach((assetId) => essentialSet.add(assetId))
  } else {
    meshAssetIds.forEach((assetId) => essentialSet.add(assetId))
  }

  // Essential assets (preloadable subtrees) should be eagerly available on scene entry.
  essentialAssetIds.forEach((assetId) => essentialSet.add(assetId))

  const meshInfo: SceneAssetPreloadInfo['mesh'] = {
    all: Array.from(meshAssetIds).sort(),
  }
  if (essentialSet.size) {
    meshInfo.essential = Array.from(essentialSet).sort()
  }

  return { mesh: meshInfo }
}

function collectSourceAssetIds(nodes: SceneNode[]): Set<string> {
  const ids = new Set<string>()
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    const assetId = typeof node.sourceAssetId === 'string' ? node.sourceAssetId.trim() : ''
    if (assetId) {
      ids.add(assetId)
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }
  return ids
}

function collectScatterAssetIds(nodes: SceneNode[]): Set<string> {
  const ids = new Set<string>()
  const stack: SceneNode[] = [...nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (node.dynamicMesh?.type === 'Ground') {
      const definition = node.dynamicMesh as GroundDynamicMesh & {
        terrainScatter?: TerrainScatterStoreSnapshot | null
      }
      const snapshot = definition.terrainScatter
      if (snapshot && Array.isArray(snapshot.layers) && snapshot.layers.length) {
        snapshot.layers.forEach((layer) => {
          addAssetIdToSet(ids, layer?.assetId)
          addAssetIdToSet(ids, layer?.profileId)
          if (Array.isArray(layer?.instances)) {
            layer.instances.forEach((instance) => {
              addAssetIdToSet(ids, instance?.assetId)
              addAssetIdToSet(ids, instance?.profileId)
            })
          }
        })
      }
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }
  return ids
}

function addAssetIdToSet(bucket: Set<string>, assetId: string | null | undefined): void {
  const normalized = typeof assetId === 'string' ? assetId.trim() : ''
  if (normalized) {
    bucket.add(normalized)
  }
}
