/**
 * Slowroads seasonal asset catalog (platform-neutral core).
 *
 * The mapping below mirrors what slowroads.io actually binds into its scene
 * materials (extracted from the shipped bundle): every season selects its own
 * surface map set, sprite atlases, tree cards / imposters and road textures.
 * `logicalId` is the source file name without extension; the content hash stays
 * inside the id so uploaded assets can be deduplicated by the server
 * (`sourceLocalAssetId` in the asset bundle manifest).
 *
 * This module deliberately avoids DOM / three / bundler globs so it can move
 * into `schema/proceduralLandscape` unchanged; the lab resolves `logicalId` to
 * a URL through its asset source, the editor through the asset resolver.
 *
 * Colour spaces mirror the official loader `U(url, anisotropy = 4, wrap = repeat,
 * colorSpace = "srgb")` call sites: the grass fibre, surface colour maps, sprite
 * atlases and tree atlases decode as sRGB, while detail/noise/normal/height maps
 * pass through linearly ("srgb-linear"). The conifer tree set is the one wrap
 * exception: `winter/spring/..._trees_1_m` and `_trees_1_a` load with
 * RepeatWrapping because the near-tree OBJ tiles its V coordinate (~0..4.9).
 * Winter aliases `grass` and `detailNear` to the same file, and the official
 * texture cache keeps the first (grass => sRGB) request, so both slots must
 * declare the same colour space here.
 */

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter'

export const SEASON_IDS: readonly SeasonId[] = ['spring', 'summer', 'autumn', 'winter']

/** slowroads' internal season index used by its shader branches. */
export const SEASON_INDEX: Record<SeasonId, number> = {
  spring: 0,
  summer: 1,
  autumn: 2,
  winter: 3,
}

export const SEASON_LABELS: Record<SeasonId, string> = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
}

export type TextureKind = 'albedo' | 'detail' | 'noise' | 'normal' | 'alpha'
export type TextureColorSpace = 'srgb' | 'linear'

export interface SeasonTextureRef {
  /** logicalId = source file name without extension (content hash included). */
  id: string
  kind: TextureKind
  colorSpace: TextureColorSpace
}

function tex(id: string, kind: TextureKind = 'albedo', colorSpace: TextureColorSpace = 'srgb'): SeasonTextureRef {
  return { id, kind, colorSpace }
}

/** grayscale detail / noise maps stay in linear space. */
function linear(id: string, kind: TextureKind = 'detail'): SeasonTextureRef {
  return { id, kind, colorSpace: 'linear' }
}

export interface SeasonSurfaceTextures {
  /** base grass color layer (tinted by the seasonal palette). */
  grass: SeasonTextureRef
  /** under-canopy forest floor. */
  forest: SeasonTextureRef
  /** heather / low-scrub ground patches. */
  heather: SeasonTextureRef
  /** roadside gravel shoulder. */
  gravel: SeasonTextureRef
  /** steep-slope rock. */
  rock: SeasonTextureRef
  /** shoreline sand band (winter reuses the gravel map like slowroads). */
  sand: SeasonTextureRef
  /** near-distance ground detail (winter reuses the snow grass map). */
  detailNear: SeasonTextureRef
  /** far-distance mottling (winter has a dedicated map). */
  detailFar: SeasonTextureRef
}

export interface SeasonSpriteSets {
  /** roadside bush / flower sprites (4 variant cells). */
  bushes: SeasonTextureRef
  /** corridor grass sprites (4 variant cells, tinted by the palette). */
  grassSprites: SeasonTextureRef
}

export interface SeasonTreeSet {
  /** near broadleaf cards (diffuse + normal map). */
  broadleafD: SeasonTextureRef
  broadleafN: SeasonTextureRef
  /** near conifer cards (diffuse + grayscale alpha mask). */
  coniferM: SeasonTextureRef
  coniferA: SeasonTextureRef
}

export interface SeasonImposterSet {
  /** far broadleaf imposters (map + normal). */
  mapA: SeasonTextureRef
  normA: SeasonTextureRef
  /** far conifer imposters; every season shares the autumn normal. */
  mapB: SeasonTextureRef
  normB: SeasonTextureRef
}

export interface SeasonRoadSet {
  /** single-track road surface; vertical UV repeat every 2x road width. */
  base: SeasonTextureRef
  /** seasonal overlay (spring moss / autumn leaves); driven by tree shadow. */
  overlay?: SeasonTextureRef
}

export interface SeasonCatalogEntry {
  id: SeasonId
  /** slowroads shader season index. */
  index: number
  surface: SeasonSurfaceTextures
  sprites: SeasonSpriteSets
  trees: SeasonTreeSet
  imposters: SeasonImposterSet
  road: SeasonRoadSet
}

const AUTUMN_CONIFER_IMPOSTER_NORMAL = tex('autumn_imposters_1_n.2a7e8cf6', 'normal', 'linear')

export const SEASON_CATALOG: Record<SeasonId, SeasonCatalogEntry> = {
  spring: {
    id: 'spring',
    index: SEASON_INDEX.spring,
    surface: {
      // 官方：U(i.maps.grass, 4, void 0, void 0) → Repeat + srgb（含草纤维底色）。
      grass: tex('grass.15f2422c'),
      forest: tex('forest_spring.a81cef17'),
      heather: tex('summer_heather_05.5f56558d'),
      gravel: tex('gravel_02.8367ed2c'),
      rock: tex('spring_rock.d1f6769c'),
      sand: tex('sand.43e5b6fc'),
      detailNear: linear('ground_detail_near.9099b9d5'),
      detailFar: linear('ground_detail_far.a63b212a'),
    },
    sprites: {
      bushes: tex('spring_bushes.2db1f4bc'),
      grassSprites: tex('summer_grasses.7ddf683f'),
    },
    trees: {
      broadleafD: tex('spring_trees_0.aee94219'),
      broadleafN: tex('spring_trees_0_n.8e3ce8fa', 'normal', 'linear'),
      coniferM: tex('spring_trees_1_m.29ae06f6'),
      // 官方针叶 alpha：U(trees[1].n, 4, Repeat) → 默认 srgb 解码（OBJ 的 v 会绕回，必须 Repeat）。
      coniferA: tex('spring_trees_1_a.e8f53ceb', 'alpha', 'srgb'),
    },
    imposters: {
      mapA: tex('spring_imposters_0_d.2e67db77'),
      normA: tex('spring_imposters_0_n.1d5afe54', 'normal', 'linear'),
      mapB: tex('spring_imposters_1_d.05133c03'),
      normB: AUTUMN_CONIFER_IMPOSTER_NORMAL,
    },
    road: {
      base: tex('road_single_base_spring.2a1a3159'),
      overlay: tex('road_single_overlay_spring.a23e0db5'),
    },
  },
  summer: {
    id: 'summer',
    index: SEASON_INDEX.summer,
    surface: {
      grass: tex('grass.15f2422c'),
      forest: tex('forest_01.b82a9e7e'),
      heather: tex('summer_heather_05.5f56558d'),
      gravel: tex('gravel.0ee4475c'),
      rock: tex('summer_rock.674f8c5a'),
      sand: tex('sand.43e5b6fc'),
      detailNear: linear('ground_detail_near.9099b9d5'),
      detailFar: linear('ground_detail_far.a63b212a'),
    },
    sprites: {
      bushes: tex('summer_bushes.943c4258'),
      grassSprites: tex('summer_grasses.7ddf683f'),
    },
    trees: {
      broadleafD: tex('summer_trees_0.d5cc9742'),
      broadleafN: tex('summer_trees_0_n.011e666e', 'normal', 'linear'),
      coniferM: tex('summer_trees_1_m.866c5db4'),
      coniferA: tex('summer_trees_1_a.c88ed1f2', 'alpha', 'srgb'),
    },
    imposters: {
      mapA: tex('summer_imposters_0_d.6a3261f4'),
      normA: tex('summer_imposters_0_n.99abbc99', 'normal', 'linear'),
      mapB: tex('summer_imposters_1_d.a1e60bf5'),
      normB: AUTUMN_CONIFER_IMPOSTER_NORMAL,
    },
    road: {
      base: tex('road_single_base.d5dbc374'),
    },
  },
  autumn: {
    id: 'autumn',
    index: SEASON_INDEX.autumn,
    surface: {
      grass: tex('grass.15f2422c'),
      forest: tex('forest_autumn.55ca08bd'),
      heather: tex('autumn_heather.d890b430'),
      gravel: tex('gravel.0ee4475c'),
      rock: tex('summer_rock.674f8c5a'),
      sand: tex('sand.43e5b6fc'),
      detailNear: linear('ground_detail_near.9099b9d5'),
      detailFar: linear('ground_detail_far.a63b212a'),
    },
    sprites: {
      bushes: tex('autumn_bushes.b82ca395'),
      grassSprites: tex('summer_grasses.7ddf683f'),
    },
    trees: {
      broadleafD: tex('autumn_trees_0.2fe560b0'),
      broadleafN: tex('autumn_trees_0_n.a664e3e1', 'normal', 'linear'),
      coniferM: tex('autumn_trees_1_m.2cd39e32'),
      coniferA: tex('autumn_trees_1_a.2aa926cb', 'alpha', 'srgb'),
    },
    imposters: {
      mapA: tex('autumn_imposters_0_d.4c4b38fd'),
      normA: tex('autumn_imposters_0_n.d10ccd46', 'normal', 'linear'),
      mapB: tex('autumn_imposters_1_d.0160320a'),
      normB: AUTUMN_CONIFER_IMPOSTER_NORMAL,
    },
    road: {
      base: tex('road_single_base.d5dbc374'),
      overlay: tex('road_single_overlay_autumn.59ecdb8e'),
    },
  },
  winter: {
    id: 'winter',
    index: SEASON_INDEX.winter,
    surface: {
      // 官方冬季 grass 与 detailNear 指向同一文件（先加载的 grass 请求决定解码）：srgb。
      grass: tex('winter_grass.2126ead2'),
      forest: tex('forest_winter.0710a850'),
      heather: tex('winter_heather.b9aeb76f'),
      gravel: tex('winter_gravel.03b9e4e9'),
      rock: tex('winter_rock.674a5de1'),
      sand: tex('winter_gravel.03b9e4e9'),
      detailNear: tex('winter_grass.2126ead2'),
      detailFar: linear('ground_detail_far_winter.003963d8'),
    },
    sprites: {
      bushes: tex('winter_bushes.8e9f3165'),
      grassSprites: tex('winter_grasses.fbb53d0d'),
    },
    trees: {
      broadleafD: tex('winter_trees_0.99189e5d'),
      broadleafN: tex('winter_trees_0_n.24c5f705', 'normal', 'linear'),
      coniferM: tex('winter_trees_1_m.7ee3e863'),
      coniferA: tex('winter_trees_1_a.142fe383', 'alpha', 'srgb'),
    },
    imposters: {
      mapA: tex('winter_imposters_0_d.ce1a9b7d'),
      normA: tex('winter_imposters_0_n.8293f6b6', 'normal', 'linear'),
      mapB: tex('winter_imposters_1_d.2882c5c9'),
      normB: AUTUMN_CONIFER_IMPOSTER_NORMAL,
    },
    road: {
      base: tex('winter_road_single.7e3852c1'),
    },
  },
}

/** Textures shared by every season (loaded once, never evicted). */
export const SHARED_TEXTURES = {
  /** slowroads `fadeFine` noise: drives grass colour blend, heather masks and sprite tinting. */
  noise: linear('noise_fine.592be1a0', 'noise'),
  /** denser noise used by the bush sprite shader. */
  bushNoise: linear('noise_finer.98c1753c', 'noise'),
  /** macro grass patch variation. */
  grassVariation: linear('grass_variation.209068de'),
  /** rock height/bump for steep-slope shading. */
  rockBump: linear('rock_bump.8f8c68ad'),
  /** water surface waves. */
  seaWaves: linear('sea_waves.63ff8729'),
  /** cloud sheet used by the weather system (official loads `clouds_01` srgb-linear). */
  clouds: linear('clouds_01.700a3fdb'),
  /** wooden barrier rail (not part of the slowroads download folder; committed supplement). */
  barrier: tex('spring_wall_barrier_wood.29edf0af'),
} as const satisfies Record<string, SeasonTextureRef>

/** 8 near-tree meshes: 2 species x 4 variants (variant = atlas column). */
export const TREE_OBJECT_MODELS = {
  broadleaf: [
    'tree_01.49d91079',
    'tree_02.52e8a31e',
    'tree_03.2a55062c',
    'tree_04.53747223',
  ],
  conifer: [
    'tree_05.d68751e5',
    'tree_06.693be0d9',
    'tree_07.1fef5d95',
    'tree_08.b8bd204c',
  ],
} as const

export const TREE_OBJ_SPECIES_MODELS: Record<0 | 1, readonly string[]> = {
  0: TREE_OBJECT_MODELS.broadleaf,
  1: TREE_OBJECT_MODELS.conifer,
}

/** Every texture a season needs, deduplicated, for preloading / accounting. */
export function collectSeasonTextureRefs(season: SeasonId): SeasonTextureRef[] {
  const entry = SEASON_CATALOG[season]
  const refs: SeasonTextureRef[] = [
    entry.surface.grass,
    entry.surface.forest,
    entry.surface.heather,
    entry.surface.gravel,
    entry.surface.rock,
    entry.surface.sand,
    entry.surface.detailNear,
    entry.surface.detailFar,
    entry.sprites.bushes,
    entry.sprites.grassSprites,
    entry.trees.broadleafD,
    entry.trees.broadleafN,
    entry.trees.coniferM,
    entry.trees.coniferA,
    entry.imposters.mapA,
    entry.imposters.normA,
    entry.imposters.mapB,
    entry.imposters.normB,
    entry.road.base,
  ]
  if (entry.road.overlay) {
    refs.push(entry.road.overlay)
  }
  const seen = new Set<string>()
  return refs.filter((ref) => {
    if (seen.has(ref.id)) {
      return false
    }
    seen.add(ref.id)
    return true
  })
}

/** All texture refs used anywhere (season sets + shared) — the upload check set. */
export function collectAllTextureRefs(): SeasonTextureRef[] {
  const refs = new Map<string, SeasonTextureRef>()
  for (const season of SEASON_IDS) {
    for (const ref of collectSeasonTextureRefs(season)) {
      refs.set(ref.id, ref)
    }
  }
  for (const ref of Object.values(SHARED_TEXTURES)) {
    refs.set(ref.id, ref)
  }
  return [...refs.values()]
}
