import * as THREE from 'three'
import type { WallDynamicMesh } from '@harmony/schema'

export type WallWorldSegment = {
  start: THREE.Vector3
  end: THREE.Vector3
}

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

  const center = new THREE.Vector3((min.x + max.x) * 0.5, (min.y + max.y) * 0.5, (min.z + max.z) * 0.5)

  const definition: WallDynamicMesh = {
    type: 'Wall',
    segments: segments.map(({ start, end }) => ({
      start: { x: start.x - center.x, y: start.y - center.y, z: start.z - center.z },
      end: { x: end.x - center.x, y: end.y - center.y, z: end.z - center.z },
      height: dimensions.height,
      width: dimensions.width,
      thickness: dimensions.thickness,
    })) as any,
  }

  return { center, definition }
}

export function disposeWallPreviewGroup(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      const geometry = mesh.geometry
      if (geometry) {
        geometry.dispose()
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

export function applyWallPreviewStyling(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    const material = mesh.material as THREE.Material & { opacity?: number; transparent?: boolean }
    if ('opacity' in material) {
      material.opacity = 0.45
      material.transparent = true
    }
    mesh.layers.enableAll()
    mesh.renderOrder = 999
  })
}
