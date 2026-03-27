export type LandformBuildShape = 'polygon' | 'rectangle' | 'circle'

export const LANDFORM_BUILD_SHAPE_LABELS: Record<LandformBuildShape, string> = {
  polygon: '多边形（自由绘制）',
  rectangle: '矩形（拖拽）',
  circle: '正多边形 / 圆形（拖拽半径，0 = 圆形）',
}