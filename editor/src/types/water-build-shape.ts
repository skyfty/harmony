export type WaterBuildShape = 'polygon' | 'rectangle' | 'circle'

export const WATER_BUILD_SHAPE_LABELS: Record<WaterBuildShape, string> = {
  polygon: '多边形（左键加点，右键完成）',
  rectangle: '矩形（拖拽）',
  circle: '圆形（拖拽半径）',
}
