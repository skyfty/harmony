export type BuildTool = 'ground' | 'wall' | 'platform' | 'surface'

export const BUILD_TOOL_LABELS: Record<BuildTool, string> = {
  ground: '地面工具',
  wall: '墙壁工具',
  platform: '平台工具',
  surface: '平面工具',
}
