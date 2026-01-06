import * as THREE from 'three'
import type { GuideRouteDynamicMesh } from './index'

export type GuideRouteRenderOptions = {
  segmentThickness?: number
  waypointRadius?: number
}

const DEFAULT_SEGMENT_THICKNESS = 0.04
const DEFAULT_WAYPOINT_RADIUS = 0.08

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, numeric))
}

function clearGroupContent(group: THREE.Group) {
  while (group.children.length) {
    const child = group.children.pop()!
    child.removeFromParent()
    child.traverse((entry) => {
      const mesh = entry as THREE.Mesh
      if ((mesh as any)?.isMesh) {
        const geometry = (mesh as any).geometry as THREE.BufferGeometry | undefined
        const material = (mesh as any).material as THREE.Material | THREE.Material[] | undefined
        geometry?.dispose?.()
        if (Array.isArray(material)) {
          material.forEach((m) => m?.dispose?.())
        } else {
          material?.dispose?.()
        }
      }
    })
  }
}

function sanitizeVertices(mesh: GuideRouteDynamicMesh): THREE.Vector3[] {
  const raw = Array.isArray(mesh.vertices) ? mesh.vertices : []
  const out: THREE.Vector3[] = []
  for (const entry of raw) {
    const v = (entry as { x?: unknown; y?: unknown; z?: unknown } | null | undefined) ?? undefined
    const x = typeof v?.x === 'number' && Number.isFinite(v.x) ? v.x : 0
    const y = typeof v?.y === 'number' && Number.isFinite(v.y) ? v.y : 0
    const z = typeof v?.z === 'number' && Number.isFinite(v.z) ? v.z : 0
    const vec = new THREE.Vector3(x, y, z)
    const prev = out[out.length - 1]
    if (prev && prev.distanceToSquared(vec) <= 1e-10) {
      continue
    }
    out.push(vec)
  }
  return out
}

function ensureSegmentsMesh(count: number, thickness: number): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshStandardMaterial({ color: 0x4b4f55 })
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(0, count))
  mesh.name = 'GuideRouteSegments'
  mesh.castShadow = false
  mesh.receiveShadow = false
  // Each instance uses matrix scaling; base geometry is unit cube.
  ;(mesh as any).userData = { ...(mesh as any).userData, guideRoute: true, thickness }
  return mesh
}

function ensureWaypointsMesh(count: number, radius: number): THREE.InstancedMesh {
  const geometry = new THREE.SphereGeometry(1, 16, 12)
  const material = new THREE.MeshStandardMaterial({ color: 0x27ffff })
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(0, count))
  mesh.name = 'GuideRouteWaypoints'
  mesh.castShadow = false
  mesh.receiveShadow = false
  ;(mesh as any).userData = { ...(mesh as any).userData, guideRoute: true, radius }
  return mesh
}

function updateSegmentsInstances(mesh: THREE.InstancedMesh, vertices: THREE.Vector3[], thickness: number) {
  const segmentCount = Math.max(0, vertices.length - 1)
  const up = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3()
  const mid = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const matrix = new THREE.Matrix4()

  for (let i = 0; i < segmentCount; i += 1) {
    const a = vertices[i]!
    const b = vertices[i + 1]!
    dir.copy(b).sub(a)
    const length = dir.length()
    if (!(length > 1e-6)) {
      // Collapse degenerate segments.
      scale.set(0, 0, 0)
      mid.copy(a)
      quat.identity()
    } else {
      dir.multiplyScalar(1 / length)
      // Rotate unit Z axis to the segment direction.
      quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
      mid.copy(a).add(b).multiplyScalar(0.5)
      scale.set(thickness, thickness, length)
    }
    matrix.compose(mid, quat, scale)
    mesh.setMatrixAt(i, matrix)
  }

  mesh.count = segmentCount
  mesh.instanceMatrix.needsUpdate = true
  void up
}

function updateWaypointInstances(mesh: THREE.InstancedMesh, vertices: THREE.Vector3[], radius: number) {
  const matrix = new THREE.Matrix4()
  const quat = new THREE.Quaternion()
  const scale = new THREE.Vector3(radius, radius, radius)
  for (let i = 0; i < vertices.length; i += 1) {
    matrix.compose(vertices[i]!, quat, scale)
    mesh.setMatrixAt(i, matrix)
  }
  mesh.count = vertices.length
  mesh.instanceMatrix.needsUpdate = true
}

function rebuildGuideRouteGroup(group: THREE.Group, definition: GuideRouteDynamicMesh, options: GuideRouteRenderOptions = {}) {
  clearGroupContent(group)

  const vertices = sanitizeVertices(definition)
  const thickness = clampNumber(options.segmentThickness, 0.005, 1, DEFAULT_SEGMENT_THICKNESS)
  const radius = clampNumber(options.waypointRadius, 0.01, 2, DEFAULT_WAYPOINT_RADIUS)

  const segments = ensureSegmentsMesh(Math.max(0, vertices.length - 1), thickness)
  updateSegmentsInstances(segments, vertices, thickness)

  const waypoints = ensureWaypointsMesh(vertices.length, radius)
  updateWaypointInstances(waypoints, vertices, radius)

  group.add(segments)
  group.add(waypoints)
}

export function createGuideRouteRenderGroup(
  definition: GuideRouteDynamicMesh,
  options: GuideRouteRenderOptions = {},
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'GuideRoute'
  rebuildGuideRouteGroup(group, definition, options)
  return group
}

export function createGuideRouteGroup(
  definition: GuideRouteDynamicMesh,
  options: GuideRouteRenderOptions = {},
): THREE.Group {
  return createGuideRouteRenderGroup(definition, options)
}

export function updateGuideRouteGroup(
  object: THREE.Object3D,
  definition: GuideRouteDynamicMesh,
  options: GuideRouteRenderOptions = {},
): boolean {
  const group = object as THREE.Group
  if (!(group as any)?.isGroup) {
    return false
  }
  rebuildGuideRouteGroup(group, definition, options)
  return true
}
