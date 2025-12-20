export type BuildTool = 'ground' | 'wall' | 'floor' | 'road'

export const BUILD_TOOL_LABELS: Record<BuildTool, string> = {
  ground: '地面工具',
  wall: '墙壁工具',
  floor: '路面工具',
  road: '道路工具'
}
