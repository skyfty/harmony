/**
 * 临时校验脚本（不入库）：在 Node 里跑官方等价墙体 / 划线逻辑，核对
 * 段长规则、离路净空、确定性，以及启动自检是否全绿。
 * 用法：node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild
 *        .tmp-walls-check.ts --bundle --platform=node --format=esm --outfile=.tmp-out/.tmp-walls-check.mjs
 *       && node .tmp-out/.tmp-walls-check.mjs
 */
import { createHeightfield } from './src/core/heightfield'
import { degreesToRadians } from './src/core/noise'
import { createRoadProfile } from './src/core/roadProfile'
import { bakeTerrainHeight } from './src/core/roadProfile'
import { computeRoadMarkings } from './src/core/roadMarkings'
import { DEFAULT_ROAD_STYLE, ROAD_STYLE_PROFILES, WALL_NODE_SPACING, WALL_SEGMENT_RULES } from './src/core/roadStyle'
import { resolveSeedHeadingRad, traceRoadPath } from './src/core/roadTrace'
import { computeWallSegments } from './src/core/walls'
import { runSeasonCatalogChecks, runSelfChecks, type AssetsCatalogLike } from './src/core/selfCheck'
import assetsCatalog from './src/core/assets-catalog.json'

const style = ROAD_STYLE_PROFILES[DEFAULT_ROAD_STYLE]
let failures = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) {
    failures += 1
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const selfChecks = runSelfChecks()
for (const result of selfChecks) {
  check(`selfcheck:${result.name}`, result.ok, result.detail)
}
const seasonChecks = runSeasonCatalogChecks({ catalog: assetsCatalog as unknown as AssetsCatalogLike })
for (const result of seasonChecks) {
  check(`season:${result.name}`, result.ok, result.detail)
}

for (const seed of [1, 7, 42, 1234, 3067540892, 3527626634]) {
  const field = createHeightfield({ seed, worldSize: 1600 })
  const trace = traceRoadPath(field, {
    startX: 0,
    startZ: 0,
    headingRad: resolveSeedHeadingRad(seed),
    stepLength: 8,
    feelDistance: 24,
    feelAngleRad: degreesToRadians(32),
    slopeLimit: 0.55,
    maxTurnRad: degreesToRadians(4),
    maxLength: null,
    margin: 24,
  })
  for (const roadWidth of [3.2, 7]) {
    const profile = createRoadProfile(trace.nodes, {
      halfWidth: roadWidth * 0.5,
      shoulderWidth: 2.5,
      flattenBand: 10,
    })
    const settings = {
      seed,
      roadWidth,
      density: 1,
      detail: 3,
      waterLevel: field.waterLevel,
      style,
      shadowAt: () => 0.2,
    }
    const walls = computeWallSegments(field, profile, profile.nodes, settings)

    // 诊断（seed=1）：石墙与「地形网格实际渲染高度」的关系（网格烘焙 + 双线性插值）。
    if (seed === 1 && roadWidth === 7) {
      const segments512 = 1024
      const cell = 1600 / segments512
      const bakedAt = (x: number, z: number): number => {
        const gx = (x + 800) / cell
        const gz = (z + 800) / cell
        const ix = Math.max(0, Math.min(segments512 - 1, Math.floor(gx)))
        const iz = Math.max(0, Math.min(segments512 - 1, Math.floor(gz)))
        const fx = gx - ix
        const fz = gz - iz
        const h = (xx: number, zz: number): number =>
          bakeTerrainHeight(field, profile, -800 + xx * cell, -800 + zz * cell).height
        const h00 = h(ix, iz)
        const h10 = h(ix + 1, iz)
        const h01 = h(ix, iz + 1)
        const h11 = h(ix + 1, iz + 1)
        return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz
      }
      const drystone = walls.filter((segment) => segment.type === 'drystone').slice(0, 2)
      for (const segment of drystone) {
        const picks = [0, Math.floor(segment.points.length / 3), Math.floor((2 * segment.points.length) / 3)]
        for (const index of picks) {
          const point = segment.points[index]!
          const meshY = bakedAt(point.x, point.z)
          const terrainY = field.sampleHeight(point.x, point.z)
          const baseY = point.groundY - 0.2
          const topY = baseY + 1.1 + point.jitterHeight
          console.log(
            `   wall@${point.x.toFixed(1)},${point.z.toFixed(1)} raw=${terrainY.toFixed(2)} baked=${point.groundY.toFixed(2)}`
            + ` mesh=${meshY.toFixed(2)} base=${baseY.toFixed(2)} top=${topY.toFixed(2)}`
            + ` visible=${(topY - meshY).toFixed(2)}m buried=${(meshY - baseY).toFixed(2)}m`,
          )
        }
      }
    }
    const again = computeWallSegments(field, profile, profile.nodes, settings)
    const counts = walls.reduce<Record<string, number>>((acc, segment) => {
      acc[segment.type] = (acc[segment.type] ?? 0) + 1
      return acc
    }, {})
    console.log(
      `seed ${seed} width ${roadWidth}: road ${Math.round(profile.length)}m walls ${walls.length} ${JSON.stringify(counts)}`,
    )
    check(
      `deterministic seed=${seed} width=${roadWidth}`,
      JSON.stringify(walls.map((s) => [s.type, s.side, s.startAlong, s.endAlong, s.points.length]))
        === JSON.stringify(again.map((s) => [s.type, s.side, s.startAlong, s.endAlong, s.points.length])),
    )
    let lengthOk = true
    const failedRuns: string[] = []
    let clearanceOk = true
    let continuityOk = true
    for (const segment of walls) {
      const nodes = (segment.endAlong - segment.startAlong) / WALL_NODE_SPACING
      const minNodes = segment.type === 'barrier' || segment.type === 'fence'
        ? WALL_SEGMENT_RULES.minRunNodes
        : 1
      if (nodes > WALL_SEGMENT_RULES.maxRunNodes + 1e-6 || nodes < minNodes - 1e-6) {
        lengthOk = false
        failedRuns.push(`${segment.type} nodes=${nodes.toFixed(2)} along=${segment.startAlong}-${segment.endAlong} points=${segment.points.length}`)
      }
      const expected = segment.type === 'drystone'
        ? roadWidth + 2
        : profile.halfWidth + (segment.type === 'seaWall' ? 0.8 : 0.4)
      if (Math.abs(Math.abs(segment.distance) - expected) > 1e-6) {
        clearanceOk = false
      }
      for (let i = 1; i < segment.points.length; i += 1) {
        const a = segment.points[i - 1]!
        const b = segment.points[i]!
        if (Math.hypot(b.x - a.x, b.z - a.z) > 2 * 1.5 + 0.5) {
          continuityOk = false
        }
      }
    }
    check(`segment lengths official seed=${seed} width=${roadWidth}`, lengthOk, failedRuns.slice(0, 3).join(' | '))
    check(`segment distances official seed=${seed} width=${roadWidth}`, clearanceOk)
    check(`segment point spacing <= ~2m seed=${seed} width=${roadWidth}`, continuityOk)

    // 诊断：官方护栏/海墙门限在该地形上的可达性。
    const laterals: number[] = []
    let barrierGate = 0
    let seaGate = 0
    for (let i = 0; i < profile.nodes.length; i += 1) {
      const node = profile.nodes[i]!
      const nx = -Math.sin(node.heading)
      const nz = Math.cos(node.heading)
      const feel = 10
      const feelAngle = 0.463
      const feelLeft = field.sampleHeight(node.x + Math.cos(node.heading - feelAngle) * feel, node.z + Math.sin(node.heading - feelAngle) * feel)
      const feelRight = field.sampleHeight(node.x + Math.cos(node.heading + feelAngle) * feel, node.z + Math.sin(node.heading + feelAngle) * feel)
      const lateral = (feelLeft - feelRight) / (feel * 0.14)
      laterals.push(Math.abs(lateral))
      const elevation = Math.max(0, node.y - field.waterLevel) * 4
      if (elevation > 4 && (Math.abs(lateral) > 2 || lateral > 0)) {
        barrierGate += 1
      }
      if (elevation < 4 && Math.abs(lateral) > 0.3) {
        seaGate += 1
      }
      void nx
      void nz
    }
    laterals.sort((a, b) => a - b)
    const pick = (p: number): number => laterals[Math.min(laterals.length - 1, Math.floor(p * laterals.length))] ?? 0
    console.log(
      `   lateral |g| p50=${pick(0.5).toFixed(2)} p90=${pick(0.9).toFixed(2)} p99=${pick(0.99).toFixed(2)} max=${(laterals[laterals.length - 1] ?? 0).toFixed(2)} barrierGate=${barrierGate} seaGate=${seaGate}`,
    )

    // 诊断：护栏门限的“连续段”长度分布（官方要求同侧连续 ≥ 3 节点）。
    const runStats = (side: -1 | 1): string => {
      const flags: boolean[] = []
      for (let i = 0; i < profile.nodes.length; i += 1) {
        const node = profile.nodes[i]!
        const feel = 10
        const feelAngle = 0.463
        const feelLeft = field.sampleHeight(node.x + Math.cos(node.heading - feelAngle) * feel, node.z + Math.sin(node.heading - feelAngle) * feel)
        const feelRight = field.sampleHeight(node.x + Math.cos(node.heading + feelAngle) * feel, node.z + Math.sin(node.heading + feelAngle) * feel)
        const lateral = (feelLeft - feelRight) / (feel * 0.14)
        const da = node.headingDelta * 1.25
        const elevation = Math.max(0, node.y - field.waterLevel) * 4
        const aboveSea = elevation > 4
        const left = aboveSea && (lateral < -0.375 || (lateral < 0 && da > 0.4) || (lateral < 0.1 && da < -0.2))
        const right = aboveSea && (lateral > 0.375 || (lateral > 0 && da < -0.4) || (lateral > -0.1 && da > 0.2))
        flags.push(side < 0 ? left : right)
      }
      let best = 0
      let runs = 0
      let current = 0
      for (const flag of flags) {
        if (flag) {
          current += 1
          best = Math.max(best, current)
        } else {
          if (current > 0) {
            runs += 1
          }
          current = 0
        }
      }
      if (current > 0) {
        runs += 1
      }
      return `runs=${runs} maxRun=${best}`
    }
    console.log(`   barrier gate: left ${runStats(-1)}; right ${runStats(1)}`)
  }

  const profile = createRoadProfile(trace.nodes, { halfWidth: 1.6, shoulderWidth: 2.5, flattenBand: 10 })
  const markings = computeRoadMarkings(profile.nodes, {
    style,
    nodeSpacing: 8,
    shadowAt: () => 0,
    edgeOffset: profile.halfWidth,
    waterLevel: field.waterLevel,
  })
  const solid = markings.filter((m) => m.solidLeft || m.solidRight).length
  const merges = markings.filter((m) => m.mergeLeft || m.mergeRight).length
  console.log(`seed ${seed}: markings nodes ${markings.length} solid ${solid} merge ${merges}`)
  const tailFree = markings.slice(-(style.markingsMargin - 1)).every((m) => !m.solidLeft && !m.solidRight)
  check(`markings tail has no solid (seed=${seed})`, tailFree)
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
