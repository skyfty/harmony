import * as THREE from 'three'
import type { GroundDynamicMesh } from '@harmony/schema'
import { GRID_MAJOR_SPACING,GRID_MINOR_SPACING } from './constants'

// 网格线的主要配色和宽度配置，确保与地形有足够对比度。
const MINOR_COLOR = new THREE.Color(0x80c7ff)
const MAJOR_COLOR = new THREE.Color(0xffc107)
const LINE_OPACITY = 0.65
const LINE_OFFSET = 0.002
const MINOR_LINE_WIDTH = 1.2
const MAJOR_LINE_WIDTH = 1.5

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
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

// 根据地形定义构建细线和粗线的顶点数组，用于后续 BufferGeometry。
function buildGridSegments(definition: GroundDynamicMesh, visibleRange?: TerrainGridVisibleRange | null): SegmentBuffers {
  const columns = Math.max(1, Math.floor(definition.columns))
  const rows = Math.max(1, Math.floor(definition.rows))
  const cellSize = Math.max(1e-4, definition.cellSize)
  const width = Math.max(Math.abs(definition.width), columns * cellSize)
  const depth = Math.max(Math.abs(definition.depth), rows * cellSize)
  const halfWidth = width * 0.5
  const halfDepth = depth * 0.5
  const stepX = columns > 0 ? width / columns : 0
  const stepZ = rows > 0 ? depth / rows : 0

  const clampInt = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(value)))
  const minRow = visibleRange ? clampInt(visibleRange.minRow, 0, rows) : 0
  const maxRow = visibleRange ? clampInt(visibleRange.maxRow, 0, rows) : rows
  const minColumn = visibleRange ? clampInt(visibleRange.minColumn, 0, columns) : 0
  const maxColumn = visibleRange ? clampInt(visibleRange.maxColumn, 0, columns) : columns
  const cellColumns = Math.max(0, maxColumn - minColumn)
  const cellRows = Math.max(0, maxRow - minRow)
  if (cellColumns === 0 || cellRows === 0) {
    return { minor: new Float32Array(0), major: new Float32Array(0) }
  }

  // 预计算每个网格点的世界坐标（避免在巨量循环里重复做加乘）。
  const xCoords = new Float32Array(columns + 1)
  const zCoords = new Float32Array(rows + 1)
  for (let columnIndex = 0; columnIndex <= columns; columnIndex += 1) {
    xCoords[columnIndex] = -halfWidth + columnIndex * stepX
  }
  for (let rowIndex = 0; rowIndex <= rows; rowIndex += 1) {
    zCoords[rowIndex] = -halfDepth + rowIndex * stepZ
  }

  // 将 heightMap 解析为紧凑的一维 Float32Array。
  // 关键优化点：只遍历 heightMap 实际存在的条目，而不是 rows*columns 全量拼 key 查表。
  const stride = columns + 1
  const heightGrid = new Float32Array((rows + 1) * stride)
  const mapped = definition.heightMap ?? {}
  for (const key of Object.keys(mapped)) {
    const value = mapped[key]
    if (typeof value !== 'number') {
      continue
    }
    const sepIndex = key.indexOf(':')
    if (sepIndex <= 0) {
      continue
    }
    const rowIndex = Number(key.slice(0, sepIndex))
    const columnIndex = Number(key.slice(sepIndex + 1))
    if (!Number.isFinite(rowIndex) || !Number.isFinite(columnIndex)) {
      continue
    }
    if (rowIndex < 0 || rowIndex > rows || columnIndex < 0 || columnIndex > columns) {
      continue
    }
    heightGrid[rowIndex * stride + columnIndex] = value
  }

  // 先收集需要绘制的行/列索引，避免后续循环里反复判断对齐。
  const majorRows: number[] = []
  const minorRows: number[] = []
  const majorColumns: number[] = []
  const minorColumns: number[] = []

  for (let rowIndex = minRow; rowIndex <= maxRow; rowIndex += 1) {
    const z = zCoords[rowIndex]!
    if (isAligned(z, GRID_MAJOR_SPACING)) {
      majorRows.push(rowIndex)
    } else if (isAligned(z, GRID_MINOR_SPACING)) {
      minorRows.push(rowIndex)
    }
  }

  for (let columnIndex = minColumn; columnIndex <= maxColumn; columnIndex += 1) {
    const x = xCoords[columnIndex]!
    if (isAligned(x, GRID_MAJOR_SPACING)) {
      majorColumns.push(columnIndex)
    } else if (isAligned(x, GRID_MINOR_SPACING)) {
      minorColumns.push(columnIndex)
    }
  }

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
    target[offset] = ax
    target[offset + 1] = ay
    target[offset + 2] = az
    target[offset + 3] = bx
    target[offset + 4] = by
    target[offset + 5] = bz
  }

  // 水平线：固定 rowIndex，沿 X 方向按 cell 分段。
  for (let i = 0; i < majorRows.length; i += 1) {
    const rowIndex = majorRows[i]!
    const z = zCoords[rowIndex]!
    const base = rowIndex * stride
    for (let columnIndex = minColumn; columnIndex < maxColumn; columnIndex += 1) {
      const ax = xCoords[columnIndex]!
      const bx = xCoords[columnIndex + 1]!
      const ay = heightGrid[base + columnIndex]! + LINE_OFFSET
      const by = heightGrid[base + columnIndex + 1]! + LINE_OFFSET
      writeSegment(major, majorOffset, ax, ay, z, bx, by, z)
      majorOffset += 6
    }
  }

  for (let i = 0; i < minorRows.length; i += 1) {
    const rowIndex = minorRows[i]!
    const z = zCoords[rowIndex]!
    const base = rowIndex * stride
    for (let columnIndex = minColumn; columnIndex < maxColumn; columnIndex += 1) {
      const ax = xCoords[columnIndex]!
      const bx = xCoords[columnIndex + 1]!
      const ay = heightGrid[base + columnIndex]! + LINE_OFFSET
      const by = heightGrid[base + columnIndex + 1]! + LINE_OFFSET
      writeSegment(minor, minorOffset, ax, ay, z, bx, by, z)
      minorOffset += 6
    }
  }

  // 垂直线：固定 columnIndex，沿 Z 方向按 cell 分段。
  for (let i = 0; i < majorColumns.length; i += 1) {
    const columnIndex = majorColumns[i]!
    const x = xCoords[columnIndex]!
    for (let rowIndex = minRow; rowIndex < maxRow; rowIndex += 1) {
      const az = zCoords[rowIndex]!
      const bz = zCoords[rowIndex + 1]!
      const ay = heightGrid[rowIndex * stride + columnIndex]! + LINE_OFFSET
      const by = heightGrid[(rowIndex + 1) * stride + columnIndex]! + LINE_OFFSET
      writeSegment(major, majorOffset, x, ay, az, x, by, bz)
      majorOffset += 6
    }
  }

  for (let i = 0; i < minorColumns.length; i += 1) {
    const columnIndex = minorColumns[i]!
    const x = xCoords[columnIndex]!
    for (let rowIndex = minRow; rowIndex < maxRow; rowIndex += 1) {
      const az = zCoords[rowIndex]!
      const bz = zCoords[rowIndex + 1]!
      const ay = heightGrid[rowIndex * stride + columnIndex]! + LINE_OFFSET
      const by = heightGrid[(rowIndex + 1) * stride + columnIndex]! + LINE_OFFSET
      writeSegment(minor, minorOffset, x, ay, az, x, by, bz)
      minorOffset += 6
    }
  }

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
  heightIndices: ArrayBuffer
  heightValues: ArrayBuffer
  heightEntryCount: number
}

type TerrainGridBuildResponse = {
  kind: 'build-terrain-grid-result'
  requestId: number
  minor: ArrayBuffer
  major: ArrayBuffer
  heightMin: number
  heightMax: number
  error?: string
}

export class TerrainGridHelper extends THREE.Object3D {
  private minorLines: THREE.LineSegments | null = null
  private majorLines: THREE.LineSegments | null = null
  private minorMaterial = createLineMaterial(MINOR_COLOR, MINOR_LINE_WIDTH)
  private majorMaterial = createLineMaterial(MAJOR_COLOR, MAJOR_LINE_WIDTH)
  private signature: string | null = null
  private pendingSignature: string | null = null
  private segmentCache = new Map<string, SegmentBuffers>()

  private hasHeightRange = false
  private heightMin = 0
  private heightMax = 0

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

  getLastHeightRange(): { min: number; max: number } | null {
    if (!this.hasHeightRange) {
      return null
    }
    return { min: this.heightMin, max: this.heightMax }
  }

  private getGridWorker(): Worker | null {
    if (typeof Worker === 'undefined') {
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
          return
        }
        const pending = this.pendingGridRequests.get(data.requestId)
        if (!pending) {
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

  private cancelPendingGridRequests(reason: string) {
    for (const pending of this.pendingGridRequests.values()) {
      pending.reject(new Error(reason))
    }
    this.pendingGridRequests.clear()
  }

  private resetGridWorker(reason: string) {
    if (this.gridWorker) {
      this.gridWorker.terminate()
      this.gridWorker = null
    }
    this.cancelPendingGridRequests(reason)
  }

  private createHeightTransfer(definition: GroundDynamicMesh, rows: number, columns: number) {
    const mapped = definition.heightMap ?? {}
    const stride = columns + 1
    const keys = Object.keys(mapped)
    const heightIndices = new Uint32Array(keys.length)
    const heightValues = new Float32Array(keys.length)
    let count = 0
    let minY = 0
    let maxY = 0
    for (const key of keys) {
      const value = mapped[key]
      if (typeof value !== 'number') {
        continue
      }
      const sepIndex = key.indexOf(':')
      if (sepIndex <= 0) {
        continue
      }
      const rowIndex = Number(key.slice(0, sepIndex))
      const columnIndex = Number(key.slice(sepIndex + 1))
      if (!Number.isFinite(rowIndex) || !Number.isFinite(columnIndex)) {
        continue
      }
      if (rowIndex < 0 || rowIndex > rows || columnIndex < 0 || columnIndex > columns) {
        continue
      }
      heightIndices[count] = rowIndex * stride + columnIndex
      heightValues[count] = value
      minY = Math.min(minY, value)
      maxY = Math.max(maxY, value)
      count += 1
    }
    return {
      heightIndices,
      heightValues,
      heightEntryCount: count,
      heightMin: minY,
      heightMax: maxY,
    }
  }

  private async buildSegmentsAsync(
    definition: GroundDynamicMesh,
    cacheKey: string | null,
    visibleRange?: TerrainGridVisibleRange | null,
  ) {
    // 每次开始一个新任务时都让旧任务失效（避免 worker 排队导致 CPU 被占满）。
    const jobToken = (this.gridJobToken += 1)
    this.resetGridWorker('replaced-by-new-request')
    const worker = this.getGridWorker()
    if (!worker) {
      // Worker 不可用，回退到主线程（仍然可能很慢，但保证功能可用）。
      const buffers = buildGridSegments(definition, visibleRange)
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

    const columns = Math.max(1, Math.floor(definition.columns))
    const rows = Math.max(1, Math.floor(definition.rows))
    const clampInt = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(value)))
    const minRow = visibleRange ? clampInt(visibleRange.minRow, 0, rows) : 0
    const maxRow = visibleRange ? clampInt(visibleRange.maxRow, 0, rows) : rows
    const minColumn = visibleRange ? clampInt(visibleRange.minColumn, 0, columns) : 0
    const maxColumn = visibleRange ? clampInt(visibleRange.maxColumn, 0, columns) : columns
    const transfer = this.createHeightTransfer(definition, rows, columns)
    // 即便 worker 还没返回，也可以先缓存一份高度范围（heightMap 未编辑的点隐含为 0）。
    this.hasHeightRange = true
    this.heightMin = transfer.heightMin
    this.heightMax = transfer.heightMax
    const requestId = (this.gridRequestId += 1)
    const request: TerrainGridBuildRequest = {
      kind: 'build-terrain-grid',
      requestId,
      columns: definition.columns,
      rows: definition.rows,
      cellSize: definition.cellSize,
      width: definition.width,
      depth: definition.depth,
      majorSpacing: GRID_MAJOR_SPACING,
      minorSpacing: GRID_MINOR_SPACING,
      lineOffset: LINE_OFFSET,
      minRow,
      maxRow,
      minColumn,
      maxColumn,
      heightIndices: transfer.heightIndices.buffer as ArrayBuffer,
      heightValues: transfer.heightValues.buffer as ArrayBuffer,
      heightEntryCount: transfer.heightEntryCount,
    }

    const responsePromise = new Promise<TerrainGridBuildResponse>((resolve, reject) => {
      this.pendingGridRequests.set(requestId, { resolve, reject })
      try {
        worker.postMessage(request, [request.heightIndices, request.heightValues])
      } catch (error) {
        this.pendingGridRequests.delete(requestId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })

    const response = await responsePromise
    if (jobToken !== this.gridJobToken || this.pendingSignature !== cacheKey) {
      return
    }
    if (response.error) {
      throw new Error(response.error)
    }

    this.hasHeightRange = true
    this.heightMin = typeof response.heightMin === 'number' ? response.heightMin : this.heightMin
    this.heightMax = typeof response.heightMax === 'number' ? response.heightMax : this.heightMax

    const buffers: SegmentBuffers = {
      minor: new Float32Array(response.minor),
      major: new Float32Array(response.major),
    }
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
      this.signature = null
      this.pendingSignature = null
      this.setVisible(false)
      return
    }

    if (nextSignature && nextSignature === this.signature) {
      this.setVisible(true)
      return
    }

    if (nextSignature && nextSignature === this.pendingSignature) {
      this.setVisible(true)
      return
    }

    const cacheKey = nextSignature ?? null
    const cached = cacheKey ? this.segmentCache.get(cacheKey) : null
    if (cached) {
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
    this.buildSegmentsAsync(definition, cacheKey, visibleRange).catch((error) => {
      // 异步失败不应打断编辑器；仅记录，后续更新会重试。
      console.warn('生成地形网格失败：', error)
      if (this.pendingSignature === cacheKey) {
        this.pendingSignature = null
      }
    })
  }

  // 释放所有资源，避免内存或 GPU 泄漏。
  dispose() {
    this.resetGridWorker('disposed')
    this.minorLines?.geometry.dispose()
    this.majorLines?.geometry.dispose()
    this.minorLines?.removeFromParent()
    this.majorLines?.removeFromParent()
    this.minorMaterial.dispose()
    this.majorMaterial.dispose()
    this.segmentCache.clear()
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
      existing.geometry = new THREE.BufferGeometry()
      existing.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      existing.geometry.computeBoundingBox()
      existing.geometry.computeBoundingSphere()
      existing.visible = true
      assign(existing)
      return
    }

    const lines = createLineSegments(positions, material)
    lines.name = material === this.minorMaterial ? 'TerrainGridMinorLines' : 'TerrainGridMajorLines'
    assign(lines)
    this.add(lines)
  }
}
