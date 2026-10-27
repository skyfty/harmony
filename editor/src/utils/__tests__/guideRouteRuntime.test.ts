import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAutoTourRuntime } from '@schema/autoTourRuntime'
import {
  clampAutoTourComponentProps,
  clampCharacterControllerComponentProps,
  clampGuideRouteComponentProps,
  clampVehicleComponentProps,
  type GuideRouteComponentProps,
} from '@schema/components'
import { CharacterAutoTourRuntimeManager } from '@schema/characterAutoTourRuntime'
import {
  clearGuideRouteEvaluationCache,
  evaluateGuideRoute,
  sampleEvaluatedGuideRouteAtDistance,
} from '@schema/guideRouteRuntime'
import { buildGuideRouteTravelWindow } from '@schema/guideRouteTourTarget'

const surfaceMocks = vi.hoisted(() => ({
  state: vi.fn(),
  sample: vi.fn(),
  centerline: vi.fn(),
}))

vi.mock('@schema/proceduralLandscape/runtime', () => ({
  getProceduralLandscapeGuideRouteSurfaceState: (...args: unknown[]) => surfaceMocks.state(...args),
  getProceduralLandscapeRoadCenterlineLocal: (...args: unknown[]) => surfaceMocks.centerline(...args),
  sampleProceduralLandscapeGuideRouteSurface: (...args: unknown[]) => surfaceMocks.sample(...args),
}))

function pathProps(overrides: Partial<GuideRouteComponentProps> = {}): GuideRouteComponentProps {
  return clampGuideRouteComponentProps({
    loop: false,
    legs: [
      {
        id: 'path-1',
        kind: 'path',
        travelMode: 'vehicle',
        speedProfile: {
          cruiseSpeedMps: 8,
          lateralAccelLimitMps2: 2.5,
        },
        surfaceProviderNodeId: null,
        preserveAuthoredY: true,
        anchors: [
          { x: 0, y: 20, z: 0 },
          { x: 12, y: 20, z: 0 },
        ],
      },
    ],
    stops: [],
    transitions: [],
    ...overrides,
  })
}

function createRouteNode(props: Partial<GuideRouteComponentProps>) {
  return {
    id: 'route-1',
    name: 'Guide Route',
    nodeType: 'Mesh',
    dynamicMesh: { type: 'GuideRoute', vertices: [] },
    components: {
      guideRoute: {
        id: 'guide-component',
        type: 'guideRoute',
        enabled: true,
        props: clampGuideRouteComponentProps(props),
      },
    },
  } as any
}

describe('Guide Route compiler', () => {
  beforeEach(() => {
    clearGuideRouteEvaluationCache()
    surfaceMocks.state.mockReset()
    surfaceMocks.sample.mockReset()
    surfaceMocks.centerline.mockReset()
    surfaceMocks.state.mockReturnValue({
      status: 'ready',
      revision: 7,
      message: null,
    })
    surfaceMocks.sample.mockImplementation((_nodeId: string, x: number, z: number) => ({
      point: new THREE.Vector3(x, 10, z),
      normal: new THREE.Vector3(0, 1, 0),
      kind: 'road',
      distanceToRoad: 0,
      revision: 7,
    }))
  })

  it('compiles an authored path without requiring a landscape provider', () => {
    const result = evaluateGuideRoute({
      routeNode: createRouteNode(pathProps()),
      providerObject: null,
    })
    expect(result.status).toBe('ready')
    expect(result.legs).toHaveLength(1)
    expect(result.points[0]?.y).toBeCloseTo(20)
    expect(result.points[result.points.length - 1]?.x).toBeCloseTo(12)
  })

  it('compiles provider-backed paths from the graded visible surface', () => {
    surfaceMocks.sample.mockImplementation((_nodeId: string, x: number, z: number) => ({
      point: new THREE.Vector3(x, x < 6 ? 10 : 14, z),
      normal: new THREE.Vector3(x < 6 ? 0 : -0.6, 1, 0).normalize(),
      kind: 'terrain',
      distanceToRoad: null,
      revision: 7,
    }))
    const result = evaluateGuideRoute({
      routeNode: createRouteNode(pathProps({
        legs: [{
          id: 'graded-path',
          kind: 'path',
          travelMode: 'vehicle',
          speedProfile: { cruiseSpeedMps: 8, lateralAccelLimitMps2: 2.5 },
          surfaceProviderNodeId: 'landscape-1',
          preserveAuthoredY: false,
          anchors: [
            { x: 0, y: 100, z: 0 },
            { x: 12, y: 100, z: 0 },
          ],
        }],
      })),
      providerObject: new THREE.Object3D(),
    })

    expect(result.status).toBe('ready')
    expect(result.points[0]?.y).toBeCloseTo(10)
    expect(result.points[result.points.length - 1]?.y).toBeCloseTo(14)
    expect(result.normals[result.normals.length - 1]?.x).toBeLessThan(-0.4)
  })

  it('projects a stop onto its assigned leg and preserves its original anchor', () => {
    const props = pathProps({
      stops: [
        {
          id: 'stop-1',
          name: 'Viewpoint',
          thumbnailAssetId: null,
          anchor: { x: 5, y: 24, z: 30 },
          legId: 'path-1',
          behavior: null,
        },
      ],
    })
    const result = evaluateGuideRoute({
      routeNode: createRouteNode(props),
      providerObject: null,
    })
    expect(result.stops).toHaveLength(1)
    expect(result.stops[0]?.legDistance).toBeCloseTo(5)
    expect(result.stops[0]?.projectedPoint.x).toBeCloseTo(5)
    expect(result.stops[0]?.definition.anchor.z).toBe(30)
  })

  it('clips a generated road interval and offsets to the travel-right lane', () => {
    surfaceMocks.centerline.mockReturnValue({
      pointsXZ: [-20, 0, 0, 0, 20, 0],
      algorithmVersion: 2,
      authoringSampleStep: 1,
      authoringCellSize: 1,
    })
    const props = pathProps({
      legs: [
        {
          id: 'road-1',
          kind: 'road',
          travelMode: 'vehicle',
          speedProfile: {
            cruiseSpeedMps: 12,
            lateralAccelLimitMps2: 2.5,
          },
          providerNodeId: 'landscape-1',
          startT: 0.25,
          endT: 0.75,
          laneOffsetM: 2,
          sampleSpacingM: 1,
        },
      ],
    })
    const result = evaluateGuideRoute({
      routeNode: createRouteNode(props),
      providerObject: new THREE.Object3D(),
    })
    expect(result.status).toBe('ready')
    expect(result.points[0]?.x).toBeCloseTo(-10)
    expect(result.points[result.points.length - 1]?.x).toBeCloseTo(10)
    expect(result.points.every((point) => Math.abs(point.z - 2) < 1e-5)).toBe(true)
  })

  it('reverses road direction and places the offset on the opposite side', () => {
    surfaceMocks.centerline.mockReturnValue({
      pointsXZ: [-20, 0, 0, 0, 20, 0],
      algorithmVersion: 2,
      authoringSampleStep: 1,
      authoringCellSize: 1,
    })
    const props = pathProps({
      legs: [
        {
          id: 'road-reverse',
          kind: 'road',
          travelMode: 'vehicle',
          speedProfile: {
            cruiseSpeedMps: 8,
            lateralAccelLimitMps2: 2,
          },
          providerNodeId: 'landscape-1',
          startT: 0.75,
          endT: 0.25,
          laneOffsetM: 2,
          sampleSpacingM: 1,
        },
      ],
    })
    const result = evaluateGuideRoute({
      routeNode: createRouteNode(props),
      providerObject: new THREE.Object3D(),
    })
    expect(result.status).toBe('ready')
    expect(result.points[0]?.x).toBeGreaterThan(result.points[result.points.length - 1]!.x)
    expect(result.points.every((point) => Math.abs(point.z + 2) < 1e-5)).toBe(true)
  })

  it('builds a directed travel window to a projected stop', () => {
    const props = pathProps({
      stops: [
        {
          id: 'stop-1',
          name: 'Middle',
          thumbnailAssetId: null,
          anchor: { x: 4, y: 20, z: 0 },
          legId: 'path-1',
          behavior: null,
        },
        {
          id: 'stop-2',
          name: 'End',
          thumbnailAssetId: null,
          anchor: { x: 10, y: 20, z: 0 },
          legId: 'path-1',
          behavior: null,
        },
      ],
    })
    const route = evaluateGuideRoute({
      routeNode: createRouteNode(props),
      providerObject: null,
    })
    const window = buildGuideRouteTravelWindow(
      route,
      8,
      { routeNodeId: route.routeNodeId, destinationStopId: 'stop-1' },
      false,
    )
    expect(window?.direction).toBe(-1)
    expect(window?.route.points[0]?.x).toBeCloseTo(8)
    expect(window?.route.points[window.route.points.length - 1]?.x).toBeCloseTo(4)
    expect(window?.route.stops.map((stop) => stop.definition.id)).toEqual(['stop-1'])
    expect(window?.route.stops[0]?.routeDistance).toBeCloseTo(4)
  })
})

describe('Guide Route playback events', () => {
  beforeEach(() => {
    clearGuideRouteEvaluationCache()
    surfaceMocks.state.mockReturnValue({
      status: 'ready',
      revision: 1,
      message: null,
    })
    surfaceMocks.sample.mockImplementation((_nodeId: string, x: number, z: number) => ({
      point: new THREE.Vector3(x, 0, z),
      normal: new THREE.Vector3(0, 1, 0),
      kind: 'road',
      distanceToRoad: 0,
      revision: 1,
    }))
  })

  function createPlayback(overrides: Partial<GuideRouteComponentProps> = {}) {
    const routeNode = createRouteNode(pathProps(overrides))
    const vehicleNode = {
      id: 'vehicle-1',
      name: 'Vehicle',
      nodeType: 'Mesh',
      components: {
        autoTour: {
          id: 'auto-tour',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 4,
          }),
        },
      },
    } as any
    const vehicleObject = new THREE.Object3D()
    vehicleObject.position.set(0, 20, 0)
    const nodeObjectMap = new Map<string, THREE.Object3D>([
      [routeNode.id, new THREE.Object3D()],
      [vehicleNode.id, vehicleObject],
    ])
    const nodes = new Map<string, any>([
      [routeNode.id, routeNode],
      [vehicleNode.id, vehicleNode],
    ])
    return { routeNode, vehicleNode, vehicleObject, nodes, nodeObjectMap }
  }

  it('keeps the vehicle pose and all footprint contacts on the provider surface', () => {
    const expectedNormal = new THREE.Vector3(0, 1, -0.1).normalize()
    surfaceMocks.sample.mockImplementation((_nodeId: string, x: number, z: number) => ({
      point: new THREE.Vector3(x, 10 + z * 0.1, z),
      normal: expectedNormal.clone(),
      kind: 'terrain',
      distanceToRoad: null,
      revision: 1,
    }))
    const routeNode = createRouteNode(pathProps({
      legs: [{
        id: 'graded-path',
        kind: 'path',
        travelMode: 'vehicle',
        speedProfile: { cruiseSpeedMps: 8, lateralAccelLimitMps2: 2.5 },
        surfaceProviderNodeId: 'landscape-1',
        preserveAuthoredY: false,
        anchors: [
          { x: 0, y: 100, z: 0 },
          { x: 20, y: 100, z: 0 },
        ],
      }],
      stops: [{
        id: 'graded-stop',
        name: 'Graded stop',
        thumbnailAssetId: null,
        anchor: { x: 20, y: 100, z: 0 },
        legId: 'graded-path',
        behavior: null,
      }],
    }))
    const vehicleObject = new THREE.Group()
    vehicleObject.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4)))
    vehicleObject.position.set(0, 20, 0)
    const vehicleNode = {
      id: 'vehicle-graded',
      name: 'Vehicle',
      nodeType: 'Mesh',
      components: {
        autoTour: {
          id: 'auto-tour',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 8,
          }),
        },
        vehicle: {
          id: 'vehicle',
          type: 'vehicle',
          enabled: true,
          props: clampVehicleComponentProps({
            indexRightAxis: 0,
            indexUpAxis: 1,
            indexForwardAxis: 2,
          }),
        },
      },
    } as any
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

    const target = {
      routeNodeId: routeNode.id,
      destinationStopId: 'graded-stop',
    }
    const snap = runtime.resolveRouteSnap(vehicleNode.id, target)
    expect(snap).not.toBeNull()
    const snapUp = new THREE.Vector3(0, 1, 0).applyQuaternion(snap!.worldQuaternion)
    expect(snapUp.distanceTo(expectedNormal)).toBeLessThan(1e-6)
    runtime.startTour(vehicleNode.id, target)
    runtime.seedTourPlaybackState(vehicleNode.id, snap!)
    runtime.update(0.5)
    vehicleObject.updateMatrixWorld(true)

    const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(vehicleObject.quaternion)
    expect(worldUp.distanceTo(expectedNormal)).toBeLessThan(1e-6)

    const halfRight = 1 * (1 - 0.15)
    const halfForward = 2 * (1 - 0.15)
    for (const rightSign of [-1, 1]) {
      for (const forwardSign of [-1, 1]) {
        const contact = new THREE.Vector3(
          rightSign * halfRight,
          -0.5,
          forwardSign * halfForward,
        ).applyMatrix4(vehicleObject.matrixWorld)
        const clearance = contact.y - (10 + contact.z * 0.1)
        expect(clearance).toBeCloseTo(0.04, 5)
      }
    }
  })

  it('uses four configured wheel contacts for default vehicle axes', () => {
    const surfaceHeight = (x: number, z: number) => 10 + x * 0.12 + z * 0.08
    const expectedNormal = new THREE.Vector3(-0.12, 1, -0.08).normalize()
    surfaceMocks.sample.mockImplementation((_nodeId: string, x: number, z: number) => ({
      point: new THREE.Vector3(x, surfaceHeight(x, z), z),
      normal: expectedNormal.clone(),
      kind: 'terrain',
      distanceToRoad: null,
      revision: 1,
    }))
    const routeNode = createRouteNode(pathProps({
      legs: [{
        id: 'graded-path',
        kind: 'path',
        travelMode: 'vehicle',
        speedProfile: { cruiseSpeedMps: 8, lateralAccelLimitMps2: 2.5 },
        surfaceProviderNodeId: 'landscape-1',
        preserveAuthoredY: false,
        anchors: [
          { x: 0, y: 100, z: 0 },
          { x: 20, y: 100, z: 0 },
        ],
      }],
    }))
    const vehicleObject = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.6, 3, 4))
    vehicleObject.add(body)
    vehicleObject.position.set(0, 20, 0)
    const wheelConnections = [
      { x: 1.5, z: -0.9, isFrontWheel: true },
      { x: 1.5, z: 0.9, isFrontWheel: true },
      { x: -1.3, z: -0.9, isFrontWheel: false },
      { x: -1.3, z: 0.9, isFrontWheel: false },
    ]
    const vehicleNode = {
      id: 'vehicle-default-axes',
      name: 'Vehicle',
      nodeType: 'Mesh',
      components: {
        autoTour: {
          id: 'auto-tour',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 8,
          }),
        },
        vehicle: {
          id: 'vehicle',
          type: 'vehicle',
          enabled: true,
          props: clampVehicleComponentProps({
            wheelScaleMode: 'relative',
            indexRightAxis: 2,
            indexUpAxis: 1,
            indexForwardAxis: 0,
            wheels: wheelConnections.map((connection, index) => ({
              id: `wheel-${index + 1}`,
              nodeId: null,
              chassisConnectionPointLocal: {
                x: connection.x,
                y: -0.4,
                z: connection.z,
              },
              radius: 0.45,
              suspensionRestLength: 0.45,
              directionLocal: { x: 0, y: -1, z: 0 },
              axleLocal: { x: 0, y: 0, z: 1 },
              isFrontWheel: connection.isFrontWheel,
            })) as any,
          }),
        },
      },
    } as any
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

    runtime.startTour(vehicleNode.id)
    runtime.update(0.5)
    vehicleObject.updateMatrixWorld(true)

    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(vehicleObject.quaternion)
    expect(up.distanceTo(expectedNormal)).toBeLessThan(2e-3)
    for (const connection of wheelConnections) {
      const contact = new THREE.Vector3(
        connection.x,
        -0.4 - 0.45 - 0.45,
        connection.z,
      ).applyMatrix4(vehicleObject.matrixWorld)
      expect(contact.y - surfaceHeight(contact.x, contact.z)).toBeCloseTo(0.04, 2)
    }
  })

  it('prefers visible wheel contact bounds over the chassis bounds', () => {
    surfaceMocks.sample.mockImplementation((_nodeId: string, x: number, z: number) => ({
      point: new THREE.Vector3(x, 10, z),
      normal: new THREE.Vector3(0, 1, 0),
      kind: 'road',
      distanceToRoad: 0,
      revision: 1,
    }))
    const routeNode = createRouteNode(pathProps({
      legs: [{
        id: 'road-path',
        kind: 'path',
        travelMode: 'vehicle',
        speedProfile: { cruiseSpeedMps: 8, lateralAccelLimitMps2: 2.5 },
        surfaceProviderNodeId: 'landscape-1',
        preserveAuthoredY: false,
        anchors: [
          { x: 0, y: 100, z: 0 },
          { x: 20, y: 100, z: 0 },
        ],
      }],
    }))
    const vehicleObject = new THREE.Group()
    vehicleObject.add(new THREE.Mesh(new THREE.BoxGeometry(4.6, 3.4, 4)))
    vehicleObject.position.set(0, 20, 0)
    const wheelConnections = [
      { id: 'fl', x: 1.5, z: -0.9, isFrontWheel: true },
      { id: 'fr', x: 1.5, z: 0.9, isFrontWheel: true },
      { id: 'rl', x: -1.3, z: -0.9, isFrontWheel: false },
      { id: 'rr', x: -1.3, z: 0.9, isFrontWheel: false },
    ]
    for (const connection of wheelConnections) {
      const wheel = new THREE.Group()
      wheel.userData.nodeId = connection.id
      wheel.position.set(connection.x, -0.975, connection.z)
      wheel.add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6)))
      vehicleObject.add(wheel)
    }
    const vehicleNode = {
      id: 'vehicle-visible-wheels',
      name: 'Vehicle',
      nodeType: 'Mesh',
      components: {
        autoTour: {
          id: 'auto-tour',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 8,
          }),
        },
        vehicle: {
          id: 'vehicle',
          type: 'vehicle',
          enabled: true,
          props: clampVehicleComponentProps({
            indexRightAxis: 2,
            indexUpAxis: 1,
            indexForwardAxis: 0,
            wheels: wheelConnections.map((connection) => ({
              id: connection.id,
              nodeId: connection.id,
              chassisConnectionPointLocal: { x: connection.x, y: -0.4, z: connection.z },
              radius: 0.45,
              suspensionRestLength: 0.45,
              directionLocal: { x: 0, y: -1, z: 0 },
              axleLocal: { x: 0, y: 0, z: 1 },
              isFrontWheel: connection.isFrontWheel,
            })) as any,
          }),
        },
      },
    } as any
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

    runtime.startTour(vehicleNode.id)
    runtime.update(0.5)
    vehicleObject.updateMatrixWorld(true)

    for (const connection of wheelConnections) {
      const contact = new THREE.Vector3(
        connection.x,
        -0.975 - 0.25,
        connection.z,
      ).applyMatrix4(vehicleObject.matrixWorld)
      expect(contact.y - 10).toBeCloseTo(0.04, 4)
    }
  })

  it('smooths vehicle heading through route corners', () => {
    const routeNode = createRouteNode(pathProps({
      legs: [{
        id: 'corner-path',
        kind: 'path',
        travelMode: 'vehicle',
        speedProfile: { cruiseSpeedMps: 8, lateralAccelLimitMps2: 8 },
        surfaceProviderNodeId: null,
        preserveAuthoredY: true,
        anchors: [
          { x: 0, y: 10, z: 0 },
          { x: 10, y: 10, z: 0 },
          { x: 10, y: 10, z: 10 },
        ],
      }],
    }))
    const vehicleObject = new THREE.Group()
    vehicleObject.add(new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4)))
    vehicleObject.position.set(0, 10, 0)
    const vehicleNode = {
      id: 'vehicle-corner',
      name: 'Vehicle',
      nodeType: 'Mesh',
      components: {
        autoTour: {
          id: 'auto-tour',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 8,
          }),
        },
        vehicle: {
          id: 'vehicle',
          type: 'vehicle',
          enabled: true,
          props: clampVehicleComponentProps({
            indexRightAxis: 2,
            indexUpAxis: 1,
            indexForwardAxis: 0,
          }),
        },
      },
    } as any
    const nodes = new Map<string, any>([
      [routeNode.id, routeNode],
      [vehicleNode.id, vehicleNode],
    ])
    const runtime = createAutoTourRuntime({
      iterNodes: () => nodes.values(),
      resolveNodeById: (nodeId) => nodes.get(nodeId) ?? null,
      nodeObjectMap: new Map<string, THREE.Object3D>([
        [routeNode.id, new THREE.Object3D()],
        [vehicleNode.id, vehicleObject],
      ]),
      isManualDriveActive: () => false,
    })

    runtime.startTour(vehicleNode.id)
    const previousForward = new THREE.Vector3(1, 0, 0)
    const previousPosition = vehicleObject.position.clone()
    let maxHeadingStep = 0
    let movingFrameCount = 0
    for (let frame = 0; frame < 270; frame += 1) {
      runtime.update(1 / 120)
      vehicleObject.updateMatrixWorld(true)
      if (vehicleObject.position.distanceToSquared(previousPosition) > 1e-10) {
        movingFrameCount += 1
      }
      previousPosition.copy(vehicleObject.position)
      const forward = new THREE.Vector3(1, 0, 0)
        .applyQuaternion(vehicleObject.getWorldQuaternion(new THREE.Quaternion()))
      forward.y = 0
      forward.normalize()
      maxHeadingStep = Math.max(maxHeadingStep, previousForward.angleTo(forward))
      previousForward.copy(forward)
    }

    expect(maxHeadingStep).toBeLessThan(THREE.MathUtils.degToRad(10))
    expect(movingFrameCount).toBe(270)
    expect(previousForward.z).toBeGreaterThan(0.95)
  })

  it('keeps a character collider bottom on the graded provider surface', () => {
    surfaceMocks.sample.mockImplementation((_nodeId: string, x: number, z: number) => ({
      point: new THREE.Vector3(x, 10 + x * 0.2, z),
      normal: new THREE.Vector3(-0.2, 1, 0).normalize(),
      kind: 'terrain',
      distanceToRoad: null,
      revision: 1,
    }))
    const routeNode = createRouteNode(pathProps({
      legs: [{
        id: 'character-graded-path',
        kind: 'path',
        travelMode: 'character',
        speedProfile: { cruiseSpeedMps: 2, lateralAccelLimitMps2: 2 },
        surfaceProviderNodeId: 'landscape-1',
        preserveAuthoredY: false,
        anchors: [
          { x: 0, y: 100, z: 0 },
          { x: 20, y: 100, z: 0 },
        ],
      }],
    }))
    const characterObject = new THREE.Object3D()
    characterObject.position.set(0, 20, 0)
    const characterNode = {
      id: 'character-graded',
      name: 'Visitor',
      nodeType: 'Mesh',
      components: {
        autoTour: {
          id: 'auto-tour',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 2,
          }),
        },
        characterController: {
          id: 'character-controller',
          type: 'characterController',
          enabled: true,
          props: clampCharacterControllerComponentProps({
            colliderRadius: 0.35,
            colliderHeight: 1.8,
            walkSpeed: 2,
          }),
        },
      },
    } as any
    const nodes = new Map<string, any>([
      [routeNode.id, routeNode],
      [characterNode.id, characterNode],
    ])
    const nodeObjectMap = new Map<string, THREE.Object3D>([
      [routeNode.id, new THREE.Object3D()],
      [characterNode.id, characterObject],
    ])
    const runtime = new CharacterAutoTourRuntimeManager()
    const host = {
      iterNodes: () => nodes.entries(),
      resolveNode: (nodeId: string) => nodes.get(nodeId) ?? null,
      nodeObjectMap,
    }

    runtime.activate(characterNode.id)
    runtime.refresh(host)
    runtime.update(host, 0.25)

    const expectedGroundY = 10 + characterObject.position.x * 0.2
    expect(characterObject.position.y).toBeCloseTo(expectedGroundY + 0.57, 5)
    expect(characterObject.position.y).toBeLessThan(20)
  })

  it('allows a character to follow a Both leg', () => {
    const routeNode = createRouteNode(pathProps({
      legs: [{
        id: 'shared-path',
        kind: 'path',
        travelMode: 'both',
        speedProfile: { cruiseSpeedMps: 2, lateralAccelLimitMps2: 2 },
        surfaceProviderNodeId: null,
        preserveAuthoredY: true,
        anchors: [
          { x: 0, y: 20, z: 0 },
          { x: 12, y: 20, z: 0 },
        ],
      }],
      stops: [{
        id: 'shared-stop',
        name: 'Shared stop',
        thumbnailAssetId: null,
        anchor: { x: 12, y: 20, z: 0 },
        legId: 'shared-path',
        behavior: null,
      }],
    }))
    const characterObject = new THREE.Object3D()
    characterObject.position.set(0, 20, 0)
    const characterNode = {
      id: 'character-shared',
      name: 'Visitor',
      nodeType: 'Mesh',
      components: {
        autoTour: {
          id: 'auto-tour',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 2,
          }),
        },
        characterController: {
          id: 'character-controller',
          type: 'characterController',
          enabled: true,
          props: clampCharacterControllerComponentProps({
            colliderRadius: 0.35,
            colliderHeight: 1.8,
            walkSpeed: 2,
          }),
        },
      },
    } as any
    const nodes = new Map<string, any>([
      [routeNode.id, routeNode],
      [characterNode.id, characterNode],
    ])
    const nodeObjectMap = new Map<string, THREE.Object3D>([
      [routeNode.id, new THREE.Object3D()],
      [characterNode.id, characterObject],
    ])
    const runtime = new CharacterAutoTourRuntimeManager()
    const host = {
      iterNodes: () => nodes.entries(),
      resolveNode: (nodeId: string) => nodes.get(nodeId) ?? null,
      nodeObjectMap,
    }
    const target = {
      routeNodeId: routeNode.id,
      destinationStopId: 'shared-stop',
    }
    const snap = runtime.resolveRouteSnap(host, characterNode.id, target)

    expect(snap?.travelWindow).not.toBeNull()
    runtime.activate(characterNode.id, target)
    runtime.refresh(host)
    runtime.update(host, 0.5)
    expect(characterObject.position.x).toBeGreaterThan(0)
  })

  it('fires a non-target stop once and continues along the route', () => {
    const playback = createPlayback({
      stops: [
        {
          id: 'stop-mid',
          name: 'Middle',
          thumbnailAssetId: null,
          anchor: { x: 4, y: 20, z: 10 },
          legId: 'path-1',
          behavior: null,
        },
      ],
    })
    let runtime: ReturnType<typeof createAutoTourRuntime> | null = null
    const onGuideStop = vi.fn((nodeId: string, _stop: unknown, context: { isTourTarget: boolean }) => {
      expect(runtime?.isPaused(nodeId)).toBe(false)
      expect(context.isTourTarget).toBe(false)
    })
    runtime = createAutoTourRuntime({
      iterNodes: () => playback.nodes.values(),
      resolveNodeById: (nodeId) => playback.nodes.get(nodeId) ?? null,
      nodeObjectMap: playback.nodeObjectMap,
      isManualDriveActive: () => false,
      onGuideStop,
    })
    runtime.startTour(playback.vehicleNode.id)
    runtime.update(1.1)
    runtime.update(1.1)
    expect(onGuideStop).toHaveBeenCalledTimes(1)
    expect(runtime.isPaused(playback.vehicleNode.id)).toBe(false)
    expect(playback.vehicleObject.position.x).toBeGreaterThan(4)
    expect(onGuideStop).toHaveBeenCalledTimes(1)
  })

  it('supports manual pause and resume without resetting route progress', () => {
    const playback = createPlayback()
    const runtime = createAutoTourRuntime({
      iterNodes: () => playback.nodes.values(),
      resolveNodeById: (nodeId) => playback.nodes.get(nodeId) ?? null,
      nodeObjectMap: playback.nodeObjectMap,
      isManualDriveActive: () => false,
    })
    runtime.startTour(playback.vehicleNode.id)
    runtime.update(0.5)
    const pausedFrom = playback.vehicleObject.position.clone()

    runtime.setPaused(playback.vehicleNode.id, true)
    runtime.update(1)
    expect(runtime.isPaused(playback.vehicleNode.id)).toBe(true)
    expect(playback.vehicleObject.position.distanceTo(pausedFrom)).toBeCloseTo(0)

    runtime.setPaused(playback.vehicleNode.id, false)
    runtime.update(0.5)
    expect(playback.vehicleObject.position.x).toBeGreaterThan(pausedFrom.x)
  })

  it('does not delay a later route transition for a non-target stop', () => {
    const playback = createPlayback({
      stops: [{
        id: 'early-stop',
        name: 'Early stop',
        thumbnailAssetId: null,
        anchor: { x: 4, y: 20, z: 0 },
        legId: 'path-1',
        behavior: null,
      }],
      transitions: [{
        id: 'handoff',
        afterLegId: 'path-1',
        behavior: {
          nodeId: 'parking',
          sequenceId: 'switch-to-character',
        },
      }],
    })
    const onGuideStop = vi.fn()
    const onGuideTransition = vi.fn()
    const runtime = createAutoTourRuntime({
      iterNodes: () => playback.nodes.values(),
      resolveNodeById: (nodeId) => playback.nodes.get(nodeId) ?? null,
      nodeObjectMap: playback.nodeObjectMap,
      isManualDriveActive: () => false,
      onGuideStop,
      onGuideTransition,
    })

    runtime.startTour(playback.vehicleNode.id)
    runtime.update(10)
    expect(onGuideStop).toHaveBeenCalledOnce()
    expect(onGuideTransition).toHaveBeenCalledOnce()
    expect(runtime.isPaused(playback.vehicleNode.id)).toBe(false)
  })

  it('keeps terminal completion behavior for routes without a stop', () => {
    const playback = createPlayback()
    const onTerminalStop = vi.fn()
    const runtime = createAutoTourRuntime({
      iterNodes: () => playback.nodes.values(),
      resolveNodeById: (nodeId) => playback.nodes.get(nodeId) ?? null,
      nodeObjectMap: playback.nodeObjectMap,
      isManualDriveActive: () => false,
      onTerminalStop,
    })

    runtime.startTour(playback.vehicleNode.id)
    runtime.update(10)
    expect(onTerminalStop).toHaveBeenCalledWith(playback.vehicleNode.id, 'guide-route-complete')
    expect(runtime.isTourActive(playback.vehicleNode.id)).toBe(false)
  })

  it('uses a selected branch route for snap and playback without rewriting AutoTour props', () => {
    const playback = createPlayback()
    const branchRoute = createRouteNode(pathProps({
      legs: [{
        id: 'branch-path',
        kind: 'path',
        travelMode: 'vehicle',
        speedProfile: { cruiseSpeedMps: 8, lateralAccelLimitMps2: 2.5 },
        surfaceProviderNodeId: null,
        preserveAuthoredY: true,
        anchors: [
          { x: 0, y: 24, z: 20 },
          { x: 16, y: 24, z: 20 },
        ],
      }],
      stops: [{
        id: 'branch-stop',
        name: 'Branch stop',
        thumbnailAssetId: 'image',
        anchor: { x: 12, y: 24, z: 20 },
        legId: 'branch-path',
        behavior: null,
      }],
    }))
    branchRoute.id = 'branch-route'
    branchRoute.components.guideRoute.id = 'branch-component'
    playback.nodes.set(branchRoute.id, branchRoute)
    playback.nodeObjectMap.set(branchRoute.id, new THREE.Object3D())
    const runtime = createAutoTourRuntime({
      iterNodes: () => playback.nodes.values(),
      resolveNodeById: (nodeId) => playback.nodes.get(nodeId) ?? null,
      nodeObjectMap: playback.nodeObjectMap,
      isManualDriveActive: () => false,
    })
    const target = {
      routeNodeId: branchRoute.id,
      destinationStopId: 'branch-stop',
    }
    const snap = runtime.resolveRouteSnap(playback.vehicleNode.id, target)
    expect(snap?.routeNodeId).toBe(branchRoute.id)
    runtime.startTour(playback.vehicleNode.id, target)
    runtime.seedTourPlaybackState(playback.vehicleNode.id, snap!)
    runtime.update(1)
    expect(playback.vehicleObject.position.z).toBeGreaterThan(0)
    expect(playback.vehicleNode.components.autoTour.props.routeNodeId).toBe('route-1')
  })

  it('allows a vehicle to follow a Both leg', () => {
    const playback = createPlayback({
      legs: [{
        id: 'shared-path',
        kind: 'path',
        travelMode: 'both',
        speedProfile: { cruiseSpeedMps: 8, lateralAccelLimitMps2: 2.5 },
        surfaceProviderNodeId: null,
        preserveAuthoredY: true,
        anchors: [
          { x: 0, y: 20, z: 0 },
          { x: 12, y: 20, z: 0 },
        ],
      }],
      stops: [{
        id: 'shared-stop',
        name: 'Shared stop',
        thumbnailAssetId: null,
        anchor: { x: 12, y: 20, z: 0 },
        legId: 'shared-path',
        behavior: null,
      }],
    })
    const runtime = createAutoTourRuntime({
      iterNodes: () => playback.nodes.values(),
      resolveNodeById: (nodeId) => playback.nodes.get(nodeId) ?? null,
      nodeObjectMap: playback.nodeObjectMap,
      isManualDriveActive: () => false,
    })
    const target = {
      routeNodeId: playback.routeNode.id,
      destinationStopId: 'shared-stop',
    }
    const snap = runtime.resolveRouteSnap(playback.vehicleNode.id, target)

    expect(snap?.travelWindow).not.toBeNull()
    runtime.startTour(playback.vehicleNode.id, target)
    runtime.seedTourPlaybackState(playback.vehicleNode.id, snap!)
    runtime.update(0.5)
    expect(playback.vehicleObject.position.x).toBeGreaterThan(0)
  })

  it('pauses at a targeted stop represented by a travel window', () => {
    const playback = createPlayback({
      stops: [{
        id: 'target-stop',
        name: 'Target stop',
        thumbnailAssetId: null,
        anchor: { x: 8, y: 20, z: 0 },
        legId: 'path-1',
        behavior: null,
      }],
    })
    const target = {
      routeNodeId: playback.routeNode.id,
      destinationStopId: 'target-stop',
    }
    const onGuideStop = vi.fn((_nodeId: string, _stop: unknown, context: { isTourTarget: boolean }) => {
      expect(context.isTourTarget).toBe(true)
    })
    const onTerminalStop = vi.fn()
    const runtime = createAutoTourRuntime({
      iterNodes: () => playback.nodes.values(),
      resolveNodeById: (nodeId) => playback.nodes.get(nodeId) ?? null,
      nodeObjectMap: playback.nodeObjectMap,
      isManualDriveActive: () => false,
      onGuideStop,
      onTerminalStop,
    })
    const snap = runtime.resolveRouteSnap(playback.vehicleNode.id, target)
    expect(snap?.travelWindow).not.toBeNull()
    runtime.startTour(playback.vehicleNode.id, target)
    runtime.seedTourPlaybackState(playback.vehicleNode.id, snap!)
    runtime.update(10)

    expect(onGuideStop).toHaveBeenCalledOnce()
    expect(onTerminalStop).not.toHaveBeenCalled()
    expect(runtime.isPaused(playback.vehicleNode.id)).toBe(true)
    expect(playback.vehicleObject.position.x).toBeCloseTo(8)

    runtime.setPaused(playback.vehicleNode.id, false)
    runtime.update(1)
    expect(onTerminalStop).toHaveBeenCalledOnce()
  })

  it('fires intermediate stop behavior without delaying the selected destination', () => {
    const playback = createPlayback({
      stops: [
        {
          id: 'intermediate-stop',
          name: 'Intermediate stop',
          thumbnailAssetId: null,
          anchor: { x: 4, y: 20, z: 0 },
          legId: 'path-1',
          behavior: null,
        },
        {
          id: 'target-stop',
          name: 'Target stop',
          thumbnailAssetId: null,
          anchor: { x: 8, y: 20, z: 0 },
          legId: 'path-1',
          behavior: null,
        },
      ],
    })
    const target = {
      routeNodeId: playback.routeNode.id,
      destinationStopId: 'target-stop',
    }
    const onGuideStop = vi.fn()
    const runtime = createAutoTourRuntime({
      iterNodes: () => playback.nodes.values(),
      resolveNodeById: (nodeId) => playback.nodes.get(nodeId) ?? null,
      nodeObjectMap: playback.nodeObjectMap,
      isManualDriveActive: () => false,
      onGuideStop,
    })
    const snap = runtime.resolveRouteSnap(playback.vehicleNode.id, target)
    runtime.startTour(playback.vehicleNode.id, target)
    runtime.seedTourPlaybackState(playback.vehicleNode.id, snap!)
    runtime.update(10)

    expect(onGuideStop.mock.calls.map((call) => [call[1].definition.id, call[2].isTourTarget])).toEqual([
      ['intermediate-stop', false],
      ['target-stop', true],
    ])
    expect(playback.vehicleObject.position.x).toBeCloseTo(8)
  })

  it('holds a transition before a farther selected destination', () => {
    const playback = createPlayback({
      legs: [
        {
          id: 'path-1',
          kind: 'path',
          travelMode: 'vehicle',
          speedProfile: { cruiseSpeedMps: 8, lateralAccelLimitMps2: 2.5 },
          surfaceProviderNodeId: null,
          preserveAuthoredY: true,
          anchors: [
            { x: 0, y: 20, z: 0 },
            { x: 12, y: 20, z: 0 },
          ],
        },
        {
          id: 'path-2',
          kind: 'path',
          travelMode: 'character',
          speedProfile: { cruiseSpeedMps: 2, lateralAccelLimitMps2: 2 },
          surfaceProviderNodeId: null,
          preserveAuthoredY: true,
          anchors: [
            { x: 12, y: 20, z: 0 },
            { x: 18, y: 20, z: 0 },
          ],
        },
      ],
      stops: [{
        id: 'target-stop',
        name: 'Far target',
        thumbnailAssetId: null,
        anchor: { x: 16, y: 20, z: 0 },
        legId: 'path-2',
        behavior: null,
      }],
      transitions: [{
        id: 'handoff',
        afterLegId: 'path-1',
        behavior: {
          nodeId: 'parking',
          sequenceId: 'switch-to-character',
        },
      }],
    })
    const target = {
      routeNodeId: playback.routeNode.id,
      destinationStopId: 'target-stop',
    }
    const onGuideStop = vi.fn()
    const onGuideTransition = vi.fn()
    const runtime = createAutoTourRuntime({
      iterNodes: () => playback.nodes.values(),
      resolveNodeById: (nodeId) => playback.nodes.get(nodeId) ?? null,
      nodeObjectMap: playback.nodeObjectMap,
      isManualDriveActive: () => false,
      onGuideStop,
      onGuideTransition,
    })
    const snap = runtime.resolveRouteSnap(playback.vehicleNode.id, target)
    runtime.startTour(playback.vehicleNode.id, target)
    runtime.seedTourPlaybackState(playback.vehicleNode.id, snap!)
    runtime.update(10)

    expect(onGuideTransition).toHaveBeenCalledOnce()
    expect(onGuideStop).not.toHaveBeenCalled()
    expect(playback.vehicleObject.position.x).toBeCloseTo(12)
  })

  it('lets the target-stop host exit auto-tour immediately at the stop pose', () => {
    const playback = createPlayback({
      stops: [{
        id: 'target-stop',
        name: 'Target stop',
        thumbnailAssetId: null,
        anchor: { x: 8, y: 20, z: 0 },
        legId: 'path-1',
        behavior: null,
      }],
    })
    const target = {
      routeNodeId: playback.routeNode.id,
      destinationStopId: 'target-stop',
    }
    let runtime: ReturnType<typeof createAutoTourRuntime> | null = null
    const onGuideStop = vi.fn((nodeId: string, _stop: unknown, context: { isTourTarget: boolean }) => {
      expect(context.isTourTarget).toBe(true)
      runtime?.stopTour(nodeId)
    })
    runtime = createAutoTourRuntime({
      iterNodes: () => playback.nodes.values(),
      resolveNodeById: (nodeId) => playback.nodes.get(nodeId) ?? null,
      nodeObjectMap: playback.nodeObjectMap,
      isManualDriveActive: () => false,
      onGuideStop,
    })
    const snap = runtime.resolveRouteSnap(playback.vehicleNode.id, target)
    runtime.startTour(playback.vehicleNode.id, target)
    runtime.seedTourPlaybackState(playback.vehicleNode.id, snap!)
    runtime.update(10)
    const stoppedPosition = playback.vehicleObject.position.clone()
    expect(stoppedPosition.x).toBeCloseTo(8)
    expect(runtime.isTourActive(playback.vehicleNode.id)).toBe(false)

    runtime.update(10)
    expect(playback.vehicleObject.position.distanceTo(stoppedPosition)).toBeCloseTo(0)
  })

  it('resets stop occurrence tracking after a route loop wraps', () => {
    const playback = createPlayback({
      loop: true,
      stops: [
        {
          id: 'loop-stop',
          name: 'Loop stop',
          thumbnailAssetId: null,
          anchor: { x: 4, y: 20, z: 0 },
          legId: 'path-1',
          behavior: null,
        },
      ],
    })
    const onGuideStop = vi.fn()
    const runtime = createAutoTourRuntime({
      iterNodes: () => playback.nodes.values(),
      resolveNodeById: (nodeId) => playback.nodes.get(nodeId) ?? null,
      nodeObjectMap: playback.nodeObjectMap,
      isManualDriveActive: () => false,
      onGuideStop,
    })
    runtime.startTour(playback.vehicleNode.id)
    for (let index = 0; index < 16; index += 1) {
      runtime.update(0.5)
    }
    expect(onGuideStop.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('holds at a transition until the behavior reports success', () => {
    const playback = createPlayback({
      transitions: [
        {
          id: 'handoff',
          afterLegId: 'path-1',
          behavior: {
            nodeId: 'parking',
            sequenceId: 'switch-to-character',
          },
        },
      ],
    })
    const onGuideTransition = vi.fn()
    const runtime = createAutoTourRuntime({
      iterNodes: () => playback.nodes.values(),
      resolveNodeById: (nodeId) => playback.nodes.get(nodeId) ?? null,
      nodeObjectMap: playback.nodeObjectMap,
      isManualDriveActive: () => false,
      onGuideTransition,
    })
    runtime.startTour(playback.vehicleNode.id)
    runtime.update(4)
    expect(onGuideTransition).toHaveBeenCalledOnce()
    const heldX = playback.vehicleObject.position.x
    runtime.update(4)
    expect(playback.vehicleObject.position.x).toBeCloseTo(heldX)
    runtime.completeGuideTransition(playback.vehicleNode.id, true)
    runtime.update(0.1)
    expect(playback.vehicleObject.position.x).toBeGreaterThanOrEqual(heldX)
  })

  it('samples normals and returns the source leg for each distance', () => {
    const route = evaluateGuideRoute({
      routeNode: createRouteNode(pathProps()),
      providerObject: null,
    })
    const sample = sampleEvaluatedGuideRouteAtDistance(route, 6)
    expect(sample?.normal.y).toBeCloseTo(1)
    expect(sample?.leg?.definition.id).toBe('path-1')
  })

  it('fires character route stops once while following the same compiled path', () => {
    const baseProps = pathProps()
    const routeNode = createRouteNode(pathProps({
      legs: baseProps.legs.map((leg) => ({
        ...leg,
        travelMode: 'character',
      })),
      stops: [
        {
          id: 'character-stop',
          name: 'Character stop',
          thumbnailAssetId: null,
          anchor: { x: 4, y: 20, z: 5 },
          legId: 'path-1',
          behavior: null,
        },
      ],
    }))
    const characterNode = {
      id: 'character-1',
      name: 'Visitor',
      nodeType: 'Mesh',
      components: {
        autoTour: {
          id: 'character-tour',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: routeNode.id,
            speedMps: 2,
          }),
        },
        characterController: {
          id: 'character-controller',
          type: 'characterController',
          enabled: true,
          props: clampCharacterControllerComponentProps({
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
    const onGuideStop = vi.fn((_nodeId: string, _stop: unknown, context: { isTourTarget: boolean }) => {
      expect(context.isTourTarget).toBe(false)
    })
    const runtime = new CharacterAutoTourRuntimeManager()
    const host = {
      iterNodes: () => nodes.entries(),
      resolveNode: (nodeId: string) => nodes.get(nodeId) ?? null,
      nodeObjectMap,
      onGuideStop,
    }
    runtime.activate(characterNode.id)
    runtime.refresh(host)
    for (let index = 0; index < 8; index += 1) {
      runtime.update(host, 0.25)
    }
    expect(onGuideStop).toHaveBeenCalledTimes(1)
    expect(runtime.getInput(characterNode.id)?.moveZ).toBeGreaterThan(0)
  })

  it('lets a character navigate to a stop on a different branch route', () => {
    const defaultRoute = createRouteNode(pathProps({
      legs: pathProps().legs.map((leg) => ({ ...leg, travelMode: 'character' })),
    }))
    const branchRoute = createRouteNode(pathProps({
      legs: [{
        id: 'character-branch',
        kind: 'path',
        travelMode: 'character',
        speedProfile: { cruiseSpeedMps: 2, lateralAccelLimitMps2: 2 },
        surfaceProviderNodeId: null,
        preserveAuthoredY: true,
        anchors: [
          { x: 0, y: 20, z: 8 },
          { x: 12, y: 20, z: 8 },
        ],
      }],
      stops: [
        {
          id: 'branch-intermediate',
          name: 'Branch intermediate',
          thumbnailAssetId: 'image',
          anchor: { x: 4, y: 20, z: 8 },
          legId: 'character-branch',
          behavior: null,
        },
        {
          id: 'branch-target',
          name: 'Branch target',
          thumbnailAssetId: 'image',
          anchor: { x: 8, y: 20, z: 8 },
          legId: 'character-branch',
          behavior: null,
        },
      ],
    }))
    branchRoute.id = 'branch-character-route'
    branchRoute.components.guideRoute.id = 'branch-character-component'
    const characterNode = {
      id: 'character-branch-user',
      nodeType: 'Mesh',
      components: {
        autoTour: {
          id: 'auto-tour',
          type: 'autoTour',
          enabled: true,
          props: clampAutoTourComponentProps({
            routeNodeId: defaultRoute.id,
            speedMps: 2,
          }),
        },
        characterController: {
          id: 'controller',
          type: 'characterController',
          enabled: true,
          props: clampCharacterControllerComponentProps({ walkSpeed: 2 }),
        },
      },
    } as any
    const characterObject = new THREE.Object3D()
    characterObject.position.set(0, 20, 8)
    const nodes = new Map<string, any>([
      [defaultRoute.id, defaultRoute],
      [branchRoute.id, branchRoute],
      [characterNode.id, characterNode],
    ])
    const nodeObjectMap = new Map<string, THREE.Object3D>([
      [defaultRoute.id, new THREE.Object3D()],
      [branchRoute.id, new THREE.Object3D()],
      [characterNode.id, characterObject],
    ])
    const runtime = new CharacterAutoTourRuntimeManager()
    const onGuideStop = vi.fn()
    const host = {
      iterNodes: () => nodes.entries(),
      resolveNode: (nodeId: string) => nodes.get(nodeId) ?? null,
      nodeObjectMap,
      onGuideStop,
    }
    const target = {
      routeNodeId: branchRoute.id,
      destinationStopId: 'branch-target',
    }
    const snap = runtime.resolveRouteSnap(host, characterNode.id, target)
    expect(snap?.travelWindow?.route.routeNodeId).toBe(branchRoute.id)
    expect(snap?.targetReached).toBe(false)
    runtime.activate(characterNode.id, target)
    runtime.refresh(host)
    runtime.update(host, 0.25)
    expect(runtime.getInput(characterNode.id)?.moveZ).toBeGreaterThan(0)
    expect(characterNode.components.autoTour.props.routeNodeId).toBe(defaultRoute.id)
    for (let index = 0; index < 24; index += 1) {
      runtime.update(host, 0.25)
    }
    expect(onGuideStop.mock.calls.map((call) => [
      call[1].definition.id,
      call[2].isTourTarget,
    ])).toEqual([
      ['branch-intermediate', false],
      ['branch-target', true],
    ])
    expect(runtime.getInput(characterNode.id)?.moveZ).toBe(0)
  })
})
