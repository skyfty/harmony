import * as THREE from 'three'
import { runSelfChecks } from './src/lab/selfCheck'
import { createHeightfield } from './src/lab/heightfield'
import { createRoadProfile } from './src/lab/roadProfile'
import { resolveSeedHeadingRad, traceRoadPath } from './src/lab/roadTrace'
import { computeBarrierSegments } from './src/lab/barrier'
import { degreesToRadians } from './src/lab/noise'

const verbose = process.argv.includes('--checks')
if (verbose) {
  const results = runSelfChecks()
  for (const result of results) {
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`)
  }
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
  const profile = createRoadProfile(trace.nodes, { halfWidth: 3.5, shoulderWidth: 2.5, flattenBand: 10 })
  const samples: Array<Record<number, number>> = []
  for (let along = 0; along <= profile.length; along += 2) {
    const sample = profile.sampleAt(along)
    const perpX = -Math.sin(sample.heading)
    const perpZ = Math.cos(sample.heading)
    const drops: Record<number, number> = {}
    for (const side of [1, -1]) {
      const place = field.sampleHeight(sample.x + perpX * side * 5.75, sample.z + perpZ * side * 5.75)
      for (const out of [4, 6, 8, 12]) {
        const probe = field.sampleHeight(sample.x + perpX * side * (6 + out), sample.z + perpZ * side * (6 + out))
        drops[out] = Math.max(drops[out] ?? -Infinity, place - probe)
      }
    }
    samples.push(drops)
  }
  const percentile = (values: number[], p: number): number => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
  }
  const parts: string[] = []
  for (const out of [4, 6, 8, 12]) {
    const values = samples.map((drops) => drops[out]!)
    parts.push(`+${out}m: p50=${percentile(values, 0.5).toFixed(2)} p80=${percentile(values, 0.8).toFixed(2)} p95=${percentile(values, 0.95).toFixed(2)} max=${Math.max(...values).toFixed(2)}`)
  }
  const segments = computeBarrierSegments(field, profile, { seed, density: 0.65 })
  console.log(`seed ${seed}: road ${Math.round(profile.length)}m segments ${segments.length}`)
  for (const part of parts) {
    console.log(`   drop ${part}`)
  }
}

// 护栏朝向验证：实例旋转 -heading 后，quads 的宽度轴（局部 +X）应与道路切线一致。
{
  const seed = 1234
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
  const profile = createRoadProfile(trace.nodes, { halfWidth: 3.5, shoulderWidth: 2.5, flattenBand: 10 })
  const segments = computeBarrierSegments(field, profile, { seed, density: 1 })
  const localX = new THREE.Vector3(1, 0, 0)
  let worst = 1
  for (const segment of segments.slice(0, 200)) {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, segment.rotation, 0))
    const axis = localX.clone().applyQuaternion(quaternion)
    // 找到离护栏段最近的道路折线段，用它的切线做对照
    let bestDistance = Number.POSITIVE_INFINITY
    let tangent = new THREE.Vector3(1, 0, 0)
    for (let i = 1; i < profile.nodes.length; i += 1) {
      const a = profile.nodes[i - 1]!
      const b = profile.nodes[i]!
      const segX = b.x - a.x
      const segZ = b.z - a.z
      const segLengthSq = segX * segX + segZ * segZ
      const t = Math.max(0, Math.min(1, ((segment.x - a.x) * segX + (segment.z - a.z) * segZ) / segLengthSq))
      const px = a.x + segX * t
      const pz = a.z + segZ * t
      const distance = Math.hypot(segment.x - px, segment.z - pz)
      if (distance < bestDistance) {
        bestDistance = distance
        tangent = new THREE.Vector3(segX, 0, segZ).normalize()
      }
    }
    worst = Math.min(worst, Math.abs(tangent.dot(axis)))
  }
  console.log(`barrier orientation: segments=${segments.length} worst |dot(widthAxis, roadTangent)| = ${worst.toFixed(4)} (接近 1 表示对齐)`)
  const sample = segments[0]
  if (sample) {
    console.log(`   sample segment y=${sample.y.toFixed(2)} distance=${profile.distanceTo(sample.x, sample.z).toFixed(2)} (halfWidth+shoulder=${profile.halfWidth + profile.shoulderWidth})`)
  }
}
