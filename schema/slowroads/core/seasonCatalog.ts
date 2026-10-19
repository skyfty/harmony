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

/** 官方宽路里的划线贴图（`maps.road.paint*`，只在宽路材质绑定）。 */
export interface SeasonRoadPaintSet {
  /** 虚线（常驻中线）。 */
  dashed: SeasonTextureRef
  /** 两侧实线共用的中线实线贴图。 */
  solid: SeasonTextureRef
  solidLeft: SeasonTextureRef
  solidRight: SeasonTextureRef
  /** 实线起点的渐变贴图（官方 merge 槽位）。 */
  mergeLeft: SeasonTextureRef
  mergeRight: SeasonTextureRef
}

/** 一套路面贴图（官方 `maps.road` 或 `maps.roadSingle`）。 */
export interface SeasonRoadStyleSet {
  base: SeasonTextureRef
  /** seasonal overlay (spring moss / autumn leaves); driven by tree shadow. */
  overlay?: SeasonTextureRef
  /** 官方 `stretch`：单车道 2（每 2 倍路宽重复），宽路缺省 1。 */
  stretch?: number
  /** 官方宽路才绑定的划线贴图（冬季无划线）。 */
  paint?: SeasonRoadPaintSet
}

export interface SeasonRoadSet {
  /** 单车道路面（官方 `roadSingle`，路宽 < 2.25m）。 */
  single: SeasonRoadStyleSet
  /** 宽路路面（官方 `road`，路宽 ≥ 2.25m，含划线）。 */
  wide: SeasonRoadStyleSet
}

/**
 * 官方路侧墙体贴图（`maps.walls`）。
 *
 * 官方槽位与文件名对照（解包产物 @357963-380950，摘录见
 * `reference/official/season-walls-and-roads.js`）：`wall_barrier` 属 **Barrier**、
 * `spring_wall_barrier_wood` 属 **Fence**、`wall_concrete` 属 **SeaWall**、
 * `*_wall_drystone` 属 **Drystone**。官方季节专属的 `wall_drystone`（夏/秋）、
 * `winter_wall_*`（冬）与 `road_overlay_autumn`、`winter_road`、`paint_dashed_long`
 * 不在下载素材目录内，按“同名季节优先、缺失回退 spring/中性档”的规则处理。
 */
export interface SeasonWallSet {
  /** 硬护栏（混凝土/金属面板）。 */
  barrier: SeasonTextureRef
  /** 混凝土海墙。 */
  seaWall: SeasonTextureRef
  /** 木栏（立柱 + 横栏，lab 用实测精灵区域渲染）。 */
  fence: SeasonTextureRef
  /** 干砌石墙。 */
  drystone: SeasonTextureRef
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
  walls: SeasonWallSet
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
      single: {
        base: tex('road_single_base_spring.2a1a3159'),
        overlay: tex('road_single_overlay_spring.a23e0db5'),
        stretch: 2,
      },
      wide: {
        // 官方 spring：`maps.road = {base: road_base, paint*, overlay: road_overlay_spring}`。
        base: tex('road_base.40d53c3c'),
        overlay: tex('road_overlay_spring.10938687'),
        paint: {
          dashed: tex('road_paint_dashed.246907ab'),
          solid: tex('road_paint_solid.5d853556'),
          solidLeft: tex('road_paint_solid_left.68b665c9'),
          solidRight: tex('road_paint_solid_right.3f96bedd'),
          mergeLeft: tex('road_paint_merge_left.27a677e8'),
          mergeRight: tex('road_paint_merge_right.5c821b1d'),
        },
      },
    },
    walls: {
      barrier: tex('wall_barrier.63193046'),
      seaWall: tex('wall_concrete.d56426dc'),
      fence: tex('spring_wall_barrier_wood.29edf0af'),
      drystone: tex('spring_wall_drystone.6c714f68'),
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
      single: {
        base: tex('road_single_base.d5dbc374'),
        stretch: 2,
      },
      wide: {
        // 官方 summer：同 spring 的宽路集，无 overlay。
        base: tex('road_base.40d53c3c'),
        paint: {
          dashed: tex('road_paint_dashed.246907ab'),
          solid: tex('road_paint_solid.5d853556'),
          solidLeft: tex('road_paint_solid_left.68b665c9'),
          solidRight: tex('road_paint_solid_right.3f96bedd'),
          mergeLeft: tex('road_paint_merge_left.27a677e8'),
          mergeRight: tex('road_paint_merge_right.5c821b1d'),
        },
      },
    },
    // 官方夏季 drystone 用 `wall_drystone`（不在素材目录）⇒ 回退 spring 贴图。
    walls: {
      barrier: tex('wall_barrier.63193046'),
      seaWall: tex('wall_concrete.d56426dc'),
      fence: tex('spring_wall_barrier_wood.29edf0af'),
      drystone: tex('spring_wall_drystone.6c714f68'),
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
      single: {
        base: tex('road_single_base.d5dbc374'),
        overlay: tex('road_single_overlay_autumn.59ecdb8e'),
        stretch: 2,
      },
      wide: {
        // 官方 autumn 宽路：road_base + road_overlay_autumn + 划线。
        base: tex('road_base.40d53c3c'),
        overlay: tex('road_overlay_autumn.68f523cb'),
        paint: {
          dashed: tex('road_paint_dashed.246907ab'),
          solid: tex('road_paint_solid.5d853556'),
          solidLeft: tex('road_paint_solid_left.68b665c9'),
          solidRight: tex('road_paint_solid_right.3f96bedd'),
          mergeLeft: tex('road_paint_merge_left.27a677e8'),
          mergeRight: tex('road_paint_merge_right.5c821b1d'),
        },
      },
    },
    walls: {
      barrier: tex('wall_barrier.63193046'),
      seaWall: tex('wall_concrete.d56426dc'),
      fence: tex('spring_wall_barrier_wood.29edf0af'),
      drystone: tex('spring_wall_drystone.6c714f68'),
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
      single: {
        base: tex('winter_road_single.7e3852c1'),
        stretch: 2,
      },
      wide: {
        // 官方冬季宽路是 `winter_road`，且冬季**没有划线**（road 集里没有 paint* 槽位）。
        base: tex('winter_road.e19b36b8'),
      },
    },
    walls: {
      // 官方冬季四张 `winter_wall_*` 贴图（已入素材目录）。
      barrier: tex('winter_wall_barrier.2f3faaf6'),
      seaWall: tex('winter_wall_concrete.edcd548c'),
      fence: tex('winter_wall_barrier_wood.058b9fbc'),
      drystone: tex('winter_wall_drystone.ef024453'),
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

export interface SeasonTextureRefFilter {
  surface?: boolean
  forest?: boolean
  grass?: boolean
  bushes?: boolean
  roadSingle?: boolean
  roadWide?: boolean
  walls?: boolean
}

export interface LandscapeSharedTextureFilter {
  surface?: boolean
  forest?: boolean
  grass?: boolean
  bushes?: boolean
  water?: boolean
}

export function collectSurfaceTextureRefs(season: SeasonId): SeasonTextureRef[] {
  const surface = SEASON_CATALOG[season].surface
  return [
    surface.grass,
    surface.forest,
    surface.heather,
    surface.gravel,
    surface.rock,
    surface.sand,
    surface.detailNear,
    surface.detailFar,
  ]
}

/** Every texture a season needs, deduplicated, for preloading / accounting. */
export function collectSeasonTextureRefs(
  season: SeasonId,
  filter: SeasonTextureRefFilter = {},
): SeasonTextureRef[] {
  const entry = SEASON_CATALOG[season]
  const refs: SeasonTextureRef[] = []
  const includeSurface = filter.surface !== false
  const includeForest = filter.forest !== false
  const includeGrass = filter.grass !== false
  const includeBushes = filter.bushes !== false
  const includeRoadSingle = filter.roadSingle !== false
  const includeRoadWide = filter.roadWide !== false
  const includeWalls = filter.walls !== false

  if (includeSurface) {
    refs.push(...collectSurfaceTextureRefs(season))
  } else if (includeForest || includeGrass || includeBushes) {
    // Foliage cards sample the shared detail-far map even when the terrain
    // surface itself is not textured.
    refs.push(entry.surface.detailFar)
  }
  if (includeForest) {
    refs.push(
      entry.trees.broadleafD,
      entry.trees.broadleafN,
      entry.trees.coniferM,
      entry.trees.coniferA,
      entry.imposters.mapA,
      entry.imposters.normA,
      entry.imposters.mapB,
      entry.imposters.normB,
    )
  }
  if (includeGrass) {
    refs.push(entry.sprites.grassSprites)
  }
  if (includeBushes) {
    refs.push(entry.sprites.bushes)
  }
  const roadStyles = [
    ...(includeRoadSingle ? [entry.road.single] : []),
    ...(includeRoadWide ? [entry.road.wide] : []),
  ]
  for (const road of roadStyles) {
    refs.push(road.base)
    if (road.overlay) {
      refs.push(road.overlay)
    }
    if (road.paint) {
      refs.push(
        road.paint.dashed,
        road.paint.solid,
        road.paint.solidLeft,
        road.paint.solidRight,
        road.paint.mergeLeft,
        road.paint.mergeRight,
      )
    }
  }
  if (includeWalls) {
    refs.push(
      entry.walls.barrier,
      entry.walls.seaWall,
      entry.walls.fence,
      entry.walls.drystone,
    )
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

/** Shared maps required by the landscape shaders for the enabled layers. */
export function collectLandscapeSharedTextureRefs(
  filter: LandscapeSharedTextureFilter = {},
): SeasonTextureRef[] {
  const refs: SeasonTextureRef[] = []
  const anySurfaceOrFoliage = filter.surface !== false
    || filter.forest !== false
    || filter.grass !== false
    || filter.bushes !== false
  if (anySurfaceOrFoliage) {
    refs.push(SHARED_TEXTURES.noise, SHARED_TEXTURES.grassVariation)
  }
  if (filter.surface !== false) {
    refs.push(SHARED_TEXTURES.rockBump)
  }
  if (filter.bushes !== false) {
    refs.push(SHARED_TEXTURES.bushNoise)
  }
  if (filter.water === true) {
    refs.push(SHARED_TEXTURES.seaWaves)
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

/**
 * Resolve serialized texture IDs back to the catalog refs used by the asset
 * store. Unknown IDs are returned separately so hosts can report a useful
 * warning instead of silently losing a preload entry.
 */
export function resolveSeasonTextureRefsByIds(
  textureIds: ReadonlyArray<string>,
): { refs: SeasonTextureRef[]; unknownIds: string[] } {
  const refsById = new Map<string, SeasonTextureRef>()
  for (const ref of collectAllTextureRefs()) {
    refsById.set(ref.id, ref)
  }

  const refs: SeasonTextureRef[] = []
  const unknownIds: string[] = []
  const seen = new Set<string>()
  for (const value of textureIds) {
    const id = typeof value === 'string' ? value.trim() : ''
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    const ref = refsById.get(id)
    if (ref) {
      refs.push(ref)
    } else {
      unknownIds.push(id)
    }
  }
  return { refs, unknownIds }
}
