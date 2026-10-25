import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAutoTourRuntime } from '@schema/autoTourRuntime'
import {
  clampAutoTourComponentProps,
  clampCharacterControllerComponentProps,
  clampGuideRouteComponentProps,
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
    version: 3,
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

describe('GuideRoute V3 compiler', () => {
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

  it('rejects legacy V2 data explicitly', () => {
    const routeNode = createRouteNode(pathProps())
    routeNode.components.guideRoute.props.version = 2
    const result = evaluateGuideRoute({
      routeNode,
      providerObject: null,
    })
    expect(result.status).toBe('unsupported')
    expect(result.message).toContain('V3')
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
  })
})

describe('GuideRoute V3 playback events', () => {
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

  it('pauses exactly at a projected stop and resumes from the same distance', () => {
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
    const onGuideStop = vi.fn((nodeId: string) => {
      expect(runtime?.isPaused(nodeId)).toBe(true)
      expect(playback.vehicleObject.position.x).toBeCloseTo(4)
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
    expect(runtime.isPaused(playback.vehicleNode.id)).toBe(true)
    expect(playback.vehicleObject.position.x).toBeCloseTo(4)
    const stoppedPosition = playback.vehicleObject.position.clone()
    runtime.update(1)
    expect(playback.vehicleObject.position.distanceTo(stoppedPosition)).toBeCloseTo(0)
    expect(onGuideStop).toHaveBeenCalledTimes(1)

    runtime.setPaused(playback.vehicleNode.id, false)
    expect(runtime.isPaused(playback.vehicleNode.id)).toBe(false)
    runtime.update(0.6)
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

  it('pauses at a stop before reaching a later route transition', () => {
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
    expect(onGuideTransition).not.toHaveBeenCalled()
    expect(playback.vehicleObject.position.x).toBeCloseTo(4)

    runtime.setPaused(playback.vehicleNode.id, false)
    runtime.update(10)
    expect(onGuideTransition).toHaveBeenCalledOnce()
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
      runtime.setPaused(playback.vehicleNode.id, false)
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
    let runtime: CharacterAutoTourRuntimeManager | null = null
    const onGuideStop = vi.fn((nodeId: string) => {
      expect(runtime?.getInput(nodeId)?.moveZ).toBe(0)
      expect(characterObject.position.x).toBeCloseTo(4)
    })
    runtime = new CharacterAutoTourRuntimeManager()
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
    expect(runtime.getInput(characterNode.id)?.moveZ).toBe(0)
    const stoppedPosition = characterObject.position.clone()
    runtime.update(host, 0.25)
    expect(characterObject.position.distanceTo(stoppedPosition)).toBeCloseTo(0)

    runtime.setPaused(characterNode.id, false)
    runtime.update(host, 0.25)
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
      stops: [{
        id: 'branch-target',
        name: 'Branch target',
        thumbnailAssetId: 'image',
        anchor: { x: 8, y: 20, z: 8 },
        legId: 'character-branch',
        behavior: null,
      }],
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
    characterObject.position.set(0, 20, 0)
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
    const host = {
      iterNodes: () => nodes.entries(),
      resolveNode: (nodeId: string) => nodes.get(nodeId) ?? null,
      nodeObjectMap,
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
  })
})
