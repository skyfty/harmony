import * as THREE from 'three'
import { hashString, stableSerialize } from '../stableSerialize'
import {
  PROCEDURAL_LANDSCAPE_ROAD_CENTERLINE_ALGORITHM_VERSION,
  type ProceduralLandscapeComponentProps,
  type ProceduralLandscapeGeneratedRouteCenterline,
} from './config'

export interface CompiledRoadProfileSignatureOptions {
  groundSurfaceRevision: number
  authoringSampleStep: number
  authoringCellSize: number
  exclusionSignature: string
}

export function buildCompiledRoadProfileSourceSignature(
  props: ProceduralLandscapeComponentProps,
  options: CompiledRoadProfileSignatureOptions,
): string {
  const generatedRoute = props.road.generatedRoute
  // The compiled profile belongs to the committed route snapshot. `props.seed`
  // remains mutable while users explore landscape variants, so it must not
  // invalidate heights that were baked from `generatedRoute.seed`.
  const roadSeed = generatedRoute?.seed ?? props.seed
  return hashString(stableSerialize({
    algorithmVersion: PROCEDURAL_LANDSCAPE_ROAD_CENTERLINE_ALGORITHM_VERSION,
    dem: {
      assetId: props.dem.assetId,
      runtimeGridUrl: props.dem.runtimeGridUrl,
      runtimeGridBytes: props.dem.runtimeGridBytes,
    },
    groundSurfaceRevision: Math.max(0, Math.trunc(options.groundSurfaceRevision || 0)),
    seed: roadSeed,
    road: {
      style: props.road.style,
      width: props.road.width,
      shoulderWidth: props.road.shoulderWidth,
      flattenBand: props.road.flattenBand,
      flattenStrength: props.road.flattenStrength,
      maxSlope: props.road.maxSlope,
    },
    generatedRoute: generatedRoute
      ? {
          waypoints: generatedRoute.waypoints,
          strategy: generatedRoute.strategy,
          termination: generatedRoute.termination,
          style: generatedRoute.style,
          seed: generatedRoute.seed,
          waypointTolerance: generatedRoute.waypointTolerance,
          pathDeviation: generatedRoute.pathDeviation,
          revision: generatedRoute.revision,
        }
      : null,
    authoringSampleStep: options.authoringSampleStep,
    authoringCellSize: options.authoringCellSize,
    exclusionSignature: options.exclusionSignature,
  }))
}

export function hasValidCompiledRoadProfile(
  centerline: ProceduralLandscapeGeneratedRouteCenterline | null | undefined,
): boolean {
  const profile = centerline?.compiledProfile
  if (
    !profile
    || typeof profile.sourceSignature !== 'string'
    || !profile.sourceSignature.trim()
    || !Array.isArray(profile.pointsLocalXYZ)
  ) {
    return false
  }
  const expectedLength = centerline.pointsXZ.length / 2 * 3
  if (profile.pointsLocalXYZ.length !== expectedLength) {
    return false
  }
  for (const coordinate of profile.pointsLocalXYZ) {
    if (!Number.isFinite(coordinate)) {
      return false
    }
  }
  return true
}

export function compiledRoadProfileMatches(
  centerline: ProceduralLandscapeGeneratedRouteCenterline | null | undefined,
  sourceSignature: string,
): boolean {
  return hasValidCompiledRoadProfile(centerline)
    && centerline?.compiledProfile?.sourceSignature === sourceSignature
}

export function resolveCompiledRoadProfileWorldPoints(
  centerline: ProceduralLandscapeGeneratedRouteCenterline | null | undefined,
  hostMatrixWorld: THREE.Matrix4,
): Array<{ x: number; y: number; z: number }> | null {
  if (!hasValidCompiledRoadProfile(centerline)) {
    return null
  }
  const values = centerline!.compiledProfile!.pointsLocalXYZ
  const point = new THREE.Vector3()
  const result: Array<{ x: number; y: number; z: number }> = []
  for (let index = 0; index < values.length; index += 3) {
    point.set(values[index]!, values[index + 1]!, values[index + 2]!).applyMatrix4(hostMatrixWorld)
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      return null
    }
    result.push({ x: point.x, y: point.y, z: point.z })
  }
  return result
}
