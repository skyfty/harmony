import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeTerrainDemRuntimeGridFile } from '@schema/terrainDemRuntimeGrid'
import { createDemTerrainHeightGrid } from '@schema/proceduralLandscape/demTerrain'
import {
  planWaypointRoadRoute,
  type WaypointRoadPlanOptions,
} from '@schema/proceduralLandscape/proceduralRoad'

const demGridPath = process.env.HARMONY_DEM_GRID_FOR_ANALYSIS
const analysisDescribe = demGridPath ? describe : describe.skip

function loadAnalysisGrid() {
  return createDemTerrainHeightGrid(
    decodeTerrainDemRuntimeGridFile(
      new Uint8Array(fs.readFileSync(demGridPath!)),
    ),
  )
}

const repairPlanOptions: Omit<WaypointRoadPlanOptions, 'waypoints'> = {
  strategy: 'seeded',
  termination: 'boundary',
  seed: 1533969408,
  waypointTolerance: 4,
  pathDeviation: 60,
  stepLength: 8,
  feelDistance: 24,
  feelAngleRad: (32 * Math.PI) / 180,
  maxSlope: 0.55,
  maxTurnRad: (4 * Math.PI) / 180,
  margin: 20,
  routeClearance: 7,
  minimumTurnRadius: 20,
  maximumHeadingChangeRad: (10 * Math.PI) / 180,
}

analysisDescribe('current Qinglong DEM road repair', () => {
  it('builds the current fifteen-waypoint road as a smooth roadbed spline', () => {
    const grid = loadAnalysisGrid()
    const waypoints = [
      { x: 2133.1294459083074, z: -362.7173478295854 },
      { x: 1970.4596677990166, z: -534.0135155323205 },
      { x: 1734.4637816038667, z: -523.992005439603 },
      { x: 1442.6754018838465, z: -727.1619227025213 },
      { x: 1100.2602913551946, z: -777.3330014230514 },
      { x: 1080.6106747104454, z: -468.7363166497728 },
      { x: 927.6628306678653, z: -175.01287238927216 },
      { x: 896.2731298025574, z: 113.95031242460402 },
      { x: 1020.9552502839028, z: 394.4046489471887 },
      { x: 714.49051686411, z: 502.92774777355277 },
      { x: 610.2835153189084, z: 700.0561390582302 },
      { x: 389.00379539780005, z: 909.887813944046 },
      { x: 136.22666998213145, z: 1161.2789045597767 },
      { x: -389.3615547353769, z: 1434.7495233432144 },
      { x: -1441.9311302432843, z: 1369.8867608245675 },
    ]
    const result = planWaypointRoadRoute(grid, {
      ...repairPlanOptions,
      termination: 'dead-end',
      centerlineMode: 'dem-roadbed-spline',
      seed: 1984614004,
      waypoints,
    })
    expect(
      result.complete,
      `${result.failureReason} / passed ${result.waypointsPassed}/${waypoints.length}`,
    ).toBe(true)
    expect(result.plannerMode).toBe('waypoint-spline')
    expect(result.waypointsPassed).toBe(waypoints.length)
    expect(result.maxWaypointError).toBeLessThanOrEqual(1e-4)
    expect(result.minTurnRadius).toBeGreaterThanOrEqual(19.95)
    expect(result.maxHeadingChangeRad).toBeLessThanOrEqual(
      (10 * Math.PI) / 180,
    )
    expect(result.maxForwardGrade).toBeLessThanOrEqual(0.28 + 1e-4)
    expect(result.maxCrossSlope).toBeLessThanOrEqual(0.45 + 1e-4)
    expect(result.minCenterlineClearance).toBeGreaterThanOrEqual(7)
    let maximumCutFill = 0
    for (const node of result.nodes) {
      const terrainY = grid.sampleHeight(node.x, node.z)
      expect(terrainY).not.toBeNull()
      maximumCutFill = Math.max(maximumCutFill, Math.abs(node.y - terrainY!))
    }
    expect(maximumCutFill).toBeLessThanOrEqual(12)
  }, 60_000)

  it('builds the five-waypoint road with 20m minimum curves', () => {
    const grid = loadAnalysisGrid()
    const result = planWaypointRoadRoute(grid, {
      ...repairPlanOptions,
      termination: 'dead-end',
      centerlineMode: 'dem-roadbed-spline',
      waypoints: [
        { x: 1440.4, z: 2300.7 },
        { x: 1632.8, z: 2650.2 },
        { x: 1091.2, z: 3058.7 },
        { x: 1508.7, z: 3539.1 },
        { x: 1164.2, z: 4246.9 },
      ],
    })
    expect(
      result.complete,
      `${result.failureReason} / passed ${result.waypointsPassed}/5 / error ${result.maxWaypointError}`,
    ).toBe(true)
    expect(result.waypointsPassed).toBe(5)
    expect(result.maxWaypointError).toBeLessThanOrEqual(30)
    expect(result.minTurnRadius).toBeGreaterThanOrEqual(19.95)
    expect(result.maxHeadingChangeRad).toBeLessThanOrEqual(
      repairPlanOptions.maximumHeadingChangeRad!,
    )
    expect(result.maxForwardGrade).toBeLessThanOrEqual(0.28 + 1e-4)
    expect(result.maxCrossSlope).toBeLessThanOrEqual(0.45 + 1e-4)
    expect(result.minCenterlineClearance).toBeGreaterThanOrEqual(7)
    expect(result.geometryAutoRepaired).toBe(false)
    expect(result.plannerMode).toBe('waypoint-spline')
  }, 60_000)

  it('rejects an obsolete route that cannot satisfy curvature constraints', () => {
    const grid = loadAnalysisGrid()
    const result = planWaypointRoadRoute(grid, {
      ...repairPlanOptions,
      termination: 'dead-end',
      centerlineMode: 'dem-roadbed-spline',
      seed: 1336694912,
      waypoints: [
        { x: 2559.3, z: 766.4 },
        { x: 1794.9, z: 932.9 },
        { x: 1384.9, z: 745.6 },
        { x: 629.5, z: 729.6 },
        { x: 37.5, z: 379.8 },
        { x: -64.6, z: -504.3 },
        { x: -1472.6, z: 727.6 },
      ],
    })
    expect(result.complete).toBe(false)
    expect(result.failureReason).toBe('waypoint-unreachable')
  }, 60_000)
})
