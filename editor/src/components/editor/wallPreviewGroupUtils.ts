import * as THREE from 'three'
import type { WallDynamicMesh, WallChain } from '@schema'

export type WallWorldSegment = {
  start: THREE.Vector3
  end: THREE.Vector3
}

const WALL_SKIP_GEOMETRY_DISPOSE_USERDATA_KEY = '__harmonySkipGeometryDispose'
const WALL_SKIP_MATERIAL_DISPOSE_USERDATA_KEY = '__harmonySkipMaterialDispose'
const WALL_OWNED_TEXTURES_USERDATA_KEY = '__harmonyOwnedTextures'

export function mergeWallPreviewSegmentChainsByEndpoint(segments: WallWorldSegment[]): WallWorldSegment[] {
  if (segments.length < 2) {
    return segments
  }

  const epsSq = 1e-8
  const samePoint = (a: THREE.Vector3, b: THREE.Vector3): boolean => a.distanceToSquared(b) <= epsSq

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

        if (samePoint(aEnd, bStart)) {
          chains[i] = [...a, ...b]
          chains.splice(j, 1)
          return true
        }
        if (samePoint(aEnd, bEnd)) {
          chains[i] = [...a, ...reverseChain(b)]
          chains.splice(j, 1)
          return true
        }
        if (samePoint(aStart, bEnd)) {
          chains[i] = [...b, ...a]
          chains.splice(j, 1)
          return true
        }
        if (samePoint(aStart, bStart)) {
          chains[i] = [...reverseChain(b), ...a]
          chains.splice(j, 1)
          return true
        }
      }
    }
    return false
  }

  while (chains.length > 1 && tryMergeOnce()) {
    /* keep merging */
  }

  return chains.flat()
}

const WALL_PREVIEW_SIGNATURE_PRECISION = 1000

function encodeWallPreviewNumber(value: number): string {
  return `${Math.round(value * WALL_PREVIEW_SIGNATURE_PRECISION)}`
}

export function computeWallPreviewSignature(
  segments: WallWorldSegment[],
  dimensions: { height: number; width: number; thickness: number },
): string {
  if (!segments.length) {
    return 'empty'
  }

  const dimensionSignature = [
    encodeWallPreviewNumber(dimensions.height),
    encodeWallPreviewNumber(dimensions.width),
    encodeWallPreviewNumber(dimensions.thickness),
  ].join('|')

  const segmentSignature = segments
    .map(({ start, end }) =>
      [
        encodeWallPreviewNumber(start.x),
        encodeWallPreviewNumber(start.y),
        encodeWallPreviewNumber(start.z),
        encodeWallPreviewNumber(end.x),
        encodeWallPreviewNumber(end.y),
        encodeWallPreviewNumber(end.z),
      ].join(','),
    )
    .join(';')

  return `${dimensionSignature}|${segmentSignature}`
}

export function buildWallPreviewDynamicMeshFromWorldSegments(
  segments: WallWorldSegment[],
  dimensions: { height: number; width: number; thickness: number },
  centerOverride?: THREE.Vector3 | null,
): { center: THREE.Vector3; definition: WallDynamicMesh } | null {
  if (!segments.length) {
    return null
  }

  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)

  segments.forEach(({ start, end }) => {
    min.min(start)
    min.min(end)
    max.max(start)
    max.max(end)
  })

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
    return null
  }

  const center = centerOverride
    ? centerOverride.clone()
    : new THREE.Vector3((min.x + max.x) * 0.5, (min.y + max.y) * 0.5, (min.z + max.z) * 0.5)

  // Convert world segments to local-space WallChain polylines.
  // Split at discontinuities (gap between seg[i].end and seg[i+1].start).
  const EPS_SQ = 1e-8
  const chains: WallChain[] = []
  let currentPoints: WallChain['points'] = []

  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!
    if (currentPoints.length === 0) {
      currentPoints.push({
        x: seg.start.x - center.x,
        y: seg.start.y - center.y,
        z: seg.start.z - center.z,
      })
    }
    currentPoints.push({
      x: seg.end.x - center.x,
      y: seg.end.y - center.y,
      z: seg.end.z - center.z,
    })

    const next = segments[i + 1]
    if (next) {
      const dx = next.start.x - seg.end.x
      const dz = next.start.z - seg.end.z
      if (dx * dx + dz * dz > EPS_SQ) {
        if (currentPoints.length >= 2) {
          const fp = currentPoints[0]!; const lp = currentPoints[currentPoints.length - 1]!
          const cx = fp.x - lp.x; const cz = fp.z - lp.z
          chains.push({ points: currentPoints, closed: cx * cx + cz * cz <= EPS_SQ })
        }
        currentPoints = []
      }
    }
  }

  if (currentPoints.length >= 2) {
    const fp = currentPoints[0]!; const lp = currentPoints[currentPoints.length - 1]!
    const dx = fp.x - lp.x; const dz = fp.z - lp.z
    chains.push({ points: currentPoints, closed: dx * dx + dz * dz <= EPS_SQ })
  }

  if (!chains.length) {
    return null
  }

  const definition: WallDynamicMesh = {
    type: 'Wall',
    chains,
    openings: [],
    dimensions: { height: dimensions.height, width: dimensions.width, thickness: dimensions.thickness },
  }

  return { center, definition }
}

export function disposeWallPreviewGroup(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      const userData = (mesh.userData ?? {}) as Record<string, unknown>
      const geometry = mesh.geometry
      if (geometry && !userData[WALL_SKIP_GEOMETRY_DISPOSE_USERDATA_KEY]) {
        geometry.dispose()
      }
      const ownedTextures = userData[WALL_OWNED_TEXTURES_USERDATA_KEY]
      if (Array.isArray(ownedTextures)) {
        ownedTextures.forEach((entry) => {
          if ((entry as THREE.Texture | null | undefined)?.isTexture) {
            ;(entry as THREE.Texture).dispose()
          }
        })
      }
      if (userData[WALL_SKIP_MATERIAL_DISPOSE_USERDATA_KEY]) {
        return
      }
      const material = mesh.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose())
      } else if (material) {
        material.dispose()
      }
    }
  })
}

export function applyWallGhostPreviewStyling(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const material = mesh.material as THREE.Material & { opacity?: number; transparent?: boolean }
    if ('opacity' in material) {
      material.opacity = 0.9
      material.transparent = true
    }
    mesh.layers.enableAll()
    mesh.renderOrder = 999
  })
}

// Backward-compatible alias. Prefer applyWallGhostPreviewStyling for new call sites.
export const applyWallPreviewStyling = applyWallGhostPreviewStyling
