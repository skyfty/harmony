import {
  createPlanningDemRasterSource,
  samplePlanningDemHeightAtWorld,
  type PlanningDemRasterSource,
  type PlanningDemTargetWorldBounds,
} from '@/utils/planningDemToGround'

export interface PlanningDemHeightGridSampleOptions {
  source: PlanningDemRasterSource
  sampleStartX: number
  sampleStartZ: number
  sampleStepX: number
  sampleStepZ: number
  rows: number
  columns: number
}

function buildPlanningDemHeightGridFallback(options: PlanningDemHeightGridSampleOptions): Float64Array {
  const values = new Float64Array((options.rows + 1) * (options.columns + 1))
  for (let row = 0; row <= options.rows; row += 1) {
    const z = options.sampleStartZ + row * options.sampleStepZ
    const rowOffset = row * (options.columns + 1)
    for (let column = 0; column <= options.columns; column += 1) {
      const x = options.sampleStartX + column * options.sampleStepX
      const sample = samplePlanningDemHeightAtWorld(options.source, x, z)
      values[rowOffset + column] = Number.isFinite(sample) ? sample : 0
    }
  }
  return values
}

export function ensurePlanningDemSamplingWasm(): Promise<{ kind: 'fallback'; sampleHeightGrid(options: PlanningDemHeightGridSampleOptions): Float64Array }> {
  return Promise.resolve({
    kind: 'fallback',
    sampleHeightGrid(options) {
      return buildPlanningDemHeightGridFallback(options)
    },
  })
}

export function samplePlanningDemHeightGrid(options: PlanningDemHeightGridSampleOptions): Float64Array {
  return buildPlanningDemHeightGridFallback(options)
}

export function samplePlanningDemHeightGridFromWorldBounds(options: {
  source: PlanningDemRasterSource
  startX: number
  startZ: number
  endX: number
  endZ: number
  rows: number
  columns: number
}): Float64Array {
  const width = Math.max(Number.EPSILON, options.endX - options.startX)
  const depth = Math.max(Number.EPSILON, options.endZ - options.startZ)
  return samplePlanningDemHeightGrid({
    source: options.source,
    sampleStartX: options.startX,
    sampleStartZ: options.startZ,
    sampleStepX: width / Math.max(1, options.columns),
    sampleStepZ: depth / Math.max(1, options.rows),
    rows: options.rows,
    columns: options.columns,
  })
}

export function createPlanningDemSamplingSource(options: {
  rasterData: ArrayLike<number>
  width: number
  height: number
  targetWorldBounds: PlanningDemTargetWorldBounds
}): PlanningDemRasterSource {
  return createPlanningDemRasterSource(options)
}
