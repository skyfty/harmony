import type { FloorVertex2D } from '../core'
import { smoothstep } from './noise'
import {
  TERRAIN_FLATTENING_MAX_EDGE_BLEND_WIDTH,
  TERRAIN_FLATTENING_MIN_EDGE_BLEND_WIDTH,
  type DemTerrainFlatteningTarget,
} from './terrainFlattening'

export type TerrainTransitionFitReason =
  | 'within-threshold'
  | 'widen'
  | 'limit-reached'
  | 'unsupported-footprint'
  | 'insufficient-samples'

export interface TerrainTransitionFitOptions {
  /** Peak slope allowed along the generated smoothstep transition. */
  maxGradeDegrees?: number
  minBlendWidth?: number
  maxBlendWidth?: number
  perimeterSpacing?: number
  profileSamples?: number
  widthStep?: number
}

export interface TerrainTransitionWorstPoint {
  x: number
  z: number
  outwardX: number
  outwardZ: number
  distance: number
  rawHeight: number
  heightDelta: number
  gradeRatio: number
}

export interface TerrainTransitionFitResult {
  reason: TerrainTransitionFitReason
  currentBlendWidth: number
  recommendedBlendWidth: number | null
  requiresChange: boolean
  maxGradeDegrees: number
  currentMaxGradeRatio: number | null
  currentMaxGradeDegrees: number | null
  recommendedMaxGradeRatio: number | null
  recommendedMaxGradeDegrees: number | null
  perimeterSampleCount: number
  profileSamples: number
  worstPoint: TerrainTransitionWorstPoint | null
}

interface TerrainTransitionSample {
  x: number
  z: number
  outwardX: number
  outwardZ: number
}

interface TerrainTransitionRayMetrics {
  maxGradeRatio: number
  worstPoint: TerrainTransitionWorstPoint
}

const DEFAULT_MAX_GRADE_DEGREES = 10
const DEFAULT_MIN_BLEND_WIDTH = 8
const DEFAULT_PERIMETER_SPACING = 5
const DEFAULT_PROFILE_SAMPLES = 16
const DEFAULT_WIDTH_STEP = 2
const MIN_PERIMETER_SPACING = 0.5
const MAX_PERIMETER_SPACING = 50
const MIN_PROFILE_SAMPLES = 4
const MAX_PROFILE_SAMPLES = 32
const MIN_WIDTH_STEP = 0.5
const MAX_WIDTH_STEP = 20

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function finiteOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function signedArea(contour: ReadonlyArray<FloorVertex2D>): number {
  let area = 0
  for (let index = 0; index < contour.length; index += 1) {
    const current = contour[index]!
    const next = contour[(index + 1) % contour.length]!
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area * 0.5
}

function collectPerimeterSamples(
  contour: ReadonlyArray<FloorVertex2D>,
  spacing: number,
): TerrainTransitionSample[] {
  if (contour.length < 3) {
    return []
  }
  const orientation = signedArea(contour) >= 0 ? 1 : -1
  const samples: TerrainTransitionSample[] = []
  for (let index = 0; index < contour.length; index += 1) {
    const current = contour[index]!
    const next = contour[(index + 1) % contour.length]!
    const dx = next[0] - current[0]
    const dz = next[1] - current[1]
    const length = Math.hypot(dx, dz)
    if (length <= 1e-7) {
      continue
    }
    const steps = Math.max(1, Math.ceil(length / spacing))
    const outwardX = orientation * dz / length
    const outwardZ = -orientation * dx / length
    for (let step = 0; step < steps; step += 1) {
      const t = (step + 0.5) / steps
      samples.push({
        x: current[0] + dx * t,
        z: current[1] + dz * t,
        outwardX,
        outwardZ,
      })
    }
  }
  return samples
}

function evaluateRay(
  target: DemTerrainFlatteningTarget,
  sample: TerrainTransitionSample,
  blendWidth: number,
  profileSamples: number,
  rawHeightAt: (x: number, z: number) => number | null,
): TerrainTransitionRayMetrics | null {
  let previousHeight = target.gradeY
  let maxGradeRatio = 0
  let worstPoint: TerrainTransitionWorstPoint | null = null
  const distanceStep = blendWidth / profileSamples
  for (let sampleIndex = 1; sampleIndex <= profileSamples; sampleIndex += 1) {
    const t = sampleIndex / profileSamples
    const distance = blendWidth * t
    const x = sample.x + sample.outwardX * distance
    const z = sample.z + sample.outwardZ * distance
    const rawHeight = rawHeightAt(x, z)
    if (rawHeight == null || !Number.isFinite(rawHeight)) {
      return null
    }
    const height = target.gradeY
      + (rawHeight - target.gradeY) * smoothstep(0, 1, t)
    const gradeRatio = Math.abs(height - previousHeight) / Math.max(1e-6, distanceStep)
    if (gradeRatio > maxGradeRatio || !worstPoint) {
      maxGradeRatio = gradeRatio
      worstPoint = {
        x,
        z,
        outwardX: sample.outwardX,
        outwardZ: sample.outwardZ,
        distance,
        rawHeight,
        heightDelta: rawHeight - target.gradeY,
        gradeRatio,
      }
    }
    previousHeight = height
  }
  return worstPoint
    ? { maxGradeRatio, worstPoint }
    : null
}

function evaluateBlendWidth(
  target: DemTerrainFlatteningTarget,
  samples: ReadonlyArray<TerrainTransitionSample>,
  blendWidth: number,
  profileSamples: number,
  rawHeightAt: (x: number, z: number) => number | null,
): TerrainTransitionRayMetrics | null {
  let worst: TerrainTransitionRayMetrics | null = null
  for (const sample of samples) {
    const metrics = evaluateRay(target, sample, blendWidth, profileSamples, rawHeightAt)
    if (metrics && (!worst || metrics.maxGradeRatio > worst.maxGradeRatio)) {
      worst = metrics
    }
  }
  return worst
}

function toDegrees(gradeRatio: number): number {
  return Math.atan(gradeRatio) * 180 / Math.PI
}

export function fitTerrainFlatteningTransition(
  target: DemTerrainFlatteningTarget,
  rawHeightAt: (x: number, z: number) => number | null,
  options: TerrainTransitionFitOptions = {},
): TerrainTransitionFitResult {
  const maxGradeDegrees = clamp(
    finiteOrDefault(options.maxGradeDegrees, DEFAULT_MAX_GRADE_DEGREES),
    1,
    45,
  )
  const maxBlendWidth = clamp(
    finiteOrDefault(options.maxBlendWidth, TERRAIN_FLATTENING_MAX_EDGE_BLEND_WIDTH),
    TERRAIN_FLATTENING_MIN_EDGE_BLEND_WIDTH,
    TERRAIN_FLATTENING_MAX_EDGE_BLEND_WIDTH,
  )
  const minBlendWidth = clamp(
    finiteOrDefault(options.minBlendWidth, DEFAULT_MIN_BLEND_WIDTH),
    TERRAIN_FLATTENING_MIN_EDGE_BLEND_WIDTH,
    maxBlendWidth,
  )
  const perimeterSpacing = clamp(
    finiteOrDefault(options.perimeterSpacing, DEFAULT_PERIMETER_SPACING),
    MIN_PERIMETER_SPACING,
    MAX_PERIMETER_SPACING,
  )
  const profileSamples = Math.round(clamp(
    finiteOrDefault(options.profileSamples, DEFAULT_PROFILE_SAMPLES),
    MIN_PROFILE_SAMPLES,
    MAX_PROFILE_SAMPLES,
  ))
  const widthStep = clamp(
    finiteOrDefault(options.widthStep, DEFAULT_WIDTH_STEP),
    MIN_WIDTH_STEP,
    MAX_WIDTH_STEP,
  )
  const currentBlendWidth = Math.min(
    maxBlendWidth,
    Math.max(TERRAIN_FLATTENING_MIN_EDGE_BLEND_WIDTH, target.influenceWidth),
  )
  const footprint = target.snapshot.footprint
  if (footprint.kind !== 'polygon') {
    return {
      reason: 'unsupported-footprint',
      currentBlendWidth,
      recommendedBlendWidth: null,
      requiresChange: false,
      maxGradeDegrees,
      currentMaxGradeRatio: null,
      currentMaxGradeDegrees: null,
      recommendedMaxGradeRatio: null,
      recommendedMaxGradeDegrees: null,
      perimeterSampleCount: 0,
      profileSamples,
      worstPoint: null,
    }
  }
  const samples = collectPerimeterSamples(footprint.contourWorldXZ, perimeterSpacing)
  const currentMetrics = evaluateBlendWidth(
    target,
    samples,
    currentBlendWidth,
    profileSamples,
    rawHeightAt,
  )
  if (!currentMetrics) {
    return {
      reason: 'insufficient-samples',
      currentBlendWidth,
      recommendedBlendWidth: null,
      requiresChange: false,
      maxGradeDegrees,
      currentMaxGradeRatio: null,
      currentMaxGradeDegrees: null,
      recommendedMaxGradeRatio: null,
      recommendedMaxGradeDegrees: null,
      perimeterSampleCount: samples.length,
      profileSamples,
      worstPoint: null,
    }
  }
  if (toDegrees(currentMetrics.maxGradeRatio) <= maxGradeDegrees + 1e-6) {
    return {
      reason: 'within-threshold',
      currentBlendWidth,
      recommendedBlendWidth: currentBlendWidth,
      requiresChange: false,
      maxGradeDegrees,
      currentMaxGradeRatio: currentMetrics.maxGradeRatio,
      currentMaxGradeDegrees: toDegrees(currentMetrics.maxGradeRatio),
      recommendedMaxGradeRatio: currentMetrics.maxGradeRatio,
      recommendedMaxGradeDegrees: toDegrees(currentMetrics.maxGradeRatio),
      perimeterSampleCount: samples.length,
      profileSamples,
      worstPoint: currentMetrics.worstPoint,
    }
  }

  let recommendedBlendWidth: number | null = null
  let recommendedMetrics: TerrainTransitionRayMetrics | null = null
  const searchStart = Math.max(minBlendWidth, currentBlendWidth + widthStep)
  for (let width = searchStart; width <= maxBlendWidth + 1e-6; width += widthStep) {
    const candidateWidth = Math.min(maxBlendWidth, width)
    const metrics = evaluateBlendWidth(
      target,
      samples,
      candidateWidth,
      profileSamples,
      rawHeightAt,
    )
    if (!metrics) {
      continue
    }
    recommendedBlendWidth = candidateWidth
    recommendedMetrics = metrics
    if (toDegrees(metrics.maxGradeRatio) <= maxGradeDegrees + 1e-6) {
      break
    }
    if (candidateWidth >= maxBlendWidth - 1e-6) {
      break
    }
  }
  if (recommendedBlendWidth == null || recommendedMetrics == null) {
    return {
      reason: 'insufficient-samples',
      currentBlendWidth,
      recommendedBlendWidth: null,
      requiresChange: false,
      maxGradeDegrees,
      currentMaxGradeRatio: currentMetrics.maxGradeRatio,
      currentMaxGradeDegrees: toDegrees(currentMetrics.maxGradeRatio),
      recommendedMaxGradeRatio: null,
      recommendedMaxGradeDegrees: null,
      perimeterSampleCount: samples.length,
      profileSamples,
      worstPoint: currentMetrics.worstPoint,
    }
  }
  const withinLimit = toDegrees(recommendedMetrics.maxGradeRatio) <= maxGradeDegrees + 1e-6
  return {
    reason: withinLimit ? 'widen' : 'limit-reached',
    currentBlendWidth,
    recommendedBlendWidth,
    requiresChange: recommendedBlendWidth > currentBlendWidth + 1e-6,
    maxGradeDegrees,
    currentMaxGradeRatio: currentMetrics.maxGradeRatio,
    currentMaxGradeDegrees: toDegrees(currentMetrics.maxGradeRatio),
    recommendedMaxGradeRatio: recommendedMetrics.maxGradeRatio,
    recommendedMaxGradeDegrees: toDegrees(recommendedMetrics.maxGradeRatio),
    perimeterSampleCount: samples.length,
    profileSamples,
    worstPoint: recommendedMetrics.worstPoint,
  }
}
