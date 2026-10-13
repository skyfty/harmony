import type { AssetType } from '@schema/core'

/**
 * 资产分类目录定义（叶子模块：仅类型导入，避免与 sceneStore/assetCatalog
 * 之间形成模块初始化顺序依赖，修复 ASSET_CATEGORY_CONFIG 的 TDZ 报错）。
 */
export interface AssetCategoryDefinition {
  key:
    | 'models'
    | 'meshes'
    | 'images'
    | 'textures'
    | 'materials'
    | 'behaviors'
    | 'prefabs'
    | 'lods'
    | 'dicePresets'
    | 'wallPresets'
    | 'floorPresets'
    | 'videos'
    | 'hdri'
    | 'others'
  assetType?: AssetType
  id: string
  label: string
  extensions: string[]
}

export const ASSETS_ROOT_DIRECTORY_ID = 'dir-assets-root'
export const PACKAGES_ROOT_DIRECTORY_ID = 'dir-packages-root'
export const PACKAGE_DIRECTORY_PREFIX = 'dir-package-'

export const ASSET_CATEGORY_CONFIG: AssetCategoryDefinition[] = [
  {
    key: 'models',
    assetType: 'model',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-models`,
    label: 'Models',
    extensions: ['.glb', '.gltf', '.fbx'],
  },
  {
    key: 'meshes',
    assetType: 'mesh',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-meshes`,
    label: 'Meshes',
    extensions: ['.mesh', '.geom'],
  },
  {
    key: 'images',
    assetType: 'image',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-images`,
    label: 'Images',
    extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.svg', '.hdr'],
  },
  {
    key: 'textures',
    assetType: 'texture',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-textures`,
    label: 'Textures',
    extensions: ['.ktx', '.ktx2', '.dds', '.tga'],
  },
  {
    key: 'materials',
    assetType: 'material',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-materials`,
    label: 'Materials',
    extensions: ['.material', '.material.json', '.mat', '.mat.json'],
  },
  {
    key: 'behaviors',
    assetType: 'behavior',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-behaviors`,
    label: 'Behaviors',
    extensions: ['.behavior'],
  },
  {
    key: 'prefabs',
    assetType: 'prefab',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-prefabs`,
    label: 'Prefabs',
    extensions: ['.prefab'],
  },
  {
    key: 'lods',
    assetType: 'lod',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-lods`,
    label: 'LOD Presets',
    extensions: ['.lod'],
  },
  {
    key: 'dicePresets',
    assetType: 'dice',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-dice-presets`,
    label: 'Dice Presets',
    extensions: ['.dice'],
  },
  {
    key: 'wallPresets',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-wall-presets`,
    label: 'Wall Presets',
    extensions: ['.wall'],
  },
  {
    key: 'floorPresets',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-floor-presets`,
    label: 'Floor Presets',
    extensions: ['.floor'],
  },
  {
    key: 'videos',
    assetType: 'video',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-videos`,
    label: 'Videos',
    extensions: ['.mp4', '.mov', '.webm', '.mkv', '.avi'],
  },
  {
    key: 'hdri',
    assetType: 'hdri',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-hdri`,
    label: 'HDRi',
    extensions: ['.hdr', '.exr'],
  },
  {
    key: 'others',
    id: `${ASSETS_ROOT_DIRECTORY_ID}-others`,
    label: 'Others',
    extensions: [],
  },
]
