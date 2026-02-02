import * as THREE from 'three'
import type { Vector3Like, GuideRouteDynamicMesh } from '@harmony/schema'

export function buildGuideRouteWorldPoints(points: Vector3Like[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  points.forEach((p) => {
    if (!p) {
      return
    }
    const x = Number(p.x)
    const y = Number(p.y)
    const z = Number(p.z)
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return
    }
    const vec = new THREE.Vector3(x, Number.isFinite(y) ? y : 0, z)
    const prev = out[out.length - 1]
    if (prev && prev.distanceToSquared(vec) <= 1e-10) {
      return
    }
    out.push(vec)
  })
  return out
}

export function computeGuideRouteCenter(points: THREE.Vector3[]): THREE.Vector3 {
  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)

  points.forEach((p) => {
    min.x = Math.min(min.x, p.x)
    min.y = Math.min(min.y, p.y)
    min.z = Math.min(min.z, p.z)
    max.x = Math.max(max.x, p.x)
    max.y = Math.max(max.y, p.y)
    max.z = Math.max(max.z, p.z)
  })

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
    return new THREE.Vector3(0, 0, 0)
  }

  return new THREE.Vector3((min.x + max.x) * 0.5, (min.y + max.y) * 0.5, (min.z + max.z) * 0.5)
}

export function buildGuideRouteDynamicMeshFromWorldPoints(
  points: Vector3Like[],
): { center: THREE.Vector3; definition: GuideRouteDynamicMesh } | null {
  const worldPoints = buildGuideRouteWorldPoints(points)
  if (worldPoints.length < 2) {
    return null
  }

  const center = computeGuideRouteCenter(worldPoints)
  const vertices: Vector3Like[] = worldPoints.map((p) => ({
    x: p.x - center.x,
    y: p.y - center.y,
    z: p.z - center.z,
  }))

  const definition: GuideRouteDynamicMesh = {
    type: 'GuideRoute',
    vertices: vertices as any,
  }

  return { center, definition }
}
