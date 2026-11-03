import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  createDemRoadbedTarget,
  createDemRoadbedTargetGeometry,
} from '@schema/proceduralLandscape/demRoadbed'
import { densifyRoadRows } from '@schema/proceduralLandscape/roadBandRows'
import { buildRoadProximityIndex } from '@schema/proceduralLandscape/roadProximity'
import type { RoadTraceNode } from '@schema/proceduralLandscape/roadTrace'

function node(index: number, x: number, z: number): RoadTraceNode {
  return {
    x,
    y: 0,
    z,
    heading: 0,
    index,
    lateral: 0,
    longitudinal: 0,
    turn: 0,
    headingDelta: 0,
  }
}

describe('DEM roadbed collision LOD', () => {
  it('decimates both axes while preserving the roadbed design height', () => {
    const nodes = [node(0, 0, 100), node(1, 200, 100)]
    const roadField = buildRoadProximityIndex(nodes, { maxDistance: 80 })
    expect(roadField).not.toBeNull()
    if (!roadField) return
    const target = createDemRoadbedTarget({
      roadField,
      rawHeightAt: () => 2,
      halfWidth: 2,
      shoulderWidth: 2.5,
      demCellSize: 30,
      sideWidth: 24,
      coverageWidth: 4,
    })
    const rows = densifyRoadRows(nodes, 2)
    const matrix = new THREE.Matrix4()
    const full = createDemRoadbedTargetGeometry(rows, target, {
      lateralStep: 3,
      lift: 0.01,
      burialDepth: 0,
      edgeSkirtDepth: 0,
      hostInverse: matrix,
    })
    const collision = createDemRoadbedTargetGeometry(rows, target, {
      lateralStep: 8,
      rowSpacing: 8,
      lift: 0.01,
      burialDepth: 0,
      edgeSkirtDepth: 0,
      hostInverse: matrix,
    })

    expect(full).not.toBeNull()
    expect(collision).not.toBeNull()
    expect(collision!.triangleCount).toBe(400)
    expect(full!.triangleCount / collision!.triangleCount).toBeGreaterThan(5)

    const position = collision!.geometry.getAttribute('position')
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index)
      const z = position.getZ(index)
      expect(position.getY(index)).toBeCloseTo(target.heightAt(x, z) + 0.01, 4)
    }
  })

  it('emits the same open-end caps for rendered and collision roadbeds', () => {
    const nodes = [node(0, 0, 100), node(1, 200, 100)]
    const roadField = buildRoadProximityIndex(nodes, { maxDistance: 80 })
    expect(roadField).not.toBeNull()
    if (!roadField) return
    const rawHeightAt = (x: number): number => 20 + x * 0.01
    const target = createDemRoadbedTarget({
      roadField,
      rawHeightAt,
      halfWidth: 3.5,
      shoulderWidth: 2.5,
      demCellSize: 30,
      sideWidth: 16,
      coverageWidth: 4,
    })
    const rows = densifyRoadRows(nodes, 2)
    const options = {
      lift: 0.01,
      capEnds: true,
      coarseSurfaceHeightAt: rawHeightAt,
      burialDepth: 0.3,
      edgeSkirtDepth: 0.5,
      hostInverse: new THREE.Matrix4(),
    }
    const rendered = createDemRoadbedTargetGeometry(rows, target, {
      ...options,
      lateralStep: 3,
      maxVerticalError: 0.01,
    })
    const collision = createDemRoadbedTargetGeometry(rows, target, {
      ...options,
      lateralStep: 8,
      rowSpacing: 8,
    })

    expect(rendered).not.toBeNull()
    expect(collision).not.toBeNull()
    expect(rendered!.endCapCount).toBe(2)
    expect(collision!.endCapCount).toBe(2)
    expect(rendered!.endCapTriangleCount).toBeGreaterThan(0)
    expect(collision!.endCapTriangleCount).toBeGreaterThan(0)
    expect(rendered!.maxEndCapSeamGap).toBeLessThanOrEqual(1e-6)
    expect(collision!.maxEndCapSeamGap).toBeLessThanOrEqual(1e-6)
    expect(collision!.endCapTriangleCount)
      .toBeLessThanOrEqual(rendered!.endCapTriangleCount)
  })
})
