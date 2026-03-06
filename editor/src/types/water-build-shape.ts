export type WaterBuildShape = 'polygon' | 'rectangle' | 'circle'

export const WATER_BUILD_SHAPE_LABELS: Record<WaterBuildShape, string> = {
  polygon: '多边形（即将支持）',
  rectangle: '矩形（拖拽）',
  circle: '圆形（即将支持）',
}
