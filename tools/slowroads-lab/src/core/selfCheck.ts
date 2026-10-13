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
import { computeBarrierSegments } from './barrier'
import {
  TREE_FAR_VARIANTS,
  bushVariantEntries,
  getBushEntries,
  getConiferCardRegions,
  getGrassEntries,
} from './spriteRegions'
import {
  SEASON_IDS,
  TREE_OBJ_SPECIES_MODELS,
  collectAllTextureRefs,
  collectSeasonTextureRefs,
} from './seasonCatalog'
import { SEASON_INDEX } from './seasonCatalog'
import { SEASON_PARAMS } from './seasonParams'

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

  const barrier = computeBarrierSegments(field, profile, { seed, density: 1 })
  const barrierClearance = profile.halfWidth + profile.shoulderWidth - 0.31
  record(
    'barrier clear of road',
    barrier.every((segment) => profile.distanceTo(segment.x, segment.z) >= barrierClearance),
    `segments=${barrier.length}`,
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

  const failed = results.filter((result) => !result.ok)
  if (failed.length) {
    console.warn(`[slowroads-lab] season checks failed: ${failed.map((result) => result.name).join(', ')}`)
  } else {
    console.info(`[slowroads-lab] season checks passed (${results.length})`)
  }
  return results
}
