export type BuildTool = 'terrain' | 'paint' | 'scatter' | 'wall' | 'floor' | 'landform' | 'region' | 'guideRoute' | 'road' | 'water' | 'boundaryWall' | 'modelCollision' | 'displayBoard' | 'billboard' | 'warpGate'

export const BUILD_TOOL_LABELS: Record<BuildTool, string> = {
  terrain: '鍦板舰宸ュ叿',
  paint: '鍦板舰缁樺埗宸ュ叿',
  scatter: '鍦板舰鏁ｅ竷宸ュ叿',
  wall: '澧欏宸ュ叿',
  floor: '璺潰宸ュ叿',
  landform: '鍦拌矊宸ュ叿',
  region: '鍖哄煙宸ュ叿',
  guideRoute: '瀵艰璺緞宸ュ叿',
  road: '閬撹矾宸ュ叿',
  water: '姘撮潰宸ュ叿',
  boundaryWall: '杈圭晫澧欏伐鍏?',
  modelCollision: '妯″瀷闃绘尅闈㈠伐鍏?',
  displayBoard: '骞垮憡鐗屽伐鍏?',
  billboard: '鐪嬫澘宸ュ叿',
  warpGate: '浼犻€侀棬宸ュ叿',
}
