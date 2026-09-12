import * as THREE from 'three'
import {
  createPrimitiveGeometry,
  type SceneNode,
  type SceneNodeComponentState,
  type SceneOutlineMesh,
} from '@schema/core'
import {
  RIGIDBODY_METADATA_KEY,
  WALL_COMPONENT_TYPE,
  type RigidbodyComponentMetadata,
  type RigidbodyComponentProps,
  type RigidbodyConvexDecompositionConfig,
  type RigidbodyConvexDecompositionCustomConfig,
  type RigidbodyConvexDecompositionLevel,
  type RigidbodyConvexMeshPart,
  type RigidbodyConvexSimplifyConfig,
  type RigidbodyPhysicsShape,
  type WallComponentProps,
  clampWallProps,
  resolveRigidbodyConvexDecompositionConfig,
} from '@schema/components'
import { findObjectByPath } from '@schema/modelAssetLoader'
import { getCachedModelObject, getOrLoadModelObject } from '@schema/modelObjectCache'
import { loadObjectFromFile } from '@schema/assetImport'
import { canNodeUseRuntimeModelInstancing } from '@schema/runtimeModelInstancing'
import { createGroundMesh } from '@schema/groundMesh'
import { createWallGroup } from '@schema/wallMesh'
import { extractCompiledStaticMeshMetadataFromUserData, createCompiledStaticMeshRuntimeMesh } from '@schema/compiledStaticMesh'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { useSceneStore } from '@/stores/sceneStore'
import {
  DEFAULT_CONVEX_SIMPLIFY_CONFIG,
  buildConservativeConvexGeometryFromObject,
  geometryStats,
} from '@/utils/convexSimplify'
import { buildConvexMeshShapeFromObject } from '@/utils/convexDecompose'

/**
 * Shared rigidbody collision-shape construction used by both the scene exporter
 * (preview/export) and the in-viewport Collider Editor, so that what the editor
 * shows and persists is exactly what the export pipeline would have generated.
 */

export type SceneNodeWorldTransform = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

export const RIGIDBODY_SAMPLING_UNIT_KIND_KEY = 'harmonyRigidbodySamplingUnitKind'

export type RigidbodySamplingUnitKind = 'asset' | 'group' | 'dynamic' | 'primitive'

export type RigidbodySamplingUnitEntry = {
  object: THREE.Object3D
  kind: RigidbodySamplingUnitKind
}

const getSceneNodePositionHelper = new THREE.Vector3()
const getSceneNodeQuaternionHelper = new THREE.Quaternion()
const getSceneNodeScaleHelper = new THREE.Vector3()
const getSceneNodeEulerHelper = new THREE.Euler()
const getSceneNodeLocalMatrixHelper = new THREE.Matrix4()

const convexPointHelper = new THREE.Vector3()
const convexInverseWorldMatrixHelper = new THREE.Matrix4()
const convexRelativeMatrixHelper = new THREE.Matrix4()
const convexBoundsHelper = new THREE.Box3()
const convexCenterHelper = new THREE.Vector3()

export function composeWorldMatrix(transform: SceneNodeWorldTransform | null | undefined): THREE.Matrix4 {
  if (!transform) {
    return new THREE.Matrix4().identity()
  }
  return new THREE.Matrix4().compose(transform.position, transform.quaternion, transform.scale)
}

function getSceneNodeLocalMatrix(node: SceneNode): THREE.Matrix4 {
  const position = node.position as { x?: unknown; y?: unknown; z?: unknown } | undefined
  const rotation = node.rotation as { x?: unknown; y?: unknown; z?: unknown } | undefined
  const scale = node.scale as { x?: unknown; y?: unknown; z?: unknown } | undefined

  getSceneNodePositionHelper.set(
    typeof position?.x === 'number' && Number.isFinite(position.x) ? position.x : 0,
    typeof position?.y === 'number' && Number.isFinite(position.y) ? position.y : 0,
    typeof position?.z === 'number' && Number.isFinite(position.z) ? position.z : 0,
  )
  getSceneNodeEulerHelper.set(
    typeof rotation?.x === 'number' && Number.isFinite(rotation.x) ? rotation.x : 0,
    typeof rotation?.y === 'number' && Number.isFinite(rotation.y) ? rotation.y : 0,
    typeof rotation?.z === 'number' && Number.isFinite(rotation.z) ? rotation.z : 0,
    'XYZ',
  )
  getSceneNodeQuaternionHelper.setFromEuler(getSceneNodeEulerHelper).normalize()
  getSceneNodeScaleHelper.set(
    typeof scale?.x === 'number' && Number.isFinite(scale.x) ? Math.abs(scale.x) : 1,
    typeof scale?.y === 'number' && Number.isFinite(scale.y) ? Math.abs(scale.y) : 1,
    typeof scale?.z === 'number' && Number.isFinite(scale.z) ? Math.abs(scale.z) : 1,
  )

  return getSceneNodeLocalMatrixHelper.compose(
    getSceneNodePositionHelper,
    getSceneNodeQuaternionHelper,
    getSceneNodeScaleHelper,
  ).clone()
}

export function buildSceneNodeWorldTransformMap(nodes: SceneNode[]): Map<string, SceneNodeWorldTransform> {
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

export function findGroundNode(nodes: SceneNode[]): SceneNode | null {
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

export function resolveRigidbodySamplingNode(
  node: SceneNode,
  component: SceneNodeComponentState<RigidbodyComponentProps>,
  lookup: Map<string, SceneNode>,
): SceneNode | null {
  const rawTargetId = component.props?.targetNodeId
  const targetNodeId = typeof rawTargetId === 'string' ? rawTargetId.trim() : null
  if (targetNodeId) {
    const resolved = lookup.get(targetNodeId)
    if (resolved) {
      return resolved
    }
  }
  return node
}

export function buildSceneNodeLookup(nodes: SceneNode[]): Map<string, SceneNode> {
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

export function mergeRigidbodyMetadata(
  existing: Record<string, unknown> | undefined,
  shape: RigidbodyPhysicsShape,
  convexSimplify?: RigidbodyConvexSimplifyConfig,
  convexDecomposition?: RigidbodyConvexDecompositionConfig,
): Record<string, unknown> {
  const nextMetadata: Record<string, unknown> = existing ? { ...existing } : {}
  const payload: RigidbodyComponentMetadata = {
    shape,
    generatedAt: new Date().toISOString(),
    convexSimplify,
    convexDecomposition,
  }
  nextMetadata[RIGIDBODY_METADATA_KEY] = payload
  return nextMetadata
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

function buildInstancedSamplingObjectFromCachedMeshes(
  cached: NonNullable<ReturnType<typeof getCachedModelObject>>,
): THREE.Group | null {
  const sourceMeshes = Array.isArray(cached.meshes) ? cached.meshes : []
  if (!sourceMeshes.length) {
    return null
  }
  const samplingGroup = new THREE.Group()
  samplingGroup.name = `${cached.object.name || cached.assetId}:InstancedSamplingGeometry`
  samplingGroup.userData.rigidbodyInstancedSampling = true
  sourceMeshes.forEach((sourceMesh, index) => {
    const positionAttribute = sourceMesh.geometry?.getAttribute('position')
    if (!sourceMesh.geometry || !positionAttribute || positionAttribute.count < 3) {
      return
    }
    const samplingMesh = new THREE.Mesh(sourceMesh.geometry)
    samplingMesh.name = `${samplingGroup.name}:${index}`
    samplingMesh.frustumCulled = false
    samplingGroup.add(samplingMesh)
  })
  if (!samplingGroup.children.length) {
    return null
  }
  samplingGroup.updateMatrixWorld(true)
  return samplingGroup
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
  const importMetadata = node.importMetadata as { objectPath?: number[] | null } | null | undefined
  const hasObjectPath = Array.isArray(importMetadata?.objectPath) && importMetadata.objectPath.length > 0
  // Preview renders instancing-eligible whole-model nodes using baked local geometry (the import-time
  // root normalization offset is baked out of the InstancedMesh geometry). Sampling the raw object clone
  // would keep that root offset and produce a collider that does not hug the visible mesh. Reuse the
  // exact cached instanced geometry so collider sampling and rendering share the same coordinate space.
  if (
    !hasObjectPath
    && canNodeUseRuntimeModelInstancing(node)
    && Array.isArray(baseGroup?.meshes)
    && baseGroup!.meshes.length > 0
  ) {
    const instancedSamplingObject = buildInstancedSamplingObjectFromCachedMeshes(baseGroup!)
    if (instancedSamplingObject) {
      return instancedSamplingObject
    }
  }
  const target = findObjectByPath(baseObject, node.importMetadata?.objectPath ?? null) ?? baseObject
  const clone = target.clone(true)
  // Non-instanced preview objects are normalized to identity before the node
  // transform is applied. Keep collider sampling aligned with that rendering
  // path so the imported root offset does not leak into the convex hull.
  clone.position.set(0, 0, 0)
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

export async function buildRigidbodySamplingObject(
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
        childObject.userData[RIGIDBODY_SAMPLING_UNIT_KIND_KEY] = resolveRigidbodySamplingUnitKind(child)
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

export function resolveRigidbodySamplingUnitKind(node: SceneNode): RigidbodySamplingUnitKind {
  if (node.sourceAssetId) {
    return 'asset'
  }
  if (node.nodeType === 'Group') {
    return 'group'
  }
  if (node.dynamicMesh?.type) {
    return 'dynamic'
  }
  return 'primitive'
}

export function collectRigidbodySamplingUnitEntries(
  samplingObject: THREE.Object3D,
  isGroupNode: boolean,
): RigidbodySamplingUnitEntry[] {
  if (!isGroupNode) {
    return [{ object: samplingObject, kind: 'asset' }]
  }
  const contentRoot = samplingObject.children[0]
  if (!contentRoot) {
    return []
  }
  const entries: RigidbodySamplingUnitEntry[] = []
  for (const child of contentRoot.children) {
    if (!child) {
      continue
    }
    const userDataKind = child.userData?.[RIGIDBODY_SAMPLING_UNIT_KIND_KEY]
    const kind: RigidbodySamplingUnitKind = userDataKind === 'asset'
      || userDataKind === 'group'
      || userDataKind === 'dynamic'
      || userDataKind === 'primitive'
      ? userDataKind
      : 'asset'
    entries.push({ object: child, kind })
  }
  return entries
}

export function countSamplingObjectMeshLeaves(
  object: THREE.Object3D,
  limit = 64,
): number {
  let count = 0
  object.traverse((child) => {
    if (count >= limit) {
      return
    }
    const mesh = child as THREE.Object3D & {
      isMesh?: boolean
      isInstancedMesh?: boolean
      geometry?: THREE.BufferGeometry
    }
    const positionAttribute = mesh.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
    if (
      mesh.isMesh
      && mesh.isInstancedMesh !== true
      && positionAttribute
      && positionAttribute.count >= 3
    ) {
      count += 1
    }
  })
  return count
}

export function buildConvexShapeFromOutline(
  outline: SceneOutlineMesh,
  scaleFactors: { x: number; y: number; z: number },
  sourceWorldTransform: SceneNodeWorldTransform | null,
  hostWorldTransform: SceneNodeWorldTransform | null,
): RigidbodyPhysicsShape | null {
  const positions = Array.isArray(outline.positions) ? outline.positions : []
  if (positions.length < 12) {
    return null
  }
  const sourceScale = sourceWorldTransform?.scale ?? scaleFactors
  const safeScaleX = Math.max(1e-4, Math.abs(sourceScale.x) || 1)
  const safeScaleY = Math.max(1e-4, Math.abs(sourceScale.y) || 1)
  const safeScaleZ = Math.max(1e-4, Math.abs(sourceScale.z) || 1)
  if (sourceWorldTransform) {
    convexInverseWorldMatrixHelper.compose(
      sourceWorldTransform.position,
      sourceWorldTransform.quaternion,
      new THREE.Vector3(safeScaleX, safeScaleY, safeScaleZ),
    ).invert()
  } else {
    convexInverseWorldMatrixHelper.identity()
  }

  if (sourceWorldTransform && hostWorldTransform) {
    convexRelativeMatrixHelper
      .copy(composeWorldMatrix(hostWorldTransform))
      .invert()
      .multiply(composeWorldMatrix(sourceWorldTransform))
  } else {
    convexRelativeMatrixHelper.identity()
  }

  const localPoints: THREE.Vector3[] = []
  for (let index = 0; index < positions.length; index += 3) {
    const vx = positions[index]
    const vy = positions[index + 1]
    const vz = positions[index + 2]
    if ([vx, vy, vz].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      convexPointHelper.set(vx as number, vy as number, vz as number)
      if (sourceWorldTransform) {
        convexPointHelper.applyMatrix4(convexInverseWorldMatrixHelper)
      }
      if (sourceWorldTransform && hostWorldTransform) {
        convexPointHelper.applyMatrix4(convexRelativeMatrixHelper)
      }
      localPoints.push(convexPointHelper.clone())
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

  convexBoundsHelper.setFromPoints(localPoints)
  if (convexBoundsHelper.isEmpty()) {
    return null
  }
  convexBoundsHelper.getCenter(convexCenterHelper)

  const vertices: [number, number, number][] = localPoints.map((point) => ([
    point.x - convexCenterHelper.x,
    point.y - convexCenterHelper.y,
    point.z - convexCenterHelper.z,
  ]))

  return {
    kind: 'convex',
    vertices,
    faces,
    offset: [
      convexCenterHelper.x,
      convexCenterHelper.y,
      convexCenterHelper.z,
    ],
    applyScale: true,
  }
}

export function buildLeafConvexMeshShapeFromObject(
  object: THREE.Object3D,
  config: RigidbodyConvexSimplifyConfig,
  nodeScale: { x: number; y: number; z: number },
  sourceWorldTransform: SceneNodeWorldTransform | null,
  hostWorldTransform: SceneNodeWorldTransform | null,
): Extract<RigidbodyPhysicsShape, { kind: 'convex-mesh' }> | null {
  const parts: RigidbodyConvexMeshPart[] = []
  object.traverse((child) => {
    if (parts.length >= 64) {
      return
    }
    const mesh = child as THREE.Object3D & {
      isMesh?: boolean
      isInstancedMesh?: boolean
      geometry?: THREE.BufferGeometry
    }
    const positionAttribute = mesh.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
    if (
      !mesh.isMesh
      || mesh.isInstancedMesh === true
      || !positionAttribute
      || positionAttribute.count < 3
    ) {
      return
    }
    const built = buildConservativeConvexGeometryFromObject(mesh, config.primary)
    if (!built) {
      return
    }
    try {
      const convex = buildConvexShapeFromOutline(built.outline, nodeScale, sourceWorldTransform, hostWorldTransform)
      if (convex?.kind === 'convex' && convex.vertices.length >= 4 && convex.faces.length >= 4) {
        parts.push({
          vertices: convex.vertices,
          faces: convex.faces,
          offset: convex.offset ?? [0, 0, 0],
          rotation: [0, 0, 0],
        })
      }
    } finally {
      built.geometry.dispose()
    }
  })
  if (!parts.length) {
    return null
  }
  return {
    kind: 'convex-mesh',
    parts,
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    applyScale: true,
  }
}

export type ExportConvexShapeBuildResult = {
  shape: RigidbodyPhysicsShape
  convexSimplify?: RigidbodyConvexSimplifyConfig
  convexDecomposition?: RigidbodyConvexDecompositionConfig
}

export type BuildExportConvexShapeParams = {
  samplingObject: THREE.Object3D
  samplingNode: SceneNode
  nodeScale: { x: number; y: number; z: number }
  sourceWorldTransform: SceneNodeWorldTransform | null
  hostWorldTransform: SceneNodeWorldTransform | null
  decompositionLevel?: RigidbodyConvexDecompositionLevel | null
  decompositionCustomConfig?: Partial<RigidbodyConvexDecompositionCustomConfig> | null
}

/**
 * Builds the convex collider exactly the way the scene exporter does:
 * multi-unit groups -> per-unit leaf hull / V-HACD decomposition (`convex-mesh`),
 * plain primitives -> per-mesh leaf hull, everything else -> V-HACD decomposition,
 * and finally the inflated outline single hull (`convex`) as the fallback.
 */
export async function buildExportConvexShape(
  params: BuildExportConvexShapeParams,
): Promise<ExportConvexShapeBuildResult | null> {
  const {
    samplingObject,
    samplingNode,
    nodeScale,
    sourceWorldTransform,
    hostWorldTransform,
    decompositionLevel,
    decompositionCustomConfig,
  } = params

  const decompositionConfig = resolveRigidbodyConvexDecompositionConfig(
    decompositionLevel,
    decompositionCustomConfig,
  )
  const leafConfigBase = DEFAULT_CONVEX_SIMPLIFY_CONFIG as unknown as RigidbodyConvexSimplifyConfig
  const leafConfig: RigidbodyConvexSimplifyConfig = {
    version: 1,
    primary: { ...leafConfigBase.primary },
    fallback: { ...leafConfigBase.fallback },
    limits: { ...leafConfigBase.limits },
  }

  const samplingUnits = collectRigidbodySamplingUnitEntries(
    samplingObject,
    samplingNode.nodeType === 'Group',
  )
  if (samplingUnits.length >= 2) {
    const parts: RigidbodyConvexMeshPart[] = []
    for (const unit of samplingUnits) {
      let unitParts: RigidbodyConvexMeshPart[] | null = null
      const isSimplePrimitive = unit.kind === 'primitive'
        && countSamplingObjectMeshLeaves(unit.object, 2) === 1
      if (isSimplePrimitive) {
        const quickShape = buildLeafConvexMeshShapeFromObject(
          unit.object,
          leafConfig,
          nodeScale,
          sourceWorldTransform,
          hostWorldTransform,
        )
        if (quickShape && quickShape.parts.length === 1) {
          unitParts = quickShape.parts
        }
      }
      if (!unitParts) {
        const decomposedUnit = await buildConvexMeshShapeFromObject(
          unit.object,
          decompositionConfig,
          sourceWorldTransform,
          hostWorldTransform,
        )
        unitParts = decomposedUnit?.shape.parts ?? null
      }
      if (unitParts && unitParts.length) {
        parts.push(...unitParts)
      }
    }
    if (parts.length) {
      return {
        shape: {
          kind: 'convex-mesh',
          parts,
          offset: [0, 0, 0],
          rotation: [0, 0, 0],
          applyScale: true,
        },
        convexDecomposition: {
          ...decompositionConfig,
          usedHulls: parts.length,
        },
      }
    }
  }

  const isPlainPrimitiveTarget = !samplingNode.sourceAssetId
    && samplingNode.nodeType !== 'Group'
    && !samplingNode.dynamicMesh?.type
  let decomposedConfig: RigidbodyConvexDecompositionConfig | undefined
  if (isPlainPrimitiveTarget) {
    const quickShape = buildLeafConvexMeshShapeFromObject(
      samplingObject,
      leafConfig,
      nodeScale,
      sourceWorldTransform,
      hostWorldTransform,
    )
    if (quickShape && quickShape.parts.length >= 1) {
      return { shape: quickShape }
    }
  } else {
    const decomposed = await buildConvexMeshShapeFromObject(
      samplingObject,
      decompositionConfig,
      sourceWorldTransform,
      hostWorldTransform,
    )
    if (decomposed) {
      decomposedConfig = decomposed.config
      return { shape: decomposed.shape, convexDecomposition: decomposedConfig }
    }
  }

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
  const convexShape = buildConvexShapeFromOutline(outline, nodeScale, sourceWorldTransform, hostWorldTransform)
  if (!convexShape) {
    return null
  }
  return { shape: convexShape, convexSimplify: config }
}
