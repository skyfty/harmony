import * as THREE from 'three'
import type { RegionDynamicMesh, RegionVertex2D, Vector3Like } from './index'

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

export function normalizeRegionVertex2D(value: unknown): RegionVertex2D | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null
  }
  const x = toFiniteNumber(value[0])
  const z = toFiniteNumber(value[1])
  if (x === null || z === null) {
    return null
  }
  return [x, z]
}

export function normalizeRegionVertices2D(values: unknown): RegionVertex2D[] {
  if (!Array.isArray(values)) {
    return []
  }
  const out: RegionVertex2D[] = []
  values.forEach((entry) => {
    const vertex = normalizeRegionVertex2D(entry)
    if (!vertex) {
      return
    }
    const previous = out[out.length - 1]
    if (previous && Math.abs(previous[0] - vertex[0]) <= 1e-6 && Math.abs(previous[1] - vertex[1]) <= 1e-6) {
      return
    }
    out.push(vertex)
  })
  if (out.length >= 2) {
    const first = out[0]
    const last = out[out.length - 1]
    if (first && last && Math.abs(first[0] - last[0]) <= 1e-6 && Math.abs(first[1] - last[1]) <= 1e-6) {
      out.pop()
    }
  }
  return out
}

export function buildRegionWorldPoints(points: Vector3Like[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  points.forEach((point) => {
    if (!point || typeof point !== 'object') {
      return
    }
    const x = toFiniteNumber((point as Vector3Like).x)
    const y = toFiniteNumber((point as Vector3Like).y) ?? 0
    const z = toFiniteNumber((point as Vector3Like).z)
    if (x === null || z === null) {
      return
    }
    const next = new THREE.Vector3(x, y, z)
    const previous = out[out.length - 1]
    if (previous && previous.distanceToSquared(next) <= 1e-10) {
      return
    }
    out.push(next)
  })
  return out
}

export function computeRegionCenter(points: THREE.Vector3[]): THREE.Vector3 {
  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
  points.forEach((point) => {
    min.x = Math.min(min.x, point.x)
    min.y = Math.min(min.y, point.y)
    min.z = Math.min(min.z, point.z)
    max.x = Math.max(max.x, point.x)
    max.y = Math.max(max.y, point.y)
    max.z = Math.max(max.z, point.z)
  })
  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
    return new THREE.Vector3(0, 0, 0)
  }
  return new THREE.Vector3((min.x + max.x) * 0.5, (min.y + max.y) * 0.5, (min.z + max.z) * 0.5)
}

export function buildRegionDynamicMeshFromWorldPoints(
  points: Vector3Like[],
): { center: THREE.Vector3; definition: RegionDynamicMesh } | null {
  const worldPoints = buildRegionWorldPoints(points)
  if (worldPoints.length < 3) {
    return null
  }
  const center = computeRegionCenter(worldPoints)
  const vertices = normalizeRegionVertices2D(
    worldPoints.map((point) => [point.x - center.x, point.z - center.z] as RegionVertex2D),
  )
  if (vertices.length < 3) {
    return null
  }
  return {
    center,
    definition: {
      type: 'Region',
      vertices,
    },
  }
}

export function buildRegionDynamicMeshFromLocalVertices(vertices: RegionVertex2D[]): RegionDynamicMesh | null {
  const normalized = normalizeRegionVertices2D(vertices)
  if (normalized.length < 3) {
    return null
  }
  return {
    type: 'Region',
    vertices: normalized,
  }
}

export function isPointOnRegionSegmentXZ(point: Pick<Vector3Like, 'x' | 'z'>, a: RegionVertex2D, b: RegionVertex2D): boolean {
  const cross = (point.z - a[1]) * (b[0] - a[0]) - (point.x - a[0]) * (b[1] - a[1])
  if (Math.abs(cross) > 1e-6) {
    return false
  }
  const dot = (point.x - a[0]) * (b[0] - a[0]) + (point.z - a[1]) * (b[1] - a[1])
  if (dot < -1e-6) {
    return false
  }
  const lengthSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
  return dot <= lengthSq + 1e-6
}

export function isPointInsideRegionXZ(point: Pick<Vector3Like, 'x' | 'z'>, vertices: RegionVertex2D[]): boolean {
  const polygon = normalizeRegionVertices2D(vertices)
  if (polygon.length < 3) {
    return false
  }
  let inside = false
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index++) {
    const a = polygon[index]!
    const b = polygon[previousIndex]!
    if (isPointOnRegionSegmentXZ(point, a, b)) {
      return true
    }
    const intersects = ((a[1] > point.z) !== (b[1] > point.z))
      && (point.x < ((b[0] - a[0]) * (point.z - a[1])) / ((b[1] - a[1]) || Number.EPSILON) + a[0])
    if (intersects) {
      inside = !inside
    }
  }
  return inside
}