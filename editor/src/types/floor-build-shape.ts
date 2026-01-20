export type FloorBuildShape = 'polygon' | 'rectangle' | 'circle'

export const FLOOR_BUILD_SHAPE_LABELS: Record<FloorBuildShape, string> = {
  polygon: '多边形（自由绘制）',
  rectangle: '矩形（拖拽）',
  circle: '圆形（拖拽半径）',
}
