import * as THREE from 'three'
import type {
  FloorDynamicMesh,
  SceneMaterialProps,
  SceneNode,
  SceneNodeMaterial,
} from '@schema/core'
import { componentManager } from '@schema/components'
import type {
  HarmonyAssetSearchQuery,
  HarmonyAssetSearchResult,
  HarmonyAssetSummary,
  HarmonyBounds,
  HarmonyComponentSnapshot,
  HarmonyGeometrySnapshot,
  HarmonyMaterialSummary,
  HarmonyNodeSummary,
  HarmonySceneQuery,
  HarmonySceneQueryResult,
} from '@schema/editorAgentProtocol'
import {
  getRuntimeObject,
  resolveSceneNodeWorldMatrix,
  type useSceneStore,
} from '@/stores/sceneStore'
import type { ProjectAsset } from '@/types/project-asset'

type SceneStore = ReturnType<typeof useSceneStore>

type IndexedNode = {
  node: SceneNode
  parentId: string | null
  depth: number
}

const PRECISE_GEOMETRY_BOUNDS_VERTEX_LIMIT = 100_000

function collectNodes(nodes: SceneNode[], parentId: string | null = null, depth = 0): IndexedNode[] {
  const entries: IndexedNode[] = []
  for (const node of nodes) {
    entries.push({ node, parentId, depth })
    if (node.children?.length) {
      entries.push(...collectNodes(node.children, node.id, depth + 1))
    }
  }
  return entries
}

function toComponentSnapshot(component: NonNullable<SceneNode['components']>[string]): HarmonyComponentSnapshot | null {
  if (!component) {
    return null
  }
  const profile = componentManager.getAgentProfile(component.type)
  return {
    id: component.id,
    type: component.type,
    label: profile?.label ?? component.type,
    enabled: component.enabled !== false,
    editMode: profile?.editMode ?? 'readonly',
    domain: profile?.domain ?? null,
    props: component.props && typeof component.props === 'object'
      ? component.props as Record<string, unknown>
      : {},
    ...(component.metadata ? { metadata: component.metadata } : {}),
  }
}

function toMaterialPropsSnapshot(material: SceneNodeMaterial): SceneMaterialProps {
  return {
    color: material.color,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    side: material.side,
    wireframe: material.wireframe,
    metalness: material.metalness,
    roughness: material.roughness,
    specular: material.specular,
    shininess: material.shininess,
    transmission: material.transmission,
    thickness: material.thickness,
    ior: material.ior,
    clearcoat: material.clearcoat,
    clearcoatRoughness: material.clearcoatRoughness,
    attenuationColor: material.attenuationColor,
    attenuationDistance: material.attenuationDistance,
    emissive: material.emissive,
    emissiveIntensity: material.emissiveIntensity,
    aoStrength: material.aoStrength,
    envMapIntensity: material.envMapIntensity,
    textures: material.textures ?? {},
  }
}

function toMaterialSummary(material: SceneNodeMaterial): HarmonyMaterialSummary {
  return {
    id: material.id,
    name: material.name ?? null,
    type: material.type ?? null,
    color: material.color ?? null,
    sourceMaterialAssetId: material.sourceMaterialAssetId ?? null,
    textureAssetIds: Object.values(material.textures ?? {})
      .filter(Boolean)
      .map((texture) => texture?.assetId ?? null)
      .filter((assetId): assetId is string => Boolean(assetId)),
    props: toMaterialPropsSnapshot(material),
    ...(Array.isArray(material.textureOverrides)
      ? { textureOverrides: [...material.textureOverrides] }
      : {}),
    ...(material.deviceProfileId !== undefined
      ? { deviceProfileId: material.deviceProfileId }
      : {}),
  }
}

function toHarmonyBounds(box: THREE.Box3 | null): HarmonyBounds | null {
  if (!box || box.isEmpty()) {
    return null
  }
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
    center: { x: center.x, y: center.y, z: center.z },
    size: { x: size.x, y: size.y, z: size.z },
  }
}

function computeVisibleMeshBounds(
  root: THREE.Object3D,
  nodeWorldMatrix: THREE.Matrix4,
): { local: THREE.Box3; world: THREE.Box3 } | null {
  root.updateWorldMatrix(true, true)
  const inverseRootWorld = root.matrixWorld.clone().invert()
  const localBounds = new THREE.Box3()
  const worldBounds = new THREE.Box3()
  let found = false
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || child.visible === false || !mesh.geometry) {
      return
    }
    const meshRelativeToRoot = new THREE.Matrix4().multiplyMatrices(
      inverseRootWorld,
      mesh.matrixWorld,
    )
    const position = mesh.geometry.getAttribute('position')
    if (position && position.count > 0 && position.count <= PRECISE_GEOMETRY_BOUNDS_VERTEX_LIMIT) {
      const point = new THREE.Vector3()
      const worldPoint = new THREE.Vector3()
      for (let index = 0; index < position.count; index += 1) {
        point.fromBufferAttribute(position, index).applyMatrix4(meshRelativeToRoot)
        localBounds.expandByPoint(point)
        worldPoint.copy(point).applyMatrix4(nodeWorldMatrix)
        worldBounds.expandByPoint(worldPoint)
      }
    } else {
      if (!mesh.geometry.boundingBox) {
        mesh.geometry.computeBoundingBox()
      }
      if (!mesh.geometry.boundingBox) {
        return
      }
      const meshLocalBounds = mesh.geometry.boundingBox.clone().applyMatrix4(meshRelativeToRoot)
      localBounds.union(meshLocalBounds)
      worldBounds.union(meshLocalBounds.clone().applyMatrix4(nodeWorldMatrix))
    }
    found = true
  })
  return found ? { local: localBounds, world: worldBounds } : null
}

function toGeometrySnapshot(
  store: SceneStore,
  node: SceneNode,
): HarmonyGeometrySnapshot | undefined {
  const runtimeObject = getRuntimeObject(node.id)
  if (!runtimeObject) {
    return undefined
  }
  const nodeWorldMatrix = resolveSceneNodeWorldMatrix(store.nodes, node.id)
  if (!nodeWorldMatrix) {
    return undefined
  }
  const bounds = computeVisibleMeshBounds(runtimeObject, nodeWorldMatrix)
  const snapshot: HarmonyGeometrySnapshot = {
    localBounds: toHarmonyBounds(bounds?.local ?? null),
    worldBounds: toHarmonyBounds(bounds?.world ?? null),
  }
  if (node.dynamicMesh?.type === 'Floor') {
    const floor = node.dynamicMesh as FloorDynamicMesh
    const vertices = Array.isArray(floor.vertices)
      ? floor.vertices.map(([x, z]) => [Number(x), Number(z)] as [number, number])
      : []
    snapshot.floorVertices = vertices
    snapshot.worldFloorVertices = vertices.map(([x, z]) => {
      const point = new THREE.Vector3(x, 0, z).applyMatrix4(nodeWorldMatrix)
      return { x: point.x, y: point.y, z: point.z }
    })
  }
  return snapshot
}

function toNodeSummary(
  store: SceneStore,
  entry: IndexedNode,
  includeComponents: boolean,
  includeMaterials: boolean,
  includeGeometry: boolean,
): HarmonyNodeSummary {
  const { node, parentId } = entry
  const componentSnapshots = includeComponents
    ? Object.values(node.components ?? {})
      .map((component) => component ? toComponentSnapshot(component) : null)
      .filter((component): component is HarmonyComponentSnapshot => Boolean(component))
    : undefined
  const materials = includeMaterials
    ? (node.materials ?? []).map(toMaterialSummary)
    : undefined
  const geometry = includeGeometry ? toGeometrySnapshot(store, node) : undefined

  return {
    id: node.id,
    parentId,
    name: node.name ?? '',
    nodeType: node.nodeType ?? 'Mesh',
    position: { ...node.position },
    rotation: { ...node.rotation },
    scale: { ...node.scale },
    visible: node.visible !== false,
    locked: node.locked === true,
    childCount: node.children?.length ?? 0,
    componentTypes: Object.values(node.components ?? {})
      .filter(Boolean)
      .map((component) => component?.type ?? '')
      .filter(Boolean),
    ...(node.sourceAssetId ? { sourceAssetId: node.sourceAssetId } : {}),
    ...(componentSnapshots ? { components: componentSnapshots } : {}),
    ...(materials ? { materials } : {}),
    ...(geometry !== undefined ? { geometry } : {}),
  }
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0
  }
  const parsed = Number.parseInt(cursor, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export function queryScene(store: SceneStore, query: HarmonySceneQuery = {}): HarmonySceneQueryResult {
  const allEntries = collectNodes(store.nodes)
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 50)))
  const offset = parseCursor(query.cursor)
  const text = query.text?.trim().toLowerCase() ?? ''
  const maxDepth = typeof query.depth === 'number' && Number.isFinite(query.depth)
    ? Math.max(0, Math.floor(query.depth))
    : Number.POSITIVE_INFINITY

  const matched = allEntries.filter(({ node, parentId, depth }) => {
    if (depth > maxDepth) return false
    if (query.nodeId && node.id !== query.nodeId) return false
    if (Object.prototype.hasOwnProperty.call(query, 'parentId') && parentId !== (query.parentId ?? null)) return false
    if (query.nodeType && (node.nodeType ?? 'Mesh') !== query.nodeType) return false
    if (query.assetId && node.sourceAssetId !== query.assetId) return false
    if (query.componentType && !node.components?.[query.componentType]) return false
    if (text) {
      const componentTypes = Object.values(node.components ?? {}).map((component) => component?.type ?? '')
      const haystack = [node.name, node.id, node.nodeType, ...componentTypes].join(' ').toLowerCase()
      if (!haystack.includes(text)) return false
    }
    return true
  })

  const page = matched.slice(offset, offset + limit)
  const nextOffset = offset + page.length
  return {
    sceneId: store.currentSceneId,
    sceneName: store.currentSceneMeta?.name ?? null,
    sceneRevision: store.sceneRevision,
    totalMatched: matched.length,
    nodes: page.map((entry) => toNodeSummary(
      store,
      entry,
      query.includeComponents === true,
      query.includeMaterials === true,
      query.includeGeometry === true,
    )),
    nextCursor: nextOffset < matched.length ? String(nextOffset) : null,
  }
}

function flattenAssets(store: SceneStore): ProjectAsset[] {
  const records = new Map<string, ProjectAsset>()
  Object.values(store.assetCatalog ?? {}).forEach((assets) => {
    if (!Array.isArray(assets)) {
      return
    }
    assets.forEach((asset) => {
      if (asset?.id) {
        records.set(asset.id, asset)
      }
    })
  })
  return Array.from(records.values())
}

function toAssetSummary(asset: ProjectAsset): HarmonyAssetSummary {
  return {
    id: asset.id,
    name: asset.name ?? asset.id,
    type: asset.type ?? 'unknown',
    extension: asset.extension ?? null,
    category: asset.categoryId ?? null,
    thumbnail: asset.thumbnail ?? null,
    downloadUrl: asset.downloadUrl ?? null,
    source: asset.source?.type ?? null,
  }
}

export function searchCatalog(store: SceneStore, query: HarmonyAssetSearchQuery = {}): HarmonyAssetSearchResult {
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 50)))
  const offset = parseCursor(query.cursor)
  const text = query.text?.trim().toLowerCase() ?? ''
  const assets = flattenAssets(store)
    .filter((asset) => !query.type || asset.type === query.type)
    .filter((asset) => {
      if (!text) return true
      return [asset.id, asset.name, asset.description, asset.type]
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase()
        .includes(text)
    })
  const page = assets.slice(offset, offset + limit)
  const nextOffset = offset + page.length
  return {
    assets: page.map(toAssetSummary),
    nextCursor: nextOffset < assets.length ? String(nextOffset) : null,
  }
}
