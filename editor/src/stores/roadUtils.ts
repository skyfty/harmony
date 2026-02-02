import * as THREE from 'three'
import type { RoadDynamicMesh, Vector3Like } from '@harmony/schema'
import { ROAD_DEFAULT_WIDTH, ROAD_MIN_WIDTH } from '@schema/components'
import { updateRoadGroup, resolveRoadLocalHeightSampler } from '@schema/roadMesh'
import type { Object3D } from 'three'

type RoadStoreDeps = {
  getRuntimeObject: (id: string) => Object3D | null
}

export function normalizeRoadWidth(value: unknown): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return ROAD_DEFAULT_WIDTH
  }
  return Math.max(ROAD_MIN_WIDTH, numeric)
}

export const ROAD_CURVE_EPSILON = 1e-6

export function buildRoadWorldPoints(points: Vector3Like[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  points.forEach((p) => {
    if (!p) {
      return
    }
    const x = Number(p.x)
    const z = Number(p.z)
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return
    }
    const vec = new THREE.Vector3(x, 0, z)
    const prev = out[out.length - 1]
    if (prev && prev.distanceToSquared(vec) <= 1e-10) {
      return
    }
    out.push(vec)
  })
  return out
}

export function computeRoadCenter(points: THREE.Vector3[]): THREE.Vector3 {
  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY)
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, 0, Number.NEGATIVE_INFINITY)

  points.forEach((p) => {
    min.x = Math.min(min.x, p.x)
    min.z = Math.min(min.z, p.z)
    max.x = Math.max(max.x, p.x)
    max.z = Math.max(max.z, p.z)
  })

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
    return new THREE.Vector3(0, 0, 0)
  }

  return new THREE.Vector3((min.x + max.x) * 0.5, 0, (min.z + max.z) * 0.5)
}

export function buildRoadDynamicMeshFromWorldPoints(
  points: Vector3Like[],
  width?: number,
): { center: THREE.Vector3; definition: RoadDynamicMesh } | null {
  const worldPoints = buildRoadWorldPoints(points)
  if (worldPoints.length < 2) {
    return null
  }

  const normalizedWidth = normalizeRoadWidth(width)
  // Closed curves are represented by `closed=true` (topology via segments),
  // NOT by repeating the first point as the last point.
  let closed = false
  if (
    worldPoints.length >= 3 &&
    worldPoints[0]!.distanceToSquared(worldPoints[worldPoints.length - 1]!) <= ROAD_CURVE_EPSILON
  ) {
    worldPoints.pop()
    closed = true
  }

  // IMPORTANT: Persist only user control points.
  // Road geometry densification/smoothing happens later during mesh generation.
  const center = computeRoadCenter(worldPoints)

  const vertices = worldPoints.map((p) => [p.x - center.x, p.z - center.z] as [number, number])
  const segments: Array<{ a: number; b: number }> = []
  for (let index = 0; index < vertices.length - 1; index += 1) {
    segments.push({ a: index, b: index + 1 })
  }
  if (closed && vertices.length >= 3) {
    segments.push({ a: vertices.length - 1, b: 0 })
  }

  const definition: RoadDynamicMesh = {
    type: 'Road',
    width: normalizedWidth,
    vertices,
    segments,
  }

  return { center, definition }
}

export function applyRoadComponentPropsToNode(
  node: any,
  props: any,
  groundNode: any,
  deps: RoadStoreDeps,
): boolean {
  if (node.dynamicMesh?.type !== 'Road') {
    return false
  }
  const normalized = props && typeof props === 'object' ? props : props
  // Road geometry (vertices/segments) is edited directly via dynamicMesh.
  const existing = node.dynamicMesh
  const existingWidth = existing && typeof (existing as any).width === 'number' ? Number((existing as any).width) : NaN
  node.dynamicMesh = {
    type: 'Road',
    vertices: Array.isArray(existing.vertices) ? existing.vertices : normalized.vertices,
    segments: Array.isArray(existing.segments) ? existing.segments : normalized.segments,
    width: Number.isFinite(existingWidth) ? existingWidth : normalized.width,
  }

  const runtime = deps.getRuntimeObject(node.id)
  if (runtime) {
    const heightSampler = resolveRoadLocalHeightSampler(node, groundNode)

    runtime.traverse((child: Object3D & { type?: string }) => {
      if (child.type === 'Group' && node.dynamicMesh && node.dynamicMesh.type === 'Road') {
        updateRoadGroup(child, node.dynamicMesh, {
          junctionSmoothing: normalized.junctionSmoothing,
          laneLines: normalized.laneLines,
          shoulders: normalized.shoulders,
          heightSampler,
          samplingDensityFactor: normalized.samplingDensityFactor,
          smoothingStrengthFactor: normalized.smoothingStrengthFactor,
          minClearance: normalized.minClearance,
          laneLineWidth: normalized.laneLineWidth,
          shoulderWidth: normalized.shoulderWidth,
        })
      }
    })
  }
  return true
}
