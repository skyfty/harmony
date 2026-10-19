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
  it('repairs the five-waypoint road with 20m minimum curves', () => {
    const grid = loadAnalysisGrid()
    const result = planWaypointRoadRoute(grid, {
      ...repairPlanOptions,
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
    expect(result.geometryAutoRepaired).toBe(true)
    expect(result.autoRepairRoundedCorners).toBeGreaterThan(0)
    expect(result.effectiveWaypointTolerance).toBe(30)
  }, 60_000)

  it('keeps the previous seven-waypoint route drivable', () => {
    const grid = loadAnalysisGrid()
    const result = planWaypointRoadRoute(grid, {
      ...repairPlanOptions,
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
    expect(
      result.complete,
      `${result.failureReason} / passed ${result.waypointsPassed}/7 / error ${result.maxWaypointError}`,
    ).toBe(true)
    expect(result.waypointsPassed).toBe(7)
    expect(result.maxWaypointError).toBeLessThanOrEqual(30)
    expect(result.minTurnRadius).toBeGreaterThanOrEqual(19.95)
    expect(result.maxForwardGrade).toBeLessThanOrEqual(0.28 + 1e-4)
    expect(result.maxCrossSlope).toBeLessThanOrEqual(0.45 + 1e-4)
    expect(result.geometryAutoRepaired).toBe(true)
  }, 60_000)
})
