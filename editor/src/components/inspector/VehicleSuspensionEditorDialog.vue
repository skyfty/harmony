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
  Quaternion,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from '@/utils/transformControls.js'
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'
import { createScenePreviewPhysicsBridge } from '@/physics/createScenePreviewPhysicsBridge'
import { getCachedModelObject } from '@schema/modelObjectCache'
import { setBoundingBoxFromObject } from '@/components/editor/sceneUtils'
import {
  VEHICLE_COMPONENT_TYPE,
  clampVehicleComponentProps,
  type VehicleComponentProps,
  type VehicleWheelProps,
  RIGIDBODY_COMPONENT_TYPE,
  RIGIDBODY_METADATA_KEY,
  type RigidbodyComponentProps,
  type RigidbodyComponentMetadata,
  type RigidbodyPhysicsShape,
} from '@schema/components'
import type {
  PhysicsBackendPreference,
  PhysicsBridge,
  PhysicsSceneAsset,
  PhysicsStepFrame,
} from '@harmony/physics-core'
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
const { selectedNode, selectedNodeId, environmentSettings } = storeToRefs(sceneStore)

const vehicleComponent = computed<SceneNodeComponentState<VehicleComponentProps> | null>(() => {
  const node = selectedNode.value
  if (!node) return null
  const component = node.components?.[VEHICLE_COMPONENT_TYPE]
  return (component as SceneNodeComponentState<VehicleComponentProps> | undefined) ?? null
})

const normalizedProps = computed(() => clampVehicleComponentProps(vehicleComponent.value?.props ?? null))
const wheelEntries = computed(() => normalizedProps.value.wheels ?? [])
const isDisabled = computed(() => !vehicleComponent.value?.enabled)
const panelStyle = computed(() => {
  // Center the dialog on screen; ignore anchor to avoid sitting too low.
  return {
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
  }
})

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
let previewVehicleRootGroup: Group | null = null
let chassisGroup: Group | null = null
let frontGroup: Group | null = null
let rearGroup: Group | null = null
let frontHandleGroup: Group | null = null
let rearHandleGroup: Group | null = null
let groundMesh: Mesh | null = null
let chassisBodyMesh: Mesh | null = null
let chassisShapeOffset: Vector3 | null = null
let connectionPointMeshes: Mesh[] = []
let resizeObserver: ResizeObserver | null = null
let animationFrame: number | null = null
let wheelPreviewMeshes: Mesh[] = []
let wheelRayMeshes: Mesh[] = []
let physicsBridge: PhysicsBridge | null = null
let physicsBridgeLoadPromise: Promise<void> | null = null
let physicsBridgeStepPromise: Promise<void> | null = null
let physicsBridgeLoadToken = 0
let physicsBridgeSceneLoaded = false
let physicsBridgeEnginePreference: PhysicsBackendPreference | undefined = undefined
let physicsBridgeGravityStrength = Number.NaN
let physicsBridgeBodyId = 0
let physicsBridgeVehicleId = 0
let physicsBridgeWheelCount = 0
let renderClock = new Clock()
const tempBox = new Box3()
const tempSize = new Vector3()
const tempQuaternion = new Quaternion()

type AxisIndex = 0 | 1 | 2

function normalizeAxisIndex(axis: number | undefined): AxisIndex {
  if (axis === 1) return 1
  if (axis === 2) return 2
  return 0
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

type PreviewChassisColliderInfo = {
  halfHeight: number
  offset: Vector3
  visual:
    | { kind: 'box'; halfExtents: Vector3 }
    | { kind: 'sphere'; radius: number }
    | { kind: 'cylinder'; radiusTop: number; radiusBottom: number; height: number }
    | { kind: 'convex'; size: Vector3; center: Vector3 }
  shape:
    | { kind: 'box'; halfExtents: [number, number, number] }
    | { kind: 'sphere'; radius: number }
    | { kind: 'cylinder'; radiusTop: number; radiusBottom: number; height: number; segments?: number }
    | { kind: 'convex-hull'; vertices: Float32Array; faces?: number[][] }
    | {
        kind: 'compound'
        children: Array<{
          shapeId: number
          transform: {
            position: [number, number, number]
            rotation: [number, number, number, number]
          }
        }>
      }
}

type PreviewPhysicsAsset = {
  asset: PhysicsSceneAsset
  chassisBodyId: number
  vehicleId: number | null
  wheelCount: number
}

const PREVIEW_GROUND_HALF_EXTENTS = new Vector3(30, 0.05, 30)
const PREVIEW_GROUND_HEIGHT = -0.05
const PREVIEW_FIXED_TIME_STEP_MS = 1000 / 60

function resolvePreviewPhysicsBackendPreference(): PhysicsBackendPreference | undefined {
  const preference = environmentSettings.value.physicsEngine
  return preference === 'ammo' || preference === 'cannon' || preference === 'auto'
    ? preference
    : undefined
}

function isZeroVector(value: Vector3, epsilon = 1e-6): boolean {
  return Math.abs(value.x) <= epsilon && Math.abs(value.y) <= epsilon && Math.abs(value.z) <= epsilon
}

function appendPhysicsShape(
  shapes: PhysicsSceneAsset['shapes'],
  shape: PreviewChassisColliderInfo['shape'],
): number {
  const id = shapes.length + 1
  shapes.push({ ...shape, id } as PhysicsSceneAsset['shapes'][number])
  return id
}

function applyWorldTransformToObject(
  object: Object3D,
  worldPosition: Vector3,
  worldQuaternion: Quaternion,
): void {
  if (object.parent) {
    object.parent.updateMatrixWorld(true)
    object.position.copy(worldPosition)
    object.parent.worldToLocal(object.position)
    object.parent.getWorldQuaternion(tempQuaternion).invert()
    object.quaternion.copy(tempQuaternion).multiply(worldQuaternion)
  } else {
    object.position.copy(worldPosition)
    object.quaternion.copy(worldQuaternion)
  }
  object.updateMatrixWorld(true)
}

function buildPreviewPhysicsSceneAsset(): PreviewPhysicsAsset | null {
  const node = selectedNode.value
  if (!node) {
    return null
  }

  const collider = resolveChassisColliderShape()
  const wheels = wheelEntries.value
  const shapes: PhysicsSceneAsset['shapes'] = []
  const bodies: PhysicsSceneAsset['bodies'] = []
  const vehicles: PhysicsSceneAsset['vehicles'] = []
  const identityRotation: [number, number, number, number] = [0, 0, 0, 1]

  const groundShapeId = appendPhysicsShape(shapes, {
    kind: 'box',
    halfExtents: [PREVIEW_GROUND_HALF_EXTENTS.x, PREVIEW_GROUND_HALF_EXTENTS.y, PREVIEW_GROUND_HALF_EXTENTS.z],
  })
  bodies.push({
    id: 1,
    type: 'static',
    mass: 0,
    materialId: null,
    shapeId: groundShapeId,
    transform: {
      position: [0, PREVIEW_GROUND_HEIGHT, 0],
      rotation: identityRotation,
    },
    userDataKey: '__vehicleSuspensionPreviewGround__',
  })

  const chassisShapeId = appendPhysicsShape(shapes, collider.shape)
  const offset = collider.offset
  let finalChassisShapeId = chassisShapeId
  if (!isZeroVector(offset)) {
    finalChassisShapeId = appendPhysicsShape(shapes, {
      kind: 'compound',
      children: [
        {
          shapeId: chassisShapeId,
          transform: {
            position: [offset.x, offset.y, offset.z],
            rotation: identityRotation,
          },
        },
      ],
    })
  }

  const chassisBodyId = 2
  const baseY = Math.max(0.05, collider.halfHeight - collider.offset.y) + 0.3
  bodies.push({
    id: chassisBodyId,
    type: 'dynamic',
    mass: 600,
    materialId: null,
    shapeId: finalChassisShapeId,
    transform: {
      position: [0, baseY, 0],
      rotation: identityRotation,
    },
    linearDamping: 0.01,
    angularDamping: 0.05,
    userDataKey: node.id,
  })

  if (wheels.length) {
    const vehicleId = 1
    vehicles.push({
      id: vehicleId,
      bodyId: chassisBodyId,
      indexRightAxis: normalizedProps.value.indexRightAxis as 0 | 1 | 2,
      indexUpAxis: normalizedProps.value.indexUpAxis as 0 | 1 | 2,
      indexForwardAxis: normalizedProps.value.indexForwardAxis as 0 | 1 | 2,
      maxSpeedKmh: normalizedProps.value.maxSpeedKmh,
      wheels: wheels.map((wheel, index) => ({
        id: index + 1,
        radius: wheel.radius,
        isFrontWheel: wheel.isFrontWheel,
        connectionPoint: [wheel.chassisConnectionPointLocal.x, wheel.chassisConnectionPointLocal.y, wheel.chassisConnectionPointLocal.z],
        direction: [wheel.directionLocal.x, wheel.directionLocal.y, wheel.directionLocal.z],
        axle: [wheel.axleLocal.x, wheel.axleLocal.y, wheel.axleLocal.z],
        suspensionRestLength: wheel.suspensionRestLength,
        suspensionStiffness: wheel.suspensionStiffness,
        dampingRelaxation: wheel.dampingRelaxation,
        dampingCompression: wheel.dampingCompression,
        frictionSlip: wheel.frictionSlip,
        rollInfluence: wheel.rollInfluence,
        maxSuspensionTravel: wheel.maxSuspensionTravel,
        maxSuspensionForce: wheel.maxSuspensionForce,
      })),
    })
    return {
      asset: {
        format: 'harmony-physics',
        materials: [],
        shapes,
        bodies,
        vehicles,
      },
      chassisBodyId,
      vehicleId,
      wheelCount: wheels.length,
    }
  }

  return {
    asset: {
      format: 'harmony-physics',
      materials: [],
      shapes,
      bodies,
      vehicles,
    },
    chassisBodyId,
    vehicleId: null,
    wheelCount: 0,
  }
}

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
  const scene = previewScene
  previewScene = null
  camera = null
  if (previewVehicleRootGroup) {
    scene?.remove(previewVehicleRootGroup)
  }
  previewVehicleRootGroup = null
  previewModelGroup = null
  chassisGroup = null
  frontGroup = null
  rearGroup = null
  frontHandleGroup = null
  rearHandleGroup = null
  if (groundMesh) {
    scene?.remove(groundMesh)
  }
  groundMesh = null
  if (chassisBodyMesh) {
    scene?.remove(chassisBodyMesh)
  }
  chassisBodyMesh = null
  chassisShapeOffset = null
  connectionPointMeshes = []
  wheelPreviewMeshes = []
  wheelRayMeshes = []
  disposePhysics()
  isReady.value = false
  loadError.value = null
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
  renderClock = new Clock()
}

function disposePhysics() {
  physicsBridgeLoadToken += 1
  physicsBridgeSceneLoaded = false
  physicsBridgeLoadPromise = null
  physicsBridgeStepPromise = null
  physicsBridgeBodyId = 0
  physicsBridgeVehicleId = 0
  physicsBridgeWheelCount = 0
  const bridge = physicsBridge
  physicsBridge = null
  physicsBridgeEnginePreference = undefined
  if (bridge) {
    void bridge.destroy().catch((error) => {
      console.warn('[VehicleSuspensionEditorDialog] Failed to destroy preview physics bridge', error)
    })
  }
  chassisShapeOffset = null
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
  dir.castShadow = false
  previewScene.add(ambient)
  previewScene.add(hemi)
  previewScene.add(dir)

  const groundMaterial = new MeshStandardMaterial({ color: '#cdd6e5', roughness: 0.9, metalness: 0 })
  groundMesh = new Mesh(new PlaneGeometry(60, 60), groundMaterial)
  groundMesh.rotation.x = -Math.PI / 2
  groundMesh.position.y = 0
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
    if (!event.value) {
      handleHandleCommit()
    }
  })
  previewScene.add(transformControls.getHelper())

  rebuildModel()
  rebuildHandles()
  rebuildPhysics()
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
  if (previewVehicleRootGroup) {
    previewScene.remove(previewVehicleRootGroup)
  }
  previewVehicleRootGroup = new Group()
  previewScene.add(previewVehicleRootGroup)
  chassisGroup = new Group()
  previewVehicleRootGroup.add(chassisGroup)

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
  chassisGroup.position.set(-center.x, -center.y, -center.z)
  previewVehicleRootGroup.position.set(0, 0, 0)
  previewVehicleRootGroup.quaternion.identity()

  if (camera) {
    const distance = Math.max(size.x, size.y, size.z) * 1.6
    camera.position.set(distance, distance, distance)
    orbitControls?.target.set(0, size.y * 0.5, 0)
  }
}

function rebuildHandles() {
  if (!chassisGroup) return
  connectionPointMeshes.forEach((mesh) => chassisGroup?.remove(mesh))
  wheelPreviewMeshes.forEach((mesh) => chassisGroup?.remove(mesh))
  wheelRayMeshes.forEach((mesh) => chassisGroup?.remove(mesh))
  if (frontGroup) chassisGroup.remove(frontGroup)
  if (rearGroup) chassisGroup.remove(rearGroup)
  connectionPointMeshes = []
  wheelPreviewMeshes = []
  wheelRayMeshes = []

  frontGroup = new Group()
  rearGroup = new Group()
  chassisGroup.add(frontGroup, rearGroup)

  const sphereGeo = new SphereGeometry(0.08, 14, 10)
  const rayGeo = new CylinderGeometry(0.02, 0.02, 1, 8, 1, false)
  const frontColor = new Color('#4cc9f0')
  const rearColor = new Color('#5ad29c')
  const rayMaterial = new MeshStandardMaterial({
    color: '#9fb4d0',
    transparent: true,
    opacity: 0.35,
    roughness: 0.8,
    metalness: 0,
  })

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
      new MeshStandardMaterial({ color: isFront ? frontColor : rearColor })
    )
    marker.position.copy(localPos)
    marker.userData.wheelId = wheel.id
    marker.userData.isFront = isFront
    connectionPointMeshes.push(marker)
    targetGroup.add(marker)

    const dir = new Vector3(wheel.directionLocal.x, wheel.directionLocal.y, wheel.directionLocal.z)
    if (dir.lengthSq() < 1e-6) {
      dir.set(0, -1, 0)
    } else {
      dir.normalize()
    }
    const centerPos = localPos.clone().addScaledVector(dir, wheel.suspensionRestLength)
    const rayCenter = localPos.clone().add(centerPos).multiplyScalar(0.5)

    const wheelMesh = new Mesh(
      new SphereGeometry(Math.max(1e-3, wheel.radius), 18, 12),
      new MeshStandardMaterial({
        color: isFront ? frontColor : rearColor,
        wireframe: true,
        opacity: 0.7,
        transparent: true,
      })
    )
    wheelMesh.position.copy(centerPos)
    wheelMesh.userData.wheelId = wheel.id
    wheelPreviewMeshes.push(wheelMesh)
    targetGroup.add(wheelMesh)

    const rayMesh = new Mesh(rayGeo, rayMaterial)
    rayMesh.position.copy(rayCenter)
    rayMesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
    rayMesh.scale.set(1, Math.max(1e-4, wheel.suspensionRestLength), 1)
    rayMesh.userData.wheelId = wheel.id
    wheelRayMeshes.push(rayMesh)
    targetGroup.add(rayMesh)
  }

  wheelEntries.value.forEach((wheel) => {
    const isFront = wheel.isFrontWheel
    placeWheelMesh(wheel, isFront ? frontCenter : rearCenter, isFront ? frontGroup : rearGroup, isFront)
  })

  if (frontHandleGroup) {
    chassisGroup.remove(frontHandleGroup)
  }
  if (rearHandleGroup) {
    chassisGroup.remove(rearHandleGroup)
  }
  frontHandleGroup = new Group()
  rearHandleGroup = new Group()
  frontHandleGroup.visible = false
  rearHandleGroup.visible = false
  frontHandleGroup.position.copy(frontCenter)
  rearHandleGroup.position.copy(rearCenter)
  chassisGroup.add(frontHandleGroup, rearHandleGroup)

  uiState.spacing = computeUniformSpacing()
  attachActiveHandle()
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
  const target = activeHandle.value === 'front' ? frontHandleGroup : rearHandleGroup
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
  const target = Math.max(front, rear)
  handleSpacingChange(target)
}

function handleHandleMove() {
  if (!transformControls || !chassisGroup || !transformControls.object) return
  const target = transformControls.object
  const isFront = target === frontHandleGroup
  if (!isFront && target !== rearHandleGroup) return
  applyHandleDelta(isFront)
}

function handleHandleCommit() {
  // Only commit wheel positions after releasing the mouse to avoid mid-drag writes.
  handleHandleMove()
}

function applyHandleDelta(isFront: boolean) {
  const visualGroup = isFront ? frontGroup : rearGroup
  const handleGroup = isFront ? frontHandleGroup : rearHandleGroup
  if (!visualGroup || !handleGroup) return
  const delta = handleGroup.position.clone().sub(visualGroup.position)
  if (delta.lengthSq() <= 1e-12) {
    return
  }

  patchGroupWheels(isFront, (wheel) => ({
    ...wheel,
    chassisConnectionPointLocal: {
      x: wheel.chassisConnectionPointLocal.x + delta.x,
      y: wheel.chassisConnectionPointLocal.y + delta.y,
      z: wheel.chassisConnectionPointLocal.z + delta.z,
    },
  }))
}

function patchGroupWheels(isFront: boolean, mutator: (wheel: VehicleWheelProps) => VehicleWheelProps) {
  const component = vehicleComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) return
  const current = clampVehicleComponentProps(component.props as VehicleComponentProps)
  const next = current.wheels.map((wheel) => (wheel.isFrontWheel === isFront ? mutator(wheel) : wheel))
  sceneStore.updateNodeComponentProps(nodeId, component.id, { wheels: next })
}

function patchAllWheels(mutator: (wheel: VehicleWheelProps) => VehicleWheelProps) {
  const component = vehicleComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) return
  const current = clampVehicleComponentProps(component.props as VehicleComponentProps)
  const next = current.wheels.map((wheel) => mutator(wheel))
  sceneStore.updateNodeComponentProps(nodeId, component.id, { wheels: next })
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

async function ensurePreviewPhysicsBridge(): Promise<PhysicsBridge | null> {
  const desiredEngine = resolvePreviewPhysicsBackendPreference()
  if (physicsBridge && physicsBridgeEnginePreference === desiredEngine) {
    const currentGravityStrength = Number(environmentSettings.value.gravityStrength)
    const normalizedGravityStrength = Number.isFinite(currentGravityStrength) ? Math.max(0.01, currentGravityStrength) : 9.82
    if (Math.abs(physicsBridgeGravityStrength - normalizedGravityStrength) <= 1e-6) {
      return physicsBridge
    }
  }

  const previousBridge = physicsBridge
  physicsBridge = null
  physicsBridgeSceneLoaded = false
  physicsBridgeLoadPromise = null
  physicsBridgeStepPromise = null
  physicsBridgeLoadToken += 1
  physicsBridgeBodyId = 0
  physicsBridgeVehicleId = 0
  physicsBridgeWheelCount = 0
  physicsBridgeGravityStrength = Number.NaN

  if (previousBridge) {
    try {
      await previousBridge.destroy()
    } catch (error) {
      console.warn('[VehicleSuspensionEditorDialog] Failed to destroy previous physics bridge', error)
    }
  }

  physicsBridgeEnginePreference = desiredEngine
  const bridge = createScenePreviewPhysicsBridge({ engine: desiredEngine })
  const gravityStrength = Number(environmentSettings.value.gravityStrength)
  const gravityY = Number.isFinite(gravityStrength) ? Math.max(0.01, gravityStrength) : 9.82
  try {
    await bridge.init({
      world: {
        gravity: [0, -gravityY, 0],
        fixedTimeStepMs: PREVIEW_FIXED_TIME_STEP_MS,
        maxSubSteps: 4,
      },
    })
  } catch (error) {
    physicsBridgeEnginePreference = undefined
    console.warn('[VehicleSuspensionEditorDialog] Failed to initialize physics bridge', error)
    loadError.value = error instanceof Error ? error.message : 'Failed to initialize physics preview'
    return null
  }

  physicsBridge = bridge
  physicsBridgeGravityStrength = gravityY
  return bridge
}

async function reloadPreviewPhysics(): Promise<void> {
  if (!previewScene || !previewVehicleRootGroup || !chassisGroup) {
    return
  }
  const preview = buildPreviewPhysicsSceneAsset()
  if (!preview) {
    physicsBridgeSceneLoaded = false
    return
  }

  const bridge = await ensurePreviewPhysicsBridge()
  if (!bridge) {
    physicsBridgeSceneLoaded = false
    return
  }

  const loadToken = ++physicsBridgeLoadToken
  physicsBridgeSceneLoaded = false
  physicsBridgeBodyId = preview.chassisBodyId
  physicsBridgeVehicleId = preview.vehicleId ?? 0
  physicsBridgeWheelCount = preview.wheelCount
  loadError.value = null

  const loadPromise = bridge.loadScene(preview.asset)
    .then(() => {
      if (loadToken === physicsBridgeLoadToken) {
        physicsBridgeSceneLoaded = true
      }
    })
    .catch((error) => {
      if (loadToken === physicsBridgeLoadToken) {
        physicsBridgeSceneLoaded = false
        loadError.value = error instanceof Error ? error.message : 'Failed to load physics preview'
      }
      console.warn('[VehicleSuspensionEditorDialog] Failed to load preview physics scene', error)
    })
    .finally(() => {
      if (loadToken === physicsBridgeLoadToken) {
        physicsBridgeLoadPromise = null
      }
    })

  physicsBridgeLoadPromise = loadPromise
  await loadPromise
}

function rebuildPhysics() {
  if (!chassisGroup) return
  const collider = resolveChassisColliderShape()
  if (chassisBodyMesh) {
    chassisGroup.remove(chassisBodyMesh)
  }
  const bodyVisualMaterial = new MeshStandardMaterial({
    color: '#4c7dff',
    transparent: true,
    opacity: 0.16,
    roughness: 0.6,
    metalness: 0,
  })
  chassisBodyMesh = buildChassisVisualMesh(collider, bodyVisualMaterial)
  chassisShapeOffset = collider.offset
  if (chassisBodyMesh) {
    chassisGroup.add(chassisBodyMesh)
  }
  void reloadPreviewPhysics()
}

function updateVisualsFromPhysics() {
  if (chassisBodyMesh && chassisShapeOffset) {
    chassisBodyMesh.position.copy(chassisShapeOffset)
  }
}

function resolveChassisColliderShape(): PreviewChassisColliderInfo {
  const node = selectedNode.value
  const defaultCollider = buildFallbackCollider()
  if (!node || !node.components) return defaultCollider

  const rigidbodyComponent = node.components[RIGIDBODY_COMPONENT_TYPE] as SceneNodeComponentState<RigidbodyComponentProps> | undefined
  const metadataShape = (rigidbodyComponent?.metadata?.[RIGIDBODY_METADATA_KEY] as RigidbodyComponentMetadata | undefined)?.shape
  if (!metadataShape) {
    return defaultCollider
  }

  const scale = resolveNodeScaleFactors(node)
  const makeOffset = (raw?: [number, number, number] | null) => {
    const nx = raw?.[0] ?? 0
    const ny = raw?.[1] ?? 0
    const nz = raw?.[2] ?? 0
    return metadataShape.applyScale
      ? new Vector3(nx * scale.x, ny * scale.y, nz * scale.z)
      : new Vector3(nx, ny, nz)
  }

  const offset = makeOffset((metadataShape as any).offset)

  const resolveBox = (shape: Extract<RigidbodyPhysicsShape, { kind: 'box' }>): PreviewChassisColliderInfo => {
    const hx = shape.applyScale ? shape.halfExtents[0] * scale.x : shape.halfExtents[0]
    const hy = shape.applyScale ? shape.halfExtents[1] * scale.y : shape.halfExtents[1]
    const hz = shape.applyScale ? shape.halfExtents[2] * scale.z : shape.halfExtents[2]
    const halfExtents = new Vector3(Math.max(1e-4, hx), Math.max(1e-4, hy), Math.max(1e-4, hz))
    return {
      halfHeight: halfExtents.y,
      offset,
      shape: {
        kind: 'box',
        halfExtents: [halfExtents.x, halfExtents.y, halfExtents.z],
      },
      visual: { kind: 'box', halfExtents },
    }
  }

  const resolveSphere = (shape: Extract<RigidbodyPhysicsShape, { kind: 'sphere' }>): PreviewChassisColliderInfo => {
    const dominantScale = Math.max(scale.x, scale.y, scale.z)
    const radius = shape.applyScale ? shape.radius * dominantScale : shape.radius
    const safeRadius = Math.max(1e-4, radius)
    return {
      halfHeight: safeRadius,
      offset,
      shape: {
        kind: 'sphere',
        radius: safeRadius,
      },
      visual: { kind: 'sphere', radius: safeRadius },
    }
  }

  const resolveCylinder = (shape: Extract<RigidbodyPhysicsShape, { kind: 'cylinder' }>): PreviewChassisColliderInfo => {
    const horizontalScale = Math.max(scale.x, scale.z)
    const radiusTop = shape.applyScale ? shape.radiusTop * horizontalScale : shape.radiusTop
    const radiusBottom = shape.applyScale ? shape.radiusBottom * horizontalScale : shape.radiusBottom
    const height = shape.applyScale ? shape.height * scale.y : shape.height
    const safeTop = Math.max(1e-4, radiusTop)
    const safeBottom = Math.max(1e-4, radiusBottom)
    const safeHeight = Math.max(1e-4, height)
    return {
      halfHeight: safeHeight * 0.5,
      offset,
      shape: {
        kind: 'cylinder',
        radiusTop: safeTop,
        radiusBottom: safeBottom,
        height: safeHeight,
        segments: Math.max(4, shape.segments ?? 16),
      },
      visual: { kind: 'cylinder', radiusTop: safeTop, radiusBottom: safeBottom, height: safeHeight },
    }
  }

  const resolveConvex = (shape: Extract<RigidbodyPhysicsShape, { kind: 'convex' }>): PreviewChassisColliderInfo => {
    const vertices = (shape.vertices ?? []).map((vertex) => {
      const [x, y, z] = vertex
      const vx = shape.applyScale ? x * scale.x : x
      const vy = shape.applyScale ? y * scale.y : y
      const vz = shape.applyScale ? z * scale.z : z
      return new Vector3(vx, vy, vz)
    })
    const faces = (shape.faces ?? []).map((face) => face.slice())
    if (!vertices.length || !faces.length) {
      return defaultCollider
    }

    const bounds = vertices.reduce(
      (acc, v) => {
        acc.min.x = Math.min(acc.min.x, v.x)
        acc.min.y = Math.min(acc.min.y, v.y)
        acc.min.z = Math.min(acc.min.z, v.z)
        acc.max.x = Math.max(acc.max.x, v.x)
        acc.max.y = Math.max(acc.max.y, v.y)
        acc.max.z = Math.max(acc.max.z, v.z)
        return acc
      },
      { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) },
    )
    const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5)
    const halfHeight = Math.max(1e-4, (bounds.max.y - bounds.min.y) * 0.5)
    const visualSize = new Vector3(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z)
    const packedVertices = new Float32Array(vertices.length * 3)
    vertices.forEach((vertex, index) => {
      packedVertices[index * 3] = vertex.x - center.x
      packedVertices[index * 3 + 1] = vertex.y - center.y
      packedVertices[index * 3 + 2] = vertex.z - center.z
    })

    return {
      halfHeight,
      offset: offset.clone().add(center),
      shape: {
        kind: 'convex-hull',
        vertices: packedVertices,
        faces,
      },
      visual: { kind: 'convex', size: visualSize, center: new Vector3(center.x, center.y, center.z) },
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

function buildFallbackCollider(): PreviewChassisColliderInfo {
  const bounds = previewModelGroup ? setBoundingBoxFromObject(previewModelGroup, tempBox.makeEmpty()) : null
  const size = bounds && !bounds.isEmpty() ? bounds.getSize(tempSize) : new Vector3(2, 1, 4)
  const halfExtents = new Vector3(Math.max(0.1, size.x * 0.5), Math.max(0.1, size.y * 0.5), Math.max(0.1, size.z * 0.5))
  return {
    halfHeight: halfExtents.y,
    offset: new Vector3(0, 0, 0),
    shape: {
      kind: 'box',
      halfExtents: [halfExtents.x, halfExtents.y, halfExtents.z],
    },
    visual: { kind: 'box', halfExtents },
  }
}

function buildChassisVisualMesh(collider: PreviewChassisColliderInfo, material: MeshStandardMaterial): Mesh | null {
  switch (collider.visual.kind) {
    case 'box': {
      const halfExtents = collider.visual.halfExtents
      const mesh = new Mesh(new BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2), material)
      mesh.position.set(collider.offset.x, collider.offset.y, collider.offset.z)
      return mesh
    }
    case 'sphere': {
      const mesh = new Mesh(new SphereGeometry(collider.visual.radius, 24, 16), material)
      mesh.position.set(collider.offset.x, collider.offset.y, collider.offset.z)
      return mesh
    }
    case 'cylinder': {
      const { radiusTop, radiusBottom, height } = collider.visual
      const mesh = new Mesh(new CylinderGeometry(radiusTop, radiusBottom, height, 24), material)
      mesh.position.set(collider.offset.x, collider.offset.y, collider.offset.z)
      return mesh
    }
    case 'convex': {
      const size = collider.visual.size
      const mesh = new Mesh(new BoxGeometry(Math.max(1e-4, size.x), Math.max(1e-4, size.y), Math.max(1e-4, size.z)), material)
      mesh.position.set(collider.offset.x, collider.offset.y, collider.offset.z)
      return mesh
    }
    default:
      return null
  }
}

function applyPreviewBodyFrame(frame: PhysicsStepFrame): void {
  if (!previewVehicleRootGroup || !chassisGroup || frame.bodyCount <= 0 || frame.bodyTransforms.length < frame.bodyCount * 8) {
    return
  }
  for (let index = 0; index < frame.bodyCount; index += 1) {
    if (frame.bodyMeta?.[index] !== physicsBridgeBodyId) {
      continue
    }
    const base = index * 8
    const position = new Vector3(
      frame.bodyTransforms[base] ?? 0,
      frame.bodyTransforms[base + 1] ?? 0,
      frame.bodyTransforms[base + 2] ?? 0,
    )
    tempQuaternion.set(
      frame.bodyTransforms[base + 3] ?? 0,
      frame.bodyTransforms[base + 4] ?? 0,
      frame.bodyTransforms[base + 5] ?? 0,
      frame.bodyTransforms[base + 6] ?? 1,
    ).normalize()
    applyWorldTransformToObject(previewVehicleRootGroup, position, tempQuaternion)
    previewVehicleRootGroup.updateMatrixWorld(true)
    chassisGroup.updateMatrixWorld(true)
    break
  }
}

function applyPreviewWheelFrame(frame: PhysicsStepFrame): void {
  if (
    !chassisGroup
    || !wheelPreviewMeshes.length
    || !wheelRayMeshes.length
    || physicsBridgeWheelCount <= 0
    || frame.wheelCount <= 0
    || frame.wheelTransforms.length < frame.wheelCount * 9
  ) {
    return
  }
  const wheelCount = Math.min(frame.wheelCount, wheelPreviewMeshes.length, wheelRayMeshes.length, physicsBridgeWheelCount)
  for (let wheelIndex = 0; wheelIndex < wheelCount; wheelIndex += 1) {
    const base = wheelIndex * 9
    const mesh = wheelPreviewMeshes[wheelIndex]
    const rayMesh = wheelRayMeshes[wheelIndex]
    const connectionMesh = connectionPointMeshes[wheelIndex]
    if (!mesh) {
      continue
    }
    if (physicsBridgeVehicleId > 0 && frame.wheelTransforms[base] !== physicsBridgeVehicleId) {
      continue
    }
    const position = new Vector3(
      frame.wheelTransforms[base + 2] ?? 0,
      frame.wheelTransforms[base + 3] ?? 0,
      frame.wheelTransforms[base + 4] ?? 0,
    )
    tempQuaternion.set(
      frame.wheelTransforms[base + 5] ?? 0,
      frame.wheelTransforms[base + 6] ?? 0,
      frame.wheelTransforms[base + 7] ?? 0,
      frame.wheelTransforms[base + 8] ?? 1,
    ).normalize()
    applyWorldTransformToObject(mesh, position, tempQuaternion)
    if (rayMesh && connectionMesh) {
      const connectionWorld = connectionMesh.getWorldPosition(new Vector3())
      const wheelWorld = mesh.getWorldPosition(new Vector3())
      const rayVector = wheelWorld.clone().sub(connectionWorld)
      const rayLength = rayVector.length()
      if (rayLength > 1e-6) {
        rayVector.multiplyScalar(1 / rayLength)
        const center = connectionWorld.clone().add(wheelWorld).multiplyScalar(0.5)
        rayMesh.visible = true
        applyWorldTransformToObject(rayMesh, center, new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), rayVector))
        rayMesh.scale.set(1, Math.max(1e-4, rayLength), 1)
        rayMesh.updateMatrixWorld(true)
      } else {
        rayMesh.visible = false
      }
    }
  }
}

function applyPreviewPhysicsFrame(frame: PhysicsStepFrame): void {
  applyPreviewBodyFrame(frame)
  applyPreviewWheelFrame(frame)
}

function stepPreviewPhysics(deltaTime: number): void {
  if (
    deltaTime <= 0
    || !physicsBridge
    || !physicsBridgeSceneLoaded
    || physicsBridgeLoadPromise
    || physicsBridgeStepPromise
  ) {
    return
  }
  const bridge = physicsBridge
  physicsBridgeStepPromise = bridge.step(Math.max(0, deltaTime) * 1000)
    .then((frame) => {
      if (bridge !== physicsBridge || !physicsBridgeSceneLoaded) {
        return
      }
      applyPreviewPhysicsFrame(frame)
    })
    .catch((error) => {
      console.warn('[VehicleSuspensionEditorDialog] Failed to step preview physics', error)
    })
    .finally(() => {
      if (bridge === physicsBridge) {
        physicsBridgeStepPromise = null
      }
    })
}

function startRenderLoop() {
  if (!renderer || !previewScene || !camera) return
  renderClock = new Clock()
  const renderLoop = () => {
    animationFrame = requestAnimationFrame(renderLoop)
    stepPreviewPhysics(renderClock.getDelta())
    updateVisualsFromPhysics()
    orbitControls?.update()
    renderer?.render(previewScene as Scene, camera as PerspectiveCamera)
  }
  renderLoop()
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      nextTick(() => {
        initPreview()
      })
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
    rebuildPhysics()
  },
  { deep: true },
)

watch(
  () => selectedNodeId.value,
  () => {
    if (!props.visible) return
    rebuildModel()
    rebuildHandles()
    rebuildPhysics()
  },
)

watch(
  () => environmentSettings.value.physicsEngine,
  () => {
    if (!props.visible) return
    rebuildPhysics()
  },
)

watch(
  () => environmentSettings.value.gravityStrength,
  () => {
    if (!props.visible) return
    rebuildPhysics()
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
