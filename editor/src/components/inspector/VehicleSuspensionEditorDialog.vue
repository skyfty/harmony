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
import * as CANNON from 'cannon-es'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'
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
import { resolveNodeScaleFactors } from '@/utils/rigidbodyCollider'
import type { SceneNode, SceneNodeComponentState } from '@harmony/schema'

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
let chassisGroup: Group | null = null
let frontGroup: Group | null = null
let rearGroup: Group | null = null
let groundMesh: Mesh | null = null
let chassisBodyMesh: Mesh | null = null
let chassisShapeOffset: CANNON.Vec3 | null = null
let connectionPointMeshes: Mesh[] = []
let resizeObserver: ResizeObserver | null = null
let physicsWorld: CANNON.World | null = null
let groundBody: CANNON.Body | null = null
let chassisBody: CANNON.Body | null = null
let vehicle: CANNON.RaycastVehicle | null = null
let animationFrame: number | null = null
let wheelPreviewMeshes: Mesh[] = []
const tempBox = new Box3()
const tempSize = new Vector3()

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
  previewScene = null
  camera = null
  previewModelGroup = null
  chassisGroup = null
  frontGroup = null
  rearGroup = null
  if (groundMesh) {
    previewScene?.remove(groundMesh)
  }
  groundMesh = null
  if (chassisBodyMesh) {
    previewScene?.remove(chassisBodyMesh)
  }
  chassisBodyMesh = null
  chassisShapeOffset = null
  connectionPointMeshes = []
  wheelPreviewMeshes = []
  disposePhysics()
  isReady.value = false
  loadError.value = null
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

function disposePhysics() {
  vehicle = null
  chassisBody = null
  groundBody = null
  physicsWorld = null
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
  })
  transformControls.addEventListener('mouseUp', handleHandleCommit)
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
  if (chassisGroup) {
    previewScene.remove(chassisGroup)
  }
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
  chassisGroup.position.set(-center.x, -center.y, -center.z)

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
  if (frontGroup) chassisGroup.remove(frontGroup)
  if (rearGroup) chassisGroup.remove(rearGroup)
  connectionPointMeshes = []
  wheelPreviewMeshes = []

  frontGroup = new Group()
  rearGroup = new Group()
  chassisGroup.add(frontGroup, rearGroup)

  const sphereGeo = new SphereGeometry(0.08, 14, 10)
  const wheelGeo = new SphereGeometry(0.12, 18, 12)
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
  }

  wheelEntries.value.forEach((wheel) => {
    const isFront = wheel.isFrontWheel
    placeWheelMesh(wheel, isFront ? frontCenter : rearCenter, isFront ? frontGroup : rearGroup, isFront)
  })

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
  const maxAbs = Math.max(...group.map((wheel) => Math.abs(wheel.chassisConnectionPointLocal.x)))
  return Number(maxAbs.toFixed(3))
}

function computeUniformSpacing(): number {
  if (!wheelEntries.value.length) return 0
  const maxAbs = Math.max(...wheelEntries.value.map((wheel) => Math.abs(wheel.chassisConnectionPointLocal.x)))
  return Number(maxAbs.toFixed(3))
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
  const target = Math.max(front, rear)
  handleSpacingChange(target)
}

function handleHandleMove() {
  if (!transformControls || !chassisGroup || !transformControls.object) return
  const target = transformControls.object
  const isFront = target === frontGroup
  applyHandleDelta(isFront)
}

function handleHandleCommit() {
  // Only commit wheel positions after releasing the mouse to avoid mid-drag writes.
  handleHandleMove()
}

function applyHandleDelta(isFront: boolean) {
  const group = isFront ? frontGroup : rearGroup
  if (!group || !chassisGroup) return
  const chassis = chassisGroup
  const updates = new Map<string, Vector3>()
  connectionPointMeshes
    .filter((mesh) => mesh.userData?.isFront === isFront && mesh.userData?.wheelId)
    .forEach((mesh) => {
      const worldPos = mesh.getWorldPosition(new Vector3())
      chassis.worldToLocal(worldPos)
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
  { key: 'radius', label: 'Radius', min: 0, max: 5, step: 0.01 },
  { key: 'suspensionRestLength', label: 'Rest Length', min: 0, max: 2, step: 0.01 },
  { key: 'suspensionStiffness', label: 'Stiffness', min: 0, max: 200, step: 0.5 },
  { key: 'dampingRelaxation', label: 'Damping Relax', min: 0, max: 50, step: 0.1 },
  { key: 'dampingCompression', label: 'Damping Compress', min: 0, max: 50, step: 0.1 },
  { key: 'frictionSlip', label: 'Friction', min: 0, max: 20, step: 0.05 },
  { key: 'maxSuspensionTravel', label: 'Travel', min: 0, max: 2, step: 0.01 },
  { key: 'maxSuspensionForce', label: 'Max Force', min: 0, max: 200000, step: 100 },
  { key: 'rollInfluence', label: 'Roll Influence', min: 0, max: 5, step: 0.01 },
  { key: 'customSlidingRotationalSpeed', label: 'Custom Rot Speed', min: -50, max: 50, step: 0.1 },
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

function handleSpacingChange(value: number) {
  if (!Number.isFinite(value)) return
  const spacing = Math.max(0, value)
  patchAllWheels((wheel) => {
    const sign = Math.sign(wheel.chassisConnectionPointLocal.x) || 1
    return {
      ...wheel,
      chassisConnectionPointLocal: {
        ...wheel.chassisConnectionPointLocal,
        x: sign * spacing,
      },
    }
  })
  uiState.spacing = spacing
}

function rebuildPhysics() {
  if (!chassisGroup) return
  disposePhysics()
  physicsWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) })
  groundBody = new CANNON.Body({ mass: 0 })
  groundBody.addShape(new CANNON.Plane())
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
  physicsWorld.addBody(groundBody)

  const collider = resolveChassisColliderShape()
  const baseY = Math.max(0.05, collider.halfHeight - collider.offset.y) + 0.3

  if (chassisBodyMesh) {
    previewScene?.remove(chassisBodyMesh)
  }
  const bodyVisualMaterial = new MeshStandardMaterial({ color: '#4c7dff', transparent: true, opacity: 0.16, roughness: 0.6, metalness: 0 })
  chassisBodyMesh = buildChassisVisualMesh(collider, bodyVisualMaterial)
  chassisShapeOffset = collider.offset
  if (chassisBodyMesh) {
    previewScene?.add(chassisBodyMesh)
  }

  chassisBody = new CANNON.Body({ mass: 600 })
  chassisBody.addShape(collider.shape, collider.offset)
  chassisBody.position.set(0, baseY, 0)
  physicsWorld.addBody(chassisBody)

  vehicle = new CANNON.RaycastVehicle({
    chassisBody,
    indexRightAxis: normalizedProps.value.indexRightAxis,
    indexUpAxis: normalizedProps.value.indexUpAxis,
    indexForwardAxis: normalizedProps.value.indexForwardAxis,
  })

  wheelEntries.value.forEach((wheel) => {
    vehicle?.addWheel({
      chassisConnectionPointLocal: new CANNON.Vec3(
        wheel.chassisConnectionPointLocal.x,
        wheel.chassisConnectionPointLocal.y,
        wheel.chassisConnectionPointLocal.z,
      ),
      directionLocal: new CANNON.Vec3(wheel.directionLocal.x, wheel.directionLocal.y, wheel.directionLocal.z),
      axleLocal: new CANNON.Vec3(wheel.axleLocal.x, wheel.axleLocal.y, wheel.axleLocal.z),
      suspensionRestLength: wheel.suspensionRestLength,
      suspensionStiffness: wheel.suspensionStiffness,
      dampingRelaxation: wheel.dampingRelaxation,
      dampingCompression: wheel.dampingCompression,
      frictionSlip: wheel.frictionSlip,
      maxSuspensionTravel: wheel.maxSuspensionTravel,
      maxSuspensionForce: wheel.maxSuspensionForce,
      rollInfluence: wheel.rollInfluence,
      radius: wheel.radius,
      customSlidingRotationalSpeed: wheel.customSlidingRotationalSpeed,
      useCustomSlidingRotationalSpeed: wheel.useCustomSlidingRotationalSpeed,
      isFrontWheel: wheel.isFrontWheel,
    })
  })
  vehicle.addToWorld(physicsWorld)
}

function updateVisualsFromPhysics(deltaTime: number) {
  if (!physicsWorld || !vehicle || !chassisGroup || !chassisBody) return
  physicsWorld.step(1 / 60, deltaTime)
  vehicle.updateVehicle(1 / 60)
  for (let index = 0; index < vehicle.wheelInfos.length; index += 1) {
    vehicle.updateWheelTransform(index)
  }

  chassisGroup.position.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
  chassisGroup.quaternion.set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
  if (chassisBodyMesh) {
    const offset = chassisShapeOffset
    if (offset) {
      const rotated = new CANNON.Vec3()
      chassisBody.quaternion.vmult(offset, rotated)
      chassisBodyMesh.position.set(
        chassisBody.position.x + rotated.x,
        chassisBody.position.y + rotated.y,
        chassisBody.position.z + rotated.z,
      )
    } else {
      chassisBodyMesh.position.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z)
    }
    chassisBodyMesh.quaternion.set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w)
  }
}

type ChassisColliderInfo = {
  shape: CANNON.Shape
  halfHeight: number
  offset: CANNON.Vec3
  visual: { kind: 'box'; halfExtents: CANNON.Vec3 } | { kind: 'sphere'; radius: number } | { kind: 'cylinder'; radiusTop: number; radiusBottom: number; height: number } | { kind: 'convex'; size: Vector3; center: Vector3 }
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
  const makeOffset = (raw?: [number, number, number] | null) => {
    const nx = raw?.[0] ?? 0
    const ny = raw?.[1] ?? 0
    const nz = raw?.[2] ?? 0
    if (metadataShape.scaleNormalized) {
      return new CANNON.Vec3(nx * scale.x, ny * scale.y, nz * scale.z)
    }
    return new CANNON.Vec3(nx, ny, nz)
  }

  const offset = makeOffset((metadataShape as any).offset)

  const resolveBox = (shape: Extract<RigidbodyPhysicsShape, { kind: 'box' }>): ChassisColliderInfo => {
    const hx = shape.scaleNormalized ? shape.halfExtents[0] * scale.x : shape.halfExtents[0]
    const hy = shape.scaleNormalized ? shape.halfExtents[1] * scale.y : shape.halfExtents[1]
    const hz = shape.scaleNormalized ? shape.halfExtents[2] * scale.z : shape.halfExtents[2]
    const halfExtents = new CANNON.Vec3(Math.max(1e-4, hx), Math.max(1e-4, hy), Math.max(1e-4, hz))
    return {
      shape: new CANNON.Box(halfExtents),
      halfHeight: halfExtents.y,
      offset,
      visual: { kind: 'box', halfExtents },
    }
  }

  const resolveSphere = (shape: Extract<RigidbodyPhysicsShape, { kind: 'sphere' }>): ChassisColliderInfo => {
    const dominantScale = Math.max(scale.x, scale.y, scale.z)
    const radius = shape.scaleNormalized ? shape.radius * dominantScale : shape.radius
    const safeRadius = Math.max(1e-4, radius)
    return {
      shape: new CANNON.Sphere(safeRadius),
      halfHeight: safeRadius,
      offset,
      visual: { kind: 'sphere', radius: safeRadius },
    }
  }

  const resolveCylinder = (shape: Extract<RigidbodyPhysicsShape, { kind: 'cylinder' }>): ChassisColliderInfo => {
    const horizontalScale = Math.max(scale.x, scale.z)
    const radiusTop = shape.scaleNormalized ? shape.radiusTop * horizontalScale : shape.radiusTop
    const radiusBottom = shape.scaleNormalized ? shape.radiusBottom * horizontalScale : shape.radiusBottom
    const height = shape.scaleNormalized ? shape.height * scale.y : shape.height
    const segments = Math.max(4, shape.segments ?? 16)
    const safeTop = Math.max(1e-4, radiusTop)
    const safeBottom = Math.max(1e-4, radiusBottom)
    const safeHeight = Math.max(1e-4, height)
    return {
      shape: new CANNON.Cylinder(safeTop, safeBottom, safeHeight, segments),
      halfHeight: safeHeight * 0.5,
      offset,
      visual: { kind: 'cylinder', radiusTop: safeTop, radiusBottom: safeBottom, height: safeHeight },
    }
  }

  const resolveConvex = (shape: Extract<RigidbodyPhysicsShape, { kind: 'convex' }>): ChassisColliderInfo => {
    const vertices = (shape.vertices ?? []).map((vertex) => {
      const [x, y, z] = vertex
      const vx = metadataShape.scaleNormalized ? x * scale.x : x
      const vy = metadataShape.scaleNormalized ? y * scale.y : y
      const vz = metadataShape.scaleNormalized ? z * scale.z : z
      return new CANNON.Vec3(vx, vy, vz)
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
      { min: new CANNON.Vec3(Infinity, Infinity, Infinity), max: new CANNON.Vec3(-Infinity, -Infinity, -Infinity) },
    )
    const center = bounds.min.vadd(bounds.max).scale(0.5)
    const adjustedVertices = vertices.map((v) => v.vsub(center))
    const halfHeight = Math.max(1e-4, (bounds.max.y - bounds.min.y) * 0.5)
    const visualSize = new Vector3(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z)

    return {
      shape: new CANNON.ConvexPolyhedron({ vertices: adjustedVertices, faces }),
      halfHeight,
      offset: offset.vadd(center),
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

function buildFallbackCollider(): ChassisColliderInfo {
  const bounds = previewModelGroup ? setBoundingBoxFromObject(previewModelGroup, tempBox.makeEmpty()) : null
  const size = bounds && !bounds.isEmpty() ? bounds.getSize(tempSize) : new Vector3(2, 1, 4)
  const halfExtents = new CANNON.Vec3(Math.max(0.1, size.x * 0.5), Math.max(0.1, size.y * 0.5), Math.max(0.1, size.z * 0.5))
  return {
    shape: new CANNON.Box(halfExtents),
    halfHeight: halfExtents.y,
    offset: new CANNON.Vec3(0, 0, 0),
    visual: { kind: 'box', halfExtents },
  }
}

function buildChassisVisualMesh(collider: ChassisColliderInfo, material: MeshStandardMaterial): Mesh | null {
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

function startRenderLoop() {
  if (!renderer || !previewScene || !camera) return
  const clock = new Clock()
  const renderLoop = () => {
    animationFrame = requestAnimationFrame(renderLoop)
    const dt = clock.getDelta()
    updateVisualsFromPhysics(dt)
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
              <v-slider
                label="Wheel spacing (|X| m)"
                density="compact"
                hide-details
                :min="0"
                :max="5"
                :step="0.01"
                :model-value="uiState.spacing"
                :disabled="isDisabled"
                @update:modelValue="(value) => handleSpacingChange(Number(value))"
              />
              <div class="suspension-editor__grid">
                <v-slider
                  v-for="control in numericControls"
                  :key="`wheel-${control.key}`"
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
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
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
