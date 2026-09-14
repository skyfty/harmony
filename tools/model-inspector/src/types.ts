export type PipelineMode = 'engine' | 'native'

export const PIPELINE_MODES: PipelineMode[] = ['engine', 'native']

export const PIPELINE_LABELS: Record<PipelineMode, string> = {
  engine: '引擎管线',
  native: '原生 three.js',
}

export const PIPELINE_DESCRIPTIONS: Record<PipelineMode, string> = {
  engine: '@schema/loader 解析 + 引擎材质规范化（居中落底 / 保留文件 side / alpha cutout）',
  native: 'GLTFLoader / FBXLoader 直接解析（DRACO + KTX2 + meshopt），不做任何规范化',
}

export type ModelSource =
  | { kind: 'file'; files: File[] }
  | { kind: 'url'; url: string }

export type DisplayMode =
  | 'original'
  | 'wireframe'
  | 'unlit'
  | 'albedo'
  | 'normal'
  | 'uv'
  | 'vertexColor'

export const DISPLAY_MODES: Array<{ id: DisplayMode; label: string }> = [
  { id: 'original', label: '原始材质' },
  { id: 'wireframe', label: '线框' },
  { id: 'unlit', label: '无光照' },
  { id: 'albedo', label: '仅 albedo 贴图' },
  { id: 'normal', label: '法线' },
  { id: 'uv', label: 'UV 棋盘' },
  { id: 'vertexColor', label: '顶点色' },
]

export type MaterialOverrides = {
  side: 'keep' | 'front' | 'back' | 'double'
  transparent: 'keep' | 'on' | 'off'
  alphaTest: number | null
  flatShading: 'keep' | 'on' | 'off'
  depthWrite: 'keep' | 'on' | 'off'
  metalness: number | null
  roughness: number | null
  toneMapped: 'keep' | 'on' | 'off'
}

export const DEFAULT_MATERIAL_OVERRIDES: MaterialOverrides = {
  side: 'keep',
  transparent: 'keep',
  alphaTest: null,
  flatShading: 'keep',
  depthWrite: 'keep',
  metalness: null,
  roughness: null,
  toneMapped: 'keep',
}

export type EnginePostProcessOptions = {
  /** `prepareImportedObject()`：把模型居中并落到底面（引擎导入的默认行为）。 */
  recenter: boolean
  /**
   * 旧引擎行为：导入时把所有材质强制为 `FrontSide`。
   *
   * 线上引擎已经不再改写 `side`（改为保留 glTF `doubleSided` / FBX 双面标记），
   * 所以这里默认关闭；勾选后可以复现"背面镂空"的旧结果用于对照。
   */
  forceFrontSide: boolean
  /** 引擎导入时把 alpha 混合材质按 scatter 规则转成 alphaTest cutout。 */
  scatterCutout: boolean
}

export const DEFAULT_ENGINE_POST_PROCESS: EnginePostProcessOptions = {
  recenter: true,
  forceFrontSide: false,
  scatterCutout: true,
}

export type HelperSettings = {
  grid: boolean
  axes: boolean
  bounds: boolean
  skeleton: boolean
}

export const DEFAULT_HELPER_SETTINGS: HelperSettings = {
  grid: true,
  axes: true,
  bounds: false,
  skeleton: false,
}

export type CameraViewId = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
