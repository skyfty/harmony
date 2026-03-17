export type BuildTool = 'terrain' | 'paint' | 'scatter' | 'wall' | 'floor' | 'road' | 'water' | 'displayBoard' | 'billboard' | 'warpGate'

export const BUILD_TOOL_LABELS: Record<BuildTool, string> = {
  terrain: '地形工具',
  paint: '地形绘制工具',
  scatter: '地形散布工具',
  wall: '墙壁工具',
  floor: '路面工具',
  road: '道路工具',
  water: '水面工具',
  displayBoard: '广告牌工具',
  billboard: '看板工具',
  warpGate: '传送门工具'
}
