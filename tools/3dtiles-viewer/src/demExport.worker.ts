import * as THREE from 'three'
import {
  buildRgbCoverageHoleMask,
  buildTerrainDemSidecar,
  encodeDemGeoTiff,
  encodeOrthoGeoTiff,
  fillRgbHoles,
  planDemGrid,
  resolveDemGeoReference,
  sampleDemHeights,
  type DemExportFrame,
  type DemExportPhase,
  type DemGridPlan,
  type DemGeoReference,
  type DemSampleResult,
} from './demExport'
import {
  mergeTerrainGeometries,
  type TerrainMergeOptions,
  type TerrainMergeStats,
} from './terrainMerge'
import { buildZipArchive } from './zipArchive'

export interface DemWorkerMergeSource {
  positions: Float32Array
  normals: Float32Array | null
  uvs: Float32Array
  indices: Uint32Array
  materialIndex: number
}

export interface DemWorkerMergedGeometry {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint16Array | Uint32Array
  groups: Array<{ start: number; count: number; materialIndex: number }>
  stats: TerrainMergeStats
}

export interface DemWorkerSampleSummary {
  hitCount: number
  holeCount: number
  filledCount: number
  filledRatio: number
}

export type DemWorkerRequest =
  | {
      type: 'merge'
      sources: DemWorkerMergeSource[]
      options: Pick<TerrainMergeOptions, 'weldEpsilon' | 'stripSkirts' | 'smoothNormals'>
    }
  | {
      type: 'sample'
      plan: DemGridPlan
      frame: DemExportFrame
      warnings: string[]
      sourceTriangleCount: number
    }
  | {
      type: 'finish'
      rgb: Uint8Array | null
      createdAt: string
    }

export type DemWorkerResponse =
  | {
      type: 'progress'
      phase: DemExportPhase
      completed: number
      total: number
      label: string
    }
  | {
      type: 'merged'
      geometry: DemWorkerMergedGeometry
    }
  | {
      type: 'sampled'
      sample: DemWorkerSampleSummary
    }
  | {
      type: 'complete'
      zipBytes: Uint8Array
    }
  | {
      type: 'error'
      message: string
    }

interface WorkerScope {
  onmessage: ((event: MessageEvent<DemWorkerRequest>) => void) | null
  postMessage: (message: DemWorkerResponse, transfer?: Transferable[]) => void
}

const scope = self as unknown as WorkerScope

let heights: Float32Array | null = null
let wasHole: Uint8Array | null = null
let sample: DemSampleResult | null = null
let plan: DemGridPlan | null = null
let frame: DemExportFrame | null = null
let geo: DemGeoReference | null = null
let warnings: string[] = []
let sourceTriangleCount = 0
let demBuffer: ArrayBuffer | null = null
let mergedBuffers: {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint16Array | Uint32Array
} | null = null

function progress(phase: DemExportPhase, completed: number, total: number, label: string): void {
  scope.postMessage({ type: 'progress', phase, completed, total, label })
}

function uniqueArrayBuffers(
  values: Array<Float32Array | Uint16Array | Uint32Array>,
): Transferable[] {
  const unique = new Set<ArrayBuffer>()
  for (const value of values) {
    if (value.buffer instanceof ArrayBuffer) {
      unique.add(value.buffer)
    }
  }
  return [...unique]
}

function runMerge(request: Extract<DemWorkerRequest, { type: 'merge' }>): void {
  const sources = request.sources.map((source) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(source.positions, 3))
    if (source.normals) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(source.normals, 3))
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(source.uvs, 2))
    geometry.setIndex(new THREE.BufferAttribute(source.indices, 1))
    return { geometry, materialIndex: source.materialIndex }
  })

  const merged = mergeTerrainGeometries(sources, {
    ...request.options,
    onProgress: ({ completed, total, label }) => progress('merge', completed, total, label),
  })
  if (!merged) {
    throw new Error('当前锚点没有可导出的合并地形网格。')
  }

  const positions = merged.geometry.getAttribute('position')
  const normals = merged.geometry.getAttribute('normal')
  const uvs = merged.geometry.getAttribute('uv')
  const indices = merged.geometry.getIndex()
  if (!positions || !normals || !uvs || !indices) {
    throw new Error('地形合并失败：输出网格缺少必要属性。')
  }

  mergedBuffers = {
    positions: positions.array as Float32Array,
    normals: normals.array as Float32Array,
    uvs: uvs.array as Float32Array,
    indices: indices.array as Uint16Array | Uint32Array,
  }
  const output = {
    positions: mergedBuffers.positions.slice(),
    normals: mergedBuffers.normals.slice(),
    uvs: mergedBuffers.uvs.slice(),
    indices: mergedBuffers.indices.slice(),
  }

  scope.postMessage(
    {
      type: 'merged',
      geometry: {
        ...output,
        groups: merged.groups,
        stats: merged.stats,
      },
    },
    uniqueArrayBuffers([
      output.positions,
      output.normals,
      output.uvs,
      output.indices,
    ]),
  )
}

async function runSample(request: Extract<DemWorkerRequest, { type: 'sample' }>): Promise<void> {
  if (!mergedBuffers) {
    throw new Error('DEM 采样失败：没有已合并的地形网格。')
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(mergedBuffers.positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(mergedBuffers.indices, 1))
  geometry.computeBoundingBox()

  plan = request.plan
  frame = request.frame
  geo = resolveDemGeoReference(plan, frame)
  warnings = [...request.warnings]
  sourceTriangleCount = request.sourceTriangleCount

  sample = await sampleDemHeights(geometry, plan, frame, {
    chunkCells: 32768,
    yieldFn: async () => undefined,
    onProgress: ({ phase, loaded, total, label }) => {
      progress(phase === 'fill' ? 'fill-dem' : 'sample', loaded, total, label)
    },
  })

  if (sample.hitCount === 0) {
    throw new Error('DEM 采样失败：扫描没有命中地形网格。')
  }
  if (sample.filledRatio > 0.05) {
    warnings.push(`采样空洞占比 ${(sample.filledRatio * 100).toFixed(1)}%，已用最近有效值填充。`)
  }

  heights = sample.heights
  wasHole = sample.wasHole
  progress('encode-dem', 0, 1, '编码 dem.tif')
  demBuffer = encodeDemGeoTiff(heights, plan, geo)
  progress('encode-dem', 1, 1, '编码 dem.tif 完成')

  scope.postMessage({
    type: 'sampled',
    sample: {
      hitCount: sample.hitCount,
      holeCount: sample.holeCount,
      filledCount: sample.filledCount,
      filledRatio: sample.filledRatio,
    },
  })
}

function runFinish(request: Extract<DemWorkerRequest, { type: 'finish' }>): void {
  if (!heights || !wasHole || !sample || !plan || !frame || !geo || !demBuffer) {
    throw new Error('DEM 导出状态已失效，请重新导出。')
  }

  let orthoBuffer: ArrayBuffer | null = null
  if (request.rgb) {
    const totalCells = plan.rows * plan.cols
    const coverage = buildRgbCoverageHoleMask(
      request.rgb,
      wasHole,
      plan.rows,
      plan.cols,
      {
        onProgress: ({ processedCount, totalCount }) => {
          progress('ortho-process', processedCount, totalCount, `检查正射影像 ${processedCount}/${totalCount}`)
        },
      },
    )
    if (coverage.coveredCount === 0) {
      throw new Error('正射渲染失败：没有产生任何有效纹理像素。')
    }

    const filled = fillRgbHoles(
      request.rgb,
      coverage.mask,
      plan.rows,
      plan.cols,
      {
        onProgress: ({ processedCount, totalCount }) => {
          progress('ortho-process', processedCount, totalCount, `填充正射空洞 ${processedCount}/${totalCount}`)
        },
      },
    )
    if (filled > 0) {
      warnings.push(
        `正射影像有 ${coverage.holeCount}/${totalCells} 个像素缺少有效颜色（${(coverage.holeCount / totalCells * 100).toFixed(1)}%），已用最近有效颜色填充。`,
      )
    }

    progress('encode-ortho', 0, 1, '编码 ortho.tif')
    orthoBuffer = encodeOrthoGeoTiff(request.rgb, plan, geo)
    progress('encode-ortho', 1, 1, '编码 ortho.tif 完成')
  }

  const sidecar = buildTerrainDemSidecar({
    frame,
    plan,
    geo,
    heights,
    sample,
    sourceTriangleCount,
    hasOrtho: orthoBuffer !== null,
    warnings,
    createdAt: new Date(request.createdAt),
  })

  const zipEntries = [
    { name: 'dem.tif', bytes: new Uint8Array(demBuffer) },
    ...(orthoBuffer ? [{ name: 'ortho.tif', bytes: new Uint8Array(orthoBuffer) }] : []),
    { name: 'dem.json', bytes: new TextEncoder().encode(JSON.stringify(sidecar, null, 2)) },
  ]
  const zipBytes = buildZipArchive(zipEntries, new Date(request.createdAt), {
    onProgress: ({ completed, total, label }) => progress('package', completed, total, label),
  })
  scope.postMessage({ type: 'complete', zipBytes }, [zipBytes.buffer])
}

scope.onmessage = (event) => {
  const request = event.data
  void (async () => {
    try {
      if (request.type === 'merge') {
        runMerge(request)
      } else if (request.type === 'sample') {
        await runSample(request)
      } else {
        runFinish(request)
      }
    } catch (error) {
      scope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : 'DEM 导出 Worker 执行失败。',
      })
    }
  })()
}
