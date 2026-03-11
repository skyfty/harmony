import * as THREE from 'three'
import { GROUND_NODE_ID, cloneGroundHeightMap, type GroundDynamicMesh, type GroundRuntimeDynamicMesh } from '@schema'
import { sampleGroundEffectiveHeightRegion, type GroundEffectiveHeightRegion } from '@schema/groundMesh'
import { toRaw } from 'vue'
import { useSceneStore } from '@/stores/sceneStore'
import { useGroundHeightmapStore } from '@/stores/groundHeightmapStore'
import { GRID_MAJOR_SPACING,GRID_MINOR_SPACING } from './constants'

// 网格线的主要配色和宽度配置，确保与地形有足够对比度。
const MINOR_COLOR = new THREE.Color(0x80c7ff)
const MAJOR_COLOR = new THREE.Color(0xffc107)
// 透明度略微降低，避免地形与网格叠加后显得过于刺眼。
const LINE_OPACITY = 0.65
// 将网格线整体轻微抬高，减少与地形表面共面时的闪烁。
const LINE_OFFSET = 0.002
// 当前仍使用 Three.js 基础线材质，线宽在不同平台上的实际表现可能受驱动限制。
const MINOR_LINE_WIDTH = 1.2
const MAJOR_LINE_WIDTH = 1.5
const TERRAIN_GRID_HEIGHT_CACHE_BLOCK_CELLS = 64

// 判断世界坐标是否靠近某个网格间隔，从而决定是否绘制该线。
function isAligned(coord: number, spacing: number): boolean {
  if (spacing <= 0) {
    return false
  }
  // 使用四舍五入求最近格点距离，避免 `%` 在大循环里带来的额外开销。
  // 同时对浮点误差更友好：coord 接近 n * spacing 时都能正确命中。
  const nearest = Math.round(coord / spacing) * spacing
  const distance = Math.abs(coord - nearest)
  return distance < Math.max(spacing * 0.01, 1e-3)
}

export type TerrainGridVisibleRange = {
  // 行范围与列范围都使用“网格顶点/边界索引”语义，而不是世界坐标。
  // 外部通常会根据当前视口或裁剪区域预先换算出这一范围，用于减少构建量。
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

type NormalizedTerrainGridRange = {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
  sampleMinRow: number
  sampleMaxRow: number
  sampleMinColumn: number
  sampleMaxColumn: number
  cellRows: number
  cellColumns: number
}

function normalizeTerrainGridRange(
  rows: number,
  columns: number,
  visibleRange?: TerrainGridVisibleRange | null,
): NormalizedTerrainGridRange | null {
  const clampInt = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(value)))
  const minRow = visibleRange ? clampInt(visibleRange.minRow, 0, rows) : 0
  const maxRow = visibleRange ? clampInt(visibleRange.maxRow, 0, rows) : rows
  const minColumn = visibleRange ? clampInt(visibleRange.minColumn, 0, columns) : 0
  const maxColumn = visibleRange ? clampInt(visibleRange.maxColumn, 0, columns) : columns
  const cellColumns = Math.max(0, maxColumn - minColumn)
  const cellRows = Math.max(0, maxRow - minRow)

  if (cellColumns === 0 || cellRows === 0) {
    return null
  }

  return {
    minRow,
    maxRow,
    minColumn,
    maxColumn,
    sampleMinRow: minRow,
    sampleMaxRow: maxRow,
    sampleMinColumn: minColumn,
    sampleMaxColumn: maxColumn,
    cellRows,
    cellColumns,
  }
}

// 根据地形定义构建细线和粗线的顶点数组，用于后续 BufferGeometry。
function buildGridSegments(
  definition: GroundDynamicMesh,
  visibleRange?: TerrainGridVisibleRange | null,
  sampledHeights?: GroundEffectiveHeightRegion | null,
): SegmentBuffers {
  // 对输入参数做兜底，避免异常数据导致除零、负尺寸或数组长度非法。
  const columns = Math.max(1, Math.floor(definition.columns))
  const rows = Math.max(1, Math.floor(definition.rows))
  const cellSize = Math.max(1e-4, definition.cellSize)
  const width = Math.max(Math.abs(definition.width), columns * cellSize)
  const depth = Math.max(Math.abs(definition.depth), rows * cellSize)
  const halfWidth = width * 0.5
  const halfDepth = depth * 0.5
  // stepX / stepZ 表示相邻两条网格线在世界空间中的实际距离。
  const stepX = columns > 0 ? width / columns : 0
  const stepZ = rows > 0 ? depth / rows : 0

  const range = normalizeTerrainGridRange(rows, columns, visibleRange)
  if (!range) {
    // 完全没有可见单元格时直接返回空数组，调用方会据此移除线段对象。
    return { minor: new Float32Array(0), major: new Float32Array(0) }
  }
  const {
    minRow,
    maxRow,
    minColumn,
    maxColumn,
    sampleMinRow,
    sampleMaxRow,
    sampleMinColumn,
    sampleMaxColumn,
    cellRows,
    cellColumns,
  } = range
  const sampledColumnCount = sampleMaxColumn - sampleMinColumn + 1
  const sampledRowCount = sampleMaxRow - sampleMinRow + 1

  // 预计算每个网格点的世界坐标（避免在巨量循环里重复做加乘）。
  const xCoords = new Float32Array(sampledColumnCount)
  const zCoords = new Float32Array(sampledRowCount)
  for (let columnIndex = sampleMinColumn; columnIndex <= sampleMaxColumn; columnIndex += 1) {
    xCoords[columnIndex - sampleMinColumn] = -halfWidth + columnIndex * stepX
  }
  for (let rowIndex = sampleMinRow; rowIndex <= sampleMaxRow; rowIndex += 1) {
    zCoords[rowIndex - sampleMinRow] = -halfDepth + rowIndex * stepZ
  }

  // 构建紧凑的一维高度数组（使用合成后的有效高度）。
  // 这里使用一维数组而不是二维数组，既减少对象分配，也更便于 Worker 传输。
  const heightRegion = sampledHeights ?? sampleGroundEffectiveHeightRegion(
    definition as GroundRuntimeDynamicMesh,
    sampleMinRow,
    sampleMaxRow,
    sampleMinColumn,
    sampleMaxColumn,
  )
  const stride = heightRegion.stride
  const heightGrid = heightRegion.values
  const getHeight = (rowIndex: number, columnIndex: number) => {
    const localRow = rowIndex - heightRegion.minRow
    const localColumn = columnIndex - heightRegion.minColumn
    return heightGrid[localRow * stride + localColumn]!
  }

  // 先收集需要绘制的行/列索引，避免后续循环里反复判断对齐。
  const majorRows: number[] = []
  const minorRows: number[] = []
  const majorColumns: number[] = []
  const minorColumns: number[] = []

  for (let rowIndex = minRow; rowIndex <= maxRow; rowIndex += 1) {
    const z = zCoords[rowIndex - sampleMinRow]!
    // 粗网格优先于细网格命中，避免同一条线同时写入两个缓冲区。
    if (isAligned(z, GRID_MAJOR_SPACING)) {
      majorRows.push(rowIndex)
    } else if (isAligned(z, GRID_MINOR_SPACING)) {
      minorRows.push(rowIndex)
    }
  }

  for (let columnIndex = minColumn; columnIndex <= maxColumn; columnIndex += 1) {
    const x = xCoords[columnIndex - sampleMinColumn]!
    if (isAligned(x, GRID_MAJOR_SPACING)) {
      majorColumns.push(columnIndex)
    } else if (isAligned(x, GRID_MINOR_SPACING)) {
      minorColumns.push(columnIndex)
    }
  }

  // 每条线段由两个三维点组成，因此每段固定占用 6 个 float。
  const majorSegmentCount = majorRows.length * cellColumns + majorColumns.length * cellRows
  const minorSegmentCount = minorRows.length * cellColumns + minorColumns.length * cellRows
  const major = new Float32Array(majorSegmentCount * 6)
  const minor = new Float32Array(minorSegmentCount * 6)

  let majorOffset = 0
  let minorOffset = 0

  const writeSegment = (
    target: Float32Array,
    offset: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ) => {
    // 按 ax, ay, az, bx, by, bz 的顺序写入，直接对应 position attribute 的布局。
    target[offset] = ax
    target[offset + 1] = ay
    target[offset + 2] = az
    target[offset + 3] = bx
    target[offset + 4] = by
    target[offset + 5] = bz
  }

  // 水平线：固定 rowIndex，沿 X 方向按 cell 分段。
  // 之所以按 cell 分段而不是整行一根线，是因为每个顶点高度都可能不同，
  // 必须逐段贴合地形表面才能正确表现起伏。
  for (let i = 0; i < majorRows.length; i += 1) {
    const rowIndex = majorRows[i]!
    const z = zCoords[rowIndex - sampleMinRow]!
    for (let columnIndex = minColumn; columnIndex < maxColumn; columnIndex += 1) {
      const ax = xCoords[columnIndex - sampleMinColumn]!
      const bx = xCoords[columnIndex + 1 - sampleMinColumn]!
      const ay = getHeight(rowIndex, columnIndex) + LINE_OFFSET
      const by = getHeight(rowIndex, columnIndex + 1) + LINE_OFFSET
      writeSegment(major, majorOffset, ax, ay, z, bx, by, z)
      majorOffset += 6
    }
  }

  // 细线与粗线走完全相同的生成流程，只是写入不同目标缓冲区。
  for (let i = 0; i < minorRows.length; i += 1) {
    const rowIndex = minorRows[i]!
    const z = zCoords[rowIndex - sampleMinRow]!
    for (let columnIndex = minColumn; columnIndex < maxColumn; columnIndex += 1) {
      const ax = xCoords[columnIndex - sampleMinColumn]!
      const bx = xCoords[columnIndex + 1 - sampleMinColumn]!
      const ay = getHeight(rowIndex, columnIndex) + LINE_OFFSET
      const by = getHeight(rowIndex, columnIndex + 1) + LINE_OFFSET
      writeSegment(minor, minorOffset, ax, ay, z, bx, by, z)
      minorOffset += 6
    }
  }

  // 垂直线：固定 columnIndex，沿 Z 方向按 cell 分段。
  for (let i = 0; i < majorColumns.length; i += 1) {
    const columnIndex = majorColumns[i]!
    const x = xCoords[columnIndex - sampleMinColumn]!
    for (let rowIndex = minRow; rowIndex < maxRow; rowIndex += 1) {
      const az = zCoords[rowIndex - sampleMinRow]!
      const bz = zCoords[rowIndex + 1 - sampleMinRow]!
      const ay = getHeight(rowIndex, columnIndex) + LINE_OFFSET
      const by = getHeight(rowIndex + 1, columnIndex) + LINE_OFFSET
      writeSegment(major, majorOffset, x, ay, az, x, by, bz)
      majorOffset += 6
    }
  }

  for (let i = 0; i < minorColumns.length; i += 1) {
    const columnIndex = minorColumns[i]!
    const x = xCoords[columnIndex - sampleMinColumn]!
    for (let rowIndex = minRow; rowIndex < maxRow; rowIndex += 1) {
      const az = zCoords[rowIndex - sampleMinRow]!
      const bz = zCoords[rowIndex + 1 - sampleMinRow]!
      const ay = getHeight(rowIndex, columnIndex) + LINE_OFFSET
      const by = getHeight(rowIndex + 1, columnIndex) + LINE_OFFSET
      writeSegment(minor, minorOffset, x, ay, az, x, by, bz)
      minorOffset += 6
    }
  }

  // 返回的两个 Float32Array 会直接喂给 BufferGeometry，不再做额外拷贝。
  return { minor, major }
}

// 创建一个简单的线材质，关闭深度写入以及色调映射以避免与地形冲突。
function createLineMaterial(color: THREE.Color, linewidth: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    linewidth,
    transparent: true,
    opacity: LINE_OPACITY,
    depthWrite: false,
    toneMapped: false,
  })
}

// 将位置数组包裹在 LineSegments 中，同时防止剔除和控制渲染顺序。
function createLineSegments(positions: Float32Array, material: THREE.LineBasicMaterial): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const lines = new THREE.LineSegments(geometry, material)
  lines.frustumCulled = false
  lines.renderOrder = 100
  return lines
}

type SegmentBuffers = { minor: Float32Array; major: Float32Array }

type TerrainGridBuildRequest = {
  // kind 用于在 Worker 通信中做轻量级消息分发，避免误处理其他消息。
  kind: 'build-terrain-grid'
  requestId: number
  columns: number
  rows: number
  cellSize: number
  width: number
  depth: number
  majorSpacing: number
  minorSpacing: number
  lineOffset: number
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
  sampleMinRow: number
  sampleMaxRow: number
  sampleMinColumn: number
  sampleMaxColumn: number
  heightValues: ArrayBuffer
}

type TerrainGridBuildResponse = {
  // Worker 返回两个独立的顶点缓冲区，并附带计算到的高度范围信息。
  kind: 'build-terrain-grid-result'
  requestId: number
  minor: ArrayBuffer
  major: ArrayBuffer
  error?: string
}

type TerrainGridHeightTransfer = GroundEffectiveHeightRegion

type CachedTerrainHeightBlock = GroundEffectiveHeightRegion

function extractTerrainGridBaseSignature(cacheKey: string | null): string | null {
  if (!cacheKey) {
    return null
  }
  const viewMarker = cacheKey.indexOf('|view:')
  return viewMarker >= 0 ? cacheKey.slice(0, viewMarker) : cacheKey
}

function makeTerrainHeightBlockKey(baseSignature: string, blockRow: number, blockColumn: number): string {
  return `${baseSignature}|h:${blockRow}:${blockColumn}`
}

function createGroundDefinitionSnapshot(definition: GroundDynamicMesh): GroundRuntimeDynamicMesh {
  const rawDefinition = toRaw(definition) as GroundDynamicMesh
  const sceneStore = useSceneStore()
  const sceneId = typeof sceneStore.currentSceneId === 'string' ? sceneStore.currentSceneId.trim() : ''
  if (!sceneId) {
    throw new Error('Ground runtime state is unavailable for terrain grid snapshot')
  }
  const sourceDefinition = useGroundHeightmapStore().resolveGroundRuntimeMesh(GROUND_NODE_ID, rawDefinition)
  return {
    ...rawDefinition,
    manualHeightMap: cloneGroundHeightMap(
      toRaw(sourceDefinition.manualHeightMap) ?? sourceDefinition.manualHeightMap,
      sourceDefinition.rows,
      sourceDefinition.columns,
    ),
    planningHeightMap: cloneGroundHeightMap(
      toRaw(sourceDefinition.planningHeightMap) ?? sourceDefinition.planningHeightMap,
      sourceDefinition.rows,
      sourceDefinition.columns,
    ),
    heightComposition: (toRaw(rawDefinition.heightComposition) ?? rawDefinition.heightComposition) as GroundDynamicMesh['heightComposition'],
    planningMetadata: rawDefinition.planningMetadata
      ? (toRaw(rawDefinition.planningMetadata) as GroundDynamicMesh['planningMetadata'])
      : null,
    generation: rawDefinition.generation ? (toRaw(rawDefinition.generation) as GroundDynamicMesh['generation']) : null,
    terrainScatter: rawDefinition.terrainScatter ? (toRaw(rawDefinition.terrainScatter) as GroundDynamicMesh['terrainScatter']) : null,
    terrainPaint: rawDefinition.terrainPaint ? (toRaw(rawDefinition.terrainPaint) as GroundDynamicMesh['terrainPaint']) : null,
  }
}

export class TerrainGridHelper extends THREE.Object3D {
  // 细网格与粗网格拆成两套对象，便于分别设置材质、显隐和后续扩展。
  private minorLines: THREE.LineSegments | null = null
  private majorLines: THREE.LineSegments | null = null
  private minorMaterial = createLineMaterial(MINOR_COLOR, MINOR_LINE_WIDTH)
  private majorMaterial = createLineMaterial(MAJOR_COLOR, MAJOR_LINE_WIDTH)
  // signature 表示当前已经渲染到场景中的版本；pendingSignature 表示正在生成中的版本。
  private signature: string | null = null
  private pendingSignature: string | null = null
  // 以签名缓存已生成的顶点数据，避免在相同地形状态下重复计算。
  private segmentCache = new Map<string, SegmentBuffers>()
  private heightBlockCache = new Map<string, CachedTerrainHeightBlock>()
  private heightBlockCacheBaseSignature: string | null = null

  // 高度范围会被外部逻辑复用，例如设置相机裁剪、辅助显示或包围盒信息。
  private hasHeightRange = false
  private heightMin = 0
  private heightMax = 0

  // Worker 相关状态：
  // - gridRequestId 用于给每次 postMessage 分配唯一请求编号；
  // - gridJobToken 用于让更旧的异步任务失效；
  // - pendingGridRequests 维护 requestId 到 Promise 的映射。
  private gridWorker: Worker | null = null
  private gridRequestId = 0
  private gridJobToken = 0
  private pendingGridRequests = new Map<
    number,
    {
      resolve: (response: TerrainGridBuildResponse) => void
      reject: (error: Error) => void
    }
  >()

  constructor() {
    super()
    this.name = 'TerrainGridHelper'
  }

  // 返回最近一次网格构建得到的高度上下界；若尚未构建，则返回 null。
  getLastHeightRange(): { min: number; max: number } | null {
    if (!this.hasHeightRange) {
      return null
    }
    return { min: this.heightMin, max: this.heightMax }
  }

  // 延迟创建 Worker，并复用同一个实例处理后续网格构建任务。
  private getGridWorker(): Worker | null {
    if (typeof Worker === 'undefined') {
      // 某些环境可能不支持 Worker，例如 SSR、测试环境或受限 WebView。
      return null
    }
    if (this.gridWorker) {
      return this.gridWorker
    }
    try {
      this.gridWorker = new Worker(new URL('@/workers/terrainGrid.worker.ts', import.meta.url), { type: 'module' })
      this.gridWorker.onmessage = (event: MessageEvent<TerrainGridBuildResponse>) => {
        const data = event.data
        if (!data || data.kind !== 'build-terrain-grid-result') {
          // 非目标消息直接忽略，避免不同 Worker 协议混用时互相干扰。
          return
        }
        const pending = this.pendingGridRequests.get(data.requestId)
        if (!pending) {
          // 请求可能已被取消或被新任务替换，此时结果没有继续消费的必要。
          return
        }
        this.pendingGridRequests.delete(data.requestId)
        pending.resolve(data)
      }
      this.gridWorker.onerror = (event) => {
        console.warn('地形网格 Worker 出错：', event)
      }
      return this.gridWorker
    } catch (error) {
      console.warn('无法初始化地形网格 Worker，将回退到主线程生成：', error)
      this.gridWorker = null
      return null
    }
  }

  // 主动拒绝所有挂起中的 Promise，避免调用方永远等待一个不会返回的旧请求。
  private cancelPendingGridRequests(reason: string) {
    for (const pending of this.pendingGridRequests.values()) {
      pending.reject(new Error(reason))
    }
    this.pendingGridRequests.clear()
  }

  // 终止 Worker 后必须同步清理 pending 映射，否则会遗留悬空的异步请求。
  private resetGridWorker(reason: string) {
    if (this.gridWorker) {
      this.gridWorker.terminate()
      this.gridWorker = null
    }
    this.cancelPendingGridRequests(reason)
  }

  // 将高度数据拍平成可 Transfer 的 TypedArray，供 Worker 侧直接重建高度网格。
  private createHeightTransfer(
    definition: GroundDynamicMesh,
    range: NormalizedTerrainGridRange,
    baseSignature: string | null,
  ): TerrainGridHeightTransfer {
    const sampleRowCount = range.sampleMaxRow - range.sampleMinRow + 1
    const sampleColumnCount = range.sampleMaxColumn - range.sampleMinColumn + 1
    const total = sampleRowCount * sampleColumnCount
    const heightValues = new Float32Array(total)

    if (baseSignature && this.heightBlockCacheBaseSignature !== baseSignature) {
      this.heightBlockCache.clear()
      this.heightBlockCacheBaseSignature = baseSignature
    } else if (!baseSignature && this.heightBlockCache.size > 0) {
      this.heightBlockCache.clear()
      this.heightBlockCacheBaseSignature = null
    }

    const rows = Math.max(1, Math.floor(definition.rows))
    const columns = Math.max(1, Math.floor(definition.columns))
    const blockSize = TERRAIN_GRID_HEIGHT_CACHE_BLOCK_CELLS
    const firstBlockRow = Math.floor(range.sampleMinRow / blockSize)
    const lastBlockRow = Math.floor(range.sampleMaxRow / blockSize)
    const firstBlockColumn = Math.floor(range.sampleMinColumn / blockSize)
    const lastBlockColumn = Math.floor(range.sampleMaxColumn / blockSize)

    for (let blockRow = firstBlockRow; blockRow <= lastBlockRow; blockRow += 1) {
      for (let blockColumn = firstBlockColumn; blockColumn <= lastBlockColumn; blockColumn += 1) {
        const blockStartRow = blockRow * blockSize
        const blockStartColumn = blockColumn * blockSize
        const blockEndRow = Math.min(rows, blockStartRow + blockSize)
        const blockEndColumn = Math.min(columns, blockStartColumn + blockSize)
        const cacheEntry = baseSignature
          ? this.heightBlockCache.get(makeTerrainHeightBlockKey(baseSignature, blockRow, blockColumn)) ?? null
          : null
        const block = cacheEntry ?? sampleGroundEffectiveHeightRegion(
          definition as GroundRuntimeDynamicMesh,
          blockStartRow,
          blockEndRow,
          blockStartColumn,
          blockEndColumn,
        )

        if (baseSignature && !cacheEntry) {
          this.heightBlockCache.set(makeTerrainHeightBlockKey(baseSignature, blockRow, blockColumn), block)
        }

        const copyMinRow = Math.max(range.sampleMinRow, block.minRow)
        const copyMaxRow = Math.min(range.sampleMaxRow, block.maxRow)
        const copyMinColumn = Math.max(range.sampleMinColumn, block.minColumn)
        const copyMaxColumn = Math.min(range.sampleMaxColumn, block.maxColumn)
        if (copyMaxRow < copyMinRow || copyMaxColumn < copyMinColumn) {
          continue
        }

        const copyWidth = copyMaxColumn - copyMinColumn + 1
        for (let rowIndex = copyMinRow; rowIndex <= copyMaxRow; rowIndex += 1) {
          const targetOffset = (rowIndex - range.sampleMinRow) * sampleColumnCount + (copyMinColumn - range.sampleMinColumn)
          const sourceOffset = (rowIndex - block.minRow) * block.stride + (copyMinColumn - block.minColumn)
          heightValues.set(block.values.subarray(sourceOffset, sourceOffset + copyWidth), targetOffset)
        }
      }
    }

    let minY = 0
    let maxY = 0
    for (let index = 0; index < heightValues.length; index += 1) {
      const value = heightValues[index]!
      minY = Math.min(minY, value)
      maxY = Math.max(maxY, value)
    }

    return {
      minRow: range.sampleMinRow,
      maxRow: range.sampleMaxRow,
      minColumn: range.sampleMinColumn,
      maxColumn: range.sampleMaxColumn,
      stride: sampleColumnCount,
      values: heightValues,
      heightMin: minY,
      heightMax: maxY,
    }
  }

  private async buildSegmentsAsync(
    definition: GroundDynamicMesh,
    cacheKey: string | null,
    visibleRange?: TerrainGridVisibleRange | null,
  ) {
    const definitionSnapshot = createGroundDefinitionSnapshot(definition)
    const baseSignature = extractTerrainGridBaseSignature(cacheKey)
    // 每次开始一个新任务时都让旧任务失效（避免 worker 排队导致 CPU 被占满）。
    const jobToken = (this.gridJobToken += 1)
    this.resetGridWorker('replaced-by-new-request')
    const worker = this.getGridWorker()

    const columns = Math.max(1, Math.floor(definitionSnapshot.columns))
    const rows = Math.max(1, Math.floor(definitionSnapshot.rows))
    const range = normalizeTerrainGridRange(rows, columns, visibleRange)
    if (!range) {
      const empty = { minor: new Float32Array(0), major: new Float32Array(0) }
      if (cacheKey) {
        this.segmentCache.set(cacheKey, empty)
      }
      if (jobToken !== this.gridJobToken || this.pendingSignature !== cacheKey) {
        return
      }
      this.signature = cacheKey
      this.pendingSignature = null
      this.replaceLines(empty.minor, this.minorLines, this.minorMaterial, (instance) => {
        this.minorLines = instance
      })
      this.replaceLines(empty.major, this.majorLines, this.majorMaterial, (instance) => {
        this.majorLines = instance
      })
      this.setVisible(true)
      return
    }
    // 先在主线程打包高度数据，Worker 只负责纯计算，避免跨线程共享复杂对象。
    const transfer = this.createHeightTransfer(definitionSnapshot, range, baseSignature)
    // 即便 worker 还没返回，也可以先缓存一份高度范围（heightMap 未编辑的点隐含为 0）。
    this.hasHeightRange = true
    this.heightMin = transfer.heightMin
    this.heightMax = transfer.heightMax

    if (!worker) {
      const buffers = buildGridSegments(definitionSnapshot, visibleRange, transfer)
      if (cacheKey) {
        this.segmentCache.set(cacheKey, buffers)
      }
      if (jobToken !== this.gridJobToken || this.pendingSignature !== cacheKey) {
        return
      }
      this.signature = cacheKey
      this.pendingSignature = null
      this.replaceLines(buffers.minor, this.minorLines, this.minorMaterial, (instance) => {
        this.minorLines = instance
      })
      this.replaceLines(buffers.major, this.majorLines, this.majorMaterial, (instance) => {
        this.majorLines = instance
      })
      this.setVisible(true)
      return
    }

    const requestId = (this.gridRequestId += 1)
    const request: TerrainGridBuildRequest = {
      kind: 'build-terrain-grid',
      requestId,
      columns: definitionSnapshot.columns,
      rows: definitionSnapshot.rows,
      cellSize: definitionSnapshot.cellSize,
      width: definitionSnapshot.width,
      depth: definitionSnapshot.depth,
      majorSpacing: GRID_MAJOR_SPACING,
      minorSpacing: GRID_MINOR_SPACING,
      lineOffset: LINE_OFFSET,
      minRow: range.minRow,
      maxRow: range.maxRow,
      minColumn: range.minColumn,
      maxColumn: range.maxColumn,
      sampleMinRow: transfer.minRow,
      sampleMaxRow: transfer.maxRow,
      sampleMinColumn: transfer.minColumn,
      sampleMaxColumn: transfer.maxColumn,
      heightValues: transfer.values.buffer as ArrayBuffer,
    }

    const responsePromise = new Promise<TerrainGridBuildResponse>((resolve, reject) => {
      this.pendingGridRequests.set(requestId, { resolve, reject })
      try {
        // 使用 Transferable 转移底层 ArrayBuffer，避免大数组复制带来的额外开销。
        worker.postMessage(request, [request.heightValues])
      } catch (error) {
        this.pendingGridRequests.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })

    const response = await responsePromise
    if (jobToken !== this.gridJobToken || this.pendingSignature !== cacheKey) {
      // 即使 Worker 正常返回，只要它不是当前最新任务，结果也不能落地到场景中。
      return
    }
    if (response.error) {
      throw new Error(response.error)
    }

    this.hasHeightRange = true
    this.heightMin = transfer.heightMin
    this.heightMax = transfer.heightMax

    const buffers: SegmentBuffers = {
      minor: new Float32Array(response.minor),
      major: new Float32Array(response.major),
    }
    // Worker 返回的是已转移回来的 ArrayBuffer，这里重新包成 Float32Array 供 Three.js 使用。
    if (cacheKey) {
      this.segmentCache.set(cacheKey, buffers)
    }
    this.signature = cacheKey
    this.pendingSignature = null
    this.replaceLines(buffers.minor, this.minorLines, this.minorMaterial, (instance) => {
      this.minorLines = instance
    })
    this.replaceLines(buffers.major, this.majorLines, this.majorMaterial, (instance) => {
      this.majorLines = instance
    })
    this.setVisible(true)
  }

  // 根据传入签名决定是否重建网格，仅在数据变化时更新时间开销较大的网格几何。
  update(definition: GroundDynamicMesh | null, nextSignature: string | null, visibleRange?: TerrainGridVisibleRange | null) {
    if (!definition) {
      // 没有地形定义时直接隐藏当前网格，但保留对象实例供后续继续复用。
      this.signature = null
      this.pendingSignature = null
      this.heightBlockCache.clear()
      this.heightBlockCacheBaseSignature = null
      this.setVisible(false)
      return
    }

    if (nextSignature && nextSignature === this.signature) {
      // 当前场景中已经是目标版本，不需要任何重建。
      this.setVisible(true)
      return
    }

    if (nextSignature && nextSignature === this.pendingSignature) {
      // 相同版本已经在生成中，保持可见即可，避免重复提交任务。
      this.setVisible(true)
      return
    }

    const cacheKey = nextSignature ?? null
    const cached = cacheKey ? this.segmentCache.get(cacheKey) : null
    if (cached) {
      // 命中缓存时只需重建 Three.js geometry 绑定，不再重复计算顶点。
      this.signature = cacheKey
      this.pendingSignature = null
      this.replaceLines(cached.minor, this.minorLines, this.minorMaterial, (instance) => {
        this.minorLines = instance
      })
      this.replaceLines(cached.major, this.majorLines, this.majorMaterial, (instance) => {
        this.majorLines = instance
      })
      this.setVisible(true)
      return
    }

    this.pendingSignature = cacheKey
    this.setVisible(true)
    // 异步构建失败时仅清理 pending 状态，不在这里主动抛错打断编辑器流程。
    this.buildSegmentsAsync(definition, cacheKey, visibleRange).catch(() => {
      if (this.pendingSignature === cacheKey) {
        this.pendingSignature = null
      }
    })
  }

  // 释放所有资源，避免内存或 GPU 泄漏。
  dispose() {
    // 先停掉 Worker，避免对象销毁后仍有异步回调尝试写入状态。
    this.resetGridWorker('disposed')
    this.minorLines?.geometry.dispose()
    this.majorLines?.geometry.dispose()
    this.minorLines?.removeFromParent()
    this.majorLines?.removeFromParent()
    this.minorMaterial.dispose()
    this.majorMaterial.dispose()
    this.segmentCache.clear()
    this.heightBlockCache.clear()
    this.heightBlockCacheBaseSignature = null
  }

  // 控制两层网格的显示状态，保持一致性。
  private setVisible(visible: boolean) {
    if (this.minorLines) {
      this.minorLines.visible = visible
    }
    if (this.majorLines) {
      this.majorLines.visible = visible
    }
  }

  // 重建或复用现有的线段对象，确保最大程度减少几何重建开销。
  private replaceLines(
    data: Float32Array,
    existing: THREE.LineSegments | null,
    material: THREE.LineBasicMaterial,
    assign: (instance: THREE.LineSegments | null) => void,
  ) {
    if (!data.length) {
      // 对应层没有任何线段时，移除旧对象，避免渲染空几何。
      if (existing) {
        existing.geometry.dispose()
        existing.removeFromParent()
        assign(null)
      }
      return
    }

    const positions = data
    if (existing) {
      existing.geometry.dispose()
      // 复用现有对象，只替换其几何数据以保持引用不变。
      // 这样外部若持有该对象引用，也不会因为重新创建实例而失效。
      existing.geometry = new THREE.BufferGeometry()
      existing.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      existing.geometry.computeBoundingBox()
      existing.geometry.computeBoundingSphere()
      existing.visible = true
      assign(existing)
      return
    }

    const lines = createLineSegments(positions, material)
    // 通过名称区分细线/粗线，便于调试或在场景树中检索。
    lines.name = material === this.minorMaterial ? 'TerrainGridMinorLines' : 'TerrainGridMajorLines'
    assign(lines)
    this.add(lines)
  }
}
