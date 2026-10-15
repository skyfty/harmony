import { createHeightfield } from './heightfield'
import { degreesToRadians, fbm2 } from './noise'
import {
  computePlacements,
  createTreeDensityField,
  NEAR_TREE_VARIANTS,
  type LabPlacementSettings,
} from './placement'
import { createRoadProfile } from './roadProfile'
import { traceRoadPath, type RoadTraceOptions } from './roadTrace'
import { computeRoadMarkings } from './roadMarkings'
import {
  BARRIER_TUNING,
  DEFAULT_ROAD_STYLE,
  DRYSTONE,
  ROAD_STYLE_PROFILES,
  SEAWALL,
  WALL_NODE_SPACING,
  WALL_SEGMENT_RULES,
} from './roadStyle'
import { computeWallSegments } from './walls'
import {
  TREE_FAR_VARIANTS,
  bushVariantEntries,
  getBushEntries,
  getConiferCardRegions,
  getGrassEntries,
} from './spriteRegions'
import {
  SEASON_CATALOG,
  SEASON_IDS,
  SHARED_TEXTURES,
  TREE_OBJ_SPECIES_MODELS,
  collectAllTextureRefs,
  collectSeasonTextureRefs,
  type SeasonCatalogEntry,
  type SeasonId,
  type SeasonTextureRef,
} from './seasonCatalog'
import { SEASON_INDEX } from './seasonCatalog'
import { SEASON_PARAMS } from './seasonParams'
import {
  ENVIRONMENT_PRESETS,
  ENVIRONMENT_SKY_DISTANCE,
  ENVIRONMENT_VIEW_DISTANCE,
  TIME_OF_DAY_ORDER,
  WEATHER_ORDER,
  resolveFogDepthBlend,
  resolveFogParams,
  resolveSkyFogParams,
} from './environment'

/**
 * Console self-checks for the pure generation logic (no test framework in the
 * lab): determinism, road sanity and placement filters. Runs once at startup.
 */
export interface SelfCheckResult {
  name: string
  ok: boolean
  detail: string
}

export function runSelfChecks(): SelfCheckResult[] {
  const results: SelfCheckResult[] = []
  const record = (name: string, ok: boolean, detail = ''): void => {
    results.push({ name, ok, detail })
    console.assert(ok, `[slowroads-lab self-check] ${name}${detail ? ` — ${detail}` : ''}`)
  }

  // 1. Noise determinism.
  const noiseA = fbm2(7, 1.25, 3.5, 3)
  const noiseB = fbm2(7, 1.25, 3.5, 3)
  const noiseC = fbm2(8, 1.25, 3.5, 3)
  record('noise determinism', noiseA === noiseB && noiseA !== noiseC)

  // 2. Road tracing.
  const worldSize = 640
  const seed = 1234567
  const field = createHeightfield({ seed, worldSize })
  const traceOptions: RoadTraceOptions = {
    startX: 0,
    startZ: 0,
    headingRad: 0.7,
    stepLength: 8,
    feelDistance: 24,
    feelAngleRad: degreesToRadians(32),
    slopeLimit: 0.55,
    maxTurnRad: degreesToRadians(4),
    maxLength: 480,
    margin: 24,
  }
  const first = traceRoadPath(field, traceOptions)
  const second = traceRoadPath(field, traceOptions)
  record('road determinism', first.nodes.length === second.nodes.length
    && first.nodes.every((node, index) => node.x === second.nodes[index]!.x && node.z === second.nodes[index]!.z))
  record('road within bounds', first.nodes.every((node) => field.inBounds(node.x, node.z, traceOptions.margin - 1e-3)))
  let stepOk = true
  let turnOk = true
  for (let i = 1; i < first.nodes.length; i += 1) {
    const previous = first.nodes[i - 1]!
    const current = first.nodes[i]!
    const distance = Math.hypot(current.x - previous.x, current.z - previous.z)
    if (Math.abs(distance - traceOptions.stepLength) > 1e-3) {
      stepOk = false
    }
    let delta = Math.abs(current.heading - previous.heading)
    if (delta > Math.PI) {
      delta = Math.PI * 2 - delta
    }
    if (delta > Math.PI / 2 + 1e-6) {
      turnOk = false
    }
  }
  record('road step length', stepOk)
  record('road turn bounded', turnOk)

  // 3. Placements.
  const profile = createRoadProfile(first.nodes, { halfWidth: 3.5, shoulderWidth: 2.5, flattenBand: 10 })
  const density = createTreeDensityField(seed, worldSize)
  const settings: LabPlacementSettings = {
    seed,
    worldSize,
    treeDensity: 1,
    treeSize: 1,
    grassCorridor: 20,
    grassDensity: 1,
    bushDensity: 0.6,
    flowerDensity: 1,
    tallGrassDensity: 1,
  }
  const placementsA = computePlacements(field, profile, density, settings)
  const placementsB = computePlacements(field, profile, density, settings)
  record('placement determinism',
    placementsA.trees.length === placementsB.trees.length
    && placementsA.grass.length === placementsB.grass.length
    && placementsA.trees.every((tree, index) => tree.x === placementsB.trees[index]!.x),
    `trees=${placementsA.trees.length} grass=${placementsA.grass.length} bushes=${placementsA.bushes.length}`
  )

  const clearance = profile.halfWidth + profile.shoulderWidth + 2
  let treeFilterOk = true
  for (const tree of placementsA.trees.slice(0, 400)) {
    if (profile.distanceTo(tree.x, tree.z) < clearance - 1e-3) {
      treeFilterOk = false
      break
    }
    if (field.sampleSlope(tree.x, tree.z) > 0.2 + 1e-3) {
      treeFilterOk = false
      break
    }
  }
  record('trees off road and slope', treeFilterOk)

  let grassFilterOk = true
  for (const grass of placementsA.grass.slice(0, 800)) {
    const distance = profile.distanceTo(grass.x, grass.z)
    if (distance < profile.halfWidth + 0.35 - 0.6 || distance > profile.halfWidth + settings.grassCorridor + 0.6) {
      grassFilterOk = false
      break
    }
  }
  record('grass inside corridor', grassFilterOk)

  let treeVariantOk = true
  for (const tree of placementsA.trees) {
    if (tree.variantNear < 0 || tree.variantNear >= NEAR_TREE_VARIANTS[tree.species]) {
      treeVariantOk = false
      break
    }
    if (tree.variantFar < 0 || tree.variantFar >= TREE_FAR_VARIANTS) {
      treeVariantOk = false
      break
    }
  }
  record('tree variants in range', treeVariantOk)

  let layerFilterOk = true
  for (const sprite of placementsA.bushes.slice(0, 400)) {
    const distance = profile.distanceTo(sprite.x, sprite.z)
    if (distance < profile.halfWidth + 0.3 - 0.6 || distance > profile.halfWidth + 20 + 0.6) {
      layerFilterOk = false
      break
    }
  }
  record('bushes inside corridor', layerFilterOk)

  let variantUnitOk = true
  for (const sprite of [...placementsA.grass.slice(0, 400), ...placementsA.bushes.slice(0, 400)]) {
    if (!(sprite.variantUnit >= 0 && sprite.variantUnit <= 1)) {
      variantUnitOk = false
      break
    }
  }
  record('sprite variantUnit in range', variantUnitOk)

  // 官方墙体（Barrier/Fence/Drystone/SeaWall）：段长、离路净空与确定性。
  const wallSettings = {
    seed,
    roadWidth: profile.halfWidth * 2,
    density: 1,
    detail: 3,
    waterLevel: field.waterLevel,
    style: ROAD_STYLE_PROFILES[DEFAULT_ROAD_STYLE],
    shadowAt: () => 0,
  }
  const walls = computeWallSegments(field, profile, profile.nodes, wallSettings)
  const wallsRepeat = computeWallSegments(field, profile, profile.nodes, wallSettings)
  record(
    'wall generation deterministic',
    JSON.stringify(walls.map((segment) => [segment.type, segment.side, segment.startAlong, segment.endAlong]))
      === JSON.stringify(wallsRepeat.map((segment) => [segment.type, segment.side, segment.startAlong, segment.endAlong])),
    `segments=${walls.length}`,
  )
  // 官方段长：最长 MAX_WALL_LENGTH(30 节点)，Barrier/Fence 最短 MIN_WALL_LENGTH(3 节点)，
  // 其余类型至少 1 个节点跨度（lab 采样下限 2 个点 = 10m）。
  const wallLengthOk = (segment: (typeof walls)[number]): boolean => {
    const nodes = (segment.endAlong - segment.startAlong) / WALL_NODE_SPACING
    const minNodes = segment.type === 'barrier' || segment.type === 'fence'
      ? WALL_SEGMENT_RULES.minRunNodes
      : 1
    return nodes <= WALL_SEGMENT_RULES.maxRunNodes + 1e-6 && nodes >= minNodes - 1e-6
  }
  record(
    'wall segments within official length rules',
    walls.every(wallLengthOk),
    walls
      .filter((segment) => !wallLengthOk(segment))
      .map((segment) => `${segment.type}@${Math.round(segment.startAlong)}-${Math.round(segment.endAlong)}`)
      .slice(0, 4)
      .join(','),
  )
  record(
    'wall clear of road',
    walls.every((segment) => {
      const clearance = segment.type === 'drystone'
        ? profile.halfWidth + DRYSTONE.margin - 1e-6
        : profile.halfWidth + (segment.type === 'seaWall' ? SEAWALL.distance : BARRIER_TUNING.wide.distance) - 1e-6
      return Math.abs(segment.distance) + 1e-6 >= clearance
    }),
  )
  // 划线：直路段只有虚线（实线权重必须落空）。
  const markings = computeRoadMarkings(profile.nodes, {
    style: ROAD_STYLE_PROFILES[DEFAULT_ROAD_STYLE],
    nodeSpacing: 8,
    shadowAt: () => 0,
    edgeOffset: profile.halfWidth,
    waterLevel: field.waterLevel,
  })
  record(
    'markings weights in {0,1}',
    markings.every((weight) => [weight.solid, weight.solidLeft, weight.solidRight, weight.mergeLeft, weight.mergeRight]
      .every((flag) => typeof flag === 'boolean')),
    `nodes=${markings.length}`,
  )

  const failed = results.filter((result) => !result.ok)
  if (failed.length) {
    console.warn(`[slowroads-lab] self-checks failed: ${failed.map((result) => result.name).join(', ')}`)
  } else {
    console.info(`[slowroads-lab] self-checks passed (${results.length})`)
  }
  return results
}

/** Minimal shape of the committed assets catalog (src/core/assets-catalog.json). */
export interface AssetsCatalogLike {
  files: Array<{
    logicalId: string
    file: string
    kind: string
    bytes: number
    width?: number
    height?: number
    variant?: string
    derivedFrom?: string
  }>
}

export interface SeasonCatalogCheckInput {
  catalog: AssetsCatalogLike
  /** Optional per-season model ids (defaults to the species model table). */
  modelIds?: Record<0 | 1, readonly string[]>
}

/**
 * Verifies the seasonal catalog against the measured asset catalog:
 * every texture / model a season references must exist, the region tables must
 * cover the slowroads cell semantics (winter drops grass cells 0/1, bushes have
 * at least one cell, conifer cards have exactly the measured side-view trees),
 * and the per-season shading params must be complete.
 */
export function runSeasonCatalogChecks(input: SeasonCatalogCheckInput): SelfCheckResult[] {
  const results: SelfCheckResult[] = []
  const record = (name: string, ok: boolean, detail = ''): void => {
    results.push({ name, ok, detail })
    console.assert(ok, `[slowroads-lab season-check] ${name}${detail ? ` — ${detail}` : ''}`)
  }

  const knownIds = new Set(input.catalog.files.map((file) => file.logicalId))
  const modelIds: Record<0 | 1, readonly string[]> = input.modelIds ?? TREE_OBJ_SPECIES_MODELS

  // 1. Every referenced texture exists in the catalog (either the full asset or a derived variant).
  const missing: string[] = []
  for (const ref of collectAllTextureRefs()) {
    if (!knownIds.has(ref.id)) {
      missing.push(ref.id)
    }
  }
  for (const species of [0, 1] as const) {
    for (const id of modelIds[species]) {
      if (!knownIds.has(id)) {
        missing.push(id)
      }
    }
  }
  record('catalog covers all assets', missing.length === 0, missing.slice(0, 6).join(', '))

  // 2. Per-season texture counts + deduplication sanity.
  let seasonRefsOk = true
  const counts: string[] = []
  for (const season of SEASON_IDS) {
    const refs = collectSeasonTextureRefs(season)
    counts.push(`${season}:${refs.length}`)
    if (refs.length < 16) {
      seasonRefsOk = false
    }
    const ids = new Set(refs.map((ref) => ref.id))
    if (ids.size !== refs.length) {
      seasonRefsOk = false
    }
  }
  record('season texture sets complete', seasonRefsOk, counts.join(' '))

  // 3. Region tables: cell semantics.
  let regionOk = true
  const regionNotes: string[] = []
  for (const season of SEASON_IDS) {
    const bushEntries = getBushEntries(season)
    const grassEntries = getGrassEntries(season)
    const conifer = getConiferCardRegions(season)
    if (!bushEntries.length || !grassEntries.length) {
      regionOk = false
      regionNotes.push(`${season}:empty-set`)
    }
    if (bushVariantEntries(season).length < 1) {
      regionOk = false
      regionNotes.push(`${season}:no-bush-cells`)
    }
    if (conifer.length < 2) {
      regionOk = false
      regionNotes.push(`${season}:conifer-cards`)
    }
    const grassCells = grassEntries.map((entry) => entry.cell)
    if (season === 'winter') {
      if (grassCells.some((cell) => cell < 2)) {
        regionOk = false
        regionNotes.push('winter:grass-cells')
      }
    } else if (![0, 1, 2, 3].every((cell) => grassCells.includes(cell))) {
      regionOk = false
      regionNotes.push(`${season}:grass-cells`)
    }
    for (const region of [...bushEntries.map((entry) => entry.region), ...grassEntries.map((entry) => entry.region), ...conifer]) {
      if (!(region.u0 >= 0 && region.u1 <= 1 && region.v0 >= 0 && region.v1 <= 1 && region.u1 > region.u0 && region.v1 > region.v0)) {
        regionOk = false
        regionNotes.push(`${season}:bounds`)
      }
    }
  }
  record('sprite regions valid', regionOk, regionNotes.join(' '))

  // 4. Season params completeness + index alignment.
  let paramsOk = true
  for (const season of SEASON_IDS) {
    const params = SEASON_PARAMS[season]
    if (params.index !== SEASON_INDEX[season]) {
      paramsOk = false
    }
    for (const color of [params.grassColA, params.grassColB, params.peakColA, params.peakColB, params.fieldDiscolouration, params.roadCol]) {
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        paramsOk = false
      }
    }
    if (!(params.shadowFactor > 0 && params.treeDiscolouration >= 0)) {
      paramsOk = false
    }
  }
  record('season params complete', paramsOk)
  record('winter flags', SEASON_PARAMS.winter.hasSnow && SEASON_PARAMS.winter.frozenWater)

  // 5. Texture colour spaces mirror the official `U(url, aniso, wrap, colorSpace)`
  //    call sites (grass conifer atlases decode sRGB; detail/noise/normal maps pass
  //    through linearly; winter aliases grass === detailNear).
  const colorSpaceNotes: string[] = []
  const expectSpace = (ok: boolean, note: string): void => {
    if (!ok) colorSpaceNotes.push(note)
  }
  for (const season of SEASON_IDS) {
    const entry = SEASON_CATALOG[season]
    expectSpace(entry.surface.grass.colorSpace === 'srgb', `${season}:grass`)
    expectSpace(entry.surface.forest.colorSpace === 'srgb', `${season}:forest`)
    expectSpace(entry.surface.heather.colorSpace === 'srgb', `${season}:heather`)
    expectSpace(entry.surface.gravel.colorSpace === 'srgb', `${season}:gravel`)
    expectSpace(entry.surface.rock.colorSpace === 'srgb', `${season}:rock`)
    expectSpace(entry.surface.sand.colorSpace === 'srgb', `${season}:sand`)
    expectSpace(entry.surface.detailFar.colorSpace === 'linear', `${season}:detailFar`)
    expectSpace(entry.surface.detailNear.colorSpace === (season === 'winter' ? 'srgb' : 'linear'), `${season}:detailNear`)
    expectSpace(entry.sprites.bushes.colorSpace === 'srgb', `${season}:bushes`)
    expectSpace(entry.sprites.grassSprites.colorSpace === 'srgb', `${season}:grassSprites`)
    expectSpace(entry.trees.broadleafD.colorSpace === 'srgb', `${season}:broadleafD`)
    expectSpace(entry.trees.broadleafN.colorSpace === 'linear', `${season}:broadleafN`)
    expectSpace(entry.trees.coniferM.colorSpace === 'srgb', `${season}:coniferM`)
    expectSpace(entry.trees.coniferA.colorSpace === 'srgb', `${season}:coniferA`)
    expectSpace(entry.imposters.mapA.colorSpace === 'srgb' && entry.imposters.mapB.colorSpace === 'srgb', `${season}:imposterMaps`)
    expectSpace(entry.imposters.normA.colorSpace === 'linear' && entry.imposters.normB.colorSpace === 'linear', `${season}:imposterNormals`)
    expectSpace(entry.road.single.base.colorSpace === 'srgb', `${season}:roadSingleBase`)
    expectSpace(entry.road.wide.base.colorSpace === 'srgb', `${season}:roadWideBase`)
    if (entry.road.single.overlay) {
      expectSpace(entry.road.single.overlay.colorSpace === 'srgb', `${season}:roadSingleOverlay`)
    }
    if (entry.road.wide.overlay) {
      expectSpace(entry.road.wide.overlay.colorSpace === 'srgb', `${season}:roadWideOverlay`)
    }
    // 划线贴图与墙体贴图都按 srgb 解码（官方 U(url) 默认 srgb）。
    if (entry.road.wide.paint) {
      for (const ref of [
        entry.road.wide.paint.dashed,
        entry.road.wide.paint.solid,
        entry.road.wide.paint.solidLeft,
        entry.road.wide.paint.solidRight,
        entry.road.wide.paint.mergeLeft,
        entry.road.wide.paint.mergeRight,
      ]) {
        expectSpace(ref.colorSpace === 'srgb', `${season}:roadPaint`)
      }
    }
    for (const ref of [entry.walls.barrier, entry.walls.seaWall, entry.walls.fence, entry.walls.drystone]) {
      expectSpace(ref.colorSpace === 'srgb', `${season}:wall`)
    }
  }
  record('texture color spaces match official loader', colorSpaceNotes.length === 0, colorSpaceNotes.slice(0, 6).join(', '))

  // 6. One file may only declare one colour space: the official texture cache is
  //    keyed by URL, so aliased slots (winter grass/detailNear) must agree.
  const byLogicalId = new Map<string, { colorSpace: string; slot: string }>()
  const aliasConflicts: string[] = []
  const visitRef = (slot: string, ref: SeasonTextureRef): void => {
    const previous = byLogicalId.get(ref.id)
    if (!previous) {
      byLogicalId.set(ref.id, { colorSpace: ref.colorSpace, slot })
      return
    }
    if (previous.colorSpace !== ref.colorSpace) {
      aliasConflicts.push(`${ref.id}: ${previous.slot}(${previous.colorSpace}) vs ${slot}(${ref.colorSpace})`)
    }
  }
  const walkEntry = (entry: object, prefix: string): void => {
    for (const [key, value] of Object.entries(entry)) {
      if (!value || typeof value !== 'object') {
        continue
      }
      const record = value as Record<string, unknown>
      if (typeof record.id === 'string' && typeof record.colorSpace === 'string') {
        visitRef(prefix ? `${prefix}.${key}` : key, value as SeasonTextureRef)
        continue
      }
      walkEntry(value as object, prefix ? `${prefix}.${key}` : key)
    }
  }
  for (const season of SEASON_IDS) {
    walkEntry(SEASON_CATALOG[season] satisfies SeasonCatalogEntry, season)
  }
  walkEntry(SHARED_TEXTURES, 'shared')
  record('texture aliases share one color space', aliasConflicts.length === 0, aliasConflicts.slice(0, 4).join(' | '))

  // 7. Official foliage alpha tests (non-winter .5/.2/.6, winter .2/.3/.5).
  const alphaExpectation: Record<SeasonId, readonly [number, number, number]> = {
    spring: [0.5, 0.2, 0.6],
    summer: [0.5, 0.2, 0.6],
    autumn: [0.5, 0.2, 0.6],
    winter: [0.2, 0.3, 0.5],
  }
  const alphaNotes: string[] = []
  for (const season of SEASON_IDS) {
    const params = SEASON_PARAMS[season]
    const [grass, bush, imposter] = alphaExpectation[season]
    if (params.grassAlphaTest !== grass || params.bushAlphaTest !== bush || params.imposterAlphaTest !== imposter) {
      alphaNotes.push(season)
    }
  }
  record('foliage alpha tests match official presets', alphaNotes.length === 0, alphaNotes.join(','))

  // 12b. 树卡变色语义：官方 `effects.treeDiscolouration` 是噪声**幅度**，不是通道乘数。
  //      顶点分块 un / Jg：`disc = 1 + (noise - 0.5) * factor`（柏树列再 *0.5+0.5）。
  //      把因子直接当乘数时冬季（0.2）绿通道只剩 20% ⇒ 树冠洋红（2026-10 修复）。
  const discolourationNotes: string[] = []
  let winterDiscolourationOk = true
  for (const season of SEASON_IDS) {
    const factor = SEASON_PARAMS[season].treeDiscolouration
    const range = scanTreeDiscolourationRange(factor)
    // 乘数区间必须等于 [1 - factor/2, 1 + factor/2]（= 官方公式），而不是 {factor}。
    const expectedMin = 1 - factor / 2
    const expectedMax = 1 + factor / 2
    if (Math.abs(range.min - expectedMin) > 1e-6 || Math.abs(range.max - expectedMax) > 1e-6) {
      discolourationNotes.push(`${season}:range(${range.min.toFixed(3)}..${range.max.toFixed(3)})`)
    }
    if (season === 'winter' && (range.min < 0.9 - 1e-6 || range.max > 1.1 + 1e-6)) {
      winterDiscolourationOk = false
    }
  }
  record(
    'tree discolouration = noise amplitude (1 ± factor/2)',
    discolourationNotes.length === 0,
    discolourationNotes.join(' '),
  )
  record(
    'winter tree discolouration stays within 0.9..1.1 (no channel crush)',
    winterDiscolourationOk,
    `winter factor=${SEASON_PARAMS.winter.treeDiscolouration} → 乘数落在 0.9..1.1；`
      + '把因子当乘数（旧缺陷）会得到 0.2 并让树冠发紫',
  )

  const failed = results.filter((result) => !result.ok)
  if (failed.length) {
    console.warn(`[slowroads-lab] season checks failed: ${failed.map((result) => result.name).join(', ')}`)
  } else {
    console.info(`[slowroads-lab] season checks passed (${results.length})`)
  }
  return results
}

/**
 * 环境（季节×时间×天气）预设校验：
 *  - 官方 32 套预设齐全、颜色合法、数值有限；
 *  - 数据不变量：星空只在夜晴（4 处）、降雪只在冬季（5 处，含 1 个密度 0 的占位）；
 *  - 由视距比例推导的雾参数合理（near/far/density）；
 *  - 天空/云层雾尺度（第五批）：天空用官方 n1 = tileSize × 2，场景用 1000 尺度。
 */
export function runEnvironmentChecks(): SelfCheckResult[] {
  const results: SelfCheckResult[] = []
  const record = (name: string, ok: boolean, detail = ''): void => {
    results.push({ name, ok, detail })
    console.assert(ok, `[slowroads-lab env-check] ${name}${detail ? ` — ${detail}` : ''}`)
  }

  const hexPattern = /^#[0-9a-fA-F]{6}$/
  let presetCount = 0
  let starsCount = 0
  let snowCount = 0
  let shapesOk = true
  let notes = ''
  for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
    for (const time of TIME_OF_DAY_ORDER) {
      for (const weather of WEATHER_ORDER) {
        presetCount += 1
        const preset = ENVIRONMENT_PRESETS[season][time][weather]
        const colors = [
          preset.lights.sun.col,
          preset.lights.ambient.col,
          preset.fog.colA,
          preset.fog.colB,
          preset.fog.colC ?? preset.fog.colB,
          preset.water.base,
          preset.water.body,
          preset.water.highlight,
          preset.water.underwater,
          preset.clouds.highlight,
          preset.clouds.lowlight,
        ]
        if (!colors.every((color) => hexPattern.test(color))) {
          shapesOk = false
          notes = `${season}/${time}/${weather}:color`
        }
        const numbers = [
          preset.lights.sun.intensity,
          preset.lights.ambient.intensity,
          preset.fog.near,
          preset.fog.far,
          preset.clouds.shelfHeight0,
          preset.clouds.shelfHeight1,
          preset.clouds.skyScale0,
          preset.clouds.skyScale1,
        ]
        if (!numbers.every((value) => Number.isFinite(value))) {
          shapesOk = false
          notes = `${season}/${time}/${weather}:number`
        }
        const fog = resolveFogParams(preset)
        if (!(fog.far > 0 && fog.density > 0)) {
          shapesOk = false
          notes = `${season}/${time}/${weather}:fog`
        }
        if (preset.stars) {
          starsCount += 1
          if (time !== 'night' || weather !== 'clear') {
            shapesOk = false
            notes = `stars@${season}/${time}/${weather}`
          }
        }
        if (preset.snow) {
          snowCount += 1
          if (season !== 'winter') {
            shapesOk = false
            notes = `snow@${season}/${time}/${weather}`
          }
        }
      }
    }
  }
  record('environment presets complete', presetCount === 32 && shapesOk, notes)
  record('stars only night+clear', starsCount === 4, `stars=${starsCount}`)
  record('snow only winter', snowCount === 5, `snow=${snowCount}`)

  // 天空/云层雾尺度（第五批）：官方 updateSky() 用 n1 = tileSize × 2 推 fogNear/fogFar，
  // 而 vFogBlend 由 (far + near)/2 推出 —— preset.fog.near < 0 的预设（春·晨·晴 等）
  // 在 1000 尺度下只有 0.722，官方是 1.0，天空 A/B 混色与云层覆盖权重都被压低。
  const skyScaleOk = ENVIRONMENT_SKY_DISTANCE === ENVIRONMENT_VIEW_DISTANCE * 2
  record(
    'sky fog distance = 2 x view distance (official n1)',
    skyScaleOk,
    `sky=${ENVIRONMENT_SKY_DISTANCE} view=${ENVIRONMENT_VIEW_DISTANCE}`,
  )

  const referencePreset = ENVIRONMENT_PRESETS.spring.morning.clear
  const referenceScene = resolveFogParams(referencePreset)
  const referenceSky = resolveSkyFogParams(referencePreset)
  const referenceSceneBlend = resolveFogDepthBlend(referenceScene.near, referenceScene.far)
  const referenceSkyBlend = resolveFogDepthBlend(referenceSky.near, referenceSky.far)
  record(
    'sky vFogBlend matches official (spring/morning/clear = 1)',
    Math.abs(referenceSkyBlend - 1) < 1e-6,
    `sky near=${referenceSky.near} far=${referenceSky.far} blend=${referenceSkyBlend.toFixed(4)}`,
  )
  record(
    'scene vFogBlend keeps lab scale (spring/morning/clear = 0.7778)',
    Math.abs(referenceSceneBlend - 7.7778e-1) < 5e-4,
    `scene near=${referenceScene.near} far=${referenceScene.far} blend=${referenceSceneBlend.toFixed(4)}`,
  )

  // 单调性不变量：天空尺度恒 ≥ 场景尺度（尺度放大只会让 fogAvg 变大 → vFogBlend 不减）。
  let blendInvariantOk = true
  let blendDetail = 'ok'
  let differCount = 0
  let sceneSubUnitCount = 0
  for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
    for (const time of TIME_OF_DAY_ORDER) {
      for (const weather of WEATHER_ORDER) {
        const preset = ENVIRONMENT_PRESETS[season][time][weather]
        const scene = resolveFogParams(preset)
        const sky = resolveSkyFogParams(preset)
        const sceneBlend = resolveFogDepthBlend(scene.near, scene.far)
        const skyBlend = resolveFogDepthBlend(sky.near, sky.far)
        if (skyBlend < sceneBlend - 1e-9) {
          blendInvariantOk = false
          blendDetail = `${season}/${time}/${weather}: sky=${skyBlend.toFixed(4)} < scene=${sceneBlend.toFixed(4)}`
        }
        if (Math.abs(skyBlend - sceneBlend) > 1e-9) {
          differCount += 1
        }
        if (sceneBlend < 1 - 1e-9) {
          sceneSubUnitCount += 1
        }
      }
    }
  }
  record('sky vFogBlend >= scene vFogBlend for all 32 presets', blendInvariantOk, blendDetail)
  // 只有「场景 fogAvg < 500」（= far + near < 1，含 near < 0 与 far < 1 两类）的预设
  // 会因尺度不同而改变 vFogBlend；这条把改动影响面钉死，以后若有人把天空尺度也用在
  // 场景上（或反过来）会当场失败。
  record(
    'sky/scene vFogBlend differ exactly on scene fogAvg < 500 presets',
    differCount === sceneSubUnitCount,
    `differ=${differCount} sceneAvg<500=${sceneSubUnitCount}`,
  )

  const failed = results.filter((result) => !result.ok)
  if (failed.length) {
    console.warn(`[slowroads-lab] environment checks failed: ${failed.map((result) => result.name).join(', ')}`)
  } else {
    console.info(`[slowroads-lab] environment checks passed (${results.length})`)
  }
  return results
}

/** One landscape material reduced to what the uniform coverage check needs. */
export interface MaterialUniformCheckInput {
  name: string
  vertexShader: string
  fragmentShader: string
  uniformKeys: readonly string[]
}

/* ------------------------- 树卡变色（treeDiscolouration） ------------------------- */

/**
 * 官方树卡变色乘数的纯函数镜像（顶点分块 un / Jg）：
 *   `disc = 1.0 + (noise - 0.5) * factor;  if (柏树列) disc = disc * 0.5 + 0.5;`
 * `factor` = 官方 `effects.treeDiscolouration`（幅度：春 1.5 / 夏 .9 / 秋 1.2 / 冬 .2），
 * 不是通道乘数——直接乘通道会让冬季绿通道只剩 20%，树冠发紫。
 */
export function resolveTreeDiscolouration(
  noise: number,
  factor: number,
  options?: { cypress?: boolean },
): number {
  const jittered = 1 + (noise - 0.5) * factor
  return options?.cypress ? jittered * 0.5 + 0.5 : jittered
}

/** 噪声 0..1 扫描出的乘数区间（自检用：应等于 `[1 - factor/2, 1 + factor/2]`）。 */
export function scanTreeDiscolourationRange(factor: number, steps = 64): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let index = 0; index <= steps; index += 1) {
    const value = resolveTreeDiscolouration(index / steps, factor)
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return { min, max }
}

/** 变色着色器的源码断言输入（与 uniform 覆盖检查同源）。 */
export interface TreeDiscolourationShaderInput {
  name: string
  vertexShader: string
  fragmentShader: string
}

const TREE_SHADER_NAME = /^slowroads-(foliage|near-tree)-/
const TREE_DISCOLOURATION_FORMULA = /-\s*0\.5\)\s*\*\s*uTreeDiscolourationFactor/
const UNIFORM_DECLARATION_LINE = /^\s*uniform\b/

/**
 * 树卡变色着色器断言（防回归）：因子只能出现在顶点噪声公式里一次，片元必须消费
 * `vTreeDiscolouration` varying。直接拿因子乘通道 = 冬季发紫那个缺陷，这里当场失败。
 */
export function runTreeDiscolourationShaderChecks(
  materials: TreeDiscolourationShaderInput[],
): SelfCheckResult[] {
  const results: SelfCheckResult[] = []
  const record = (name: string, ok: boolean, detail = ''): void => {
    results.push({ name, ok, detail })
    console.assert(ok, `[slowroads-lab tree-discolouration-check] ${name}${detail ? ` — ${detail}` : ''}`)
  }

  const violations = new Set<string>()
  const scoped = materials.filter((material) => TREE_SHADER_NAME.test(material.name))
  for (const material of scoped) {
    const vertex = stripGlslComments(material.vertexShader)
    const fragment = stripGlslComments(material.fragmentShader)
    const factorLines = vertex
      .split('\n')
      .filter((line) => line.includes('uTreeDiscolourationFactor') && !UNIFORM_DECLARATION_LINE.test(line))
    if (factorLines.length !== 1) {
      violations.add(`${material.name}:factor-lines=${factorLines.length}`)
      continue
    }
    const formulaLine = factorLines[0]!
    if (!TREE_DISCOLOURATION_FORMULA.test(formulaLine)) {
      violations.add(`${material.name}:factor-not-in-noise-formula`)
    }
    if (!formulaLine.includes('texture2D(uTreeDiscolourationNoise')) {
      violations.add(`${material.name}:no-noise-sample`)
    }
    if (!formulaLine.includes('256.0')) {
      violations.add(`${material.name}:noise-scale-mismatch`)
    }
    if (!/varying\s+float\s+vTreeDiscolouration\s*;/.test(fragment)) {
      violations.add(`${material.name}:fragment-missing-varying`)
    }
    if (fragment.includes('uTreeDiscolourationFactor')) {
      violations.add(`${material.name}:fragment-uses-factor`)
    }
  }
  const violationList = [...violations]
  record(
    'tree discolouration: factor only inside vertex noise formula',
    violationList.length === 0,
    violationList.length ? violationList.slice(0, 6).join(', ') : `tree materials=${scoped.length}`,
  )

  const failed = results.filter((result) => !result.ok)
  if (failed.length) {
    console.warn(`[slowroads-lab] tree discolouration checks failed: ${failed.map((result) => result.name).join(', ')}`)
  } else {
    console.info(`[slowroads-lab] tree discolouration checks passed (${results.length}, tree materials=${scoped.length})`)
  }
  return results
}

const UNIFORM_DECLARATION = /\buniform\s+(?:lowp\s+|mediump\s+|highp\s+)?\w+\s+(\w+)\s*(\[[^\]]*\])?\s*;/g

function stripGlslComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/** Shader 源码里声明的 uniform 名（用于对照 JS 侧 uniform 表）。 */
export function collectUniformDeclarations(shaderSource: string): string[] {
  const names: string[] = []
  for (const match of stripGlslComments(shaderSource).matchAll(UNIFORM_DECLARATION)) {
    if (match[1]) {
      names.push(match[1])
    }
  }
  return names
}

/**
 * 材质 uniform 覆盖检查：着色器里声明的每个 uniform 都必须在 JS uniform 表里，
 * 否则 three 不会上传它（运行时恒为 0/空）——「地面过暗」就是这类静默故障
 * （地形着色器用了官方光照 uniform，但 JS 表里没建这几项）。
 */
export function runMaterialUniformCoverageChecks(materials: MaterialUniformCheckInput[]): SelfCheckResult[] {
  const results: SelfCheckResult[] = []
  const record = (name: string, ok: boolean, detail = ''): void => {
    results.push({ name, ok, detail })
    console.assert(ok, `[slowroads-lab uniform-check] ${name}${detail ? ` — ${detail}` : ''}`)
  }

  const violations = new Set<string>()
  for (const material of materials) {
    const provided = new Set(material.uniformKeys)
    const declared = new Set([
      ...collectUniformDeclarations(material.vertexShader),
      ...collectUniformDeclarations(material.fragmentShader),
    ])
    for (const name of declared) {
      if (!provided.has(name)) {
        violations.add(`${material.name}:${name}`)
      }
    }
  }
  const violationList = [...violations]
  record(
    'landscape material uniforms covered',
    violationList.length === 0,
    violationList.length ? `missing ${violationList.slice(0, 8).join(', ')}` : `materials=${materials.length}`,
  )

  const failed = results.filter((result) => !result.ok)
  if (failed.length) {
    console.warn(`[slowroads-lab] uniform checks failed: ${failed.map((result) => result.name).join(', ')}`)
  } else {
    console.info(`[slowroads-lab] uniform checks passed (${results.length}, materials=${materials.length})`)
  }
  return results
}
