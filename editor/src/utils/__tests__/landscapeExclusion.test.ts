import { beforeEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { SceneNode } from '@schema/core'
import {
  ComponentManager,
} from '@schema/components/componentManager'
import {
  LANDSCAPE_EXCLUSION_ZONE_COMPONENT_TYPE,
  clampLandscapeExclusionZoneProps,
  createLandscapeExclusionZoneComponentState,
  landscapeExclusionZoneComponentDefinition,
} from '@schema/components/definitions/landscapeExclusionZoneComponent'
import {
  filterLandscapeExclusionPlacements,
  getLandscapeExclusionSnapshot,
  isPointExcluded,
  landscapeExclusionSignature,
  registerLandscapeExclusion,
  resetLandscapeExclusionsForTests,
  segmentIntersectsExclusion,
  unregisterLandscapeExclusion,
  updateLandscapeExclusion,
  type LandscapeExclusionCircle,
} from '@schema/proceduralLandscape/exclusion'
import { buildGlobalScenicGuide } from '@schema/proceduralLandscape/globalScenicGuide'
import { planWaypointRoadRoute } from '@schema/proceduralLandscape/proceduralRoad'
import type { TerrainHeightGrid } from '@schema/proceduralLandscape/terrainSampler'
import { createWaterPlane } from '@schema/proceduralLandscape/waterPlane'
import {
  clipWallSegmentsToExclusions,
  type WallSample,
  type WallSegment,
} from '@schema/proceduralLandscape/walls'

const circle: LandscapeExclusionCircle = {
  id: 'building-1',
  centerX: 0,
  centerZ: 0,
  radius: 10,
}

function makeFlatGrid(size = 1_000, cellSize = 10): TerrainHeightGrid {
  const cols = Math.floor(size / cellSize) + 1
  const rows = cols
  const minX = -size * 0.5
  const minZ = -size * 0.5
  const heights = new Float32Array(cols * rows)
  const coverage = new Uint8Array(cols * rows)
  coverage.fill(1)
  const sampleHeight = (x: number, z: number): number | null => {
    const gx = (x - minX) / cellSize
    const gz = (z - minZ) / cellSize
    return gx < 0 || gx > cols - 1 || gz < 0 || gz > rows - 1 ? null : 0
  }
  return {
    minX,
    maxX: minX + (cols - 1) * cellSize,
    minZ,
    maxZ: minZ + (rows - 1) * cellSize,
    minY: 0,
    maxY: 0,
    cols,
    rows,
    cellSize,
    averageEdgeLength: cellSize,
    memoryBytes: heights.byteLength + coverage.byteLength,
    heights,
    coverage,
    contains: (x, z) => sampleHeight(x, z) != null,
    sampleHeight,
    sampleNormal: () => new THREE.Vector3(0, 1, 0),
  }
}

function makeWallSample(x: number): WallSample {
  return {
    x,
    z: 0,
    roadY: 0,
    groundY: 0,
    nx: 0,
    nz: 1,
    rotation: 0,
    u: x,
    shadow: 0,
    jitterHeight: 0,
  }
}

describe('landscape exclusion geometry', () => {
  beforeEach(() => {
    resetLandscapeExclusionsForTests()
  })

  it('clamps component radius and keeps legacy-safe defaults', () => {
    expect(clampLandscapeExclusionZoneProps(null).radius).toBe(20)
    expect(clampLandscapeExclusionZoneProps({ radius: 0 }).radius).toBe(0.5)
    expect(clampLandscapeExclusionZoneProps({ radius: 20_000 }).radius).toBe(10_000)
    expect(clampLandscapeExclusionZoneProps({ radius: Number.NaN }).radius).toBe(20)
  })

  it('uses world position and world radius regardless of node scale', () => {
    const parent = new THREE.Group()
    parent.position.set(100, 12, -40)
    const object = new THREE.Group()
    object.scale.set(8, 8, 8)
    parent.add(object)
    registerLandscapeExclusion('node:component', object, 25)

    const snapshot = getLandscapeExclusionSnapshot()
    expect(snapshot).toEqual([{
      id: 'node:component',
      centerX: 100,
      centerZ: -40,
      radius: 25,
    }])
    expect(landscapeExclusionSignature(snapshot)).toBe(
      landscapeExclusionSignature([...snapshot]),
    )
  })

  it('updates enabled state and cleans registrations', () => {
    const object = new THREE.Group()
    registerLandscapeExclusion('a', object, 10)
    expect(getLandscapeExclusionSnapshot()).toHaveLength(1)
    updateLandscapeExclusion('a', { enabled: false })
    expect(getLandscapeExclusionSnapshot()).toHaveLength(0)
    updateLandscapeExclusion('a', { enabled: true, radius: 30 })
    expect(getLandscapeExclusionSnapshot()[0]?.radius).toBe(30)
    unregisterLandscapeExclusion('a')
    expect(getLandscapeExclusionSnapshot()).toHaveLength(0)
  })

  it('filters points and segments with footprint margins', () => {
    expect(isPointExcluded(0, 9.9, [circle])).toBe(true)
    expect(isPointExcluded(11, 0, [circle])).toBe(false)
    expect(segmentIntersectsExclusion(-20, 0, 20, 0, [circle])).toBe(true)
    expect(segmentIntersectsExclusion(-20, 20, 20, 20, [circle])).toBe(false)
    const placements = [
      { x: 0, z: 0 },
      { x: 19, z: 0 },
      { x: 30, z: 0 },
    ]
    expect(filterLandscapeExclusionPlacements(
      placements,
      [circle],
      (placement) => placement.x > 15 ? 15 : 0,
    )).toEqual([{ x: 30, z: 0 }])
  })

  it('component lifecycle registers and unregisters its runtime object', () => {
    const nodeId = 'building-node'
    const node = {
      id: nodeId,
      name: 'Building',
      nodeType: 'Group',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    } as SceneNode
    const state = createLandscapeExclusionZoneComponentState(node, { radius: 32 }, {
      id: 'exclusion',
    })
    node.components = {
      [LANDSCAPE_EXCLUSION_ZONE_COMPONENT_TYPE]: state,
    }
    const manager = new ComponentManager()
    manager.registerDefinition(landscapeExclusionZoneComponentDefinition)
    manager.syncScene([node])
    const runtime = new THREE.Group()
    runtime.position.set(75, 0, 25)
    manager.attachRuntime(node, runtime)
    expect(getLandscapeExclusionSnapshot()[0]).toMatchObject({
      centerX: 75,
      centerZ: 25,
      radius: 32,
    })

    state.enabled = false
    manager.syncNode(node)
    expect(getLandscapeExclusionSnapshot()).toHaveLength(0)
    manager.removeNode(nodeId)
    expect(getLandscapeExclusionSnapshot()).toHaveLength(0)
  })
})

describe('landscape exclusion consumers', () => {
  beforeEach(() => {
    resetLandscapeExclusionsForTests()
  })

  it('routes a shortest guide around a blocked circle', () => {
    const guide = buildGlobalScenicGuide(
      makeFlatGrid(),
      [{ x: -350, z: 0 }, { x: 350, z: 0 }],
      {
        seed: 7,
        stepLength: 10,
        pathDeviation: 200,
        margin: 10,
        termination: 'boundary',
        waypointTolerance: 5,
        exclusionCircles: [circle],
        exclusionMargin: 12,
      },
    )
    expect(guide.failureReason).toBeNull()
    expect(guide.points.length).toBeGreaterThan(2)
    for (let index = 1; index < guide.points.length; index += 1) {
      const previous = guide.points[index - 1]!
      const current = guide.points[index]!
      expect(segmentIntersectsExclusion(
        previous.x,
        previous.z,
        current.x,
        current.z,
        [circle],
        12,
      )).toBe(false)
    }
  })

  it('keeps the final shortest road centerline outside the exclusion', () => {
    const planningCircle = { ...circle, radius: 70 }
    const result = planWaypointRoadRoute(makeFlatGrid(1_400, 20), {
      waypoints: [{ x: -450, z: 0 }, { x: 450, z: 0 }],
      strategy: 'shortest',
      termination: 'dead-end',
      seed: 7,
      waypointTolerance: 8,
      pathDeviation: 250,
      stepLength: 8,
      feelDistance: 24,
      feelAngleRad: (32 * Math.PI) / 180,
      maxSlope: 0.55,
      maxTurnRad: (10 * Math.PI) / 180,
      margin: 12,
      routeClearance: 20,
      minimumTurnRadius: 20,
      maximumHeadingChangeRad: (10 * Math.PI) / 180,
      exclusionCircles: [planningCircle],
      exclusionMargin: 22,
    })
    expect(result.complete, result.failureReason ?? 'unknown seeded route failure').toBe(true)
    expect(result.nodes.length).toBeGreaterThan(2)
    for (let index = 1; index < result.nodes.length; index += 1) {
      const previous = result.nodes[index - 1]!
      const current = result.nodes[index]!
      expect(segmentIntersectsExclusion(
        previous.x,
        previous.z,
        current.x,
        current.z,
        [planningCircle],
        22,
      )).toBe(false)
    }
  })

  it('routes a seeded scenic road around the exclusion', () => {
    const planningCircle = { ...circle, radius: 65 }
    const result = planWaypointRoadRoute(makeFlatGrid(1_400, 20), {
      waypoints: [{ x: -450, z: 0 }, { x: 450, z: 0 }],
      strategy: 'seeded',
      termination: 'boundary',
      seed: 31,
      waypointTolerance: 8,
      pathDeviation: 220,
      stepLength: 8,
      feelDistance: 24,
      feelAngleRad: (32 * Math.PI) / 180,
      maxSlope: 0.55,
      maxTurnRad: (10 * Math.PI) / 180,
      margin: 12,
      routeClearance: 20,
      minimumTurnRadius: 20,
      maximumHeadingChangeRad: (10 * Math.PI) / 180,
      exclusionCircles: [planningCircle],
      exclusionMargin: 22,
    })
    expect(result.complete, result.failureReason ?? 'unknown seeded route failure').toBe(true)
    for (let index = 1; index < result.nodes.length; index += 1) {
      const previous = result.nodes[index - 1]!
      const current = result.nodes[index]!
      expect(segmentIntersectsExclusion(
        previous.x,
        previous.z,
        current.x,
        current.z,
        [planningCircle],
        22,
      )).toBe(false)
    }
  })

  it('splits wall runs at the projected exclusion boundary', () => {
    const points = Array.from({ length: 21 }, (_, index) => makeWallSample(-20 + index * 2))
    const segment: WallSegment = {
      type: 'drystone',
      side: 1,
      distance: 2,
      startAlong: 0,
      endAlong: 40,
      points,
    }
    const clipped = clipWallSegmentsToExclusions([segment], [circle], 0)
    expect(clipped).toHaveLength(2)
    expect(clipped.every((entry) => entry.points.length >= 2)).toBe(true)
    expect(clipped.flatMap((entry) => entry.points).every(
      (point) => Math.hypot(point.x - circle.centerX, point.z - circle.centerZ) >= circle.radius - 1e-4,
    )).toBe(true)
  })

  it('triangulates water without covering exclusion holes', () => {
    const water = createWaterPlane({
      worldSize: 200,
      centerX: 0,
      centerZ: 0,
      waterLevel: 0,
      waves: new THREE.Texture(),
      exclusionCircles: [circle],
    })
    const position = water.mesh.geometry.getAttribute('position')
    const index = water.mesh.geometry.getIndex()
    expect(index).not.toBeNull()
    for (let triangle = 0; triangle < index!.count; triangle += 3) {
      const a = index!.getX(triangle)
      const b = index!.getX(triangle + 1)
      const c = index!.getX(triangle + 2)
      const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3
      const z = -(position.getY(a) + position.getY(b) + position.getY(c)) / 3
      expect(Math.hypot(x, z)).toBeGreaterThan(circle.radius - 0.5)
    }
    water.dispose()
  })
})
