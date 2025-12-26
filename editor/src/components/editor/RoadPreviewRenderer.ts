import * as THREE from 'three'
import type { RoadDynamicMesh } from '@harmony/schema'
import { createRoadGroup, updateRoadGroup } from '@schema/roadMesh'

export type RoadPreviewSession = {
  points: THREE.Vector3[]
  previewEnd: THREE.Vector3 | null
  previewGroup: THREE.Group | null
  width: number
}

export type RoadPreviewRenderer = {
  markDirty: () => void
  flushIfNeeded: (scene: THREE.Scene | null, session: RoadPreviewSession | null) => void
  flush: (scene: THREE.Scene | null, session: RoadPreviewSession | null) => void
  clear: (session: RoadPreviewSession | null) => void
  reset: () => void
  dispose: (session: RoadPreviewSession | null) => void
}

const ROAD_PREVIEW_SIGNATURE_PRECISION = 1000
const ROAD_PREVIEW_Y_OFFSET = 0.01

function encodeRoadPreviewNumber(value: number): string {
  return `${Math.round(value * ROAD_PREVIEW_SIGNATURE_PRECISION)}`
}

function computeRoadPreviewSignature(points: THREE.Vector3[], previewEnd: THREE.Vector3 | null, width: number): string {
  if (!points.length && !previewEnd) {
    return 'empty'
  }

  const widthSignature = encodeRoadPreviewNumber(width)
  const pSignature = points
    .map((p) => [encodeRoadPreviewNumber(p.x), encodeRoadPreviewNumber(p.z)].join(','))
    .join(';')
  const endSignature = previewEnd
    ? [encodeRoadPreviewNumber(previewEnd.x), encodeRoadPreviewNumber(previewEnd.z)].join(',')
    : 'none'

  return `${widthSignature}|${pSignature}|${endSignature}`
}

function disposeRoadPreviewGroup(group: THREE.Group) {
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

function applyRoadPreviewStyling(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }

    const applyMaterial = (source: THREE.Material) => {
      const material = source as THREE.Material & {
        opacity?: number
        transparent?: boolean
        depthWrite?: boolean
        polygonOffset?: boolean
        polygonOffsetFactor?: number
        polygonOffsetUnits?: number
        color?: { setHex?: (hex: number) => void }
        emissive?: { setHex?: (hex: number) => void }
        emissiveIntensity?: number
        toneMapped?: boolean
        needsUpdate?: boolean
      }

      const ROAD_PREVIEW_COLOR = 0x8fd3ff

      if ('opacity' in material) {
        material.opacity = 0.75
        material.transparent = true
      }

      // Make the preview clearly visible against the ground.
      material.color?.setHex?.(ROAD_PREVIEW_COLOR)
      material.emissive?.setHex?.(ROAD_PREVIEW_COLOR)
      if (typeof material.emissiveIntensity === 'number') {
        material.emissiveIntensity = 1
      }

      // Disable tone mapping so the highlight stays bright even without scene lights.
      if (typeof material.toneMapped === 'boolean') {
        material.toneMapped = false
      }

      // Reduce z-fighting / depth artifacts when close to the ground.
      if (typeof material.depthWrite === 'boolean') {
        material.depthWrite = false
      }
      if (typeof material.polygonOffset === 'boolean') {
        material.polygonOffset = true
        material.polygonOffsetFactor = -1
        material.polygonOffsetUnits = -1
      }

      if (typeof material.needsUpdate === 'boolean') {
        material.needsUpdate = true
      }
    }

    const meshMaterial = mesh.material
    if (Array.isArray(meshMaterial)) {
      meshMaterial.forEach((entry) => entry && applyMaterial(entry))
    } else if (meshMaterial) {
      applyMaterial(meshMaterial)
    }

    mesh.layers.enableAll()
    mesh.renderOrder = 999
  })
}

function buildRoadPreviewDefinition(points: THREE.Vector3[], previewEnd: THREE.Vector3 | null, width: number): {
  center: THREE.Vector3
  definition: RoadDynamicMesh
} | null {
  const combined = [...points]
  if (previewEnd && points.length) {
    combined.push(previewEnd)
  }

  if (combined.length < 2) {
    return null
  }

  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY)
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, 0, Number.NEGATIVE_INFINITY)

  combined.forEach((p) => {
    min.x = Math.min(min.x, p.x)
    min.z = Math.min(min.z, p.z)
    max.x = Math.max(max.x, p.x)
    max.z = Math.max(max.z, p.z)
  })

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) {
    return null
  }

  const center = new THREE.Vector3((min.x + max.x) * 0.5, 0, (min.z + max.z) * 0.5)

  const normalizedWidth = Number.isFinite(width) ? Math.max(0.2, width) : 2
  const vertices = combined.map((p) => [p.x - center.x, p.z - center.z] as [number, number])
  const segments = vertices.length >= 2
    ? Array.from({ length: vertices.length - 1 }, (_value, index) => ({ a: index, b: index + 1 }))
    : []
  const definition: RoadDynamicMesh = {
    type: 'Road',
    width: normalizedWidth,
    vertices,
    segments,
  }

  return { center, definition }
}

export function createRoadPreviewRenderer(options: {
  rootGroup: THREE.Group
  /** Optional sampler in world XZ coordinates. */
  heightSampler?: ((x: number, z: number) => number) | null
}): RoadPreviewRenderer {
  let needsSync = false
  let signature: string | null = null

  const clear = (session: RoadPreviewSession | null) => {
    if (session?.previewGroup) {
      const preview = session.previewGroup
      preview.removeFromParent()
      disposeRoadPreviewGroup(preview)
      session.previewGroup = null
    }
    signature = null
  }

  const flush = (scene: THREE.Scene | null, session: RoadPreviewSession | null) => {
    needsSync = false

    if (!scene || !session) {
      if (signature !== null) {
        clear(session)
        signature = null
      }
      return
    }

    const build = buildRoadPreviewDefinition(session.points, session.previewEnd, session.width)
    if (!build) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
      return
    }

    const nextSignature = computeRoadPreviewSignature(session.points, session.previewEnd, session.width)
    if (nextSignature === signature) {
      return
    }
    signature = nextSignature

    const localHeightSampler = options.heightSampler
      ? ((x: number, z: number) => options.heightSampler!(x + build.center.x, z + build.center.z))
      : null

    if (!session.previewGroup) {
      const preview = createRoadGroup(build.definition, { heightSampler: localHeightSampler })
      applyRoadPreviewStyling(preview)
      preview.userData.isRoadPreview = true
      session.previewGroup = preview
      options.rootGroup.add(preview)
    } else {
      updateRoadGroup(session.previewGroup, build.definition, { heightSampler: localHeightSampler })
      applyRoadPreviewStyling(session.previewGroup)
      if (!options.rootGroup.children.includes(session.previewGroup)) {
        options.rootGroup.add(session.previewGroup)
      }
    }

    session.previewGroup!.position.copy(build.center)
    session.previewGroup!.position.y += ROAD_PREVIEW_Y_OFFSET
  }

  return {
    markDirty: () => {
      needsSync = true
    },
    flushIfNeeded: (scene: THREE.Scene | null, session: RoadPreviewSession | null) => {
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
    dispose: (session: RoadPreviewSession | null) => {
      clear(session)
      needsSync = false
      signature = null
    },
  }
}
