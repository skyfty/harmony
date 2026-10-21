import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearGuideRouteEvaluationCache,
  evaluateGuideRoute,
  sampleEvaluatedGuideRouteAtDistance,
} from '@schema/guideRouteRuntime'
import {
  clampAutoTourComponentProps,
  clampCharacterControllerComponentProps,
  clampGuideRouteComponentProps,
  clampVehicleComponentProps,
} from '@schema/components'
import { createAutoTourRuntime } from '@schema/autoTourRuntime'
import { CharacterAutoTourRuntimeManager } from '@schema/characterAutoTourRuntime'
import { VehicleMotionAuthorityController } from '@schema/vehicleMotionAuthority'

const surfaceMocks = vi.hoisted(() => ({
  state: vi.fn(),
  sample: vi.fn(),
  terrainHeight: vi.fn(),
}))
const surfaceStateMock = surfaceMocks.state
const surfaceSampleMock = surfaceMocks.sample
const terrainHeightMock = surfaceMocks.terrainHeight

vi.mock('@schema/proceduralLandscape/runtime', () => ({
  getProceduralLandscapeGuideRouteSurfaceState: (...args: unknown[]) => surfaceStateMock(...args),
  getProceduralLandscapeRoadCenterlineLocal: () => null,
  sampleProceduralLandscapeGuideRouteSurface: (...args: unknown[]) => surfaceSampleMock(...args),
  sampleProceduralLandscapeTerrainHeight: (...args: unknown[]) => terrainHeightMock(...args),
}))

function createRouteNode() {
  return {
    id: 'route-1',
    name: 'Guide Route',
    nodeType: 'Mesh',
    dynamicMesh: { type: 'GuideRoute', vertices: [] },
    components: {
      guideRoute: {
        id: 'component-1',
        type: 'guideRoute',
        enabled: true,
        props: clampGuideRouteComponentProps({
          surfaceProviderNodeId: 'terrain-1',
          routeSource: 'drawn',
          sampleSpacingM: 2,
          roadLateralOffsetM: 0,
          waypoints: [
            {
              name: 'P1',
              position: { x: 0, y: 0, z: 0 },
              dock: true,
            },
            {
              name: 'P2',
              position: { x: 12, y: 0, z: 0 },
              dock: true,
            },
          ],
        }),
      },
    },
  } as any
}

describe('guideRouteRuntime', () => {
  beforeEach(() => {
    clearGuideRouteEvaluationCache()
    surfaceStateMock.mockReset()
    surfaceSampleMock.mockReset()
    terrainHeightMock.mockReset()
  })

  it('blocks evaluation while the surface provider is loading', () => {
    surfaceStateMock.mockReturnValue({
      status: 'loading',
      revision: 3,
      message: 'DEM terrain is building.',
    })

    const result = evaluateGuideRoute({
      routeNode: createRouteNode(),
      providerObject: null,
    })

    expect(result.status).toBe('provider-loading')
    expect(result.points).toEqual([])
    expect(result.revision).toBe(3)
    expect(surfaceSampleMock).not.toHaveBeenCalled()
  })

  it('rejects legacy Guide Route data instead of migrating it', () => {
    const routeNode = createRouteNode()
    routeNode.components.guideRoute.props.version = 1

    const result = evaluateGuideRoute({
      routeNode,
      providerObject: null,
    })

    expect(result.status).toBe('unsupported')
    expect(result.message).toContain('not V2')
    expect(surfaceSampleMock).not.toHaveBeenCalled()
  })

  it('densifies controls and uses the shared surface height and normal', () => {
    surfaceStateMock.mockReturnValue({
      status: 'ready',
      revision: 7,
      message: null,
    })
    surfaceSampleMock.mockImplementation((_nodeId, x, z) => ({
      point: new THREE.Vector3(x, 40 + x * 0.25, z),
      normal: new THREE.Vector3(0, 1, 0),
      kind: 'terrain',
      distanceToRoad: null,
      revision: 7,
    }))

    const result = evaluateGuideRoute({
      routeNode: createRouteNode(),
      providerObject: null,
    })

    expect(result.status).toBe('ready')
    expect(result.points.length).toBeGreaterThan(2)
    expect(result.points[0]!.y).toBeCloseTo(40)
    expect(result.points[result.points.length - 1]!.y).toBeCloseTo(43)
    expect(result.dock[0]).toBe(true)
    expect(result.dock[result.dock.length - 1]).toBe(true)
    expect(result.totalLength).toBeGreaterThan(12)

    const middle = sampleEvaluatedGuideRouteAtDistance(result, result.totalLength * 0.5)
    expect(middle).not.toBeNull()
    expect(middle!.point.y).toBeGreaterThan(40)
    expect(middle!.point.y).toBeLessThan(43)
  })

  it('samples exactly along the visible control-point polyline', () => {
    surfaceStateMock.mockReturnValue({
      status: 'ready',
      revision: 11,
      message: null,
    })
    surfaceSampleMock.mockImplementation((_nodeId, x, z) => ({
      point: new THREE.Vector3(x, 20, z),
      normal: new THREE.Vector3(0, 1, 0),
      kind: 'terrain',
      distanceToRoad: null,
      revision: 11,
    }))
    const routeNode = createRouteNode()
    routeNode.components.guideRoute.props = clampGuideRouteComponentProps({
      surfaceProviderNodeId: 'terrain-1',
      routeSource: 'drawn',
      sampleSpacingM: 2,
      waypoints: [
        { name: 'P1', position: { x: 0, y: 20, z: 0 }, dock: true },
        { name: 'P2', position: { x: 10, y: 20, z: 0 }, dock: false },
        { name: 'P3', position: { x: 10, y: 20, z: 10 }, dock: true },
      ],
    })

    const result = evaluateGuideRoute({ routeNode, providerObject: null })

    expect(result.status).toBe('ready')
    result.points.forEach((point) => {
      const onFirstSegment = Math.abs(point.z) <= 1e-6 && point.x >= -1e-6 && point.x <= 10 + 1e-6
      const onSecondSegment = Math.abs(point.x - 10) <= 1e-6 && point.z >= -1e-6 && point.z <= 10 + 1e-6
      expect(onFirstSegment || onSecondSegment).toBe(true)
    })
  })

  it('keeps every sampled wheel support point above a sloped terrain patch', () => {
    surfaceStateMock.mockReturnValue({
      status: 'ready',
      revision: 12,
      message: null,
    })
    surfaceSampleMock.mockImplementation((_nodeId, x, z) => ({
      point: new THREE.Vector3(x, 10, z),
      normal: new THREE.Vector3(-0.196116, 0.980581, -0.098058).normalize(),
      kind: 'terrain',
      distanceToRoad: null,
      revision: 12,
    }))
    terrainHeightMock.mockImplementation((_nodeId, x, z) => 10 + x * 0.2 + z * 0.1)

    const routeNode = createRouteNode()
    const vehicleNode = {
      id: 'vehicle-ground',
      name: 'Vehicle',
      nodeType: 'Mesh',
      components: {
        vehicle: {
          id: 'vehicle-component',
          type: 'vehicle',
          enabled: true,
          props: clampVehicleComponentProps({
            indexRightAxis: 2,
            indexUpAxis: 1,
            indexForwardAxis: 0,
          }),
        },
        autoTour: {
          id: 'tour-ground',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 2,
            loop: false,
          }),
        },
      },
    } as any
    const vehicleObject = new THREE.Object3D()
    vehicleObject.position.set(0, 10.5, 0)
    vehicleObject.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4)))
    const nodeObjectMap = new Map<string, THREE.Object3D>([
      [routeNode.id, new THREE.Object3D()],
      [vehicleNode.id, vehicleObject],
    ])
    const nodes = new Map<string, any>([
      [routeNode.id, routeNode],
      [vehicleNode.id, vehicleNode],
    ])
    const runtime = createAutoTourRuntime({
      iterNodes: () => nodes.values(),
      resolveNodeById: (nodeId) => nodes.get(nodeId) ?? null,
      nodeObjectMap,
      isManualDriveActive: () => false,
    })

    runtime.startTour(vehicleNode.id)
    runtime.update(1)

    const bounds = new THREE.Box3().setFromObject(vehicleObject)
    const surfaceHeights = [
      terrainHeightMock(routeNode.id, bounds.min.x, bounds.min.z),
      terrainHeightMock(routeNode.id, bounds.max.x, bounds.min.z),
      terrainHeightMock(routeNode.id, bounds.min.x, bounds.max.z),
      terrainHeightMock(routeNode.id, bounds.max.x, bounds.max.z),
    ].map((value) => Number(value))
    const highestSurface = Math.max(...surfaceHeights)
    expect(bounds.min.y).toBeGreaterThanOrEqual(highestSurface + 0.039)
    expect(bounds.min.y).toBeLessThanOrEqual(highestSurface + 0.08)
  })

  it('uses instanced proxy bounds when the vehicle container has no meshes', () => {
    surfaceStateMock.mockReturnValue({
      status: 'ready',
      revision: 13,
      message: null,
    })
    surfaceSampleMock.mockImplementation((_nodeId, x, z) => ({
      point: new THREE.Vector3(x, 10, z),
      normal: new THREE.Vector3(0, 1, 0),
      kind: 'terrain',
      distanceToRoad: null,
      revision: 13,
    }))
    terrainHeightMock.mockReturnValue(10)

    const routeNode = createRouteNode()
    const vehicleNode = {
      id: 'vehicle-instanced-bounds',
      name: 'Vehicle',
      nodeType: 'Mesh',
      components: {
        vehicle: {
          id: 'vehicle-component',
          type: 'vehicle',
          enabled: true,
          props: clampVehicleComponentProps({
            indexRightAxis: 2,
            indexUpAxis: 1,
            indexForwardAxis: 0,
          }),
        },
        autoTour: {
          id: 'tour-instanced-bounds',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 2,
            loop: false,
          }),
        },
      },
    } as any
    const vehicleProxy = new THREE.Object3D()
    vehicleProxy.position.set(0, 10, 0)
    vehicleProxy.userData.instancedBounds = {
      min: [-1, -0.75, -2],
      max: [1, 0.75, 2],
    }
    const nodeObjectMap = new Map<string, THREE.Object3D>([
      [routeNode.id, new THREE.Object3D()],
      [vehicleNode.id, vehicleProxy],
    ])
    const nodes = new Map<string, any>([
      [routeNode.id, routeNode],
      [vehicleNode.id, vehicleNode],
    ])
    const runtime = createAutoTourRuntime({
      iterNodes: () => nodes.values(),
      resolveNodeById: (nodeId) => nodes.get(nodeId) ?? null,
      nodeObjectMap,
      resolveObjectBounds: (object) => {
        const raw = object.userData.instancedBounds as {
          min: [number, number, number]
          max: [number, number, number]
        }
        const bounds = new THREE.Box3(
          new THREE.Vector3().fromArray(raw.min),
          new THREE.Vector3().fromArray(raw.max),
        )
        return bounds.applyMatrix4(object.matrixWorld)
      },
      isManualDriveActive: () => false,
    })

    runtime.startTour(vehicleNode.id)
    runtime.update(1)

    expect(vehicleProxy.position.y).toBeCloseTo(10.79)
  })

  it('does not re-evaluate support height from changing wheel mesh bounds', () => {
    surfaceStateMock.mockReturnValue({
      status: 'ready',
      revision: 16,
      message: null,
    })
    surfaceSampleMock.mockImplementation((_nodeId, x, z) => ({
      point: new THREE.Vector3(x, 10, z),
      normal: new THREE.Vector3(0, 1, 0),
      kind: 'terrain',
      distanceToRoad: null,
      revision: 16,
    }))
    terrainHeightMock.mockReturnValue(10)

    const routeNode = createRouteNode()
    const vehicleNode = {
      id: 'vehicle-stable-ground-bounds',
      name: 'Vehicle',
      nodeType: 'Mesh',
      components: {
        vehicle: {
          id: 'vehicle-component',
          type: 'vehicle',
          enabled: true,
          props: clampVehicleComponentProps({
            indexRightAxis: 2,
            indexUpAxis: 1,
            indexForwardAxis: 0,
          }),
        },
        autoTour: {
          id: 'tour-stable-ground-bounds',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 5,
            loop: false,
          }),
        },
      },
    } as any
    const vehicleObject = new THREE.Object3D()
    vehicleObject.position.set(0, 10.5, 0)
    vehicleObject.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.2)))
    const nodeObjectMap = new Map<string, THREE.Object3D>([
      [routeNode.id, new THREE.Object3D()],
      [vehicleNode.id, vehicleObject],
    ])
    const nodes = new Map<string, any>([
      [routeNode.id, routeNode],
      [vehicleNode.id, vehicleNode],
    ])
    const runtime = createAutoTourRuntime({
      iterNodes: () => nodes.values(),
      resolveNodeById: (nodeId) => nodes.get(nodeId) ?? null,
      nodeObjectMap,
      isManualDriveActive: () => false,
    })

    runtime.startTour(vehicleNode.id)
    runtime.update(0.1)
    const initialY = vehicleObject.position.y

    const animatedWheelBounds = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.2))
    animatedWheelBounds.position.set(0, -5, 0)
    vehicleObject.add(animatedWheelBounds)
    vehicleObject.updateMatrixWorld(true)
    runtime.update(0.1)

    expect(vehicleObject.position.y).toBeCloseTo(initialY, 2)
  })

  it('rises immediately and settles smoothly when terrain drops', () => {
    surfaceStateMock.mockReturnValue({
      status: 'ready',
      revision: 14,
      message: null,
    })
    let surfaceHeight = 12
    surfaceSampleMock.mockImplementation((_nodeId, x, z) => ({
      point: new THREE.Vector3(x, surfaceHeight, z),
      normal: new THREE.Vector3(0, 1, 0),
      kind: 'terrain',
      distanceToRoad: null,
      revision: 14,
    }))
    terrainHeightMock.mockImplementation(() => surfaceHeight)

    const routeNode = createRouteNode()
    const vehicleNode = {
      id: 'vehicle-undulation',
      name: 'Vehicle',
      nodeType: 'Mesh',
      components: {
        vehicle: {
          id: 'vehicle-component',
          type: 'vehicle',
          enabled: true,
          props: clampVehicleComponentProps({
            indexRightAxis: 2,
            indexUpAxis: 1,
            indexForwardAxis: 0,
          }),
        },
        autoTour: {
          id: 'tour-undulation',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 5,
            loop: false,
          }),
        },
      },
    } as any
    const vehicleObject = new THREE.Object3D()
    vehicleObject.position.set(0, 12.5, 0)
    vehicleObject.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.2)))
    const nodeObjectMap = new Map<string, THREE.Object3D>([
      [routeNode.id, new THREE.Object3D()],
      [vehicleNode.id, vehicleObject],
    ])
    const nodes = new Map<string, any>([
      [routeNode.id, routeNode],
      [vehicleNode.id, vehicleNode],
    ])
    const runtime = createAutoTourRuntime({
      iterNodes: () => nodes.values(),
      resolveNodeById: (nodeId) => nodes.get(nodeId) ?? null,
      nodeObjectMap,
      isManualDriveActive: () => false,
    })

    runtime.startTour(vehicleNode.id)
    runtime.update(0.1)
    const uphillY = vehicleObject.position.y
    expect(uphillY).toBeCloseTo(12.54, 1)

    surfaceHeight = 8
    surfaceStateMock.mockReturnValue({
      status: 'ready',
      revision: 15,
      message: null,
    })
    runtime.update(0.1)
    const downhillTarget = 8.54
    expect(vehicleObject.position.y).toBeLessThan(uphillY)
    expect(vehicleObject.position.y).toBeGreaterThan(downhillTarget + 1)
  })

  it('moves a vehicle directly along route elevation without a physics instance', () => {
    surfaceStateMock.mockReturnValue({
      status: 'ready',
      revision: 9,
      message: null,
    })
    surfaceSampleMock.mockImplementation((_nodeId, x, z) => ({
      point: new THREE.Vector3(x, 40 + x * 0.25, z),
      normal: new THREE.Vector3(0, 1, 0),
      kind: 'terrain',
      distanceToRoad: null,
      revision: 9,
    }))

    const routeNode = createRouteNode()
    const vehicleNode = {
      id: 'vehicle-1',
      name: 'Vehicle',
      nodeType: 'Mesh',
      components: {
        autoTour: {
          id: 'tour-1',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 2,
            loop: false,
          }),
        },
      },
    } as any
    const vehicleObject = new THREE.Object3D()
    vehicleObject.position.set(0, 40, 0)
    const routeObject = new THREE.Object3D()
    const nodeObjectMap = new Map<string, THREE.Object3D>([
      [routeNode.id, routeObject],
      [vehicleNode.id, vehicleObject],
    ])
    const nodes = new Map<string, any>([
      [routeNode.id, routeNode],
      [vehicleNode.id, vehicleNode],
    ])
    const runtime = createAutoTourRuntime({
      iterNodes: () => nodes.values(),
      resolveNodeById: (nodeId) => nodes.get(nodeId) ?? null,
      nodeObjectMap,
      isManualDriveActive: () => false,
    })

    runtime.startTour(vehicleNode.id)
    runtime.update(1)

    expect(vehicleObject.position.x).toBeGreaterThan(0)
    expect(vehicleObject.position.y).toBeGreaterThan(40)
    expect(Number.isFinite(vehicleObject.quaternion.w)).toBe(true)
  })

  it('snaps a vehicle to the nearest route point with a complete world quaternion', () => {
    surfaceStateMock.mockReturnValue({
      status: 'ready',
      revision: 10,
      message: null,
    })
    surfaceSampleMock.mockImplementation((_nodeId, x, z) => ({
      point: new THREE.Vector3(x, 20, z),
      normal: new THREE.Vector3(0, 1, 0),
      kind: 'terrain',
      distanceToRoad: null,
      revision: 10,
    }))
    const routeNode = createRouteNode()
    const vehicleNode = {
      id: 'vehicle-snap-1',
      name: 'Vehicle Snap',
      nodeType: 'Mesh',
      components: {
        autoTour: {
          id: 'tour-snap-1',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 2,
            loop: false,
          }),
        },
        vehicle: {
          id: 'vehicle-component-snap-1',
          type: 'vehicle',
          enabled: true,
          props: clampVehicleComponentProps(null),
        },
      },
    } as any
    const vehicleObject = new THREE.Object3D()
    vehicleObject.position.set(4, 20, 3)
    const nodes = new Map<string, any>([
      [routeNode.id, routeNode],
      [vehicleNode.id, vehicleNode],
    ])
    const nodeObjectMap = new Map<string, THREE.Object3D>([
      [routeNode.id, new THREE.Object3D()],
      [vehicleNode.id, vehicleObject],
    ])
    const runtime = createAutoTourRuntime({
      iterNodes: () => nodes.values(),
      resolveNodeById: (nodeId) => nodes.get(nodeId) ?? null,
      nodeObjectMap,
      isManualDriveActive: () => false,
    })

    const snap = runtime.resolveRouteSnap(vehicleNode.id)

    expect(snap).not.toBeNull()
    expect(snap!.worldPosition.x).toBeCloseTo(4)
    expect(snap!.worldPosition.z).toBeCloseTo(0)
    expect(Math.abs(snap!.worldQuaternion.length())).toBeCloseTo(1)
  })
})

describe('VehicleMotionAuthorityController', () => {
  it('disables collisions during auto-surface and restores them for manual physics', () => {
    const controller = new VehicleMotionAuthorityController()
    const body = {
      collisionResponse: true,
      collisionFilterMask: 0xffff,
      collisionFilterGroup: 0x0001,
      velocity: { set: vi.fn() },
      angularVelocity: { set: vi.fn() },
      sleep: vi.fn(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
    } as any
    const object = new THREE.Object3D()

    controller.beginAutoSurface('vehicle-1', {
      object,
      body,
      bodies: [body],
      orientationAdjustment: null,
    })

    expect(controller.getState('vehicle-1')).toBe('auto-surface')
    expect(controller.shouldWritePhysicsToObject('vehicle-1')).toBe(false)
    expect(controller.shouldIncludeGroundAnchor('vehicle-1')).toBe(false)
    expect(body.collisionResponse).toBe(false)
    expect(body.collisionFilterMask).toBe(0)

    controller.endAutoSurface('vehicle-1')
    expect(controller.getState('vehicle-1')).toBe('idle-physics')
    expect(body.collisionResponse).toBe(true)
    expect(body.collisionFilterMask).toBe(0xffff)
    expect(body.collisionFilterGroup).toBe(0x0001)
  })
})

describe('CharacterAutoTourRuntimeManager', () => {
  beforeEach(() => {
    clearGuideRouteEvaluationCache()
    surfaceStateMock.mockReturnValue({
      status: 'ready',
      revision: 21,
      message: null,
    })
    surfaceSampleMock.mockImplementation((_nodeId, x, z) => ({
      point: new THREE.Vector3(x, 20, z),
      normal: new THREE.Vector3(0, 1, 0),
      kind: 'terrain',
      distanceToRoad: null,
      revision: 21,
    }))
  })

  function createCharacterTourFixture() {
    const routeNode = createRouteNode()
    const characterNode = {
      id: 'character-1',
      name: 'Character',
      nodeType: 'Group',
      components: {
        autoTour: {
          id: 'tour-character-1',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 2,
            loop: false,
          }),
        },
        characterController: {
          id: 'controller-character-1',
          type: 'characterController',
          enabled: true,
          props: clampCharacterControllerComponentProps({
            forwardAxis: '+x',
            walkSpeed: 2,
          }),
        },
      },
    } as any
    const characterObject = new THREE.Object3D()
    characterObject.position.set(0, 20, 0)
    const nodes = new Map<string, any>([
      [routeNode.id, routeNode],
      [characterNode.id, characterNode],
    ])
    const nodeObjectMap = new Map<string, THREE.Object3D>([
      [routeNode.id, new THREE.Object3D()],
      [characterNode.id, characterObject],
    ])
    const onTourComplete = vi.fn()
    const host = {
      iterNodes: () => nodes.entries(),
      resolveNode: (nodeId: string) => nodes.get(nodeId) ?? null,
      nodeObjectMap,
      onTourComplete,
    }
    return {
      manager: new CharacterAutoTourRuntimeManager(),
      host,
      characterNode,
      characterObject,
      onTourComplete,
    }
  }

  it('stays idle until activated and freezes movement while paused', () => {
    const { manager, host, characterNode, characterObject } = createCharacterTourFixture()

    manager.refresh(host)
    manager.update(host, 1)
    expect(manager.size).toBe(0)
    expect(manager.isActive(characterNode.id)).toBe(false)
    expect(characterObject.position.x).toBeCloseTo(0)

    manager.activate(characterNode.id)
    manager.refresh(host)
    manager.update(host, 1)
    expect(manager.isActive(characterNode.id)).toBe(true)
    expect(characterObject.position.x).toBeGreaterThan(0)

    const pausedX = characterObject.position.x
    manager.setPaused(characterNode.id, true)
    manager.update(host, 1)
    expect(characterObject.position.x).toBeCloseTo(pausedX)
    expect(manager.getInput(characterNode.id)?.moveZ).toBe(0)

    manager.setPaused(characterNode.id, false)
    manager.update(host, 1)
    expect(characterObject.position.x).toBeGreaterThan(pausedX)

    manager.deactivate(characterNode.id)
    manager.update(host, 1)
    expect(manager.size).toBe(0)
  })

  it('projects a character to the nearest route point with route alignment', () => {
    const { manager, host, characterNode, characterObject } = createCharacterTourFixture()
    characterObject.position.set(4, 20, 3)

    const snap = manager.resolveRouteSnap(host, characterNode.id)

    expect(snap).not.toBeNull()
    expect(snap!.worldPosition.x).toBeCloseTo(4)
    expect(snap!.worldPosition.y).toBeCloseTo(20.52)
    expect(snap!.worldPosition.z).toBeCloseTo(0)
    expect(snap!.forwardWorld.x).toBeCloseTo(1)
    expect(Math.abs(snap!.worldQuaternion.length())).toBeCloseTo(1)
  })

  it('stops at the endpoint and reports completion for non-loop routes', () => {
    const {
      manager,
      host,
      characterNode,
      characterObject,
      onTourComplete,
    } = createCharacterTourFixture()

    manager.activate(characterNode.id)
    manager.refresh(host)
    characterObject.position.set(11.8, 20, 0)
    manager.update(host, 1)

    expect(characterObject.position.x).toBeCloseTo(12)
    expect(manager.isActive(characterNode.id)).toBe(false)
    expect(manager.size).toBe(0)
    expect(onTourComplete).toHaveBeenCalledOnce()
    expect(onTourComplete).toHaveBeenCalledWith(characterNode.id)
  })
})
