import * as THREE from 'three'
import type { WallDynamicMesh, WallChain, Vector3Like, SceneNode } from '@schema'
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

/** Convert a flat merged segment list (already endpoint-merged) into WallChain polylines.
 * Detects connected components by checking whether consecutive segment endpoints match.
 */
function worldSegmentsToWallChains(
  segments: WallWorldSegment[],
  center: THREE.Vector3,
  options: { forceClosedSingleChain?: boolean } = {},
): WallChain[] {
  if (!segments.length) return []

  const eps = 1e-6
  const same = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceToSquared(b) <= eps

  // Split into connected groups.
  const groups: WallWorldSegment[][] = []
  let current: WallWorldSegment[] = [segments[0]!]
  for (let i = 1; i < segments.length; i++) {
    const prev = current[current.length - 1]!
    const seg = segments[i]!
    if (same(prev.end, seg.start)) {
      current.push(seg)
    } else {
      groups.push(current)
      current = [seg]
    }
  }
  groups.push(current)

  const shouldForceClosedSingleChain = Boolean(options.forceClosedSingleChain && groups.length === 1)

  return groups.map((grp) => {
    const first = grp[0]!
    const last = grp[grp.length - 1]!
    const closed = same(last.end, first.start) || shouldForceClosedSingleChain

    const points: Vector3Like[] = grp.map((seg) => ({
      x: seg.start.x - center.x,
      y: seg.start.y - center.y,
      z: seg.start.z - center.z,
    }))
    if (!closed) {
      points.push({
        x: last.end.x - center.x,
        y: last.end.y - center.y,
        z: last.end.z - center.z,
      })
    }
    return { points, closed } satisfies WallChain
  })
}

function computeWallSegmentBounds(segments: WallWorldSegment[]): { min: THREE.Vector3; max: THREE.Vector3 } | null {
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
    return null
  }

  return { min, max }
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

export function computeWallCenter(
  segments: WallWorldSegment[],
  dimensions: { height?: number; width?: number; thickness?: number } = {},
): THREE.Vector3 {
  const bounds = computeWallSegmentBounds(segments)
  if (!bounds) {
    return new THREE.Vector3(0, 0, 0)
  }

  const normalized = normalizeWallDimensions(dimensions)
  const { min, max } = bounds
  const centerY = min.y + normalized.height * 0.5

  return new THREE.Vector3((min.x + max.x) * 0.5, centerY, (min.z + max.z) * 0.5)
}

export function buildWallDynamicMeshFromWorldSegments(
  segments: Array<{ start: Vector3Like; end: Vector3Like }>,
  dimensions: { height?: number; width?: number; thickness?: number } = {},
  options: { forceClosedSingleChain?: boolean } = {},
): { center: THREE.Vector3; definition: WallDynamicMesh } | null {
  const worldSegments = mergeWallWorldSegmentChainsByEndpoint(buildWallWorldSegments(segments))
  if (!worldSegments.length) {
    return null
  }

  const normalizedDims = normalizeWallDimensions(dimensions)
  const center = computeWallCenter(worldSegments, normalizedDims)
  const chains = worldSegmentsToWallChains(worldSegments, center, options)

  const definition: WallDynamicMesh = {
    type: 'Wall',
    chains,
    openings: [],
    bodyMaterialConfigId: null,
    dimensions: normalizedDims,
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
  if (!node.dynamicMesh || node.dynamicMesh.type !== 'Wall' || !Array.isArray(node.dynamicMesh.chains) || !node.dynamicMesh.chains.length) {
    return false
  }

  const normalized = clampWallProps(props)

  node.dynamicMesh = {
    ...node.dynamicMesh,
    bodyMaterialConfigId: normalized.bodyMaterialConfigId,
    dimensions: {
      height: normalized.height,
      width: normalized.width,
      thickness: normalized.thickness,
    },
  }

  const runtime = deps.getRuntimeObject(node.id)
  if (runtime) {
    runtime.traverse((child: Object3D & { type?: string; name?: string; userData?: Record<string, unknown> | undefined }) => {
      if (child.type === 'Group' && child.name === 'WallGroup' && child.userData?.dynamicMeshType === 'Wall') {
        if (node.dynamicMesh && node.dynamicMesh.type === 'Wall') {
          deps.updateWallGroup(child, node.dynamicMesh, {
            smoothing: resolveWallSmoothing(node),
            wallRenderMode: normalized.wallRenderMode,
            repeatInstanceStep: normalized.repeatInstanceStep,
          } as any)
        }
        return
      }
    })
  }
  return true
}
