<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from '@/utils/transformControls.js'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'
import { findSceneNode } from '@/components/editor/sceneUtils'
import { getCachedModelObject } from '@schema/modelObjectCache'
import {
  RIGIDBODY_COMPONENT_TYPE,
  RIGIDBODY_METADATA_KEY,
  type RigidbodyComponentMetadata,
  type RigidbodyComponentProps,
  type RigidbodyPhysicsShape,
} from '@schema/components'
import { buildOutlineMeshFromObject } from '@/utils/outlineMesh'
import type { SceneNode, SceneNodeComponentState } from '@harmony/schema'
import { resolveNodeScaleFactors } from '@/utils/rigidbodyCollider'

const props = defineProps<{
  visible: boolean
  anchor: { top: number; left: number } | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

type ColliderShapeKind = 'box' | 'sphere' | 'convex'

type EditableShape = {
  kind: ColliderShapeKind
  dimensions: THREE.Vector3
  offset: THREE.Vector3
}

const COLLIDER_SHAPE_OPTIONS: Array<{ label: string; value: ColliderShapeKind }> = [
  { label: 'Convex (Mesh)', value: 'convex' },
  { label: 'Box', value: 'box' },
  { label: 'Sphere', value: 'sphere' },
]

const sceneStore = useSceneStore()
const { selectedNodeId, selectedNode, nodes: sceneNodes } = storeToRefs(sceneStore)

const rigidbodyComponent = computed<SceneNodeComponentState<RigidbodyComponentProps> | null>(() => {
  const node = selectedNode.value
  if (!node) {
    return null
  }
  const component = node.components?.[RIGIDBODY_COMPONENT_TYPE]
  return (component as SceneNodeComponentState<RigidbodyComponentProps> | undefined) ?? null
})

const targetNodeId = computed(() => {
  const raw = rigidbodyComponent.value?.props.targetNodeId
  if (typeof raw === 'string' && raw.trim().length) {
    return raw.trim()
  }
  return selectedNodeId.value ?? null
})

const targetNode = computed<SceneNode | null>(() => {
  const id = targetNodeId.value
  if (!id) {
    return selectedNode.value ?? null
  }
  const tree = sceneNodes.value ?? []
  return findSceneNode(tree, id)
})

const panelStyle = computed(() => {
  if (!props.anchor) {
    return {}
  }
  const OFFSET_Y = 70
  return {
    top: `${props.anchor.top + OFFSET_Y}px`,
    left: `${props.anchor.left}px`,
  }
})

const colliderKind = ref<ColliderShapeKind>('convex')
const transformMode = ref<'translate' | 'scale'>('translate')
const colliderDimensions = reactive({ x: 1, y: 1, z: 1 })
const colliderOffset = reactive({ x: 0, y: 0, z: 0 })
const isReady = ref(false)
const loadError = ref<string | null>(null)
const previewContainerRef = ref<HTMLDivElement | null>(null)

const nodeLabel = computed(() => targetNode.value?.name ?? selectedNode.value?.name ?? 'Current Node')

const componentMetadataShape = computed<RigidbodyPhysicsShape | null>(() => {
  const metadata = rigidbodyComponent.value?.metadata?.[RIGIDBODY_METADATA_KEY] as RigidbodyComponentMetadata | undefined
  return metadata?.shape ?? null
})

const nodeScaleFactors = computed(() => targetNode.value ? resolveNodeScaleFactors(targetNode.value) : { x: 1, y: 1, z: 1 })

const canSave = computed(() => Boolean(rigidbodyComponent.value && selectedNodeId.value && isReady.value && !loadError.value))

let renderer: THREE.WebGLRenderer | null = null
let previewScene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let orbitControls: OrbitControls | null = null
let transformControls: TransformControls | null = null
let colliderGroup: THREE.Group | null = null
let colliderMesh: THREE.Mesh | null = null
let colliderEdges: THREE.LineSegments | null = null
let previewModelGroup: THREE.Group | null = null
let previewBounds: THREE.Box3 | null = null
let previewConvexGeometry: THREE.BufferGeometry | null = null
let resizeObserver: ResizeObserver | null = null
let previewRefreshToken = 0
const previewOriginShift = new THREE.Vector3()

function applyNodeTransformFromState(
  target: THREE.Object3D,
  node: SceneNode,
  options: { applyPositionRotation?: boolean } = {},
) {
  const { applyPositionRotation = true } = options
  if (applyPositionRotation) {
    target.position.set(node.position.x, node.position.y, node.position.z)
    target.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
  } else {
    target.position.set(0, 0, 0)
    target.rotation.set(0, 0, 0)
  }
  target.scale.set(node.scale.x, node.scale.y, node.scale.z)
}

function cloneRuntimeObject(runtimeObject: THREE.Object3D, node: SceneNode, applyPositionRotation: boolean): THREE.Object3D | null {
  const instancedAssetId = runtimeObject.userData?.instancedAssetId as string | undefined
  if (instancedAssetId) {
    const cached = getCachedModelObject(instancedAssetId)
    if (!cached) {
      return null
    }
    const instancedClone = cached.object.clone(true)
    applyNodeTransformFromState(instancedClone, node, { applyPositionRotation })
    return instancedClone
  }
  return runtimeObject.clone(true)
}

function cloneNodeForPreview(node: SceneNode, isRoot = false): THREE.Object3D | null {
  const runtimeObject = getRuntimeObject(node.id)
  let clone: THREE.Object3D | null = null

  if (runtimeObject) {
    clone = cloneRuntimeObject(runtimeObject, node, !isRoot)
  } else if (node.nodeType === 'Group') {
    clone = new THREE.Group()
  }

  if (!clone) {
    return null
  }

  clone.name = node.name ?? clone.name
  clone.userData = {
    ...(clone.userData ?? {}),
    nodeId: node.id,
  }

  applyNodeTransformFromState(clone, node, { applyPositionRotation: !isRoot })

  if (Array.isArray(node.children) && node.children.length) {
    node.children.forEach((child) => {
      const childClone = cloneNodeForPreview(child, false)
      if (childClone) {
        clone.add(childClone)
      }
    })
  }

  return clone
}

function disposePreview() {
  resizeObserver?.disconnect()
  resizeObserver = null

  if (renderer) {
    renderer.setAnimationLoop(null)
    renderer.dispose()
    const canvas = renderer.domElement
    canvas?.parentElement?.removeChild(canvas)
  }
  renderer = null

  orbitControls?.dispose()
  orbitControls = null

  if (transformControls) {
    const helper = transformControls.getHelper?.()
    if (helper && previewScene) {
      previewScene.remove(helper)
    }
    transformControls.detach()
    transformControls.dispose?.()
  }
  transformControls = null

  if (colliderMesh) {
    colliderMesh.geometry.dispose()
    ;(colliderMesh.material as THREE.Material).dispose?.()
  }
  colliderMesh = null

  if (colliderEdges) {
    colliderEdges.geometry.dispose()
    ;(colliderEdges.material as THREE.Material).dispose?.()
  }
  colliderEdges = null

  colliderGroup = null
  previewScene = null
  camera = null
  previewModelGroup = null
  previewBounds = null
  previewConvexGeometry?.dispose()
  previewConvexGeometry = null
  previewOriginShift.set(0, 0, 0)
  isReady.value = false
}

function normalizeColliderKind(type: string | null | undefined): ColliderShapeKind {
  if (type === 'convex') {
    return 'convex'
  }
  if (type === 'sphere') {
    return 'sphere'
  }
  if (type === 'box') {
    return 'box'
  }
  return 'convex'
}

function updateColliderStateFromGroup() {
  if (!colliderGroup) {
    return
  }
  colliderOffset.x = colliderGroup.position.x
  colliderOffset.y = colliderGroup.position.y
  colliderOffset.z = colliderGroup.position.z
  if (colliderKind.value === 'convex' && colliderMesh?.geometry?.boundingBox) {
    const size = colliderMesh.geometry.boundingBox.getSize(new THREE.Vector3())
    colliderDimensions.x = size.x * colliderGroup.scale.x
    colliderDimensions.y = size.y * colliderGroup.scale.y
    colliderDimensions.z = size.z * colliderGroup.scale.z
  } else {
    colliderDimensions.x = colliderGroup.scale.x
    colliderDimensions.y = colliderGroup.scale.y
    colliderDimensions.z = colliderGroup.scale.z
  }
}

function constrainColliderTransform() {
  if (!colliderGroup) {
    return
  }
  if (colliderKind.value === 'sphere') {
    const average = (colliderGroup.scale.x + colliderGroup.scale.y + colliderGroup.scale.z) / 3
    const safe = Math.max(0.05, average)
    colliderGroup.scale.set(safe, safe, safe)
  } else {
    colliderGroup.scale.set(
      Math.max(0.05, colliderGroup.scale.x),
      Math.max(0.05, colliderGroup.scale.y),
      Math.max(0.05, colliderGroup.scale.z),
    )
  }
}

function buildConvexGeometryFromPreview(): THREE.BufferGeometry | null {
  if (!previewModelGroup) {
    return null
  }
  const outline = buildOutlineMeshFromObject(previewModelGroup, { pointTarget: 320 })
  if (!outline || !outline.positions || outline.positions.length < 12) {
    return null
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(outline.positions, 3))
  if (Array.isArray(outline.indices) && outline.indices.length >= 3) {
    geometry.setIndex(outline.indices)
  } else {
    const fallback: number[] = []
    for (let index = 0; index + 2 < outline.positions.length / 3; index += 3) {
      fallback.push(index, index + 1, index + 2)
    }
    geometry.setIndex(fallback)
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function buildConvexGeometryFromDefinition(definition: Extract<RigidbodyPhysicsShape, { kind: 'convex' }>, scale: THREE.Vector3): THREE.BufferGeometry | null {
  const vertices = Array.isArray(definition.vertices) ? definition.vertices : []
  if (vertices.length < 4) {
    return null
  }
  const positions: number[] = []
  vertices.forEach((tuple) => {
    const vx = Number(tuple?.[0])
    const vy = Number(tuple?.[1])
    const vz = Number(tuple?.[2])
    if ([vx, vy, vz].every((value) => Number.isFinite(value))) {
      positions.push(vx * scale.x, vy * scale.y, vz * scale.z)
    }
  })
  if (positions.length < 12) {
    return null
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const faces = Array.isArray(definition.faces) ? definition.faces : []
  const index: number[] = []
  faces.forEach((face) => {
    if (Array.isArray(face) && face.length >= 3) {
      for (let i = 0; i + 2 < face.length; i += 1) {
        const a = Number(face[0])
        const b = Number(face[i + 1])
        const c = Number(face[i + 2])
        if ([a, b, c].every((value) => Number.isInteger(value) && value >= 0)) {
          index.push(a, b, c)
        }
      }
    }
  })
  if (index.length) {
    geometry.setIndex(index)
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function rebuildColliderGeometry(kind: ColliderShapeKind) {
  if (!previewScene) {
    return
  }
  let geometry: THREE.BufferGeometry | null = null
  if (kind === 'convex') {
    previewConvexGeometry?.dispose()
    previewConvexGeometry = buildConvexGeometryFromPreview()
    geometry = previewConvexGeometry
  } else if (kind === 'sphere') {
    geometry = new THREE.SphereGeometry(0.5, 36, 24)
  } else if (kind === 'box') {
    geometry = new THREE.BoxGeometry(1, 1, 1)
  }
  if (!geometry) {
    return
  }

  if (!colliderGroup) {
    colliderGroup = new THREE.Group()
    previewScene.add(colliderGroup)
  }

  if (colliderMesh) {
    colliderGroup.remove(colliderMesh)
    colliderMesh.geometry.dispose()
    ;(colliderMesh.material as THREE.Material).dispose?.()
  }

  const fillMaterial = new THREE.MeshStandardMaterial({
    color: 0x4cc9f0,
    opacity: 0.2,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  colliderMesh = new THREE.Mesh(geometry, fillMaterial)
  colliderGroup.add(colliderMesh)

  if (colliderEdges) {
    colliderGroup.remove(colliderEdges)
    colliderEdges.geometry.dispose()
    ;(colliderEdges.material as THREE.Material).dispose?.()
  }
  colliderEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x4cc9f0 })
  )
  colliderGroup.add(colliderEdges)
  transformControls?.attach(colliderGroup)
}

function buildDefaultShapeFromModel(kind: ColliderShapeKind): EditableShape | null {
  if (!previewBounds) {
    return null
  }
  const size = previewBounds.getSize(new THREE.Vector3())
  const center = previewBounds.getCenter(new THREE.Vector3())
  const minSize = 0.25
  if (kind === 'convex') {
    if (!previewConvexGeometry) {
      previewConvexGeometry = buildConvexGeometryFromPreview()
    }
    if (!previewConvexGeometry) {
      return null
    }
    previewConvexGeometry.computeBoundingBox()
    const box = previewConvexGeometry.boundingBox ?? new THREE.Box3().setFromObject(previewModelGroup ?? new THREE.Group())
    const convexSize = box.getSize(new THREE.Vector3())
    const convexCenter = box.getCenter(new THREE.Vector3())
    return {
      kind,
      dimensions: new THREE.Vector3(
        Math.max(minSize, convexSize.x || minSize),
        Math.max(minSize, convexSize.y || minSize),
        Math.max(minSize, convexSize.z || minSize),
      ),
      offset: convexCenter,
    }
  }
  if (kind === 'box') {
    return {
      kind,
      dimensions: new THREE.Vector3(
        Math.max(minSize, size.x || minSize),
        Math.max(minSize, size.y || minSize),
        Math.max(minSize, size.z || minSize),
      ),
      offset: center,
    }
  }
  if (kind === 'sphere') {
    const diameter = Math.max(size.x, size.y, size.z)
    const safeDiameter = Math.max(minSize, diameter || minSize)
    return {
      kind,
      dimensions: new THREE.Vector3(safeDiameter, safeDiameter, safeDiameter),
      offset: center,
    }
  }
  const diameter = Math.max(size.x, size.z)
  const safeDiameter = Math.max(minSize, diameter || minSize)
  const safeHeight = Math.max(minSize, size.y || minSize)
  return {
    kind,
    dimensions: new THREE.Vector3(safeDiameter, safeHeight, safeDiameter),
    offset: center,
  }
}

function convertMetadataShape(shape: RigidbodyPhysicsShape, kind: ColliderShapeKind): EditableShape | null {
  const normalized = shape.scaleNormalized !== false
  const scaleX = normalized ? nodeScaleFactors.value.x : 1
  const scaleY = normalized ? nodeScaleFactors.value.y : 1
  const scaleZ = normalized ? nodeScaleFactors.value.z : 1
  const offsetTuple = shape.offset ?? [0, 0, 0]
  const actualOffset = new THREE.Vector3(
    offsetTuple[0] * scaleX,
    offsetTuple[1] * scaleY,
    offsetTuple[2] * scaleZ,
  )
  actualOffset.sub(previewOriginShift)

  if (shape.kind === 'box' && kind === 'box') {
    const [hx, hy, hz] = shape.halfExtents
    return {
      kind: 'box',
      dimensions: new THREE.Vector3(
        Math.max(0.05, hx * 2 * scaleX),
        Math.max(0.05, hy * 2 * scaleY),
        Math.max(0.05, hz * 2 * scaleZ),
      ),
      offset: actualOffset,
    }
  }
  if (shape.kind === 'sphere' && kind === 'sphere') {
    const diameter = Math.max(0.05, shape.radius * 2 * Math.max(scaleX, scaleY, scaleZ))
    return {
      kind: 'sphere',
      dimensions: new THREE.Vector3(diameter, diameter, diameter),
      offset: actualOffset,
    }
  }
  if (shape.kind === 'convex' && kind === 'convex') {
    const geometry = buildConvexGeometryFromDefinition(shape, new THREE.Vector3(scaleX, scaleY, scaleZ))
    if (!geometry) {
      return null
    }
    previewConvexGeometry?.dispose()
    previewConvexGeometry = geometry
    geometry.computeBoundingBox()
    const box = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(
      geometry.getAttribute('position'),
    )
    const size = box.getSize(new THREE.Vector3())
    return {
      kind: 'convex',
      dimensions: new THREE.Vector3(
        Math.max(0.05, size.x),
        Math.max(0.05, size.y),
        Math.max(0.05, size.z),
      ),
      offset: actualOffset,
    }
  }
  return null
}

function applyEditableShape(shape: EditableShape) {
  colliderKind.value = shape.kind
  rebuildColliderGeometry(shape.kind)
  if (!colliderGroup) {
    return
  }
  colliderGroup.position.copy(shape.offset)
  if (shape.kind === 'convex') {
    colliderGroup.scale.set(1, 1, 1)
  } else {
    colliderGroup.scale.set(shape.dimensions.x, shape.dimensions.y, shape.dimensions.z)
  }
  constrainColliderTransform()
  updateColliderStateFromGroup()
  transformControls?.setMode(transformMode.value)
}

function resolveInitialShape(desiredKind: ColliderShapeKind): EditableShape | null {
  const metadata = componentMetadataShape.value
  if (metadata) {
    const converted = convertMetadataShape(metadata, desiredKind)
    if (converted) {
      return converted
    }
  }
  return buildDefaultShapeFromModel(desiredKind)
}

function schedulePreviewRefresh() {
  const token = ++previewRefreshToken
  nextTick(async () => {
    if (!props.visible || token !== previewRefreshToken) {
      return
    }
    try {
      await initializePreview(token)
    } catch (error) {
      console.warn('[RigidbodyColliderEditor] Failed to initialize preview', error)
      if (token === previewRefreshToken) {
        loadError.value = 'Unable to initialize the collider preview.'
      }
    }
  })
}

function handleResize() {
  if (!renderer || !camera) {
    return
  }
  const container = previewContainerRef.value
  if (!container) {
    return
  }
  const width = Math.max(1, container.clientWidth)
  const height = Math.max(1, container.clientHeight)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

async function initializePreview(requestToken: number) {
  disposePreview()
  loadError.value = null
  if (!props.visible || requestToken !== previewRefreshToken) {
    return
  }
  const container = previewContainerRef.value
  if (!container) {
    loadError.value = 'Preview container is unavailable.'
    return
  }
  const targetId = targetNodeId.value
  const node = targetNode.value
  if (!targetId || !node) {
    loadError.value = 'No node available for collider editing.'
    return
  }
  const runtimeObject = getRuntimeObject(targetId)
  if (!runtimeObject && node.nodeType !== 'Group') {
    loadError.value = 'No runtime object available for collider editing.'
    return
  }
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.shadowMap.enabled = false
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(container.clientWidth || 1, container.clientHeight || 1)
  container.appendChild(renderer.domElement)

  previewScene = new THREE.Scene()
  previewScene.background = new THREE.Color(0x0f1116)
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000)
  camera.position.set(6, 4, 6)

  orbitControls = new OrbitControls(camera, renderer.domElement)
  orbitControls.enableDamping = false
  orbitControls.dampingFactor = 0.06
  orbitControls.target.set(0, 0, 0)

  const ambient = new THREE.AmbientLight(0xffffff, 0.85)
  previewScene.add(ambient)
  const directional = new THREE.DirectionalLight(0xffffff, 0.8)
  directional.position.set(8, 12, 6)
  previewScene.add(directional)

  let clone: THREE.Object3D | null = null

  if (node.nodeType === 'Group') {
    // For groups, recreate the full hierarchy so child meshes (including instanced ones) appear in the preview
    clone = cloneNodeForPreview(node, true)
    if (!clone && runtimeObject) {
      clone = cloneRuntimeObject(runtimeObject, node, false)
    }
  } else if (runtimeObject) {
    clone = cloneRuntimeObject(runtimeObject, node, false)
  }
  if (!clone) {
    loadError.value = 'The instanced model is not available for preview.'
    disposePreview()
    return
  }

  clone.updateMatrixWorld(true)
  previewModelGroup = new THREE.Group()
  previewModelGroup.add(clone)
  previewScene.add(previewModelGroup)

  const originalBounds = new THREE.Box3().setFromObject(previewModelGroup)
  if (originalBounds.isEmpty()) {
    loadError.value = 'The selected node has no visible geometry.'
    disposePreview()
    return
  }
  const center = originalBounds.getCenter(new THREE.Vector3())
  previewOriginShift.copy(center)
  previewModelGroup.position.set(-center.x, -center.y, -center.z)
  previewModelGroup.updateMatrixWorld(true)
  previewBounds = new THREE.Box3().setFromObject(previewModelGroup)

  const size = previewBounds.getSize(new THREE.Vector3())
  const radius = Math.max(size.x, size.y, size.z) * 0.65 || 4
  const distance = radius * 2.2
  camera.position.set(distance, distance * 0.6, distance)
  camera.lookAt(0, 0, 0)
  orbitControls.update()

  transformControls = new TransformControls(camera, renderer.domElement)
  transformControls.setMode(transformMode.value)
  transformControls.addEventListener('mouseDown', () => {
    if (orbitControls) {
      orbitControls.enabled = false
    }
  })
  transformControls.addEventListener('mouseUp', () => {
    if (orbitControls) {
      orbitControls.enabled = true
    }
  })
  transformControls.addEventListener('objectChange', () => {
    constrainColliderTransform()
    updateColliderStateFromGroup()
  })
  previewScene.add(transformControls.getHelper())

  const desiredKind = normalizeColliderKind(rigidbodyComponent.value?.props.colliderType)
  const shape = resolveInitialShape(desiredKind) ?? resolveInitialShape('convex') ?? {
    kind: 'box',
    dimensions: new THREE.Vector3(1, 1, 1),
    offset: new THREE.Vector3(),
  }
  applyEditableShape(shape)
  isReady.value = true

  renderer.setAnimationLoop(() => {
    orbitControls?.update()
    previewScene && camera && renderer?.render(previewScene, camera)
  })
  handleResize()
  resizeObserver = new ResizeObserver(() => handleResize())
  resizeObserver.observe(container)
}

function handleShapeKindChange(kind: ColliderShapeKind | null) {
  if (!kind || kind === colliderKind.value) {
    return
  }
  const shape = resolveInitialShape(kind)
  if (shape) {
    applyEditableShape(shape)
  }
}

function handleAutoFit() {
  const shape = buildDefaultShapeFromModel(colliderKind.value)
  if (shape) {
    applyEditableShape(shape)
  }
}

function buildMetadataShape(): RigidbodyPhysicsShape | null {
  if (!colliderGroup) {
    return null
  }
  const scale = nodeScaleFactors.value
  const offset = colliderGroup.position.clone().add(previewOriginShift)

  if (colliderKind.value === 'box') {
    return {
      kind: 'box',
      halfExtents: [
        Math.max(1e-4, (colliderGroup.scale.x * 0.5) / scale.x),
        Math.max(1e-4, (colliderGroup.scale.y * 0.5) / scale.y),
        Math.max(1e-4, (colliderGroup.scale.z * 0.5) / scale.z),
      ],
      offset: [offset.x / scale.x, offset.y / scale.y, offset.z / scale.z],
      scaleNormalized: true,
    }
  }
  if (colliderKind.value === 'sphere') {
    const radius = colliderGroup.scale.x * 0.5
    const dominant = Math.max(scale.x, scale.y, scale.z)
    return {
      kind: 'sphere',
      radius: Math.max(1e-4, radius / dominant),
      offset: [offset.x / scale.x, offset.y / scale.y, offset.z / scale.z],
      scaleNormalized: true,
    }
  }
  if (colliderKind.value === 'convex') {
    if (!previewConvexGeometry) {
      previewConvexGeometry = buildConvexGeometryFromPreview()
    }
    const positions = (previewConvexGeometry?.getAttribute('position') as THREE.BufferAttribute | undefined)
    if (!positions) {
      return null
    }
    const vertices: [number, number, number][] = []
    const scratch = new THREE.Vector3()
    for (let i = 0; i < positions.count; i += 1) {
      scratch.fromBufferAttribute(positions, i)
      scratch.multiply(colliderGroup.scale)
      scratch.add(offset)
      vertices.push([scratch.x / scale.x, scratch.y / scale.y, scratch.z / scale.z])
    }
    const faces: number[][] = []
    const index = previewConvexGeometry?.getIndex()
    if (index && index.count >= 3) {
      for (let i = 0; i + 2 < index.count; i += 3) {
        faces.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)])
      }
    } else {
      for (let i = 0; i + 2 < positions.count; i += 3) {
        faces.push([i, i + 1, i + 2])
      }
    }
    if (!vertices.length || !faces.length) {
      return null
    }
    return {
      kind: 'convex',
      vertices,
      faces,
      offset: [offset.x / scale.x, offset.y / scale.y, offset.z / scale.z],
      scaleNormalized: true,
    }
  }

  return null
}

function handleConfirm() {
  if (!canSave.value || !rigidbodyComponent.value || !selectedNodeId.value) {
    return
  }
  const shape = buildMetadataShape()
  if (!shape) {
    return
  }
  const metadata: Record<string, unknown> = { ...(rigidbodyComponent.value.metadata ?? {}) }
  const payload: RigidbodyComponentMetadata = {
    shape,
    generatedAt: new Date().toISOString(),
  }
  metadata[RIGIDBODY_METADATA_KEY] = payload
  sceneStore.updateNodeComponentMetadata(selectedNodeId.value, rigidbodyComponent.value.id, metadata)
  sceneStore.updateNodeComponentProps(selectedNodeId.value, rigidbodyComponent.value.id, {
    colliderType: colliderKind.value,
  })
  emit('close')
}

function handleCancel() {
  emit('close')
}

watch(() => props.visible, (visible) => {
  if (visible) {
    schedulePreviewRefresh()
  } else {
    disposePreview()
  }
}, { immediate: true })

watch(targetNodeId, () => {
  if (props.visible) {
    schedulePreviewRefresh()
  }
})

watch(
  () => componentMetadataShape.value,
  () => {
    if (props.visible) {
      schedulePreviewRefresh()
    }
  },
)

watch(transformMode, (mode) => {
  transformControls?.setMode(mode)
})

watch(
  () => rigidbodyComponent.value?.enabled,
  (enabled) => {
    if (props.visible && enabled === false) {
      emit('close')
    }
  },
)

watch(selectedNodeId, () => {
  if (props.visible) {
    emit('close')
  }
})

onUnmounted(() => {
  disposePreview()
})
</script>

<template>
  <Teleport to="body">
    <transition name="fade-transition">
      <div
        v-if="visible && anchor"
        class="collider-editor"
        :style="panelStyle"
      >
        <v-toolbar density="compact" height="40px" class="collider-editor__toolbar">
          <div class="collider-editor__title">
            Collider Editor · {{ nodeLabel }}
          </div>
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            @click="handleCancel"
          />
        </v-toolbar>

        <v-divider />

        <div class="collider-editor__body">
          <div class="collider-editor__preview">
            <div class="collider-editor__overlay">
              <v-select
                class="collider-editor__shape-select"
                label="Collider Shape"
                density="compact"
                variant="outlined"
                hide-details
                :items="COLLIDER_SHAPE_OPTIONS"
                item-title="label"
                item-value="value"
                :model-value="colliderKind"
                :disabled="!isReady"
                @update:modelValue="handleShapeKindChange"
              />
              <div class="collider-editor__overlay-actions">
                <v-btn
                  size="small"
                  icon
                  variant="tonal"
                  :color="transformMode === 'translate' ? 'primary' : undefined"
                  :disabled="!isReady"
                  title="Move"
                  aria-label="Move"
                  @click="transformMode = 'translate'"
                >
                  <v-icon icon="mdi-axis-arrow" />
                </v-btn>
                <v-btn
                  size="small"
                  icon
                  variant="tonal"
                  :color="transformMode === 'scale' ? 'primary' : undefined"
                  :disabled="!isReady"
                  title="Scale"
                  aria-label="Scale"
                  @click="transformMode = 'scale'"
                >
                  <v-icon icon="mdi-crop" />
                </v-btn>
                <v-btn
                  size="small"
                  icon
                  variant="tonal"
                  :disabled="!isReady"
                  title="Auto-fit"
                  aria-label="Auto-fit"
                  @click="handleAutoFit"
                >
                  <v-icon icon="mdi-aspect-ratio" />
                </v-btn>
              </div>
            </div>

            <div v-if="loadError" class="collider-editor__empty">
              {{ loadError }}
            </div>
            <div v-else class="collider-editor__canvas" ref="previewContainerRef">
              <div v-if="!isReady" class="collider-editor__empty">
                Preparing preview…
              </div>
            </div>

            <div class="collider-editor__stats" v-if="isReady">
              <div class="collider-editor__stats-row">
                Size
                <span>{{ colliderDimensions.x.toFixed(2) }} × {{ colliderDimensions.y.toFixed(2) }} × {{ colliderDimensions.z.toFixed(2) }} m</span>
              </div>
              <div class="collider-editor__stats-row">
                Offset
                <span>{{ colliderOffset.x.toFixed(2) }}, {{ colliderOffset.y.toFixed(2) }}, {{ colliderOffset.z.toFixed(2) }} m</span>
              </div>
            </div>

            <div class="collider-editor__hint">
              Drag the gizmo to move or scale the collider. Use the buttons above to switch modes or change the mesh shape on the left.
            </div>
          </div>
        </div>

        <v-divider />

        <div class="collider-editor__actions">
          <v-btn variant="text" @click="handleCancel">
            Cancel
          </v-btn>
          <v-btn color="primary" :disabled="!canSave" @click="handleConfirm">
            Save Collider
          </v-btn>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>


.collider-editor-enter-active,
.collider-editor-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.collider-editor-enter-from,
.collider-editor-leave-to {
  opacity: 0;
  transform: translate(-105%, 10px);
}



.collider-editor {
  position: fixed;
  top: 0;
  left: 0;
  transform: translateX(-100%);

  width: min(1100px, 85vw);
  max-height: 120vh;
  display: flex;
  flex-direction: column;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background-color: rgba(18, 22, 28, 0.72);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
  z-index: 24;
}


.collider-editor__toolbar {
  background: transparent;
  color: inherit;
}

.collider-editor__title {
  font-weight: 600;
  letter-spacing: 0.04em;
}

.collider-editor__body {
  display: flex;
  flex-direction: column;
  padding: 0.75rem;
  min-height: 520px;
}

.collider-editor__preview {
  position: relative;
  flex: 1;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  background: #06070b;
  overflow: hidden;
}

.collider-editor__canvas {
  width: 100%;
  height: 100%;
  position: relative;
  min-height: 520px;
}

.collider-editor__canvas canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}

.collider-editor__overlay {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.55rem;
  border-radius: 10px;
  background: rgba(12, 14, 19, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(10px);
}

.collider-editor__shape-select {
  max-width: 240px;
}

.collider-editor__overlay-actions {
  display: flex;
  gap: 0.4rem;
}

.collider-editor__stats {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.5rem 0.7rem;
  border-radius: 8px;
  background: rgba(12, 14, 19, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.88rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}

.collider-editor__stats-row {
  display: flex;
  justify-content: space-between;
  color: rgba(233, 236, 241, 0.82);
}

.collider-editor__hint {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 2;
  max-width: 320px;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  background: rgba(12, 14, 19, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.72);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}

.collider-editor__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 1rem;
  font-size: 0.9rem;
  color: rgba(233, 236, 241, 0.72);
}

.collider-editor__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.8rem;
  padding: 0.75rem 1rem;
}
</style>
