import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  createBackFollowCameraTuning,
  createCameraFollowState,
  FollowCameraController,
  resolveGroundAlignedFollowForward,
} from '@schema/followCameraController'
import {
  VehicleDriveController,
  type VehicleDriveControllerBindings,
  type VehicleDriveControllerDeps,
} from '@schema/VehicleDriveController'
import { resolveVehicleAxisVector } from '@schema/vehicleAxes'

const CAMERA_FOLLOW_DISTANCE = 6
const CAMERA_FOLLOW_HEIGHT = 4
const MAX_FOLLOW_PITCH = THREE.MathUtils.degToRad(45)

type VehicleCameraFixture = {
  controller: VehicleDriveController
  camera: THREE.PerspectiveCamera
  cameraFollowState: ReturnType<typeof createCameraFollowState>
  vehicleObject: THREE.Group
  axisForward: THREE.Vector3
}

function createVehicleCameraFixture(): VehicleCameraFixture {
  const vehicleObject = new THREE.Group()
  vehicleObject.position.set(12, 20, -8)
  const model = new THREE.Group()
  model.rotation.y = Math.PI / 2
  model.add(new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 1.4, 4.2),
    new THREE.MeshBasicMaterial(),
  ))
  vehicleObject.add(model)
  vehicleObject.updateMatrixWorld(true)

  const cameraFollowState = createCameraFollowState()
  const camera = new THREE.PerspectiveCamera()
  const nodeObjectMap = new Map<string, THREE.Object3D>([['vehicle', vehicleObject]])
  const axisForward = new THREE.Vector3(1, 0, 0)
  const vehicleInstances = new Map([
    ['vehicle', {
      nodeId: 'vehicle',
      vehicle: { chassisBody: null },
      wheelCount: 4,
      steerableWheelIndices: [0, 1],
      axisRight: new THREE.Vector3(0, 0, 1),
      axisUp: new THREE.Vector3(0, 1, 0),
      axisForward,
      axisRightIndex: 2 as const,
      axisUpIndex: 1 as const,
      axisForwardIndex: 0 as const,
    }],
  ])
  const vehicleNode = {
    id: 'vehicle',
    components: {
      vehicle: {
        props: {
          cameraFollowDistance: CAMERA_FOLLOW_DISTANCE,
          cameraFollowHeight: CAMERA_FOLLOW_HEIGHT,
        },
      },
    },
  }

  const deps = {
    vehicleInstances,
    rigidbodyInstances: new Map(),
    nodeObjectMap,
    resolveNodeById: (nodeId: string) => nodeId === 'vehicle' ? vehicleNode : null,
    resolveRigidbodyComponent: () => null,
    resolveVehicleComponent: (node: typeof vehicleNode | null) => node?.components?.vehicle ?? null,
    isPhysicsEnabled: () => false,
    ensureVehicleBindingForNode: () => undefined,
    normalizeNodeId: (nodeId: string | null | undefined) => nodeId ?? null,
    followCameraDistanceScale: () => 1,
    followCameraTuning: () => createBackFollowCameraTuning(),
  } as unknown as VehicleDriveControllerDeps

  const bindings = {
    state: {
      active: true,
      nodeId: 'vehicle',
      token: null,
      vehicle: null,
      steerableWheelIndices: [0, 1],
      wheelCount: 4,
      seatNodeId: null,
      sourceEvent: null,
    },
    inputFlags: {
      forward: false,
      backward: false,
      left: false,
      right: false,
      brake: false,
    },
    input: {
      throttle: 0,
      steering: 0,
      brake: 0,
    },
    uiOverride: { value: 'auto' },
    promptBusy: { value: false },
    exitBusy: { value: false },
    cameraRestoreState: {
      hasSnapshot: false,
      position: new THREE.Vector3(),
      target: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      up: new THREE.Vector3(0, 1, 0),
      isCameraCaged: false,
    },
    cameraFollowState,
    steeringKeyboardValue: { value: 0 },
  } as unknown as VehicleDriveControllerBindings

  return {
    controller: new VehicleDriveController(deps, bindings),
    camera,
    cameraFollowState,
    vehicleObject,
    axisForward,
  }
}

function setVehicleRotation(
  fixture: VehicleCameraFixture,
  pitchDegrees: number,
  yawDegrees = 0,
  rollDegrees = 0,
): void {
  fixture.vehicleObject.rotation.set(
    THREE.MathUtils.degToRad(rollDegrees),
    THREE.MathUtils.degToRad(yawDegrees),
    THREE.MathUtils.degToRad(pitchDegrees),
    'YXZ',
  )
  fixture.vehicleObject.updateMatrixWorld(true)
}

function resolveExpectedCameraBasis(
  vehicleObject: THREE.Object3D,
  axisForward: THREE.Vector3,
): {
  forward: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
} {
  const forward = axisForward.clone()
    .applyQuaternion(vehicleObject.getWorldQuaternion(new THREE.Quaternion()))
    .normalize()
  const horizontalLength = Math.hypot(forward.x, forward.z)
  const pitch = THREE.MathUtils.clamp(
    Math.atan2(forward.y, Math.max(1e-12, horizontalLength)),
    -MAX_FOLLOW_PITCH,
    MAX_FOLLOW_PITCH,
  )
  if (horizontalLength >= 1e-5) {
    forward.x *= Math.cos(pitch) / horizontalLength
    forward.z *= Math.cos(pitch) / horizontalLength
    forward.y = Math.sin(pitch)
    forward.normalize()
  }
  const right = new THREE.Vector3(0, 1, 0).cross(forward).normalize()
  const up = forward.clone().cross(right).normalize()
  return { forward, right, up }
}

function updateCamera(fixture: VehicleCameraFixture): void {
  fixture.cameraFollowState.initialized = false
  expect(fixture.controller.updateCamera(
    0,
    { camera: fixture.camera },
    { immediate: true },
  )).toBe(true)
}

function expectStableVehicleCameraComposition(
  fixture: VehicleCameraFixture,
  pitchDegrees: number,
  yawDegrees = 0,
  rollDegrees = 0,
): void {
  setVehicleRotation(fixture, pitchDegrees, yawDegrees, rollDegrees)
  updateCamera(fixture)

  const { forward, right, up } = resolveExpectedCameraBasis(
    fixture.vehicleObject,
    fixture.axisForward,
  )
  const anchor = fixture.vehicleObject.getWorldPosition(new THREE.Vector3())
  const offset = fixture.camera.position.clone().sub(anchor)
  const cameraRight = new THREE.Vector3().setFromMatrixColumn(fixture.camera.matrixWorld, 0)

  expect(offset.dot(forward)).toBeCloseTo(-CAMERA_FOLLOW_DISTANCE, 4)
  expect(offset.dot(up)).toBeCloseTo(CAMERA_FOLLOW_HEIGHT, 4)
  expect(offset.dot(right)).toBeCloseTo(0, 4)
  expect(fixture.camera.up.distanceTo(up)).toBeLessThan(1e-5)
  expect(Math.abs(cameraRight.y)).toBeLessThan(1e-5)
}

describe('vehicle follow camera slope alignment', () => {
  it('keeps vehicle cardinal axes isolated after a world-space transform', () => {
    const worldForward = resolveVehicleAxisVector(0)
      .applyQuaternion(new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        THREE.MathUtils.degToRad(50),
      ))

    expect(worldForward.distanceTo(new THREE.Vector3(
      Math.cos(THREE.MathUtils.degToRad(50)),
      0,
      -Math.sin(THREE.MathUtils.degToRad(50)),
    ))).toBeLessThan(1e-6)
    expect(resolveVehicleAxisVector(0).toArray()).toEqual([1, 0, 0])
    expect(resolveVehicleAxisVector(1).toArray()).toEqual([0, 1, 0])
    expect(resolveVehicleAxisVector(2).toArray()).toEqual([0, 0, 1])
  })

  it('keeps the Car00 model axis aligned with the vehicle forward axis', () => {
    const fixture = createVehicleCameraFixture()
    const model = fixture.vehicleObject.children[0]!
    const vehicleQuaternion = fixture.vehicleObject.getWorldQuaternion(new THREE.Quaternion())
    const modelQuaternion = model.getWorldQuaternion(new THREE.Quaternion())
    const vehicleForward = fixture.axisForward.clone().applyQuaternion(vehicleQuaternion)
    const modelForward = new THREE.Vector3(0, 0, 1).applyQuaternion(modelQuaternion)

    expect(vehicleForward.dot(modelForward)).toBeCloseTo(1, 5)
  })

  it('keeps the same vehicle-relative composition on flat, uphill, and downhill roads', () => {
    const fixture = createVehicleCameraFixture()

    expectStableVehicleCameraComposition(fixture, 0)
    expectStableVehicleCameraComposition(fixture, 15)
    expectStableVehicleCameraComposition(fixture, -15)
  })

  it('follows pitch without transferring vehicle roll into the horizon', () => {
    const fixture = createVehicleCameraFixture()

    expectStableVehicleCameraComposition(fixture, 12, 37, 20)
  })

  it('smoothly returns the camera basis to level after leaving a slope', () => {
    const fixture = createVehicleCameraFixture()
    setVehicleRotation(fixture, 15)
    updateCamera(fixture)
    setVehicleRotation(fixture, 0)

    for (let frame = 0; frame < 120; frame += 1) {
      expect(fixture.controller.updateCamera(
        1 / 60,
        { camera: fixture.camera },
      )).toBe(true)
    }

    expect(fixture.camera.up.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-3)
  })

  it('clamps extreme pitch and keeps finite camera values near vertical', () => {
    const fixture = createVehicleCameraFixture()

    expectStableVehicleCameraComposition(fixture, 89)
    expect(Number.isFinite(fixture.camera.position.x)).toBe(true)
    expect(Number.isFinite(fixture.camera.position.y)).toBe(true)
    expect(Number.isFinite(fixture.camera.position.z)).toBe(true)
    expect(Number.isFinite(fixture.camera.up.x)).toBe(true)
    expect(Number.isFinite(fixture.camera.up.y)).toBe(true)
    expect(Number.isFinite(fixture.camera.up.z)).toBe(true)
    expect(fixture.cameraFollowState.heading.y).toBeCloseTo(Math.sin(MAX_FOLLOW_PITCH), 4)
  })
})

describe('follow camera forward pitch option', () => {
  function runFollowCamera(followForwardPitch: boolean): {
    camera: THREE.PerspectiveCamera
    heading: THREE.Vector3
  } {
    const controller = new FollowCameraController()
    const follow = createCameraFollowState()
    const camera = new THREE.PerspectiveCamera()
    const anchor = new THREE.Vector3(3, 5, 7)

    expect(controller.update({
      follow,
      placement: {
        distance: 6,
        heightOffset: 4,
        targetLift: 0.5,
        targetForward: 3,
      },
      anchorWorld: anchor,
      desiredForwardWorld: new THREE.Vector3(0, Math.sin(MAX_FOLLOW_PITCH), -Math.cos(MAX_FOLLOW_PITCH)),
      deltaSeconds: 0,
      ctx: { camera },
      immediate: true,
      followForwardPitch,
    })).toBe(true)

    return {
      camera,
      heading: follow.heading.clone(),
    }
  }

  it('preserves the existing level-heading behavior by default', () => {
    const result = runFollowCamera(false)

    expect(result.heading.y).toBe(0)
    expect(result.camera.up.y).toBeCloseTo(1, 5)
  })

  it('uses the pitched basis when explicitly enabled', () => {
    const result = runFollowCamera(true)

    expect(result.heading.y).toBeCloseTo(Math.sin(MAX_FOLLOW_PITCH), 5)
    expect(result.camera.up.y).toBeCloseTo(Math.cos(MAX_FOLLOW_PITCH), 5)
    expect(result.camera.up.z).toBeGreaterThan(0)
  })
})

describe('ground-aligned character follow forward', () => {
  it('projects the character heading onto an uphill or downhill surface', () => {
    const slopeRadians = THREE.MathUtils.degToRad(15)
    const groundNormal = new THREE.Vector3(0, Math.cos(slopeRadians), Math.sin(slopeRadians))
    const previousHeading = new THREE.Vector3(0, 0, -1)

    const uphill = resolveGroundAlignedFollowForward(
      new THREE.Vector3(0, 0, -1),
      groundNormal,
      previousHeading,
      new THREE.Vector3(),
    )
    const downhill = resolveGroundAlignedFollowForward(
      new THREE.Vector3(0, 0, 1),
      groundNormal,
      previousHeading,
      new THREE.Vector3(),
    )

    expect(uphill.y).toBeCloseTo(Math.sin(slopeRadians), 5)
    expect(uphill.z).toBeCloseTo(-Math.cos(slopeRadians), 5)
    expect(downhill.y).toBeCloseTo(-Math.sin(slopeRadians), 5)
    expect(downhill.z).toBeCloseTo(Math.cos(slopeRadians), 5)
  })

  it('keeps flat movement level and ignores cross-slope roll', () => {
    const level = resolveGroundAlignedFollowForward(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(),
    )
    const crossSlope = resolveGroundAlignedFollowForward(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(20)), Math.cos(THREE.MathUtils.degToRad(20)), 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(),
    )

    expect(level.distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(1e-5)
    expect(crossSlope.y).toBeCloseTo(0, 5)
    expect(crossSlope.z).toBeCloseTo(-1, 5)
  })

  it('clamps steep ground pitch and rejects invalid normals', () => {
    const steepSlopeRadians = THREE.MathUtils.degToRad(60)
    const steep = resolveGroundAlignedFollowForward(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, Math.cos(steepSlopeRadians), Math.sin(steepSlopeRadians)),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(),
    )
    const invalid = resolveGroundAlignedFollowForward(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(Number.NaN, 1, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(),
    )

    expect(steep.y).toBeCloseTo(Math.sin(MAX_FOLLOW_PITCH), 5)
    expect(invalid.distanceTo(new THREE.Vector3(0, 0, -1))).toBeLessThan(1e-5)
  })
})
