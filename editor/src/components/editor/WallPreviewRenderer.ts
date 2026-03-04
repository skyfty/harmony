import * as THREE from 'three'
import type { WallDynamicMesh, WallChain } from '@schema'
import { createWallGroup, updateWallGroup } from '@schema/wallMesh'

export type WallPreviewSegment = {
  start: THREE.Vector3
  end: THREE.Vector3
}

export type WallPreviewSession = {
  dragStart: THREE.Vector3 | null
  dragEnd: THREE.Vector3 | null
  segments: WallPreviewSegment[]
  previewGroup: THREE.Group | null
  nodeId: string | null
  dimensions: { height: number; width: number; thickness: number }
}

export type WallPreviewRenderer = {
  markDirty: () => void
  flushIfNeeded: (scene: THREE.Scene | null, session: WallPreviewSession | null) => void
  flush: (scene: THREE.Scene | null, session: WallPreviewSession | null) => void
  clear: (session: WallPreviewSession | null) => void
  reset: () => void
  dispose: (session: WallPreviewSession | null) => void
}

const WALL_PREVIEW_SIGNATURE_PRECISION = 1000

function encodeWallPreviewNumber(value: number): string {
  return `${Math.round(value * WALL_PREVIEW_SIGNATURE_PRECISION)}`
}

function computeWallPreviewSignature(
  segments: WallPreviewSegment[],
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

function disposeWallPreviewGroup(group: THREE.Group) {
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

function applyWallPreviewStyling(group: THREE.Group) {
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

function buildWallPreviewDefinition(
  segments: WallPreviewSegment[],
  dimensions: { height: number; width: number; thickness: number },
  normalizeWallDimensionsForViewport: (values: {
    height?: number
    width?: number
    thickness?: number
  }) => { height: number; width: number; thickness: number },
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
  const normalized = normalizeWallDimensionsForViewport(dimensions)

  // Convert preview segments to local-space WallChain polylines.
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
    dimensions: { height: normalized.height, width: normalized.width, thickness: normalized.thickness },
  }

  return { center, definition }
}

export function createWallPreviewRenderer(options: {
  rootGroup: THREE.Group
  normalizeWallDimensionsForViewport: (values: {
    height?: number
    width?: number
    thickness?: number
  }) => { height: number; width: number; thickness: number }
}): WallPreviewRenderer {
  let needsSync = false
  let signature: string | null = null

  const clear = (session: WallPreviewSession | null) => {
    if (session?.previewGroup) {
      const preview = session.previewGroup
      preview.removeFromParent()
      disposeWallPreviewGroup(preview)
      session.previewGroup = null
    }
    signature = null
  }

  const flush = (scene: THREE.Scene | null, session: WallPreviewSession | null) => {
    needsSync = false

    if (!scene || !session) {
      if (signature !== null) {
        clear(session)
        signature = null
      }
      return
    }

    const segments: WallPreviewSegment[] = [...session.segments]
    if (session.dragStart && session.dragEnd) {
      segments.push({ start: session.dragStart.clone(), end: session.dragEnd.clone() })
    }

    const hasCommittedNode = !!session.nodeId
    const hasActiveDrag = !!session.dragStart && !!session.dragEnd
    if (hasCommittedNode && !hasActiveDrag) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
      return
    }

    if (!segments.length) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
      return
    }

    const build = buildWallPreviewDefinition(segments, session.dimensions, options.normalizeWallDimensionsForViewport)
    if (!build) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
      return
    }

    const nextSignature = computeWallPreviewSignature(segments, session.dimensions)
    if (nextSignature === signature) {
      return
    }
    signature = nextSignature

    if (!session.previewGroup) {
      const preview = createWallGroup(build.definition)
      applyWallPreviewStyling(preview)
      preview.userData.isWallPreview = true
      session.previewGroup = preview
      options.rootGroup.add(preview)
    } else {
      updateWallGroup(session.previewGroup, build.definition)
      applyWallPreviewStyling(session.previewGroup)
      if (!options.rootGroup.children.includes(session.previewGroup)) {
        options.rootGroup.add(session.previewGroup)
      }
    }

    session.previewGroup!.position.copy(build.center)
  }

  return {
    markDirty: () => {
      needsSync = true
    },
    flushIfNeeded: (scene: THREE.Scene | null, session: WallPreviewSession | null) => {
      if (!needsSync) {
        return
      }
      flush(scene, session)
    },
    flush,
    clear,
    reset: () => {
      needsSync = false
      signature = null
    },
    dispose: (session: WallPreviewSession | null) => {
      clear(session)
      needsSync = false
      signature = null
    },
  }
}
