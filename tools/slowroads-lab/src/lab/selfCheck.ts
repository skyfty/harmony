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
import { TREE_FAR_VARIANTS } from './spriteRegions'

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
      + ` flowers=${placementsA.flowers.length} tallGrass=${placementsA.tallGrass.length}`)

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
  for (const sprite of [...placementsA.flowers.slice(0, 400), ...placementsA.tallGrass.slice(0, 400)]) {
    const distance = profile.distanceTo(sprite.x, sprite.z)
    if (distance < profile.halfWidth + 0.3 - 0.6 || distance > profile.halfWidth + 20 + 0.6) {
      layerFilterOk = false
      break
    }
  }
  record('flowers/tall grass inside corridor', layerFilterOk)

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
