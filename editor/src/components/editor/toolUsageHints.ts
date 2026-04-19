import type { GroundSculptOperation } from '@schema'
import type { TerrainScatterBrushShape } from '@schema/terrain-scatter'
import type { GroundPanelTab } from '@/stores/terrainStore'
import type { BuildTool } from '@/types/build-tool'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import type { LandformBuildShape } from '@/types/landform-build-shape'
import type { WallBuildShape } from '@/types/wall-build-shape'

export type ToolUsageHintRow = {
  label: string
  text: string
}

export type ToolUsageHints = {
  tool: BuildTool
  title: string
  rows: ToolUsageHintRow[]
}

export type ActiveToolUsageHintContext = {
  activeBuildTool: BuildTool | null
  brushOperation: GroundSculptOperation | null
  groundPanelTab: GroundPanelTab
  scatterEraseModeActive: boolean
  scatterRestoreModifierActive: boolean
  wallDoorSelectModeActive: boolean
  floorBuildShape: FloorBuildShape
  landformBuildShape: LandformBuildShape
  wallBuildShape: WallBuildShape
  scatterBrushShape: TerrainScatterBrushShape
  scatterAssetSelected: boolean
  paintAssetSelected: boolean
}

function createRows(rows: ToolUsageHintRow[]): ToolUsageHintRow[] {
  return rows
}

function resolveShapeLabel(shape: FloorBuildShape | LandformBuildShape | WallBuildShape | TerrainScatterBrushShape): string {
  switch (shape) {
    case 'line':
      return '折线'
    case 'rectangle':
      return '矩形'
    case 'circle':
      return '圆形'
    case 'polygon':
      return '多边形'
    default:
      return '当前笔刷'
  }
}

function resolveTerrainOperationLabel(operation: GroundSculptOperation | null): string {
  switch (operation) {
    case 'raise':
      return '抬高'
    case 'depress':
      return '下压'
    case 'smooth':
      return '平滑'
    case 'flatten':
      return '整平'
    case 'flatten-zero':
      return '归零整平'
    default:
      return '雕刻'
  }
}

function resolveScatterPlacementRows(
  scatterBrushShape: TerrainScatterBrushShape,
  scatterAssetSelected: boolean,
): ToolUsageHintRow[] {
  const shapeLabel = resolveShapeLabel(scatterBrushShape)
  if (scatterBrushShape === 'polygon') {
    return createRows([
      { label: '入口', text: '视口工具栏 -> Terrain Scatter' },
      { label: '模式', text: `${shapeLabel}区域撒件` },
      { label: '鼠标', text: '左键逐点定义区域' },
      { label: '完成', text: '双击左键完成当前区域撒件' },
      { label: '取消', text: '右键取消当前区域 · Escape 退出当前操作' },
      { label: '准备', text: scatterAssetSelected ? '已选择散布资源，可直接撒件' : '先在散布面板里选择资源，再进行撒件' },
    ])
  }
  if (scatterBrushShape === 'rectangle' || scatterBrushShape === 'line') {
    return createRows([
      { label: '入口', text: '视口工具栏 -> Terrain Scatter' },
      { label: '模式', text: `${shapeLabel}区域撒件` },
      { label: '鼠标', text: '左键拖拽定义区域并完成撒件' },
      { label: '调整', text: '在面板中调整间距、密度与形状参数' },
      { label: '取消', text: 'Escape 退出当前操作' },
      { label: '准备', text: scatterAssetSelected ? '已选择散布资源，可直接撒件' : '先在散布面板里选择资源，再进行撒件' },
    ])
  }
  return createRows([
    { label: '入口', text: '视口工具栏 -> Terrain Scatter' },
    { label: '模式', text: `${shapeLabel}刷撒件` },
    { label: '鼠标', text: '左键点击或拖刷连续撒件' },
    { label: '修饰', text: 'Ctrl/Cmd + 滚轮调整刷子半径' },
    { label: '准备', text: scatterAssetSelected ? '已选择散布资源，可直接撒件' : '先在散布面板里选择资源，再进行撒件' },
    { label: '取消', text: 'Escape 退出当前操作' },
  ])
}

function resolveFloorRows(shape: FloorBuildShape): ToolUsageHintRow[] {
  const shapeLabel = resolveShapeLabel(shape)
  if (shape === 'polygon') {
    return createRows([
      { label: '入口', text: '视口工具栏 -> Floor Brush' },
      { label: '模式', text: `${shapeLabel}绘制` },
      { label: '鼠标', text: '左键逐点添加顶点' },
      { label: '完成', text: '双击左键完成地面' },
      { label: '修饰', text: 'Shift 顶点吸附 · C 相对角度吸附' },
      { label: '取消', text: '右键或 Escape 取消当前草图' },
    ])
  }
  if (shape === 'rectangle') {
    return createRows([
      { label: '入口', text: '视口工具栏 -> Floor Brush' },
      { label: '模式', text: `${shapeLabel}绘制` },
      { label: '鼠标', text: '左键拖拽生成矩形地面' },
      { label: '修饰', text: 'Shift 顶点吸附到已有顶点' },
      { label: '取消', text: '右键或 Escape 取消当前草图' },
    ])
  }
  return createRows([
    { label: '入口', text: '视口工具栏 -> Floor Brush' },
    { label: '模式', text: `${shapeLabel}绘制` },
    { label: '鼠标', text: '左键拖拽生成圆形或正多边形地面' },
    { label: '修饰', text: 'Shift 顶点吸附到已有顶点' },
    { label: '取消', text: '右键或 Escape 取消当前草图' },
  ])
}

function resolveLandformRows(shape: LandformBuildShape): ToolUsageHintRow[] {
  const shapeLabel = resolveShapeLabel(shape)
  if (shape === 'polygon') {
    return createRows([
      { label: '入口', text: '视口工具栏 -> Landform Brush' },
      { label: '模式', text: `${shapeLabel}绘制` },
      { label: '鼠标', text: '左键逐点添加顶点' },
      { label: '完成', text: '双击左键完成地貌' },
      { label: '修饰', text: 'Shift 顶点吸附 · C 相对角度吸附' },
      { label: '取消', text: '右键或 Escape 取消当前草图' },
    ])
  }
  if (shape === 'rectangle') {
    return createRows([
      { label: '入口', text: '视口工具栏 -> Landform Brush' },
      { label: '模式', text: `${shapeLabel}绘制` },
      { label: '鼠标', text: '左键拖拽生成矩形地貌' },
      { label: '修饰', text: 'Shift 顶点吸附到已有顶点' },
      { label: '取消', text: '右键或 Escape 取消当前草图' },
    ])
  }
  return createRows([
    { label: '入口', text: '视口工具栏 -> Landform Brush' },
    { label: '模式', text: `${shapeLabel}绘制` },
    { label: '鼠标', text: '左键拖拽生成圆形或正多边形地貌' },
    { label: '修饰', text: 'Shift 顶点吸附到已有顶点' },
    { label: '取消', text: '右键或 Escape 取消当前草图' },
  ])
}

function resolveWallRows(shape: WallBuildShape): ToolUsageHintRow[] {
  const shapeLabel = resolveShapeLabel(shape)
  if (shape === 'line') {
    return createRows([
      { label: '入口', text: '视口工具栏 -> Wall Brush' },
      { label: '模式', text: `${shapeLabel}墙体` },
      { label: '鼠标', text: '左键连续放点并续接墙段' },
      { label: '修饰', text: 'Shift 顶点吸附与角度约束 · C 相对角度吸附' },
      { label: '快捷', text: 'Shift+G 按上一个已提交墙段自动续铺' },
      { label: '取消', text: '右键或 Escape 取消当前绘制' },
    ])
  }
  if (shape === 'polygon') {
    return createRows([
      { label: '入口', text: '视口工具栏 -> Wall Brush' },
      { label: '模式', text: `${shapeLabel}闭合墙体` },
      { label: '鼠标', text: '左键逐点定义闭合轮廓' },
      { label: '完成', text: '双击左键完成闭合墙体' },
      { label: '修饰', text: 'C 相对角度吸附' },
      { label: '取消', text: '右键或 Escape 取消当前草图' },
    ])
  }
  return createRows([
    { label: '入口', text: '视口工具栏 -> Wall Brush' },
    { label: '模式', text: `${shapeLabel}墙体` },
    { label: '鼠标', text: '左键拖拽生成当前形状的墙体' },
    { label: '修饰', text: 'Shift 顶点吸附到已有顶点' },
    { label: '取消', text: '右键或 Escape 取消当前草图' },
  ])
}

function resolveGenericRows(tool: BuildTool): ToolUsageHintRow[] {
  switch (tool) {
    case 'road':
      return createRows([
        { label: '入口', text: '视口工具栏 -> Road Tool' },
        { label: '鼠标', text: '左键连续放点绘制道路' },
        { label: '完成', text: '双击左键完成当前道路' },
        { label: '修饰', text: 'Shift 或全局顶点吸附用于对齐已有顶点' },
        { label: '取消', text: '右键或 Escape 取消当前道路' },
      ])
    case 'terrain':
      return createRows([
        { label: '入口', text: '视口工具栏 -> Terrain Tools' },
        { label: '准备', text: '先在地形面板中选择雕刻操作，再开始编辑' },
        { label: '鼠标', text: '左键拖拽连续雕刻地形' },
        { label: '修饰', text: 'Shift 临时切为下压 · Ctrl/Cmd + 滚轮调整笔刷半径' },
        { label: '笔刷', text: '多边形笔刷使用左键逐点定义区域，双击左键应用' },
      ])
    case 'paint':
      return createRows([
        { label: '入口', text: '视口工具栏 -> Terrain Paint' },
        { label: '准备', text: '先在绘制面板中选择地表材质资源' },
        { label: '鼠标', text: '左键拖拽连续涂刷地表材质' },
        { label: '修饰', text: 'Ctrl/Cmd + 滚轮调整笔刷半径' },
        { label: '完成', text: '松开左键提交当前笔触' },
      ])
    case 'scatter':
      return createRows([
        { label: '入口', text: '视口工具栏 -> Terrain Scatter' },
        { label: '准备', text: '先选择散布分类、资源和笔刷形状' },
        { label: '鼠标', text: '左键按当前笔刷模式进行撒件' },
        { label: '修饰', text: 'Ctrl/Cmd + 滚轮调整半径' },
        { label: '取消', text: 'Escape 退出当前撒件会话' },
      ])
    case 'region':
      return createRows([
        { label: '入口', text: '视口工具栏 -> Region Tool' },
        { label: '鼠标', text: '左键逐点定义区域顶点' },
        { label: '完成', text: '双击左键完成闭合区域' },
        { label: '修饰', text: '顶点吸附会优先对齐已有顶点' },
        { label: '取消', text: '右键或 Escape 取消当前区域草图' },
      ])
    case 'guideRoute':
      return createRows([
        { label: '入口', text: '视口工具栏 -> Guide Route Tool' },
        { label: '鼠标', text: '左键逐点添加导览路径点位' },
        { label: '完成', text: '双击左键完成当前导览路径' },
        { label: '修饰', text: '顶点吸附会优先对齐已有顶点' },
        { label: '取消', text: '右键或 Escape 取消当前路径草图' },
      ])
    case 'water':
      return createRows([
        { label: '入口', text: '视口工具栏 -> Water Tool' },
        { label: '模式', text: '矩形 / 圆形模式左键拖拽创建，Polygon 模式左键逐点添加顶点' },
        { label: '完成', text: '拖拽模式在松开左键时完成，Polygon 模式双击左键完成' },
        { label: '修饰', text: '顶点吸附会优先对齐已有顶点' },
        { label: '取消', text: '右键或 Escape 取消当前水面草图' },
      ])
    case 'boundaryWall':
      return createRows([
        { label: '入口', text: '边界墙面板 -> 自定义边界墙绘制' },
        { label: '准备', text: '先选中可编辑的边界墙节点，再进入轮廓编辑' },
        { label: '鼠标', text: '左键逐点添加边界墙轮廓顶点' },
        { label: '完成', text: '双击左键完成并提交当前轮廓' },
        { label: '修饰', text: '顶点吸附会优先对齐已有顶点' },
        { label: '取消', text: '右键或 Escape 取消当前轮廓编辑' },
      ])
    case 'displayBoard':
      return createRows([
        { label: '入口', text: '视口工具栏 -> Display Surface Tools' },
        { label: '鼠标', text: '先点击目标表面起点，再继续左键沿表面描出轮廓' },
        { label: '完成', text: '双击左键后按当前轮廓拟合展示面并创建' },
        { label: '修饰', text: '顶点吸附会优先吸附到表面可用顶点' },
        { label: '取消', text: 'Escape 取消当前展示面草图' },
      ])
    case 'billboard':
      return createRows([
        { label: '入口', text: '视口工具栏 -> Display Surface Tools -> Billboard' },
        { label: '鼠标', text: '左键按下目标表面开始，拖拽定义看板宽高' },
        { label: '完成', text: '松开左键立即创建看板' },
        { label: '修饰', text: '支持顶点吸附与侧边贴靠吸附' },
        { label: '取消', text: 'Escape 取消当前看板草图' },
      ])
    case 'warpGate':
      return createRows([
        { label: '入口', text: '视口工具栏 -> Warp Gate Tool' },
        { label: '预览', text: '传送门预览会跟随光标显示落点位置' },
        { label: '鼠标', text: '左键点击当前预览位置放置传送门，拖动不会创建' },
        { label: '完成', text: '放置后自动选中新建传送门节点' },
        { label: '取消', text: '右键或 Escape 退出当前放置' },
      ])
    default:
      return createRows([])
  }
}

export function resolveActiveToolUsageHints(context: ActiveToolUsageHintContext): ToolUsageHints | null {
  if (context.scatterEraseModeActive) {
    return {
      tool: 'scatter',
      title: context.scatterRestoreModifierActive ? '地面撒件 · 还原 / 修复' : '地面撒件 · 擦除',
      rows: createRows([
        { label: '入口', text: 'Terrain Scatter -> Scatter Erase' },
        { label: '鼠标', text: '左键点击或拖动擦除当前散布实例' },
        { label: '修饰', text: '按住 Ctrl/Cmd 临时切换为还原 / 修复' },
        { label: '尺寸', text: 'Ctrl/Cmd + 滚轮调整擦除半径' },
        { label: '取消', text: '右键或 Escape 退出擦除模式' },
      ]),
    }
  }

  const tool = context.activeBuildTool
  if (!tool) {
    return null
  }

  if (tool === 'wall' && context.wallDoorSelectModeActive) {
    return {
      tool,
      title: '墙体工具 · 门窗选择',
      rows: createRows([
        { label: '入口', text: 'Wall Tool -> 门窗选择子模式' },
        { label: '鼠标', text: '左键拖拽框选墙上的门窗开口' },
        { label: '删除', text: 'Delete / Backspace 删除当前选中的门窗' },
        { label: '取消', text: 'Escape 清空当前框选' },
      ]),
    }
  }

  if (tool === 'terrain') {
    return {
      tool,
      title: `地形雕刻${context.brushOperation ? ` · ${resolveTerrainOperationLabel(context.brushOperation)}` : ''}`,
      rows: resolveGenericRows(tool),
    }
  }

  if (tool === 'paint') {
    const rows = resolveGenericRows(tool)
    if (!context.paintAssetSelected) {
      rows[1] = { label: '准备', text: '先在绘制面板中选择地表材质资源，当前尚未选中资源' }
    }
    return {
      tool,
      title: '地形绘制',
      rows,
    }
  }

  if (tool === 'scatter') {
    return {
      tool,
      title: `地面撒件 · ${resolveShapeLabel(context.scatterBrushShape)}`,
      rows: resolveScatterPlacementRows(context.scatterBrushShape, context.scatterAssetSelected),
    }
  }

  if (tool === 'floor') {
    return {
      tool,
      title: `地板工具 · ${resolveShapeLabel(context.floorBuildShape)}`,
      rows: resolveFloorRows(context.floorBuildShape),
    }
  }

  if (tool === 'landform') {
    return {
      tool,
      title: `地貌工具 · ${resolveShapeLabel(context.landformBuildShape)}`,
      rows: resolveLandformRows(context.landformBuildShape),
    }
  }

  if (tool === 'wall') {
    return {
      tool,
      title: `墙体工具 · ${resolveShapeLabel(context.wallBuildShape)}`,
      rows: resolveWallRows(context.wallBuildShape),
    }
  }

  if (tool === 'road') {
    return {
      tool,
      title: '道路工具',
      rows: resolveGenericRows(tool),
    }
  }

  return {
    tool,
    title: resolveToolTitle(tool),
    rows: resolveGenericRows(tool),
  }
}

function resolveToolTitle(tool: BuildTool): string {
  switch (tool) {
    case 'region':
      return '区域工具'
    case 'guideRoute':
      return '导览路径工具'
    case 'water':
      return '水面工具'
    case 'boundaryWall':
      return '边界墙工具'
    case 'displayBoard':
      return '广告牌工具'
    case 'billboard':
      return '看板工具'
    case 'warpGate':
      return '传送门工具'
    default:
      return '工具使用提示'
  }
}