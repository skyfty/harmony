import * as THREE from 'three'

const EPSILON = 1e-6
const COS_STRAIGHT_THRESHOLD = Math.cos((5 * Math.PI) / 180)
const COS_UTURN_THRESHOLD = Math.cos((170 * Math.PI) / 180)

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, numeric))
}

function computeCornerCutDistance(params: {
  smoothing: number
  inLength: number
  outLength: number
  cosTheta: number
}): number {
  const smoothing = clampNumber(params.smoothing, 0, 1, 0)
  if (smoothing <= 0) {
    return 0
  }

  const inLength = params.inLength
  const outLength = params.outLength
  if (!(inLength > EPSILON) || !(outLength > EPSILON)) {
    return 0
  }

  const minLen = Math.min(inLength, outLength)
  if (!(minLen > EPSILON)) {
    return 0
  }

  // Near-straight: keep as polyline to preserve straight segments.
  if (params.cosTheta >= COS_STRAIGHT_THRESHOLD) {
    return 0
  }

  let maxRatio = 0.49
  // Very sharp turns can bulge with quadratic curves; keep them tighter.
  if (params.cosTheta <= COS_UTURN_THRESHOLD) {
    maxRatio = Math.min(maxRatio, 0.25)
  }

  const requested = smoothing * minLen
  const maxAllowed = maxRatio * minLen
  const cut = Math.min(requested, maxAllowed)
  return cut > EPSILON ? cut : 0
}

export function buildRoadCornerBezierCurvePath(
  points: THREE.Vector3[],
  closed: boolean,
  junctionSmoothing: number,
): THREE.Curve<THREE.Vector3> {
  const count = points.length
  if (count < 2) {
    return new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0))
  }
  if (count === 2) {
    return new THREE.LineCurve3(points[0]!, points[1]!)
  }

  const useClosed = Boolean(closed) && count >= 3
  const smoothing = clampNumber(junctionSmoothing, 0, 1, 0)
  if (smoothing <= 0) {
    const path = new THREE.CurvePath<THREE.Vector3>()
    for (let i = 0; i < count - 1; i += 1) {
      const a = points[i]!
      const b = points[i + 1]!
      if (a.distanceToSquared(b) > EPSILON * EPSILON) {
        path.add(new THREE.LineCurve3(a.clone(), b.clone()))
      }
    }
    if (useClosed) {
      const a = points[count - 1]!
      const b = points[0]!
      if (a.distanceToSquared(b) > EPSILON * EPSILON) {
        path.add(new THREE.LineCurve3(a.clone(), b.clone()))
      }
    }
    return path
  }

  const entryPoints: THREE.Vector3[] = new Array(count)
  const exitPoints: THREE.Vector3[] = new Array(count)
  const rounded: boolean[] = new Array(count).fill(false)

  const inDir = new THREE.Vector3()
  const outDir = new THREE.Vector3()

  for (let i = 0; i < count; i += 1) {
    const p = points[i]!
    if (!useClosed && (i === 0 || i === count - 1)) {
      entryPoints[i] = p.clone()
      exitPoints[i] = p.clone()
      continue
    }

    const prev = points[(i - 1 + count) % count]!
    const next = points[(i + 1) % count]!

    inDir.subVectors(p, prev)
    outDir.subVectors(next, p)
    const inLen = inDir.length()
    const outLen = outDir.length()

    if (!(inLen > EPSILON) || !(outLen > EPSILON)) {
      entryPoints[i] = p.clone()
      exitPoints[i] = p.clone()
      continue
    }

    const cosTheta = inDir.dot(outDir) / (inLen * outLen)
    const cut = computeCornerCutDistance({ smoothing, inLength: inLen, outLength: outLen, cosTheta })
    if (!(cut > 0)) {
      entryPoints[i] = p.clone()
      exitPoints[i] = p.clone()
      continue
    }

    inDir.multiplyScalar(1 / inLen)
    outDir.multiplyScalar(1 / outLen)

    entryPoints[i] = p.clone().addScaledVector(inDir, -cut)
    exitPoints[i] = p.clone().addScaledVector(outDir, cut)
    rounded[i] = true
  }

  const path = new THREE.CurvePath<THREE.Vector3>()
  const addLine = (a: THREE.Vector3, b: THREE.Vector3) => {
    if (a.distanceToSquared(b) <= EPSILON * EPSILON) {
      return
    }
    path.add(new THREE.LineCurve3(a.clone(), b.clone()))
  }
  const addQuad = (a: THREE.Vector3, ctrl: THREE.Vector3, b: THREE.Vector3) => {
    if (a.distanceToSquared(b) <= EPSILON * EPSILON) {
      return
    }
    path.add(new THREE.QuadraticBezierCurve3(a.clone(), ctrl.clone(), b.clone()))
  }

  if (useClosed) {
    for (let i = 0; i < count; i += 1) {
      if (rounded[i]) {
        addQuad(entryPoints[i]!, points[i]!, exitPoints[i]!)
      }
      const nextIndex = (i + 1) % count
      addLine(exitPoints[i]!, entryPoints[nextIndex]!)
    }
    return path
  }

  // Open path
  let current = exitPoints[0]!
  for (let i = 0; i < count - 1; i += 1) {
    const nextIndex = i + 1
    addLine(current, entryPoints[nextIndex]!)
    if (rounded[nextIndex] && nextIndex !== count - 1) {
      addQuad(entryPoints[nextIndex]!, points[nextIndex]!, exitPoints[nextIndex]!)
      current = exitPoints[nextIndex]!
    } else {
      current = entryPoints[nextIndex]!
    }
  }

  return path
}
