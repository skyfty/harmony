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

type PlanningDemSamplingBindings =
  | {
      kind: 'fallback'
      sampleHeightGrid(options: PlanningDemHeightGridSampleOptions): Float64Array
    }
  | {
      kind: 'wasm'
      sampleHeightGrid(options: PlanningDemHeightGridSampleOptions): Float64Array
    }

let bindingsPromise: Promise<PlanningDemSamplingBindings> | null = null
let resolvedBindings: PlanningDemSamplingBindings | null = null

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

async function loadPlanningDemSamplingWasm(): Promise<PlanningDemSamplingBindings> {
  try {
    const moduleUrl = new URL('./rust-crate/pkg/harmony_ground_paint_wasm.js', import.meta.url)
    const module = await import(/* @vite-ignore */ moduleUrl.href)
    const wasmModule = typeof module.default === 'function' ? await module.default() : module
    const sampleHeightGrid = typeof wasmModule.sample_height_grid === 'function'
      ? wasmModule.sample_height_grid.bind(wasmModule)
      : typeof wasmModule.sampleHeightGrid === 'function'
        ? wasmModule.sampleHeightGrid.bind(wasmModule)
        : null
    if (!sampleHeightGrid) {
      throw new Error('Planning DEM WASM module does not export sample_height_grid')
    }
    return {
      kind: 'wasm',
      sampleHeightGrid(options) {
        const targetWorldBounds: PlanningDemTargetWorldBounds = options.source.targetWorldBounds
        const result = sampleHeightGrid(
          Float64Array.from(options.source.rasterData),
          options.source.width,
          options.source.height,
          targetWorldBounds.minX,
          targetWorldBounds.minZ,
          options.source.sampleStepX,
          options.source.sampleStepZ,
          options.sampleStartX,
          options.sampleStartZ,
          options.rows,
          options.columns,
        ) as Float64Array
        return result instanceof Float64Array ? result : Float64Array.from(result as ArrayLike<number>)
      },
    }
  } catch {
    return {
      kind: 'fallback',
      sampleHeightGrid(options) {
        return buildPlanningDemHeightGridFallback(options)
      },
    }
  }
}

export function ensurePlanningDemSamplingWasm(): Promise<PlanningDemSamplingBindings> {
  if (!bindingsPromise) {
    bindingsPromise = loadPlanningDemSamplingWasm().then((bindings) => {
      resolvedBindings = bindings
      return bindings
    })
  }
  return bindingsPromise
}

void ensurePlanningDemSamplingWasm()

export function samplePlanningDemHeightGrid(options: PlanningDemHeightGridSampleOptions): Float64Array {
  if (resolvedBindings) {
    return resolvedBindings.sampleHeightGrid(options)
  }
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