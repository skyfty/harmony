import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearGuideRouteEvaluationCache,
  evaluateGuideRoute,
  sampleEvaluatedGuideRouteAtDistance,
} from '@schema/guideRouteRuntime'
import {
  clampAutoTourComponentProps,
  clampGuideRouteComponentProps,
} from '@schema/components'
import { createAutoTourRuntime } from '@schema/autoTourRuntime'
import { VehicleMotionAuthorityController } from '@schema/vehicleMotionAuthority'

const surfaceMocks = vi.hoisted(() => ({
  state: vi.fn(),
  sample: vi.fn(),
}))
const surfaceStateMock = surfaceMocks.state
const surfaceSampleMock = surfaceMocks.sample

vi.mock('@schema/proceduralLandscape/runtime', () => ({
  getProceduralLandscapeGuideRouteSurfaceState: (...args: unknown[]) => surfaceStateMock(...args),
  getProceduralLandscapeRoadCenterlineLocal: () => null,
  sampleProceduralLandscapeGuideRouteSurface: (...args: unknown[]) => surfaceSampleMock(...args),
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
