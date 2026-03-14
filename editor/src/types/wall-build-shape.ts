export type WallBuildShape = 'line' | 'polygon' | 'rectangle' | 'circle'

export const WALL_BUILD_SHAPE_LABELS: Record<WallBuildShape, string> = {
  line: 'Line',
  polygon: 'Polygon',
  rectangle: 'Rectangle',
  circle: 'Circle',
}
