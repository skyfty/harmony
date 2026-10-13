/**
 * Slowroads 素材清单。
 *
 * 这些 PNG 从 slowroads 站点下载后原样入库（保留文件名里的内容哈希），
 * 用途按实测/目视分类：
 *  - albedo：可直接当颜色用的地表或精灵贴图（sRGB）；
 *  - detail：灰阶细节/凹凸/遮罩（线性空间，作乘性细节）；
 *  - noise：平铺用噪声（线性空间）；
 *  - normal：法线图（线性空间）；
 *  - alpha：单独的透明度遮罩（线性空间）。
 *
 * PNG 是刻意的选择：正式运行目标是微信小程序，早前版本对 WebP 支持不完整。
 * 注意 4096×1024 的树图集在老机型上有 2048 纹理上限的兼容风险（本次不切分）。
 */

const assetUrls = import.meta.glob('./*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export type SlowroadsTextureKind = 'albedo' | 'detail' | 'noise' | 'normal' | 'alpha'
export type SlowroadsColorSpace = 'srgb' | 'linear'

interface RawSlowroadsAsset {
  file: string
  kind: SlowroadsTextureKind
  colorSpace: SlowroadsColorSpace
  size: [number, number]
  /** 本实验室中的用途（逐张人工分析结论）。 */
  usage: string
}

const RAW_ASSETS = {
  grass: {
    file: 'grass.15f2422c.png',
    kind: 'detail',
    colorSpace: 'linear',
    size: [1024, 1024],
    usage: '草地纤维亮度细节（与绿色 tint 相乘）',
  },
  grassVariation: {
    file: 'grass_variation.209068de.png',
    kind: 'detail',
    colorSpace: 'linear',
    size: [512, 512],
    usage: '草地宏观斑块变化（大尺度 UV）',
  },
  gravel: {
    file: 'gravel_02.8367ed2c.png',
    kind: 'albedo',
    colorSpace: 'srgb',
    size: [1024, 1024],
    usage: '路肩碎石/杂草混合色',
  },
  sand: {
    file: 'sand.43e5b6fc.png',
    kind: 'albedo',
    colorSpace: 'srgb',
    size: [512, 512],
    usage: '水线附近沙带',
  },
  forest: {
    file: 'forest_spring.a81cef17.png',
    kind: 'albedo',
    colorSpace: 'srgb',
    size: [1024, 1024],
    usage: '树冠覆盖区林下地表',
  },
  heather: {
    file: 'summer_heather_05.5f56558d.png',
    kind: 'albedo',
    colorSpace: 'srgb',
    size: [1024, 1024],
    usage: '深色灌丛地被补丁',
  },
  rock: {
    file: 'spring_rock.d1f6769c.png',
    kind: 'albedo',
    colorSpace: 'srgb',
    size: [1024, 1024],
    usage: '陡坡苔藓岩石色',
  },
  rockBump: {
    file: 'rock_bump.8f8c68ad.png',
    kind: 'detail',
    colorSpace: 'linear',
    size: [1024, 1024],
    usage: '岩石凹凸（扰动坡度法线）',
  },
  groundDetailNear: {
    file: 'ground_detail_near.9099b9d5.png',
    kind: 'detail',
    colorSpace: 'linear',
    size: [512, 512],
    usage: '近处细颗粒细节（约 40m 内淡出）',
  },
  groundDetailFar: {
    file: 'ground_detail_far.a63b212a.png',
    kind: 'detail',
    colorSpace: 'linear',
    size: [512, 512],
    usage: '中远距离斑驳细节',
  },
  noiseFineA: {
    file: 'noise_fine.592be1a0.png',
    kind: 'noise',
    colorSpace: 'linear',
    size: [512, 512],
    usage: '细尺度平铺打散',
  },
  noiseFineB: {
    file: 'noise_fine.9cdaf478.png',
    kind: 'noise',
    colorSpace: 'linear',
    size: [512, 512],
    usage: '中尺度平铺打散',
  },
  noiseFineC: {
    file: 'noise_fine.a3591251.png',
    kind: 'noise',
    colorSpace: 'linear',
    size: [512, 512],
    usage: '粗尺度平铺打散',
  },
  noiseFinerA: {
    file: 'noise_finer.56c77b62.png',
    kind: 'noise',
    colorSpace: 'linear',
    size: [512, 512],
    usage: '微观颗粒（路面噪点 + 草皮高频）',
  },
  noiseFinerB: {
    file: 'noise_finer.962cd5d7.png',
    kind: 'noise',
    colorSpace: 'linear',
    size: [512, 512],
    usage: '水面微观扰动',
  },
  noiseFinerC: {
    file: 'noise_finer.98c1753c.png',
    kind: 'noise',
    colorSpace: 'linear',
    size: [512, 512],
    usage: '备用噪声变体（当前未引用）',
  },
  seaWaves: {
    file: 'sea_waves.63ff8729.png',
    kind: 'detail',
    colorSpace: 'linear',
    size: [512, 512],
    usage: '水面波纹（双方向滚动 + 高光）',
  },
  nearTreesBroadleaf: {
    file: 'spring_trees_0.aee94219.png',
    kind: 'albedo',
    colorSpace: 'srgb',
    size: [2048, 512],
    usage: '近树卡·阔叶（4 列树丛卡，底部 128px 为树皮条带，不参与渲染）',
  },
  nearTreesBroadleafNormal: {
    file: 'spring_trees_0_n.8e3ce8fa.png',
    kind: 'normal',
    colorSpace: 'linear',
    size: [2048, 512],
    usage: '近树卡·阔叶法线（与 spring_trees_0 同布局）',
  },
  nearTreesConifer: {
    file: 'spring_trees_1_m.29ae06f6.png',
    kind: 'albedo',
    colorSpace: 'srgb',
    size: [2048, 512],
    usage: '近树卡·针叶（左 256px 为树皮，右侧 4 棵树；自身无 alpha，需配 _a）',
  },
  nearTreesConiferAlpha: {
    file: 'spring_trees_1_a.e8f53ceb.png',
    kind: 'alpha',
    colorSpace: 'linear',
    size: [2048, 512],
    usage: '近树卡·针叶 alpha 遮罩（白=不透明，需按亮度取样）',
  },
  farTreesBroadleaf: {
    file: 'spring_imposters_0_d.2e67db77.png',
    kind: 'albedo',
    colorSpace: 'srgb',
    size: [4096, 1024],
    usage: '远树 imposters·阔叶（16×4 = 64 变体）',
  },
  farTreesConifer: {
    file: 'spring_imposters_1_d.05133c03.png',
    kind: 'albedo',
    colorSpace: 'srgb',
    size: [4096, 1024],
    usage: '远树 imposters·针叶（16×4 = 64 变体）',
  },
  farTreesConiferNormal: {
    file: 'autumn_imposters_1_n.2a7e8cf6.png',
    kind: 'normal',
    colorSpace: 'linear',
    size: [4096, 1024],
    usage: '远树 imposters·针叶法线（秋季节版本，与 _d 同布局）',
  },
  flowers: {
    file: 'spring_bushes.2db1f4bc.png',
    kind: 'albedo',
    colorSpace: 'srgb',
    size: [1024, 256],
    usage: '路侧花草（5 丛：野花、白花、幼苗、大型蕨）',
  },
  tallGrass: {
    file: 'summer_grasses.7ddf683f.png',
    kind: 'albedo',
    colorSpace: 'srgb',
    size: [512, 128],
    usage: '走廊高草（3 丛浅色干草 + 1 个深色灌木球）',
  },
  barrier: {
    file: 'spring_wall_barrier_wood.29edf0af.png',
    kind: 'albedo',
    colorSpace: 'srgb',
    size: [1024, 512],
    usage: '木护栏横栏（y308-348 / y398-438 两条横木；顶部木墙贴图备用未使用）',
  },
} as const satisfies Record<string, RawSlowroadsAsset>

export type SlowroadsAssetId = keyof typeof RAW_ASSETS

export interface SlowroadsAsset extends RawSlowroadsAsset {
  id: SlowroadsAssetId
  url: string
}

function resolveUrl(id: SlowroadsAssetId, file: string): string {
  const url = assetUrls[`./${file}`]
  if (!url) {
    throw new Error(`slowroads-lab: 素材缺失 ${file}（id=${id}），请确认 src/assets/slowroads 下的 PNG 是否完整`)
  }
  return url
}

export const SLOWROADS_ASSETS: Record<SlowroadsAssetId, SlowroadsAsset> = Object.fromEntries(
  Object.entries(RAW_ASSETS).map(([id, entry]) => [id, { ...entry, id: id as SlowroadsAssetId, url: resolveUrl(id as SlowroadsAssetId, entry.file) }]),
) as Record<SlowroadsAssetId, SlowroadsAsset>
