<script setup lang="ts">
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  Clock,
  Color,
  DirectionalLight,
  HemisphereLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PerspectiveCamera,
  Scene,
  CylinderGeometry,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from '@/utils/transformControls.js'
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'
import { getCachedModelObject } from '@schema/modelObjectCache'
import { setBoundingBoxFromObject } from '@/components/editor/sceneUtils'
import { createScenePreviewPhysicsBridge } from '@/physics/createScenePreviewPhysicsBridge'
import {
  PHYSICS_BODY_TRANSFORM_STRIDE,
  PHYSICS_WHEEL_TRANSFORM_STRIDE,
  type PhysicsBridge,
  type PhysicsCompoundChildDesc,
  type PhysicsSceneAsset,
  type PhysicsShapeDesc,
  type PhysicsStepFrame,
  type PhysicsVector3,
} from '@harmony/physics-core'
import {
  VEHICLE_COMPONENT_TYPE,
  clampVehicleComponentProps,
  type VehicleComponentProps,
  type VehicleWheelProps,
  RIGIDBODY_COMPONENT_TYPE,
  RIGIDBODY_METADATA_KEY,
  clampRigidbodyComponentProps,
  type RigidbodyComponentProps,
  type RigidbodyComponentMetadata,
  type RigidbodyPhysicsShape,
} from '@schema/components'
import { resolveNodeScaleFactors } from '@/utils/rigidbodyCollider'
import type { SceneNode, SceneNodeComponentState } from '@schema'

const props = defineProps<{
  visible: boolean
  anchor: { top: number; left: number } | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const vehicleComponent = computed<SceneNodeComponentState<VehicleComponentProps> | null>(() => {
  const node = selectedNode.value
  if (!node) return null
  const component = node.components?.[VEHICLE_COMPONENT_TYPE]
  return (component as SceneNodeComponentState<VehicleComponentProps> | undefined) ?? null
})

const normalizedProps = computed(() => clampVehicleComponentProps(vehicleComponent.value?.props ?? null))
const wheelEntries = computed(() => normalizedProps.value.wheels ?? [])
const isDisabled = computed(() => !vehicleComponent.value?.enabled)
const panelStyle = computed(() => ({
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
}))

const previewContainerRef = ref<HTMLDivElement | null>(null)
const isReady = ref(false)
const loadError = ref<string | null>(null)
const activeHandle = ref<'front' | 'rear'>('front')
const uiState = reactive({
  spacing: 0,
})

let renderer: WebGLRenderer | null = null
let previewScene: Scene | null = null
let camera: PerspectiveCamera | null = null
let orbitControls: OrbitControls | null = null
let transformControls: TransformControls | null = null
let previewModelGroup: Object3D | null = null
let chassisGroup: Group | null = null
let frontGroup: Group | null = null
let rearGroup: Group | null = null
let groundMesh: Mesh | null = null
let chassisBodyMesh: Mesh | null = null
let connectionPointMeshes: Mesh[] = []
let resizeObserver: ResizeObserver | null = null
let physicsBridge: PhysicsBridge | null = null
let physicsBridgeInitPromise: Promise<PhysicsBridge> | null = null
let physicsSceneRequestId = 0
let physicsSceneLoaded = false
let physicsStepInFlight = false
let pendingPhysicsDeltaMs = 0
let chassisPreviewBaseY = 1
let animationFrame: number | null = null
let wheelPreviewMeshes: Mesh[] = []

const tempBox = new Box3()
const tempSize = new Vector3()
const tempWheelDirection = new Vector3()
const tempWheelLocalPosition = new Vector3()
const tempWheelWorldPosition = new Vector3()

const PREVIEW_GROUND_SHAPE_ID = 1
const PREVIEW_CHASSIS_SHAPE_ID = 10
const PREVIEW_CHASSIS_COMPOUND_SHAPE_ID = 11
const PREVIEW_GROUND_BODY_ID = 1
const PREVIEW_CHASSIS_BODY_ID = 2
const PREVIEW_GROUND_MATERIAL_ID = 1
const PREVIEW_CHASSIS_MATERIAL_ID = 2
const PREVIEW_VEHICLE_ID = 1
const IDENTITY_ROTATION: [number, number, number, number] = [0, 0, 0, 1]

type AxisIndex = 0 | 1 | 2

type ChassisColliderInfo = {
  shapeDescriptors: PhysicsShapeDesc[]
  rootShapeId: number
  halfHeight: number
  offset: PhysicsVector3
  visual:
    | { kind: 'box'; halfExtents: PhysicsVector3 }
    | { kind: 'sphere'; radius: number }
    | { kind: 'cylinder'; radiusTop: number; radiusBottom: number; height: number }
    | { kind: 'convex'; size: Vector3 }
}

function normalizeAxisIndex(axis: number | undefined): AxisIndex {
  if (axis === 1) return 1
  if (axis === 2) return 2
  return 0
}

function toPhysicsVector3(x: number, y: number, z: number): PhysicsVector3 {
  return [x, y, z]
}

function isZeroPhysicsVector(vector: PhysicsVector3): boolean {
  return Math.abs(vector[0]) < 1e-6 && Math.abs(vector[1]) < 1e-6 && Math.abs(vector[2]) < 1e-6
}

function getAxisValue(vector: { x: number; y: number; z: number }, axis: AxisIndex): number {
  return axis === 0 ? vector.x : axis === 1 ? vector.y : vector.z
}

function setAxisValue(vector: { x: number; y: number; z: number }, axis: AxisIndex, value: number) {
  if (axis === 0) return { ...vector, x: value }
  if (axis === 1) return { ...vector, y: value }
  return { ...vector, z: value }
}

const rightAxisIndex = computed<AxisIndex>(() => normalizeAxisIndex(normalizedProps.value.indexRightAxis))

function handleClose() {
  emit('close')
}

function applyNodeTransformFromState(target: Object3D, node: SceneNode) {
  target.position.set(node.position.x, node.position.y, node.position.z)
  target.rotation.set(node.rotation.x, node.rotation.y, node.rotation.z)
  target.scale.set(node.scale.x, node.scale.y, node.scale.z)
}

function cloneRuntimeObject(runtimeObject: Object3D, node: SceneNode): Object3D | null {
  const instancedAssetId = runtimeObject.userData?.instancedAssetId as string | undefined
  if (instancedAssetId) {
    const cached = getCachedModelObject(instancedAssetId)
    if (!cached) {
      return null
    }
    const instancedClone = cached.object.clone(true)
    applyNodeTransformFromState(instancedClone, node)
    return instancedClone
  }
  return runtimeObject.clone(true)
}

function cloneNodeForPreview(node: SceneNode): Object3D | null {
  const runtimeObject = getRuntimeObject(node.id)
  let clone: Object3D | null = null
  if (runtimeObject) {
    clone = cloneRuntimeObject(runtimeObject, node)
  } else if (node.nodeType === 'Group') {
    clone = new Group()
    applyNodeTransformFromState(clone, node)
  }
  if (!clone) return null
  clone.name = node.name ?? clone.name
  clone.userData = { ...(clone.userData ?? {}), nodeId: node.id }
  if (Array.isArray(node.children)) {
    node.children.forEach((child) => {
      const childClone = cloneNodeForPreview(child)
      if (childClone) clone.add(childClone)
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
    previewScene?.remove(transformControls.getHelper())
    transformControls.detach()
    transformControls.dispose?.()
  }
  transformControls = null
  if (chassisGroup && chassisBodyMesh) {
    chassisGroup.remove(chassisBodyMesh)
  }
  wheelPreviewMeshes.forEach((mesh) => previewScene?.remove(mesh))
  const scene = previewScene
  previewScene = null
  camera = null
  previewModelGroup = null
  chassisGroup = null
  frontGroup = null
  rearGroup = null
  if (groundMesh) {
    scene?.remove(groundMesh)
  }
  groundMesh = null
  chassisBodyMesh = null
  connectionPointMeshes = []
  wheelPreviewMeshes = []
  void disposePhysics()
  isReady.value = false
  loadError.value = null
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

async function disposePhysics() {
  const bridge = physicsBridge
  physicsSceneRequestId += 1
  physicsSceneLoaded = false
  physicsStepInFlight = false
  pendingPhysicsDeltaMs = 0
  physicsBridgeInitPromise = null
  physicsBridge = null
  if (!bridge) {
    return
  }
  try {
    await bridge.disposeScene()
  } catch (error) {
    console.warn('[VehicleSuspensionEditorDialog] Failed to dispose physics scene', error)
  }
  try {
    await bridge.destroy()
  } catch (error) {
    console.warn('[VehicleSuspensionEditorDialog] Failed to destroy physics bridge', error)
  }
}

function initPreview() {
  const container = previewContainerRef.value
  if (!container) return
  disposePreview()
  renderer = new WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6))
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.setClearColor(new Color('#dfe5ee'))
  container.appendChild(renderer.domElement)

  previewScene = new Scene()
  camera = new PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.05, 1000)
  camera.position.set(6, 4, 6)
  previewScene.add(camera)

  const ambient = new AmbientLight(0xffffff, 1.0)
  const hemi = new HemisphereLight(0xbfd4ff, 0xdde3ed, 0.55)
  const dir = new DirectionalLight(0xffffff, 1.15)
  dir.position.set(6, 9, 7)
  previewScene.add(ambient, hemi, dir)

  groundMesh = new Mesh(
    new PlaneGeometry(60, 60),
    new MeshStandardMaterial({ color: '#cdd6e5', roughness: 0.9, metalness: 0 }),
  )
  groundMesh.rotation.x = -Math.PI / 2
  previewScene.add(groundMesh)

  orbitControls = new OrbitControls(camera, renderer.domElement)
  orbitControls.target.set(0, 1, 0)
  orbitControls.enableDamping = false

  transformControls = new TransformControls(camera, renderer.domElement)
  transformControls.setMode('translate')
  transformControls.addEventListener('dragging-changed', (event) => {
    if (orbitControls) {
      orbitControls.enabled = !event.value
    }
  })
  transformControls.addEventListener('mouseUp', handleHandleCommit)
  previewScene.add(transformControls.getHelper())

  rebuildModel()
  rebuildHandles()
  void rebuildPhysics()
  startRenderLoop()

  resizeObserver = new ResizeObserver(() => resizeRenderer())
  resizeObserver.observe(container)
  isReady.value = true
}

function resizeRenderer() {
  if (!renderer || !camera || !previewContainerRef.value) return
  const width = previewContainerRef.value.clientWidth
  const height = previewContainerRef.value.clientHeight
  camera.aspect = Math.max(0.1, width / Math.max(height, 1))
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

function rebuildModel() {
  if (!previewScene || !selectedNode.value) return
  if (chassisGroup) {
    previewScene.remove(chassisGroup)
  }
  wheelPreviewMeshes.forEach((mesh) => previewScene.remove(mesh))
  chassisGroup = new Group()
  previewScene.add(chassisGroup)

  const clone = cloneNodeForPreview(selectedNode.value)
  if (clone) {
    clone.position.set(0, 0, 0)
    clone.rotation.set(0, 0, 0)
    chassisGroup.add(clone)
    previewModelGroup = clone
  } else {
    previewModelGroup = null
  }

  const bounds = previewModelGroup ? setBoundingBoxFromObject(previewModelGroup, tempBox.makeEmpty()) : null
  const size = bounds && !bounds.isEmpty() ? bounds.getSize(tempSize) : new Vector3(2, 1, 4)
  const center = bounds && !bounds.isEmpty() ? bounds.getCenter(new Vector3()) : new Vector3(0, size.y * 0.5, 0)
  chassisGroup.position.set(0, 0, 0)

  if (camera) {
    const distance = Math.max(size.x, size.y, size.z) * 1.6
    camera.position.set(distance, distance, distance)
    orbitControls?.target.set(center.x, center.y, center.z)
  }
}

function rebuildHandles() {
  if (!chassisGroup) return
  connectionPointMeshes.forEach((mesh) => chassisGroup.remove(mesh))
  wheelPreviewMeshes.forEach((mesh) => previewScene?.remove(mesh))
  if (frontGroup) chassisGroup.remove(frontGroup)
  if (rearGroup) chassisGroup.remove(rearGroup)
  connectionPointMeshes = []
  wheelPreviewMeshes = []

  frontGroup = new Group()
  rearGroup = new Group()
  chassisGroup.add(frontGroup, rearGroup)

  const sphereGeo = new SphereGeometry(0.08, 14, 10)
  const frontColor = new Color('#4cc9f0')
  const rearColor = new Color('#5ad29c')
  const frontCenter = computeGroupCenter(true)
  const rearCenter = computeGroupCenter(false)
  frontGroup.position.copy(frontCenter)
  rearGroup.position.copy(rearCenter)

  const placeWheelMesh = (wheel: VehicleWheelProps, center: Vector3, targetGroup: Group | null, isFront: boolean) => {
    if (!targetGroup) return
    const localPos = new Vector3(
      wheel.chassisConnectionPointLocal.x - center.x,
      wheel.chassisConnectionPointLocal.y - center.y,
      wheel.chassisConnectionPointLocal.z - center.z,
    )
    const marker = new Mesh(
      sphereGeo,
      new MeshStandardMaterial({ color: isFront ? frontColor : rearColor }),
    )
    marker.position.copy(localPos)
    marker.userData.wheelId = wheel.id
    marker.userData.isFront = isFront
    connectionPointMeshes.push(marker)
    targetGroup.add(marker)

    const wheelMesh = new Mesh(
      new SphereGeometry(Math.max(1e-3, wheel.radius), 18, 12),
      new MeshStandardMaterial({
        color: isFront ? frontColor : rearColor,
        wireframe: true,
        opacity: 0.7,
        transparent: true,
      }),
    )
    wheelMesh.userData.wheelId = wheel.id
    wheelPreviewMeshes.push(wheelMesh)
    previewScene?.add(wheelMesh)
  }

  wheelEntries.value.forEach((wheel) => {
    const isFront = wheel.isFrontWheel
    placeWheelMesh(wheel, isFront ? frontCenter : rearCenter, isFront ? frontGroup : rearGroup, isFront)
  })

  uiState.spacing = computeUniformSpacing()
  attachActiveHandle()
  updateWheelPreviewMeshesFromRestPose(chassisPreviewBaseY)
}

function computeGroupCenter(isFront: boolean): Vector3 {
  const group = wheelEntries.value.filter((wheel) => wheel.isFrontWheel === isFront)
  if (!group.length) return new Vector3()
  const accum = new Vector3()
  group.forEach((wheel) => {
    accum.x += wheel.chassisConnectionPointLocal.x
    accum.y += wheel.chassisConnectionPointLocal.y
    accum.z += wheel.chassisConnectionPointLocal.z
  })
  accum.multiplyScalar(1 / group.length)
  return accum
}

function computeGroupSpacing(isFront: boolean): number {
  const group = wheelEntries.value.filter((wheel) => wheel.isFrontWheel === isFront)
  if (!group.length) return 0
  const axis = rightAxisIndex.value
  const maxAbs = Math.max(...group.map((wheel) => Math.abs(getAxisValue(wheel.chassisConnectionPointLocal, axis))))
  return Number((maxAbs * 2).toFixed(3))
}

function computeUniformSpacing(): number {
  if (!wheelEntries.value.length) return 0
  const axis = rightAxisIndex.value
  const maxAbs = Math.max(...wheelEntries.value.map((wheel) => Math.abs(getAxisValue(wheel.chassisConnectionPointLocal, axis))))
  return Number((maxAbs * 2).toFixed(3))
}

function attachActiveHandle() {
  if (!transformControls || !chassisGroup) return
  transformControls.detach()
  const target = activeHandle.value === 'front' ? frontGroup : rearGroup
  if (target) {
    transformControls.attach(target)
  }
}

function alignAxlesVertical() {
  const frontCenter = computeGroupCenter(true)
  const rearCenter = computeGroupCenter(false)
  const targetY = (frontCenter.y + rearCenter.y) * 0.5
  const shiftGroupY = (isFront: boolean, center: Vector3) => {
    const delta = targetY - center.y
    patchGroupWheels(isFront, (wheel) => ({
      ...wheel,
      chassisConnectionPointLocal: {
        ...wheel.chassisConnectionPointLocal,
        y: wheel.chassisConnectionPointLocal.y + delta,
      },
    }))
  }
  shiftGroupY(true, frontCenter)
  shiftGroupY(false, rearCenter)
}

function alignAxlesHorizontal() {
  const frontCenter = computeGroupCenter(true)
  const rearCenter = computeGroupCenter(false)
  const targetZ = (frontCenter.z + rearCenter.z) * 0.5
  const shiftGroupZ = (isFront: boolean, center: Vector3) => {
    const delta = targetZ - center.z
    patchGroupWheels(isFront, (wheel) => ({
      ...wheel,
      chassisConnectionPointLocal: {
        ...wheel.chassisConnectionPointLocal,
        z: wheel.chassisConnectionPointLocal.z + delta,
      },
    }))
  }
  shiftGroupZ(true, frontCenter)
  shiftGroupZ(false, rearCenter)
}

function equalizeTrackWidth() {
  const front = computeGroupSpacing(true)
  const rear = computeGroupSpacing(false)
  handleSpacingChange(Math.max(front, rear))
}

function handleHandleMove() {
  if (!transformControls || !chassisGroup || !transformControls.object) return
  applyHandleDelta(transformControls.object === frontGroup)
}

function handleHandleCommit() {
  handleHandleMove()
}

function applyHandleDelta(isFront: boolean) {
  if (!chassisGroup) return
  const updates = new Map<string, Vector3>()
  connectionPointMeshes
    .filter((mesh) => mesh.userData?.isFront === isFront && mesh.userData?.wheelId)
    .forEach((mesh) => {
      const worldPos = mesh.getWorldPosition(new Vector3())
      chassisGroup?.worldToLocal(worldPos)
      updates.set(mesh.userData.wheelId as string, worldPos.clone())
    })
  patchGroupWheels(isFront, (wheel) => {
    const next = updates.get(wheel.id)
    if (!next) return wheel
    return {
      ...wheel,
      chassisConnectionPointLocal: { x: next.x, y: next.y, z: next.z },
    }
  })
}

function patchGroupWheels(isFront: boolean, mutator: (wheel: VehicleWheelProps) => VehicleWheelProps) {
  const component = vehicleComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) return
  const current = clampVehicleComponentProps(component.props as VehicleComponentProps)
  sceneStore.updateNodeComponentProps(
    nodeId,
    component.id,
    { wheels: current.wheels.map((wheel) => (wheel.isFrontWheel === isFront ? mutator(wheel) : wheel)) },
  )
}

function patchAllWheels(mutator: (wheel: VehicleWheelProps) => VehicleWheelProps) {
  const component = vehicleComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) return
  const current = clampVehicleComponentProps(component.props as VehicleComponentProps)
  sceneStore.updateNodeComponentProps(nodeId, component.id, { wheels: current.wheels.map((wheel) => mutator(wheel)) })
}

const numericControls: Array<{ key: keyof VehicleWheelProps; label: string; min: number; max: number; step: number }> = [
  { key: 'radius', label: 'Radius (m)', min: 0, max: 5, step: 0.01 },
  { key: 'suspensionRestLength', label: 'Rest Length (m)', min: 0, max: 2, step: 0.01 },
  { key: 'suspensionStiffness', label: 'Stiffness (N/m)', min: 0, max: 200, step: 0.5 },
  { key: 'dampingRelaxation', label: 'Damping Relax (ratio)', min: 0, max: 50, step: 0.1 },
  { key: 'dampingCompression', label: 'Damping Compress (ratio)', min: 0, max: 50, step: 0.1 },
  { key: 'frictionSlip', label: 'Friction (ratio)', min: 0, max: 20, step: 0.05 },
  { key: 'maxSuspensionTravel', label: 'Travel (m)', min: 0, max: 2, step: 0.01 },
  { key: 'maxSuspensionForce', label: 'Max Force (N)', min: 0, max: 200000, step: 100 },
  { key: 'rollInfluence', label: 'Roll Influence (ratio)', min: 0, max: 5, step: 0.01 },
  { key: 'customSlidingRotationalSpeed', label: 'Custom Rot Speed (rad/s)', min: -50, max: 50, step: 0.1 },
]

function getWheelValue(key: keyof VehicleWheelProps): number {
  const wheels = wheelEntries.value
  if (!wheels.length) return 0
  const value = wheels[0]![key]
  return typeof value === 'number' ? value : 0
}

function handleNumericChange(key: keyof VehicleWheelProps, value: number) {
  if (!Number.isFinite(value)) return
  patchAllWheels((wheel) => ({ ...wheel, [key]: value }))
}

function handleNumericTextChange(key: keyof VehicleWheelProps, value: string | number) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return
  handleNumericChange(key, parsed)
}

function handleSpacingChange(value: number) {
  if (!Number.isFinite(value) || isDisabled.value) return
  const width = Math.max(0, value)
  const halfSpacing = width * 0.5
  const axis = rightAxisIndex.value
  const updates = new Map<string, number>()

  const captureGroupSpacing = (isFront: boolean) => {
    const group = wheelEntries.value.filter((wheel) => wheel.isFrontWheel === isFront)
    if (!group.length) return
    const centerAxis = group.reduce((sum, wheel) => sum + getAxisValue(wheel.chassisConnectionPointLocal, axis), 0) / group.length
    const sorted = [...group].sort(
      (a, b) => getAxisValue(a.chassisConnectionPointLocal, axis) - getAxisValue(b.chassisConnectionPointLocal, axis),
    )
    sorted.forEach((wheel, index) => {
      const current = getAxisValue(wheel.chassisConnectionPointLocal, axis)
      let sign = Math.sign(current - centerAxis)
      if (sign === 0) {
        if (sorted.length <= 1) {
          sign = 0
        } else if (sorted.length === 2) {
          sign = index === 0 ? -1 : 1
        } else {
          sign = index < sorted.length / 2 ? -1 : 1
        }
      }
      updates.set(wheel.id, centerAxis + sign * halfSpacing)
    })
  }

  captureGroupSpacing(true)
  captureGroupSpacing(false)

  patchAllWheels((wheel) => {
    const nextAxis = updates.get(wheel.id)
    if (nextAxis === undefined) return wheel
    return {
      ...wheel,
      chassisConnectionPointLocal: setAxisValue(wheel.chassisConnectionPointLocal, axis, nextAxis),
    }
  })
  uiState.spacing = width
}

function handleSpacingInputChange(value: string | number) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return
  handleSpacingChange(parsed)
}

function getRigidbodyPreviewProps(): RigidbodyComponentProps {
  const node = selectedNode.value
  const rigidbodyComponent = node?.components?.[RIGIDBODY_COMPONENT_TYPE] as SceneNodeComponentState<RigidbodyComponentProps> | undefined
  return clampRigidbodyComponentProps(rigidbodyComponent?.props ?? null)
}

async function ensurePreviewPhysicsBridgeReady(): Promise<PhysicsBridge> {
  if (physicsBridgeInitPromise) {
    return physicsBridgeInitPromise
  }
  const bridge = physicsBridge ?? createScenePreviewPhysicsBridge()
  physicsBridge = bridge
  physicsBridgeInitPromise = bridge.init({
    world: {
      gravity: [0, -9.82, 0],
      fixedTimeStepMs: 1000 / 60,
      maxSubSteps: 4,
    },
  }).then(() => bridge)
    .catch((error) => {
      physicsBridgeInitPromise = null
      console.warn('[VehicleSuspensionEditorDialog] Failed to initialize physics bridge', error)
      throw error
    })
  return physicsBridgeInitPromise
}

async function rebuildPhysics() {
  if (!chassisGroup) return
  const requestId = ++physicsSceneRequestId
  const bridge = await ensurePreviewPhysicsBridgeReady().catch((error) => {
    loadError.value = error instanceof Error ? error.message : 'Failed to initialize physics preview.'
    return null
  })
  if (!bridge || requestId !== physicsSceneRequestId) {
    return
  }

  physicsSceneLoaded = false
  physicsStepInFlight = false
  pendingPhysicsDeltaMs = 0
  const collider = resolveChassisColliderShape()
  const baseY = Math.max(0.05, collider.halfHeight - collider.offset[1]) + 0.3
  chassisPreviewBaseY = baseY

  if (chassisBodyMesh) {
    chassisGroup.remove(chassisBodyMesh)
  }
  chassisBodyMesh = buildChassisVisualMesh(
    collider,
    new MeshStandardMaterial({ color: '#4c7dff', transparent: true, opacity: 0.16, roughness: 0.6, metalness: 0 }),
  )
  if (chassisBodyMesh) {
    chassisGroup.add(chassisBodyMesh)
  }

  chassisGroup.position.set(0, baseY, 0)
  chassisGroup.quaternion.identity()
  chassisGroup.updateMatrixWorld(true)
  updateWheelPreviewMeshesFromRestPose(baseY)

  try {
    await bridge.loadScene(buildPreviewPhysicsSceneAsset(collider, baseY))
    if (requestId !== physicsSceneRequestId) {
      return
    }
    loadError.value = null
    physicsSceneLoaded = true
  } catch (error) {
    if (requestId !== physicsSceneRequestId) {
      return
    }
    loadError.value = error instanceof Error ? error.message : 'Failed to load physics preview.'
    console.warn('[VehicleSuspensionEditorDialog] Failed to rebuild physics preview', error)
  }
}

function buildPreviewPhysicsSceneAsset(collider: ChassisColliderInfo, baseY: number): PhysicsSceneAsset {
  const rigidbodyProps = getRigidbodyPreviewProps()
  return {
    format: 'harmony-physics',
    version: 1,
    materials: [
      { id: PREVIEW_GROUND_MATERIAL_ID, friction: 1, restitution: 0 },
      { id: PREVIEW_CHASSIS_MATERIAL_ID, friction: rigidbodyProps.friction, restitution: rigidbodyProps.restitution },
    ],
    shapes: [
      {
        id: PREVIEW_GROUND_SHAPE_ID,
        kind: 'box',
        halfExtents: [40, 0.5, 40],
      },
      ...collider.shapeDescriptors,
    ],
    bodies: [
      {
        id: PREVIEW_GROUND_BODY_ID,
        type: 'static',
        mass: 0,
        materialId: PREVIEW_GROUND_MATERIAL_ID,
        shapeId: PREVIEW_GROUND_SHAPE_ID,
        transform: {
          position: [0, -0.5, 0],
          rotation: IDENTITY_ROTATION,
        },
      },
      {
        id: PREVIEW_CHASSIS_BODY_ID,
        type: 'dynamic',
        mass: Math.max(1, rigidbodyProps.mass || 600),
        materialId: PREVIEW_CHASSIS_MATERIAL_ID,
        shapeId: collider.rootShapeId,
        transform: {
          position: [0, baseY, 0],
          rotation: IDENTITY_ROTATION,
        },
        linearDamping: rigidbodyProps.linearDamping,
        angularDamping: rigidbodyProps.angularDamping,
      },
    ],
    vehicles: [
      {
        id: PREVIEW_VEHICLE_ID,
        bodyId: PREVIEW_CHASSIS_BODY_ID,
        indexRightAxis: normalizeAxisIndex(normalizedProps.value.indexRightAxis),
        indexUpAxis: normalizeAxisIndex(normalizedProps.value.indexUpAxis),
        indexForwardAxis: normalizeAxisIndex(normalizedProps.value.indexForwardAxis),
        wheels: wheelEntries.value.map((wheel, index) => ({
          id: index + 1,
          radius: Math.max(1e-3, wheel.radius),
          isFrontWheel: wheel.isFrontWheel,
          connectionPoint: toPhysicsVector3(
            wheel.chassisConnectionPointLocal.x,
            wheel.chassisConnectionPointLocal.y,
            wheel.chassisConnectionPointLocal.z,
          ),
          direction: toPhysicsVector3(wheel.directionLocal.x, wheel.directionLocal.y, wheel.directionLocal.z),
          axle: toPhysicsVector3(wheel.axleLocal.x, wheel.axleLocal.y, wheel.axleLocal.z),
          suspensionRestLength: Math.max(1e-3, wheel.suspensionRestLength),
          suspensionStiffness: Math.max(0, wheel.suspensionStiffness),
          dampingRelaxation: Math.max(0, wheel.dampingRelaxation),
          dampingCompression: Math.max(0, wheel.dampingCompression),
          frictionSlip: Math.max(1e-3, wheel.frictionSlip),
          rollInfluence: Math.max(0, wheel.rollInfluence),
          maxSuspensionTravel: Math.max(0, wheel.maxSuspensionTravel),
          maxSuspensionForce: Math.max(0, wheel.maxSuspensionForce),
        })),
      },
    ],
  }
}

function updateWheelPreviewMeshesFromRestPose(baseY: number) {
  if (!chassisGroup) return
  chassisGroup.position.set(0, baseY, 0)
  chassisGroup.quaternion.identity()
  chassisGroup.updateMatrixWorld(true)
  wheelEntries.value.forEach((wheel, index) => {
    const wheelMesh = wheelPreviewMeshes[index]
    if (!wheelMesh) return
    tempWheelDirection.set(wheel.directionLocal.x, wheel.directionLocal.y, wheel.directionLocal.z)
    if (tempWheelDirection.lengthSq() < 1e-6) {
      tempWheelDirection.set(0, -1, 0)
    } else {
      tempWheelDirection.normalize()
    }
    tempWheelLocalPosition.set(
      wheel.chassisConnectionPointLocal.x,
      wheel.chassisConnectionPointLocal.y,
      wheel.chassisConnectionPointLocal.z,
    ).addScaledVector(tempWheelDirection, wheel.suspensionRestLength)
    tempWheelWorldPosition.copy(tempWheelLocalPosition)
    chassisGroup.localToWorld(tempWheelWorldPosition)
    wheelMesh.position.copy(tempWheelWorldPosition)
    wheelMesh.quaternion.identity()
  })
}

function queuePreviewPhysicsStep(deltaMs: number) {
  pendingPhysicsDeltaMs += Math.max(0, deltaMs)
  flushPreviewPhysicsStep()
}

function flushPreviewPhysicsStep() {
  const bridge = physicsBridge
  if (!bridge || !physicsSceneLoaded || physicsStepInFlight || pendingPhysicsDeltaMs <= 0) {
    return
  }
  const deltaMs = pendingPhysicsDeltaMs
  pendingPhysicsDeltaMs = 0
  physicsStepInFlight = true
  void bridge.step(deltaMs)
    .then((frame) => {
      if (bridge !== physicsBridge || !physicsSceneLoaded) {
        return
      }
      applyPhysicsStepFrame(frame)
    })
    .catch((error) => {
      if (bridge !== physicsBridge) {
        return
      }
      loadError.value = error instanceof Error ? error.message : 'Failed to step physics preview.'
      console.warn('[VehicleSuspensionEditorDialog] Failed to step physics preview', error)
    })
    .finally(() => {
      if (bridge !== physicsBridge) {
        return
      }
      physicsStepInFlight = false
      if (pendingPhysicsDeltaMs > 0) {
        queueMicrotask(() => flushPreviewPhysicsStep())
      }
    })
}

function applyPhysicsStepFrame(frame: PhysicsStepFrame) {
  if (chassisGroup && frame.bodyMeta) {
    for (let index = 0; index < frame.bodyCount; index += 1) {
      if (frame.bodyMeta[index] !== PREVIEW_CHASSIS_BODY_ID) {
        continue
      }
      const base = index * PHYSICS_BODY_TRANSFORM_STRIDE
      chassisGroup.position.set(
        frame.bodyTransforms[base] ?? 0,
        frame.bodyTransforms[base + 1] ?? chassisPreviewBaseY,
        frame.bodyTransforms[base + 2] ?? 0,
      )
      chassisGroup.quaternion.set(
        frame.bodyTransforms[base + 3] ?? 0,
        frame.bodyTransforms[base + 4] ?? 0,
        frame.bodyTransforms[base + 5] ?? 0,
        frame.bodyTransforms[base + 6] ?? 1,
      ).normalize()
      chassisGroup.updateMatrixWorld(true)
      break
    }
  }
  for (let index = 0; index < frame.wheelCount; index += 1) {
    const base = index * PHYSICS_WHEEL_TRANSFORM_STRIDE
    if ((frame.wheelTransforms[base] ?? 0) !== PREVIEW_VEHICLE_ID) {
      continue
    }
    const wheelIndex = frame.wheelTransforms[base + 1] ?? -1
    const wheelMesh = wheelPreviewMeshes[wheelIndex]
    if (!wheelMesh) {
      continue
    }
    wheelMesh.position.set(
      frame.wheelTransforms[base + 2] ?? 0,
      frame.wheelTransforms[base + 3] ?? 0,
      frame.wheelTransforms[base + 4] ?? 0,
    )
    wheelMesh.quaternion.set(
      frame.wheelTransforms[base + 5] ?? 0,
      frame.wheelTransforms[base + 6] ?? 0,
      frame.wheelTransforms[base + 7] ?? 0,
      frame.wheelTransforms[base + 8] ?? 1,
    ).normalize()
  }
}

function wrapChassisShapeWithOffset(baseShape: PhysicsShapeDesc, offset: PhysicsVector3): {
  descriptors: PhysicsShapeDesc[]
  rootShapeId: number
} {
  if (isZeroPhysicsVector(offset)) {
    return {
      descriptors: [baseShape],
      rootShapeId: baseShape.id,
    }
  }
  const child: PhysicsCompoundChildDesc = {
    shapeId: baseShape.id,
    transform: {
      position: offset,
      rotation: IDENTITY_ROTATION,
    },
  }
  return {
    descriptors: [
      baseShape,
      {
        id: PREVIEW_CHASSIS_COMPOUND_SHAPE_ID,
        kind: 'compound',
        children: [child],
      },
    ],
    rootShapeId: PREVIEW_CHASSIS_COMPOUND_SHAPE_ID,
  }
}

function resolveChassisColliderShape(): ChassisColliderInfo {
  const node = selectedNode.value
  const defaultCollider = buildFallbackCollider()
  if (!node || !node.components) return defaultCollider

  const rigidbodyComponent = node.components[RIGIDBODY_COMPONENT_TYPE] as SceneNodeComponentState<RigidbodyComponentProps> | undefined
  const metadataShape = (rigidbodyComponent?.metadata?.[RIGIDBODY_METADATA_KEY] as RigidbodyComponentMetadata | undefined)?.shape
  if (!metadataShape) {
    return defaultCollider
  }

  const scale = resolveNodeScaleFactors(node)
  const makeOffset = (raw?: [number, number, number] | null): PhysicsVector3 => {
    const nx = raw?.[0] ?? 0
    const ny = raw?.[1] ?? 0
    const nz = raw?.[2] ?? 0
    return metadataShape.applyScale
      ? [nx * scale.x, ny * scale.y, nz * scale.z]
      : [nx, ny, nz]
  }
  const offset = makeOffset((metadataShape as { offset?: [number, number, number] | null }).offset)

  const resolveBox = (shape: Extract<RigidbodyPhysicsShape, { kind: 'box' }>): ChassisColliderInfo => {
    const halfExtents = toPhysicsVector3(
      Math.max(1e-4, shape.applyScale ? shape.halfExtents[0] * scale.x : shape.halfExtents[0]),
      Math.max(1e-4, shape.applyScale ? shape.halfExtents[1] * scale.y : shape.halfExtents[1]),
      Math.max(1e-4, shape.applyScale ? shape.halfExtents[2] * scale.z : shape.halfExtents[2]),
    )
    const wrapped = wrapChassisShapeWithOffset({
      id: PREVIEW_CHASSIS_SHAPE_ID,
      kind: 'box',
      halfExtents,
    }, offset)
    return {
      shapeDescriptors: wrapped.descriptors,
      rootShapeId: wrapped.rootShapeId,
      halfHeight: halfExtents[1],
      offset,
      visual: { kind: 'box', halfExtents },
    }
  }

  const resolveSphere = (shape: Extract<RigidbodyPhysicsShape, { kind: 'sphere' }>): ChassisColliderInfo => {
    const safeRadius = Math.max(1e-4, shape.applyScale ? shape.radius * Math.max(scale.x, scale.y, scale.z) : shape.radius)
    const wrapped = wrapChassisShapeWithOffset({
      id: PREVIEW_CHASSIS_SHAPE_ID,
      kind: 'sphere',
      radius: safeRadius,
    }, offset)
    return {
      shapeDescriptors: wrapped.descriptors,
      rootShapeId: wrapped.rootShapeId,
      halfHeight: safeRadius,
      offset,
      visual: { kind: 'sphere', radius: safeRadius },
    }
  }

  const resolveCylinder = (shape: Extract<RigidbodyPhysicsShape, { kind: 'cylinder' }>): ChassisColliderInfo => {
    const horizontalScale = Math.max(scale.x, scale.z)
    const radiusTop = Math.max(1e-4, shape.applyScale ? shape.radiusTop * horizontalScale : shape.radiusTop)
    const radiusBottom = Math.max(1e-4, shape.applyScale ? shape.radiusBottom * horizontalScale : shape.radiusBottom)
    const height = Math.max(1e-4, shape.applyScale ? shape.height * scale.y : shape.height)
    const wrapped = wrapChassisShapeWithOffset({
      id: PREVIEW_CHASSIS_SHAPE_ID,
      kind: 'cylinder',
      radiusTop,
      radiusBottom,
      height,
      segments: Math.max(4, shape.segments ?? 16),
    }, offset)
    return {
      shapeDescriptors: wrapped.descriptors,
      rootShapeId: wrapped.rootShapeId,
      halfHeight: height * 0.5,
      offset,
      visual: { kind: 'cylinder', radiusTop, radiusBottom, height },
    }
  }

  const resolveConvex = (shape: Extract<RigidbodyPhysicsShape, { kind: 'convex' }>): ChassisColliderInfo => {
    const vertices = (shape.vertices ?? []).map(([x, y, z]) => ([
      shape.applyScale ? x * scale.x : x,
      shape.applyScale ? y * scale.y : y,
      shape.applyScale ? z * scale.z : z,
    ] as PhysicsVector3))
    if (!vertices.length) {
      return defaultCollider
    }
    const bounds = vertices.reduce(
      (acc, vertex) => {
        acc.min.x = Math.min(acc.min.x, vertex[0])
        acc.min.y = Math.min(acc.min.y, vertex[1])
        acc.min.z = Math.min(acc.min.z, vertex[2])
        acc.max.x = Math.max(acc.max.x, vertex[0])
        acc.max.y = Math.max(acc.max.y, vertex[1])
        acc.max.z = Math.max(acc.max.z, vertex[2])
        return acc
      },
      { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) },
    )
    const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5)
    const hullVertices = new Float32Array(vertices.length * 3)
    vertices.forEach((vertex, index) => {
      hullVertices[index * 3] = vertex[0] - center.x
      hullVertices[index * 3 + 1] = vertex[1] - center.y
      hullVertices[index * 3 + 2] = vertex[2] - center.z
    })
    const worldOffset = toPhysicsVector3(offset[0] + center.x, offset[1] + center.y, offset[2] + center.z)
    const wrapped = wrapChassisShapeWithOffset({
      id: PREVIEW_CHASSIS_SHAPE_ID,
      kind: 'convex-hull',
      vertices: hullVertices,
    }, worldOffset)
    return {
      shapeDescriptors: wrapped.descriptors,
      rootShapeId: wrapped.rootShapeId,
      halfHeight: Math.max(1e-4, (bounds.max.y - bounds.min.y) * 0.5),
      offset: worldOffset,
      visual: {
        kind: 'convex',
        size: new Vector3(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z),
      },
    }
  }

  switch (metadataShape.kind) {
    case 'box':
      return resolveBox(metadataShape)
    case 'sphere':
      return resolveSphere(metadataShape)
    case 'cylinder':
      return resolveCylinder(metadataShape)
    case 'convex':
      return resolveConvex(metadataShape)
    default:
      return defaultCollider
  }
}

function buildFallbackCollider(): ChassisColliderInfo {
  const bounds = previewModelGroup ? setBoundingBoxFromObject(previewModelGroup, tempBox.makeEmpty()) : null
  const size = bounds && !bounds.isEmpty() ? bounds.getSize(tempSize) : new Vector3(2, 1, 4)
  const center = bounds && !bounds.isEmpty() ? bounds.getCenter(new Vector3()) : new Vector3(0, size.y * 0.5, 0)
  const halfExtents = toPhysicsVector3(
    Math.max(0.1, size.x * 0.5),
    Math.max(0.1, size.y * 0.5),
    Math.max(0.1, size.z * 0.5),
  )
  const offset = toPhysicsVector3(center.x, center.y, center.z)
  const wrapped = wrapChassisShapeWithOffset({
    id: PREVIEW_CHASSIS_SHAPE_ID,
    kind: 'box',
    halfExtents,
  }, offset)
  return {
    shapeDescriptors: wrapped.descriptors,
    rootShapeId: wrapped.rootShapeId,
    halfHeight: halfExtents[1],
    offset,
    visual: { kind: 'box', halfExtents },
  }
}

function buildChassisVisualMesh(collider: ChassisColliderInfo, material: MeshStandardMaterial): Mesh | null {
  switch (collider.visual.kind) {
    case 'box': {
      const [hx, hy, hz] = collider.visual.halfExtents
      const mesh = new Mesh(new BoxGeometry(hx * 2, hy * 2, hz * 2), material)
      mesh.position.set(collider.offset[0], collider.offset[1], collider.offset[2])
      return mesh
    }
    case 'sphere': {
      const mesh = new Mesh(new SphereGeometry(collider.visual.radius, 24, 16), material)
      mesh.position.set(collider.offset[0], collider.offset[1], collider.offset[2])
      return mesh
    }
    case 'cylinder': {
      const mesh = new Mesh(new CylinderGeometry(collider.visual.radiusTop, collider.visual.radiusBottom, collider.visual.height, 24), material)
      mesh.position.set(collider.offset[0], collider.offset[1], collider.offset[2])
      return mesh
    }
    case 'convex': {
      const mesh = new Mesh(
        new BoxGeometry(
          Math.max(1e-4, collider.visual.size.x),
          Math.max(1e-4, collider.visual.size.y),
          Math.max(1e-4, collider.visual.size.z),
        ),
        material,
      )
      mesh.position.set(collider.offset[0], collider.offset[1], collider.offset[2])
      return mesh
    }
    default:
      return null
  }
}

function startRenderLoop() {
  if (!renderer || !previewScene || !camera) return
  const clock = new Clock()
  const renderLoop = () => {
    animationFrame = requestAnimationFrame(renderLoop)
    queuePreviewPhysicsStep(clock.getDelta() * 1000)
    orbitControls?.update()
    renderer?.render(previewScene, camera)
  }
  renderLoop()
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      nextTick(() => initPreview())
    } else {
      disposePreview()
    }
  },
  { immediate: true },
)

watch(
  () => wheelEntries.value,
  () => {
    if (!props.visible) return
    rebuildHandles()
    void rebuildPhysics()
  },
  { deep: true },
)

watch(
  () => selectedNodeId.value,
  () => {
    if (!props.visible) return
    rebuildModel()
    rebuildHandles()
    void rebuildPhysics()
  },
)

watch(activeHandle, () => attachActiveHandle())

onUnmounted(() => {
  disposePreview()
})
</script>

<template>
  <Teleport to="body">
    <transition name="fade-transition">
      <div
        v-if="visible && anchor"
        class="suspension-editor"
        :style="panelStyle"
      >
        <v-toolbar density="compact" class="suspension-editor__toolbar" height="40px">
          <div class="suspension-editor__title">Suspension Tuning</div>
          <v-spacer />
          <v-btn
            class="toolbar-close"
            icon="mdi-close"
            size="small"
            variant="text"
            @click="handleClose"
          />
        </v-toolbar>
        <v-divider />
        <div class="suspension-editor__body">
          <div class="suspension-editor__preview">
            <div class="suspension-editor__overlay">
              <v-btn-toggle
                v-model="activeHandle"
                mandatory
                density="compact"
                color="primary"
                class="suspension-editor__toggle"
              >
                <v-btn value="front" size="small">Front Group</v-btn>
                <v-btn value="rear" size="small">Rear Group</v-btn>
              </v-btn-toggle>
              <div class="suspension-editor__overlay-actions">
                <v-btn
                  size="small"
                  icon="mdi-align-vertical-center"
                  variant="tonal"
                  color="primary"
                  :disabled="isDisabled"
                  @click="alignAxlesVertical"
                />
                <v-btn
                  size="small"
                  icon="mdi-align-horizontal-center"
                  variant="tonal"
                  color="primary"
                  :disabled="isDisabled"
                  @click="alignAxlesHorizontal"
                />
                <v-btn
                  size="small"
                  icon="mdi-arrow-expand-horizontal"
                  variant="tonal"
                  color="primary"
                  :disabled="isDisabled"
                  @click="equalizeTrackWidth"
                >
                </v-btn>
              </div>
            </div>
            <div class="suspension-editor__canvas" ref="previewContainerRef">
              <div v-if="!isReady" class="suspension-editor__empty">Preparing preview…</div>
              <div v-if="loadError" class="suspension-editor__empty">{{ loadError }}</div>
            </div>
          </div>

          <div class="suspension-editor__controls">
            <div class="suspension-editor__section">
              <div class="suspension-editor__section-title">Wheel Settings</div>
              <div class="suspension-editor__control-row">
                <v-slider
                  class="suspension-editor__slider"
                  label="Wheel spacing (m)"
                  density="compact"
                  hide-details
                  :min="0"
                  :max="5"
                  :step="0.01"
                  :model-value="uiState.spacing"
                  :disabled="isDisabled"
                  @update:modelValue="(value) => handleSpacingChange(Number(value))"
                />
                <v-text-field
                  class="suspension-editor__input"
                  density="compact"
                  hide-details
                  variant="underlined"
                  type="number"
                  :step="0.01"
                  :min="0"
                  :max="5"
                  :model-value="uiState.spacing"
                  :disabled="isDisabled"
                  @update:modelValue="handleSpacingInputChange"
                />
              </div>
              <div class="suspension-editor__grid">
                <div
                  v-for="control in numericControls"
                  :key="`wheel-${control.key}`"
                  class="suspension-editor__control-row"
                >
                  <v-slider
                    class="suspension-editor__slider"
                    :label="control.label"
                    density="compact"
                    hide-details
                    thumb-label
                    :min="control.min"
                    :max="control.max"
                    :step="control.step"
                    :model-value="getWheelValue(control.key)"
                    :disabled="isDisabled"
                    @update:modelValue="(value) => handleNumericChange(control.key, Number(value))"
                  />
                  <v-text-field
                    class="suspension-editor__input"
                    density="compact"
                    hide-details
                    variant="underlined"
                    type="number"
                    :step="control.step"
                    :min="control.min"
                    :max="control.max"
                    :model-value="getWheelValue(control.key)"
                    :disabled="isDisabled"
                    @update:modelValue="(value) => handleNumericTextChange(control.key, value)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.suspension-editor {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(1180px, 90vw);
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

.suspension-editor__toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.suspension-editor__title {
  font-weight: 600;
  letter-spacing: 0.03em;
}

.suspension-editor__body {
  display: grid;
  grid-template-columns: 1.2fr 0.9fr;
  gap: 14px;
  padding: 12px;
  min-height: 520px;
}

.suspension-editor__preview {
  position: relative;
  min-height: 520px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  background: #06070b;
  overflow: hidden;
}

.suspension-editor__canvas {
  width: 100%;
  height: 100%;
  position: relative;
  min-height: 520px;
}

.suspension-editor__canvas canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}

.suspension-editor__overlay {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.6rem;
  border-radius: 10px;
  background: rgba(12, 14, 19, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(10px);
}

.suspension-editor__toggle {
  background: rgba(255, 255, 255, 0.02);
}

.suspension-editor__overlay-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.suspension-editor__hint {
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

.suspension-editor__controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 620px;
  overflow-y: auto;
  padding-right: 6px;
}

.suspension-editor__section {
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 10px 12px;
  background: rgba(10, 12, 16, 0.8);
}

.suspension-editor__section-title {
  font-weight: 600;
  letter-spacing: 0.02em;
  margin-bottom: 8px;
  color: rgba(233, 236, 241, 0.92);
}

.suspension-editor__grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.suspension-editor__control-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.suspension-editor__slider {
  flex: 1 1 auto;
}

.suspension-editor__input {
  width: 80px;
  max-width: 80px;
}

.suspension-editor__empty {
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
</style>
