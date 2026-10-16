import { clamp, wrapAngle } from './noise'
import type { RoadTraceNode } from './roadTrace'

/**
 * 路面带的行/列采样（贴合真实地形面）。
 *
 * 追踪节点间距 8m、原始三角面可达数十到上百米，路面带若只按追踪节点铺，
 * 横向折坡会从两档之间顶出把路面压住。这里把带子沿路加密到 2m 一档，并在
 * 每个横向采样点取小邻域内的**最高面**（保守包络），保证可见路面不低于地面。
 */

/** 列采样的邻域包络（米）：沿路 / 横向各取最高面。 */
export const ROAD_SAMPLE_ALONG_RADIUS = 0.5
export const ROAD_SAMPLE_CROSS_RADIUS = 0.25

/** 路面带的行采样（追踪节点之间按 maxSpacing 加密）。 */
export interface RoadBandRow extends RoadTraceNode {
  /** 来源追踪节点下标（划线权重等按节点对齐的属性用它映射）。 */
  sourceIndex: number
}

/**
 * 把追踪节点加密到 `maxSpacing` 间隔：位置/高度线性插值，朝向按最短弧插值。
 * 加密行不参与追踪逻辑，只用于路面带的几何采样。
 */
export function densifyRoadRows(
  nodes: ReadonlyArray<RoadTraceNode>,
  maxSpacing: number,
): RoadBandRow[] {
  const rows: RoadBandRow[] = []
  const spacing = Math.max(0.5, maxSpacing)
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!
    rows.push({ ...node, index: rows.length, sourceIndex: index })
    const next = nodes[index + 1]
    if (!next) {
      continue
    }
    const span = Math.hypot(next.x - node.x, next.z - node.z)
    const parts = Math.max(0, Math.ceil(span / spacing) - 1)
    const headingDelta = wrapAngle(next.heading - node.heading)
    for (let part = 1; part <= parts; part += 1) {
      const t = part / (parts + 1)
      rows.push({
        x: node.x + (next.x - node.x) * t,
        z: node.z + (next.z - node.z) * t,
        y: node.y + (next.y - node.y) * t,
        heading: wrapAngle(node.heading + headingDelta * t),
        index: rows.length,
        lateral: 0,
        longitudinal: 0,
        turn: 0,
        headingDelta: 0,
        sourceIndex: index,
      })
    }
  }
  return rows
}

/**
 * 单行横向剖面采样（从左缘到右缘共 columnCount 列）。
 * 每列取小邻域（沿路 ±0.5m、横向 ±0.25m）内的**最高面**，避免折坡从采样点
 * 之间顶出；采样全部失败回退行高度，所有列与行高之差按 maxLateralDrop 截断。
 */
export function sampleRoadRowColumns(
  row: { x: number; z: number; y: number; heading: number },
  surfaceHeightAt: (x: number, z: number) => number | null,
  halfWidth: number,
  columnCount: number,
  maxLateralDrop: number,
): number[] {
  const columnsPerRow = Math.max(1, Math.round(columnCount))
  const dirX = Math.cos(row.heading)
  const dirZ = Math.sin(row.heading)
  const perpX = -dirZ
  const perpZ = dirX
  const columns: number[] = []
  for (let column = 0; column < columnsPerRow; column += 1) {
    const side = columnsPerRow <= 1 ? 0 : (column / (columnsPerRow - 1)) * 2 - 1
    const baseX = row.x + perpX * halfWidth * side
    const baseZ = row.z + perpZ * halfWidth * side
    let best: number | null = null
    for (const alongOffset of [-ROAD_SAMPLE_ALONG_RADIUS, 0, ROAD_SAMPLE_ALONG_RADIUS]) {
      for (const crossOffset of [-ROAD_SAMPLE_CROSS_RADIUS, 0, ROAD_SAMPLE_CROSS_RADIUS]) {
        const height = surfaceHeightAt(
          baseX + dirX * alongOffset + perpX * crossOffset,
          baseZ + dirZ * alongOffset + perpZ * crossOffset,
        )
        if (height != null && (best == null || height > best)) {
          best = height
        }
      }
    }
    columns.push(clamp(best ?? row.y, row.y - maxLateralDrop, row.y + maxLateralDrop))
  }
  return columns
}
