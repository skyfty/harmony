import * as THREE from 'three'

const EPSILON = 1e-6

function polygonArea2(points: THREE.Vector2[]): number {
  let area = 0
  const n = points.length
  for (let i = 0; i < n; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    area += a.x * b.y - b.x * a.y
  }
  return area * 0.5
}

function ensureWinding(points: THREE.Vector2[], ccw: boolean): THREE.Vector2[] {
  if (points.length < 3) {
    return points
  }
  const area = polygonArea2(points)
  const isCcw = area > 0
  if (isCcw === ccw) {
    return points
  }
  return points.slice().reverse()
}

function intersectLines2(
  p1: THREE.Vector2,
  d1: THREE.Vector2,
  p2: THREE.Vector2,
  d2: THREE.Vector2,
): THREE.Vector2 | null {
  const det = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(det) <= 1e-6) {
    return null
  }
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const t = (dx * d2.y - dy * d2.x) / det
  return new THREE.Vector2(p1.x + d1.x * t, p1.y + d1.y * t)
}

export function buildJunctionLoopXZ(params: {
  center: THREE.Vector3
  incidentDirsXZ: THREE.Vector3[]
  radius: number
  roundSegments: number
  miterLimit?: number
}): THREE.Vector2[] {
  const { center, incidentDirsXZ } = params
  const r = Number.isFinite(params.radius) ? Math.max(0, params.radius) : 0
  if (r <= EPSILON || incidentDirsXZ.length < 3) {
    return []
  }

  const miterLimit = Number.isFinite(params.miterLimit) ? Math.max(1, params.miterLimit!) : 4
  const roundSegments = Number.isFinite(params.roundSegments) ? Math.max(2, Math.min(64, Math.trunc(params.roundSegments))) : 8

  // Sort incident directions by angle around the junction.
  const dirs = incidentDirsXZ
    .map((d) => {
      const v = d.clone()
      v.y = 0
      if (v.lengthSq() <= EPSILON * EPSILON) {
        return null
      }
      v.normalize()
      const angle = Math.atan2(v.z, v.x)
      return { v, angle }
    })
    .filter((x): x is { v: THREE.Vector3; angle: number } => Boolean(x))
    .sort((a, b) => a.angle - b.angle)

  if (dirs.length < 3) {
    return []
  }

  const points: THREE.Vector2[] = []
  const c2 = new THREE.Vector2(center.x, center.z)

  const pushArc = (from: THREE.Vector2, to: THREE.Vector2) => {
    const a0 = Math.atan2(from.y - c2.y, from.x - c2.x)
    let a1 = Math.atan2(to.y - c2.y, to.x - c2.x)
    let start = a0
    let end = a1
    while (end <= start) {
      end += Math.PI * 2
    }
    const delta = end - start
    const steps = Math.max(1, Math.round((delta / (Math.PI * 2)) * roundSegments))
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps
      const a = start + delta * t
      points.push(new THREE.Vector2(c2.x + Math.cos(a) * r, c2.y + Math.sin(a) * r))
    }
  }

  for (let i = 0; i < dirs.length; i += 1) {
    const a = dirs[i]!
    const b = dirs[(i + 1) % dirs.length]!

    const da = a.v
    const db = b.v

    // Left side of da and right side of db define the outer boundary wedge.
    const la = new THREE.Vector2(-da.z, da.x)
    const lb = new THREE.Vector2(-db.z, db.x)

    const p1 = new THREE.Vector2(c2.x + la.x * r, c2.y + la.y * r)
    const v1 = new THREE.Vector2(da.x, da.z)

    const p2 = new THREE.Vector2(c2.x - lb.x * r, c2.y - lb.y * r)
    const v2 = new THREE.Vector2(db.x, db.z)

    // Seed with the start point of this wedge.
    if (i === 0) {
      points.push(p1)
    }

    const intersection = intersectLines2(p1, v1, p2, v2)
    if (!intersection) {
      pushArc(p1, p2)
      continue
    }

    const dist = intersection.distanceTo(c2)
    if (!Number.isFinite(dist) || dist > miterLimit * r) {
      pushArc(p1, p2)
      continue
    }

    points.push(intersection)
  }

  // Clean duplicates.
  const cleaned: THREE.Vector2[] = []
  for (const p of points) {
    const last = cleaned.length ? cleaned[cleaned.length - 1]! : null
    if (!last || last.distanceToSquared(p) > EPSILON * EPSILON) {
      cleaned.push(p)
    }
  }
  if (cleaned.length >= 3 && cleaned[0]!.distanceToSquared(cleaned[cleaned.length - 1]!) <= EPSILON * EPSILON) {
    cleaned.pop()
  }

  return ensureWinding(cleaned, true)
}

export function triangulateJunctionPatchXZ(params: {
  contour: THREE.Vector2[]
  holes?: THREE.Vector2[][]
  heightSampler?: ((x: number, z: number) => number) | null
  /** Optional precomputed vertex heights (world Y) aligned to contour/holes order. */
  vertexHeights?: { contour: number[]; holes?: number[][] } | null
  yOffset: number
  minClearance?: number
}): THREE.BufferGeometry | null {
  const contour = params.contour
  if (!Array.isArray(contour) || contour.length < 3) {
    return null
  }

  const holes = Array.isArray(params.holes) ? params.holes.filter((h) => Array.isArray(h) && h.length >= 3) : []

  const inputHeights = params.vertexHeights ?? null
  const contourHeights = Array.isArray(inputHeights?.contour) ? inputHeights!.contour : null
  const holeHeightsList = Array.isArray(inputHeights?.holes) ? inputHeights!.holes! : null

  const ccwContour = ensureWinding(contour, true)
  const ccwContourHeights = contourHeights
    ? (ccwContour === contour ? contourHeights : contourHeights.slice().reverse())
    : null

  const woundHoles = holes.map((h) => ensureWinding(h, false))
  const woundHoleHeights = holeHeightsList
    ? holes.map((hole, index) => {
        const heights = holeHeightsList[index]
        if (!Array.isArray(heights) || heights.length !== hole.length) {
          return null
        }
        const wound = woundHoles[index]!
        return wound === hole ? heights : heights.slice().reverse()
      })
    : null

  const faces = THREE.ShapeUtils.triangulateShape(ccwContour, woundHoles)
  if (!faces.length) {
    return null
  }

  const points2: THREE.Vector2[] = [...ccwContour]
  for (const hole of woundHoles) {
    points2.push(...hole)
  }

  const heights2: number[] | null = ccwContourHeights
    ? (() => {
        const collected: number[] = [...ccwContourHeights]
        if (woundHoles.length) {
          for (let i = 0; i < woundHoles.length; i += 1) {
            const hole = woundHoles[i]!
            const heights = woundHoleHeights ? woundHoleHeights[i] : null
            if (!heights || heights.length !== hole.length) {
              return null
            }
            collected.push(...heights)
          }
        }
        return collected
      })()
    : null

  const sampler = typeof params.heightSampler === 'function' ? params.heightSampler : null
  const clearance = Number.isFinite(params.minClearance) ? Math.max(0, params.minClearance!) : 0

  const positions: number[] = new Array(points2.length * 3)
  const uvs: number[] = new Array(points2.length * 2)

  // Simple planar UVs in XZ so BufferGeometryUtils.mergeGeometries can merge
  // with the strip geometries (which always have a `uv` attribute).
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const p of points2) {
    if (!p) {
      continue
    }
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minZ) minZ = p.y
    if (p.y > maxZ) maxZ = p.y
  }
  const spanX = Number.isFinite(maxX - minX) && Math.abs(maxX - minX) > EPSILON ? (maxX - minX) : 1
  const spanZ = Number.isFinite(maxZ - minZ) && Math.abs(maxZ - minZ) > EPSILON ? (maxZ - minZ) : 1

  for (let i = 0; i < points2.length; i += 1) {
    const p = points2[i]!
    const precomputed = heights2 ? heights2[i] : undefined
    const sampled = sampler ? sampler(p.x, p.y) : 0
    const y = Number.isFinite(precomputed as number)
      ? (precomputed as number)
      : (Number.isFinite(sampled) ? sampled : 0) + params.yOffset + clearance
    positions[i * 3 + 0] = p.x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = p.y

    uvs[i * 2 + 0] = (p.x - minX) / spanX
    uvs[i * 2 + 1] = (p.y - minZ) / spanZ
  }

  const indices: number[] = []
  for (const f of faces) {
    indices.push(f[0]!, f[1]!, f[2]!)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}
