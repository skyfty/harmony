import type { RoadProfile } from './roadProfile'
import { smoothstep } from './noise'
import type { TerrainSurfaceHeightSource } from './terrainSurface'

export interface PlacementSurface {
  heightAt(x: number, z: number): number
  normalAt(x: number, z: number): { x: number; y: number; z: number }
  slopeAt(x: number, z: number): number
}

export interface RoadbedTargetOptions {
  /** Horizontal width used to transition from the road edge back to terrain. */
  sideWidth?: number
  /** Additional coverage outside the side slope; hides graded coarse cells. */
  coverageWidth?: number
  /** How far the roadbed surface sits below the design road height. */
  roadDrop?: number
  /** Coarse-grid vertices inside the roadbed are lowered by this amount. */
  coarseClearance?: number
}

export interface RoadbedTarget {
  readonly sideWidth: number
  readonly outerHalfWidth: number
  readonly meshHalfWidth: number
  readonly influenceHalfWidth: number
  readonly coarseClearance: number
  distanceAt(x: number, z: number): number
  roadProximityAt(x: number, z: number): number
  heightAt(x: number, z: number): number
  coarseHeightAt(x: number, z: number): number
  rawHeightAt(x: number, z: number): number
  rawNormalAt(x: number, z: number): { x: number; y: number; z: number }
}

export interface FlatRoadColumns {
  columns: number[][]
  step: number
  columnCount: number
}

/**
 * Design a cut/fill roadbed from a road centerline and the raw terrain.
 *
 * Inside the asphalt + shoulder band the section is exactly horizontal. Outside
 * it smoothly blends to the raw surface at the outer edge, so the high-res
 * roadbed mesh and the graded coarse mesh meet the surrounding terrain.
 */
export function createRoadbedTarget(
  profile: RoadProfile,
  rawSurface: TerrainSurfaceHeightSource,
  options: RoadbedTargetOptions = {},
): RoadbedTarget {
  const innerHalfWidth = profile.halfWidth + profile.shoulderWidth
  const sideWidth = Math.max(1, options.sideWidth ?? Math.max(30, rawSurface.cellSize * 1.5))
  const coverageWidth = Math.max(0, options.coverageWidth ?? rawSurface.cellSize * 0.5)
  const outerHalfWidth = innerHalfWidth + sideWidth
  const meshHalfWidth = outerHalfWidth + coverageWidth
  const influenceHalfWidth = meshHalfWidth
  const roadDrop = Math.max(0, options.roadDrop ?? 0.05)
  const coarseClearance = Math.max(0, options.coarseClearance ?? 0.1)

  const distanceAt = (x: number, z: number): number => {
    const closest = profile.closestPoint(x, z)
    return closest ? closest.distance : Number.POSITIVE_INFINITY
  }

  const heightAt = (x: number, z: number): number => {
    const terrainY = rawSurface.heightAt(x, z)
    const closest = profile.closestPoint(x, z)
    if (!closest) {
      return terrainY
    }
    if (closest.distance <= innerHalfWidth) {
      // A single row height across the entire carriageway: no lateral bank.
      return closest.height - roadDrop
    }
    if (closest.distance >= outerHalfWidth) {
      return terrainY
    }
    const t = smoothstep(innerHalfWidth, outerHalfWidth, closest.distance)
    return (closest.height - roadDrop) + (terrainY - (closest.height - roadDrop)) * t
  }

  return {
    sideWidth,
    outerHalfWidth,
    meshHalfWidth,
    influenceHalfWidth,
    coarseClearance,
    distanceAt,
    roadProximityAt(x: number, z: number): number {
      return profile.roadProximityAt(x, z)
    },
    heightAt,
    coarseHeightAt(x: number, z: number): number {
      const target = heightAt(x, z)
      const distance = distanceAt(x, z)
      if (distance >= meshHalfWidth) {
        return rawSurface.heightAt(x, z)
      }
      // Lower the coarse grid under the roadbed, then fade the clearance out
      // at the raw coverage ring so the surrounding terrain has no trench step.
      const fade = 1 - smoothstep(outerHalfWidth, meshHalfWidth, distance)
      return target - coarseClearance * fade
    },
    rawHeightAt(x: number, z: number): number {
      return rawSurface.heightAt(x, z)
    },
    rawNormalAt(x: number, z: number): { x: number; y: number; z: number } {
      const step = Math.max(0.75, rawSurface.cellSize * 0.05)
      const dx = (rawSurface.heightAt(x + step, z) - rawSurface.heightAt(x - step, z)) / (2 * step)
      const dz = (rawSurface.heightAt(x, z + step) - rawSurface.heightAt(x, z - step)) / (2 * step)
      const inverseLength = 1 / Math.hypot(dx, 1, dz)
      return { x: -dx * inverseLength, y: inverseLength, z: -dz * inverseLength }
    },
  }
}

/** Flat road-band columns aligned with the road mesh's 2m rows. */
export function createFlatRoadBandColumns(
  profile: RoadProfile,
  options: { step?: number; columnCount?: number } = {},
): FlatRoadColumns {
  const step = Math.max(0.5, options.step ?? 2)
  const columnCount = Math.max(2, Math.round(options.columnCount ?? 9))
  const sampleCount = Math.max(2, Math.floor(profile.length / step) + 1)
  const columns: number[][] = []
  for (let i = 0; i < sampleCount; i += 1) {
    const row = profile.sampleAt(Math.min(profile.length, i * step))
    columns.push(new Array(columnCount).fill(row.y))
  }
  return { columns, step, columnCount }
}

/**
 * Visible surface used by vegetation and other placed objects: the roadbed
 * mesh inside its footprint, raw terrain outside. The 1cm offset matches the
 * rendered roadbed lift.
 */
export function createRoadbedPlacementSurface(
  roadbed: RoadbedTarget,
  rawSurface: TerrainSurfaceHeightSource,
): PlacementSurface {
  const heightAt = (x: number, z: number): number => (
    roadbed.distanceAt(x, z) <= roadbed.meshHalfWidth
      ? roadbed.heightAt(x, z) + 0.01
      : rawSurface.heightAt(x, z)
  )
  const step = Math.max(0.75, rawSurface.cellSize * 0.05)

  return {
    heightAt,
    normalAt(x: number, z: number): { x: number; y: number; z: number } {
      const hx0 = heightAt(x - step, z)
      const hx1 = heightAt(x + step, z)
      const hz0 = heightAt(x, z - step)
      const hz1 = heightAt(x, z + step)
      const dx = (hx1 - hx0) / (2 * step)
      const dz = (hz1 - hz0) / (2 * step)
      const inverseLength = 1 / Math.hypot(dx, 1, dz)
      return { x: -dx * inverseLength, y: inverseLength, z: -dz * inverseLength }
    },
    slopeAt(x: number, z: number): number {
      const normal = this.normalAt(x, z)
      return Math.max(0, 1 - normal.y)
    },
  }
}
