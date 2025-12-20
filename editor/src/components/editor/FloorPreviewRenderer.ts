import * as THREE from 'three'
import type { FloorDynamicMesh } from '@harmony/schema'
import { createFloorGroup, updateFloorGroup } from '@schema/floorMesh'

export type FloorPreviewSession = {
  points: THREE.Vector3[]
  previewEnd: THREE.Vector3 | null
  previewGroup: THREE.Group | null
}

export type FloorPreviewRenderer = {
  markDirty: () => void
  flushIfNeeded: (scene: THREE.Scene | null, session: FloorPreviewSession | null) => void
  flush: (scene: THREE.Scene | null, session: FloorPreviewSession | null) => void
  clear: (session: FloorPreviewSession | null) => void
  reset: () => void
  dispose: (session: FloorPreviewSession | null) => void
}

const FLOOR_PREVIEW_SIGNATURE_PRECISION = 1000
const FLOOR_PREVIEW_Y_OFFSET = 0.01

function encodePreviewNumber(value: number): string {
  return `${Math.round(value * FLOOR_PREVIEW_SIGNATURE_PRECISION)}`
}

function computeFloorPreviewSignature(points: THREE.Vector3[], previewEnd: THREE.Vector3 | null): string {
  if (!points.length && !previewEnd) {
    return 'empty'
  }

  const pSignature = points
    .map((p) => [encodePreviewNumber(p.x), encodePreviewNumber(p.z)].join(','))
    .join(';')
  const endSignature = previewEnd
    ? [encodePreviewNumber(previewEnd.x), encodePreviewNumber(previewEnd.z)].join(',')
    : 'none'

  return `${pSignature}|${endSignature}`
}

function disposeFloorPreviewGroup(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      mesh.geometry?.dispose?.()
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) {
        mat.forEach((entry) => entry?.dispose?.())
      } else {
        mat?.dispose?.()
      }
    }
  })
}

function applyFloorPreviewStyling(group: THREE.Group) {
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

      const FLOOR_PREVIEW_COLOR = 0x8fd3ff

      if ('opacity' in material) {
        material.opacity = 0.65
        material.transparent = true
      }

      material.color?.setHex?.(FLOOR_PREVIEW_COLOR)
      material.emissive?.setHex?.(FLOOR_PREVIEW_COLOR)
      if (typeof material.emissiveIntensity === 'number') {
        material.emissiveIntensity = 0.8
      }

      if (typeof material.toneMapped === 'boolean') {
        material.toneMapped = false
      }

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

function buildFloorPreviewDefinition(points: THREE.Vector3[], previewEnd: THREE.Vector3 | null): {
  center: THREE.Vector3
  definition: FloorDynamicMesh
} | null {
  const combined = [...points]
  if (previewEnd && points.length) {
    combined.push(previewEnd)
  }

  if (combined.length < 3) {
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
  const vertices = combined.map((p) => [p.x - center.x, p.z - center.z] as [number, number])

  const definition: FloorDynamicMesh = {
    type: 'Floor',
    vertices,
    materialId: null,
  }

  return { center, definition }
}

export function createFloorPreviewRenderer(options: { rootGroup: THREE.Group }): FloorPreviewRenderer {
  let needsSync = false
  let signature: string | null = null

  const clear = (session: FloorPreviewSession | null) => {
    if (session?.previewGroup) {
      const preview = session.previewGroup
      preview.removeFromParent()
      disposeFloorPreviewGroup(preview)
      session.previewGroup = null
    }
    signature = null
  }

  const flush = (scene: THREE.Scene | null, session: FloorPreviewSession | null) => {
    needsSync = false

    if (!scene || !session) {
      if (signature !== null) {
        clear(session)
        signature = null
      }
      return
    }

    const build = buildFloorPreviewDefinition(session.points, session.previewEnd)
    if (!build) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
      return
    }

    const nextSignature = computeFloorPreviewSignature(session.points, session.previewEnd)
    if (nextSignature === signature) {
      return
    }
    signature = nextSignature

    if (!session.previewGroup) {
      const preview = createFloorGroup(build.definition)
      applyFloorPreviewStyling(preview)
      preview.userData.isFloorPreview = true
      session.previewGroup = preview
      options.rootGroup.add(preview)
    } else {
      updateFloorGroup(session.previewGroup, build.definition)
      applyFloorPreviewStyling(session.previewGroup)
      if (!options.rootGroup.children.includes(session.previewGroup)) {
        options.rootGroup.add(session.previewGroup)
      }
    }

    session.previewGroup!.position.copy(build.center)
    session.previewGroup!.position.y += FLOOR_PREVIEW_Y_OFFSET
  }

  return {
    markDirty: () => {
      needsSync = true
    },
    flushIfNeeded: (scene: THREE.Scene | null, session: FloorPreviewSession | null) => {
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
    dispose: (session: FloorPreviewSession | null) => {
      clear(session)
      needsSync = false
      signature = null
    },
  }
}
