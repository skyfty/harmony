import * as THREE from 'three'
import type { WallDynamicMesh, Vector3Like, SceneNode } from '@harmony/schema'
import {
  WALL_DEFAULT_HEIGHT,
  WALL_DEFAULT_WIDTH,
  WALL_DEFAULT_THICKNESS,
  WALL_MIN_HEIGHT,
  WALL_MIN_WIDTH,
  WALL_MIN_THICKNESS,
  clampWallProps,
  type WallComponentProps,
  WALL_DEFAULT_SMOOTHING,
} from '@schema/components'
import type { Object3D } from 'three'

type WallStoreDeps = {
  getRuntimeObject: (id: string) => Object3D | null
  updateWallGroup: (group: Object3D, definition: WallDynamicMesh, options?: any) => void
}

export type WallWorldSegment = {
  start: THREE.Vector3
  end: THREE.Vector3
}

function createVector(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z)
}

export function mergeWallWorldSegmentChainsByEndpoint(segments: WallWorldSegment[]): WallWorldSegment[] {
  if (segments.length < 2) {
    return segments
  }

  const epsSq = 1e-8
  const samePoint = (a: THREE.Vector3, b: THREE.Vector3): boolean => a.distanceToSquared(b) <= epsSq

  // Start by treating each segment as its own chain.
  let chains: WallWorldSegment[][] = segments.map((seg) => [seg])

  const reverseChain = (chain: WallWorldSegment[]): WallWorldSegment[] =>
    chain
      .slice()
      .reverse()
      .map((seg) => ({ start: seg.end, end: seg.start }))

  const tryMergeOnce = (): boolean => {
    for (let i = 0; i < chains.length; i += 1) {
      const a = chains[i]!
      const aStart = a[0]!.start
      const aEnd = a[a.length - 1]!.end

      for (let j = i + 1; j < chains.length; j += 1) {
        const b = chains[j]!
        const bStart = b[0]!.start
        const bEnd = b[b.length - 1]!.end

        // aEnd -> bStart
        if (samePoint(aEnd, bStart)) {
          chains[i] = [...a, ...b]
          chains.splice(j, 1)
          return true
        }
        // aEnd -> bEnd (reverse b)
        if (samePoint(aEnd, bEnd)) {
          chains[i] = [...a, ...reverseChain(b)]
          chains.splice(j, 1)
          return true
        }
        // aStart -> bEnd (prepend b)
        if (samePoint(aStart, bEnd)) {
          chains[i] = [...b, ...a]
          chains.splice(j, 1)
          return true
        }
        // aStart -> bStart (reverse b, prepend)
        if (samePoint(aStart, bStart)) {
          chains[i] = [...reverseChain(b), ...a]
          chains.splice(j, 1)
          return true
        }
      }
    }
    return false
  }

  // Keep merging until no further endpoint connections exist.
  // This intentionally allows merging chains at corners; the later colinear merge step
  // will only collapse truly straight runs.
  while (chains.length > 1 && tryMergeOnce()) {
    /* keep merging */
  }

  return chains.flat()
}

export function normalizeWallDimensions(values: { height?: number; width?: number; thickness?: number }): {
  height: number
  width: number
  thickness: number
} {
  const DEFAULT_WALL_HEIGHT = WALL_DEFAULT_HEIGHT
  const DEFAULT_WALL_WIDTH = WALL_DEFAULT_WIDTH
  const DEFAULT_WALL_THICKNESS = WALL_DEFAULT_THICKNESS
  const MIN_WALL_HEIGHT = WALL_MIN_HEIGHT
  const MIN_WALL_WIDTH = WALL_MIN_WIDTH
  const MIN_WALL_THICKNESS = WALL_MIN_THICKNESS

  const height = Number.isFinite(values.height) ? Math.max(MIN_WALL_HEIGHT, values.height!) : DEFAULT_WALL_HEIGHT
  const width = Number.isFinite(values.width) ? Math.max(MIN_WALL_WIDTH, values.width!) : DEFAULT_WALL_WIDTH
  const thickness = Number.isFinite(values.thickness)
    ? Math.max(MIN_WALL_THICKNESS, values.thickness!)
    : DEFAULT_WALL_THICKNESS
  return { height, width, thickness }
}

export function buildWallWorldSegments(segments: Array<{ start: Vector3Like; end: Vector3Like }>): WallWorldSegment[] {
  return segments
    .map((segment) => {
      if (!segment?.start || !segment?.end) {
        return null
      }
      const start = new THREE.Vector3(segment.start.x, segment.start.y, segment.start.z)
      const end = new THREE.Vector3(segment.end.x, segment.end.y, segment.end.z)
      if (!Number.isFinite(start.x) || !Number.isFinite(start.y) || !Number.isFinite(start.z)) {
        return null
      }
      if (!Number.isFinite(end.x) || !Number.isFinite(end.y) || !Number.isFinite(end.z)) {
        return null
      }
      if (start.distanceToSquared(end) <= 1e-10) {
        return null
      }
      return { start, end }
    })
    .filter((entry): entry is WallWorldSegment => !!entry)
}

export function computeWallCenter(segments: WallWorldSegment[]): THREE.Vector3 {
  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)

  segments.forEach(({ start, end }) => {
    min.x = Math.min(min.x, start.x, end.x)
    min.y = Math.min(min.y, start.y, end.y)
    min.z = Math.min(min.z, start.z, end.z)
    max.x = Math.max(max.x, start.x, end.x)
    max.y = Math.max(max.y, start.y, end.y)
    max.z = Math.max(max.z, start.z, end.z)
  })

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
    return new THREE.Vector3(0, 0, 0)
  }

  return new THREE.Vector3((min.x + max.x) * 0.5, (min.y + max.y) * 0.5, (min.z + max.z) * 0.5)
}

export function buildWallDynamicMeshFromWorldSegments(
  segments: Array<{ start: Vector3Like; end: Vector3Like }>,
  dimensions: { height?: number; width?: number; thickness?: number } = {},
): { center: THREE.Vector3; definition: WallDynamicMesh } | null {
  const worldSegments = mergeWallWorldSegmentChainsByEndpoint(buildWallWorldSegments(segments))
  if (!worldSegments.length) {
    return null
  }

  const { height, width, thickness } = normalizeWallDimensions(dimensions)
  const center = computeWallCenter(worldSegments)

  const dynamicSegments = worldSegments.map(({ start, end }) => ({
    start: createVector(start.x - center.x, start.y - center.y, start.z - center.z),
    end: createVector(end.x - center.x, end.y - center.y, end.z - center.z),
    height,
    width,
    thickness,
  }))

  // Merge contiguous colinear segments to keep geometry minimal.
  // Important: do NOT merge across corners; that would change wall topology.
  const mergedSegments: typeof dynamicSegments = []
  const eps = 1e-8
  const minLen = 1e-6
  const areColinearXZ = (
    a: { start: Vector3Like; end: Vector3Like },
    b: { start: Vector3Like; end: Vector3Like },
  ): boolean => {
    const v0x = Number(a.end.x) - Number(a.start.x)
    const v0z = Number(a.end.z) - Number(a.start.z)
    const v1x = Number(b.end.x) - Number(b.start.x)
    const v1z = Number(b.end.z) - Number(b.start.z)
    const l0 = Math.sqrt(v0x * v0x + v0z * v0z)
    const l1 = Math.sqrt(v1x * v1x + v1z * v1z)
    if (!Number.isFinite(l0) || !Number.isFinite(l1) || l0 <= minLen || l1 <= minLen) {
      return false
    }
    const dot = (v0x / l0) * (v1x / l1) + (v0z / l0) * (v1z / l1)
    return Number.isFinite(dot) && dot >= 0.9999
  }
  const lenSqXZ = (a: Vector3Like, b: Vector3Like): number => {
    const dx = Number(b.x) - Number(a.x)
    const dz = Number(b.z) - Number(a.z)
    return dx * dx + dz * dz
  }

  for (const seg of dynamicSegments) {
    if (!seg) {
      continue
    }
    if (!Number.isFinite(Number(seg.start.x) + Number(seg.start.z) + Number(seg.end.x) + Number(seg.end.z))) {
      continue
    }
    if (lenSqXZ(seg.start, seg.end) <= minLen * minLen) {
      continue
    }

    const prev = mergedSegments[mergedSegments.length - 1]
    if (!prev) {
      mergedSegments.push(seg)
      continue
    }

    const contSq = lenSqXZ(prev.end, seg.start)
    const sameProps =
      Math.abs(Number(prev.height) - Number(seg.height)) <= 1e-8 &&
      Math.abs(Number(prev.width) - Number(seg.width)) <= 1e-8 &&
      Math.abs(Number(prev.thickness) - Number(seg.thickness)) <= 1e-8
    if (Number.isFinite(contSq) && contSq <= eps && sameProps && areColinearXZ(prev, seg)) {
      prev.end = seg.end
      continue
    }

    mergedSegments.push(seg)
  }

  const definition: WallDynamicMesh = {
    type: 'Wall',
    segments: mergedSegments,
  }

  return { center, definition }
}

export function resolveWallSmoothing(node: SceneNode | null | undefined): number {
  const component = node?.components?.['wall'] as
    | { props?: Partial<WallComponentProps> | null }
    | undefined
  if (!component) {
    return WALL_DEFAULT_SMOOTHING
  }
  return clampWallProps(component.props ?? null).smoothing
}

export function applyWallComponentPropsToNode(
  node: SceneNode,
  props: WallComponentProps,
  deps: WallStoreDeps,
): boolean {
  if (!node.dynamicMesh || node.dynamicMesh.type !== 'Wall' || !Array.isArray(node.dynamicMesh.segments) || !node.dynamicMesh.segments.length) {
    return false
  }

  const normalized = clampWallProps(props)
  type Segment = WallDynamicMesh['segments'][number]
  const nextSegments: Segment[] = node.dynamicMesh.segments.map((segment) => {
    const seg = segment as Segment
    return {
      ...seg,
      height: normalized.height,
      width: normalized.width,
      thickness: normalized.thickness,
    }
  })

  node.dynamicMesh = {
    type: 'Wall',
    segments: nextSegments,
  }

  const runtime = deps.getRuntimeObject(node.id)
  if (runtime) {
    runtime.traverse((child: Object3D & { type?: string; name?: string; userData?: Record<string, unknown> | undefined }) => {
      if (child.type === 'Group' && child.name === 'WallGroup' && child.userData?.dynamicMeshType === 'Wall') {
        if (node.dynamicMesh && node.dynamicMesh.type === 'Wall') {
          deps.updateWallGroup(child, node.dynamicMesh, {
            smoothing: resolveWallSmoothing(node),
            jointTrimMode: normalized.jointTrimMode,
            jointTrimManual: normalized.jointTrimManual,
          } as any)
        }
        return
      }
    })
  }
  return true
}
