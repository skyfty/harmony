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

function sampleHeight(definition: GroundDynamicMesh, row: number, column: number): number {
  const key = `${row}:${column}`
  const value = definition.heightMap?.[key]
  return typeof value === 'number' ? value : 0
}

// 判断世界坐标是否靠近某个网格间隔，从而决定是否绘制该线。
function isAligned(coord: number, spacing: number): boolean {
  if (spacing <= 0) {
    return false
  }
  const mod = Math.abs(coord) % spacing
  const distance = Math.min(mod, spacing - mod)
  return distance < Math.max(spacing * 0.01, 1e-3)
}

// 根据地形定义构建细线和粗线的顶点数组，用于后续 BufferGeometry。
function buildGridSegments(definition: GroundDynamicMesh): { minor: number[]; major: number[] } {
  const columns = Math.max(1, Math.floor(definition.columns))
  const rows = Math.max(1, Math.floor(definition.rows))
  const cellSize = Math.max(1e-4, definition.cellSize)
  const width = Math.max(Math.abs(definition.width), columns * cellSize)
  const depth = Math.max(Math.abs(definition.depth), rows * cellSize)
  const halfWidth = width * 0.5
  const halfDepth = depth * 0.5
  const stepX = columns > 0 ? width / columns : 0
  const stepZ = rows > 0 ? depth / rows : 0

  const minorSegments: number[] = []
  const majorSegments: number[] = []

  // 将一条线段的两端坐标追加到指定的数组中。
  const pushSegment = (target: number[], ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    target.push(ax, ay, az, bx, by, bz)
  }

  // 选择该坐标属于主网格、次网格还是不绘制。
  const classifyLine = (coord: number) => {
    if (isAligned(coord, GRID_MAJOR_SPACING)) {
      return majorSegments
    }
    if (isAligned(coord, GRID_MINOR_SPACING)) {
      return minorSegments
    }
    return null
  }

  for (let rowIndex = 0; rowIndex <= rows; rowIndex += 1) {
    const z = -halfDepth + rowIndex * stepZ
    const target = classifyLine(z)
    if (!target) {
      continue
    }
    for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
      const ax = -halfWidth + columnIndex * stepX
      const bx = ax + stepX
      const ay = sampleHeight(definition, rowIndex, columnIndex) + LINE_OFFSET
      const by = sampleHeight(definition, rowIndex, columnIndex + 1) + LINE_OFFSET
      pushSegment(target, ax, ay, z, bx, by, z)
    }
  }

  for (let columnIndex = 0; columnIndex <= columns; columnIndex += 1) {
    const x = -halfWidth + columnIndex * stepX
    const target = classifyLine(x)
    if (!target) {
      continue
    }
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      const az = -halfDepth + rowIndex * stepZ
      const bz = az + stepZ
      const ay = sampleHeight(definition, rowIndex, columnIndex) + LINE_OFFSET
      const by = sampleHeight(definition, rowIndex + 1, columnIndex) + LINE_OFFSET
      pushSegment(target, x, ay, az, x, by, bz)
    }
  }

  return { minor: minorSegments, major: majorSegments }
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

export class TerrainGridHelper extends THREE.Object3D {
  private minorLines: THREE.LineSegments | null = null
  private majorLines: THREE.LineSegments | null = null
  private minorMaterial = createLineMaterial(MINOR_COLOR, MINOR_LINE_WIDTH)
  private majorMaterial = createLineMaterial(MAJOR_COLOR, MAJOR_LINE_WIDTH)
  private signature: string | null = null

  constructor() {
    super()
    this.name = 'TerrainGridHelper'
  }

  // 根据传入签名决定是否重建网格，仅在数据变化时更新时间开销较大的网格几何。
  update(definition: GroundDynamicMesh | null, nextSignature: string | null) {
    if (!definition) {
      this.signature = null
      this.setVisible(false)
      return
    }

    if (nextSignature && nextSignature === this.signature) {
      this.setVisible(true)
      return
    }

    this.signature = nextSignature
    const { minor, major } = buildGridSegments(definition)
    this.replaceLines(minor, this.minorLines, this.minorMaterial, (instance) => {
      this.minorLines = instance
    })
    this.replaceLines(major, this.majorLines, this.majorMaterial, (instance) => {
      this.majorLines = instance
    })
  }

  // 释放所有资源，避免内存或 GPU 泄漏。
  dispose() {
    this.minorLines?.geometry.dispose()
    this.majorLines?.geometry.dispose()
    this.minorLines?.removeFromParent()
    this.majorLines?.removeFromParent()
    this.minorMaterial.dispose()
    this.majorMaterial.dispose()
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
    data: number[],
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

    const positions = new Float32Array(data)

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
