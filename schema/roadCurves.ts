import * as THREE from 'three'

export type RoadPathLike = {
  indices: number[]
  closed: boolean
}

export type RoadBuildDataLike = {
  vertexVectors: Array<THREE.Vector3 | null>
  paths: RoadPathLike[]
}

export type RoadCurveDescriptor = {
  curve: THREE.Curve<THREE.Vector3>
}

export type RoadCurveBuildOptions = {
  /** Road width in meters. Used to scale corner rounding and micro-bend limits. */
  width: number
}

const EPS = 1e-6

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function safeFinite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeDirXZ(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3): number {
  out.copy(to).sub(from)
  out.y = 0
  const len = Math.hypot(out.x, out.z)
  if (!(len > EPS)) {
    out.set(0, 0, 0)
    return 0
  }
  out.multiplyScalar(1 / len)
  return len
}

function computeCornerRadius(width: number, smoothing: number): { base: number; microMax: number } {
  const w = Math.max(0.01, safeFinite(width, 2))
  const s = clamp(safeFinite(smoothing, 0), 0, 1)

  // Keep a small minimum radius so even smoothing=0 isn't a perfect hard polyline.
  const rMin = clamp(0.03 * w, 0.02, 0.25)
  const rMax = clamp(1.5 * w, rMin, 12)
  const gamma = 1.5
  const base = rMin + (rMax - rMin) * Math.pow(s, gamma)

  // Micro-bend radius cap (used for very small-angle, long-segment corners).
  const microMax = clamp(0.25 * w, rMin, 2)
  return { base, microMax }
}

function buildCornerCutDistance(params: {
  width: number
  radius: number
  angleRad: number
  lenIn: number
  lenOut: number
}): number {
  const { width, radius, angleRad, lenIn, lenOut } = params
  const w = Math.max(0.01, safeFinite(width, 2))

  // Arc tangent distance from the vertex to each tangency point.
  const dArc = radius * Math.tan(angleRad * 0.5)
  const dSeg = 0.45 * Math.min(lenIn, lenOut)
  const dW = 2.0 * w
  return Math.min(dArc, dSeg, dW)
}

function buildRoundedCurveFromPoints(
  points: THREE.Vector3[],
  closed: boolean,
  smoothing: number,
  options: RoadCurveBuildOptions,
): THREE.Curve<THREE.Vector3> {
  if (points.length < 2) {
    return new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3())
  }
  if (points.length === 2 && !closed) {
    return new THREE.LineCurve3(points[0], points[1])
  }

  // De-duplicate consecutive points (numerical noise, editor edits).
  const filtered: THREE.Vector3[] = []
  for (const p of points) {
    const prev = filtered.length ? filtered[filtered.length - 1]! : null
    if (!prev || prev.distanceToSquared(p) > 1e-8) {
      filtered.push(p)
    }
  }
  if (closed && filtered.length >= 2) {
    const first = filtered[0]!
    const last = filtered[filtered.length - 1]!
    if (first.distanceToSquared(last) <= 1e-8) {
      filtered.pop()
    }
  }
  if (filtered.length < 2) {
    return new THREE.LineCurve3(points[0], points[points.length - 1] ?? points[0])
  }
  if (filtered.length === 2 && closed) {
    const path = new THREE.CurvePath<THREE.Vector3>()
    path.add(new THREE.LineCurve3(filtered[0], filtered[1]))
    path.add(new THREE.LineCurve3(filtered[1], filtered[0]))
    return path
  }

  const { base: baseRadius, microMax: microRadiusMax } = computeCornerRadius(options.width, smoothing)
  const uTurnThresholdRad = (170 * Math.PI) / 180
  const microAngleRad = (1.5 * Math.PI) / 180
  const noiseAngleRad = (0.2 * Math.PI) / 180
  const microMinLen = Math.max(10 * options.width, 8)

  const n = filtered.length

  // Precompute rounded entry/exit points per vertex.
  const entry: Array<THREE.Vector3 | null> = new Array(n).fill(null)
  const exit: Array<THREE.Vector3 | null> = new Array(n).fill(null)

  const dirIn = new THREE.Vector3()
  const dirOut = new THREE.Vector3()

  const startIndex = closed ? 0 : 1
  const endIndex = closed ? n - 1 : n - 2

  for (let i = startIndex; i <= endIndex; i += 1) {
    const prev = filtered[(i - 1 + n) % n]!
    const curr = filtered[i]!
    const next = filtered[(i + 1) % n]!

    const lenIn = normalizeDirXZ(prev, curr, dirIn)
    const lenOut = normalizeDirXZ(curr, next, dirOut)
    if (!(lenIn > EPS) || !(lenOut > EPS)) {
      continue
    }

    const dot = clamp(dirIn.dot(dirOut), -1, 1)
    const angle = Math.acos(dot)

    // Nearly straight: skip to avoid ultra-tiny curves.
    if (angle < noiseAngleRad) {
      continue
    }

    // U-turn: disable rounding entirely to avoid big loops.
    if (angle >= uTurnThresholdRad) {
      continue
    }

    let radius = baseRadius

    // Option C: for very small-angle corners that occur on long segments, cap the radius so it stays subtle.
    if (angle <= microAngleRad && Math.min(lenIn, lenOut) >= microMinLen) {
      radius = Math.min(radius, microRadiusMax)
    }

    const d = buildCornerCutDistance({
      width: options.width,
      radius,
      angleRad: angle,
      lenIn,
      lenOut,
    })

    if (!(d > 1e-3)) {
      continue
    }

    const p = curr.clone().addScaledVector(dirIn, -d)
    const q = curr.clone().addScaledVector(dirOut, d)

    entry[i] = p
    exit[i] = q
  }

  const path = new THREE.CurvePath<THREE.Vector3>()

  const addLine = (a: THREE.Vector3, b: THREE.Vector3) => {
    if (a.distanceToSquared(b) <= 1e-10) {
      return
    }
    path.add(new THREE.LineCurve3(a, b))
  }

  if (!closed) {
    let cursor = filtered[0]!
    for (let i = 1; i < n - 1; i += 1) {
      const e = entry[i]
      const x = exit[i]
      const v = filtered[i]!
      if (e && x) {
        addLine(cursor, e)
        path.add(new THREE.QuadraticBezierCurve3(e, v, x))
        cursor = x
      } else {
        addLine(cursor, v)
        cursor = v
      }
    }
    addLine(cursor, filtered[n - 1]!)
    return path
  }

  // Closed: start from the first entry point if it exists (so we close smoothly).
  const start = entry[0] ?? filtered[0]!
  let cursor = start

  for (let i = 0; i < n; i += 1) {
    const e = entry[i]
    const x = exit[i]
    const v = filtered[i]!

    if (e && x) {
      addLine(cursor, e)
      path.add(new THREE.QuadraticBezierCurve3(e, v, x))
      cursor = x
    } else {
      addLine(cursor, v)
      cursor = v
    }
  }

  addLine(cursor, start)
  return path
}

export function buildRoadCurves(
  smoothing: number,
  buildData: RoadBuildDataLike,
  options: RoadCurveBuildOptions,
): RoadCurveDescriptor[] {
  const curves: RoadCurveDescriptor[] = []
  const safeWidth = Math.max(0.01, safeFinite(options?.width, 2))

  for (const path of buildData.paths ?? []) {
    const points = (path.indices ?? [])
      .map((index) => buildData.vertexVectors?.[index] ?? null)
      .filter((p): p is THREE.Vector3 => Boolean(p))

    if (points.length < 2) {
      continue
    }

    const curve = buildRoundedCurveFromPoints(points, Boolean(path.closed), smoothing, { width: safeWidth })
    curves.push({ curve })
  }

  return curves
}
