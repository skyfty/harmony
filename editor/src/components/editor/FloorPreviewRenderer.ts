import * as THREE from 'three'
import type { FloorDynamicMesh } from '@harmony/schema'
import { createFloorGroup, updateFloorGroup } from '@schema/floorMesh'
import { FLOOR_DEFAULT_SMOOTH } from '@schema/components'

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

function buildRectanglePreviewPoints(first: THREE.Vector3, second: THREE.Vector3): THREE.Vector3[] {
  const minX = Math.min(first.x, second.x)
  const maxX = Math.max(first.x, second.x)
  const minZ = Math.min(first.z, second.z)
  const maxZ = Math.max(first.z, second.z)

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return []
  }

  return [
    new THREE.Vector3(minX, 0, minZ),
    new THREE.Vector3(minX, 0, maxZ),
    new THREE.Vector3(maxX, 0, maxZ),
    new THREE.Vector3(maxX, 0, minZ),
  ]
}

function computePolygonArea2D(vertices: THREE.Vector3[]): number {
  let area = 0
  for (let i = 0; i < vertices.length; i += 1) {
    const current = vertices[i]!
    const next = vertices[(i + 1) % vertices.length]!
    area += current.x * next.z - next.x * current.z
  }
  return area * 0.5
}

function buildTwoPointPreviewPoints(first: THREE.Vector3, previewEnd: THREE.Vector3): THREE.Vector3[] {
  const direction = previewEnd.clone().sub(first)
  direction.y = 0
  if (direction.lengthSq() <= Number.EPSILON) {
    return [first.clone(), previewEnd.clone(), previewEnd.clone()]
  }

  const perp = new THREE.Vector3(direction.z, 0, -direction.x)
  perp.normalize()
  perp.multiplyScalar(0.1)

  const offsetPoint = previewEnd.clone().add(perp)
  let triangle = [first.clone(), offsetPoint.clone(), previewEnd.clone()]
  if (computePolygonArea2D(triangle) < 0) {
    const flipped = previewEnd.clone().sub(perp)
    triangle = [first.clone(), flipped, previewEnd.clone()]
  }
  return triangle
}

function getPreviewVertices(points: THREE.Vector3[], previewEnd: THREE.Vector3 | null): THREE.Vector3[] {
  if (!points.length) {
    return []
  }

  if (points.length === 1 && previewEnd) {
    const first = points[0]
    if (first) {
      return buildTwoPointPreviewPoints(first, previewEnd)
    }
  }

  if (points.length === 2 && previewEnd) {
    const first = points[0]
    const second = points[1]
    if (first && second && previewEnd.equals(second)) {
      const rectangle = buildRectanglePreviewPoints(first, second)
      if (rectangle.length) {
        return rectangle
      }
    }
  }

  const combined = points.map((p) => p.clone())
  if (previewEnd) {
    combined.push(previewEnd.clone())
  }
  return combined
}

function computePreviewCenter(points: THREE.Vector3[]): THREE.Vector3 | null {
  if (!points.length) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  points.forEach((p) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) {
      return
    }
    minX = Math.min(minX, p.x)
    minZ = Math.min(minZ, p.z)
    maxX = Math.max(maxX, p.x)
    maxZ = Math.max(maxZ, p.z)
  })

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return null
  }

  return new THREE.Vector3((minX + maxX) * 0.5, 0, (minZ + maxZ) * 0.5)
}

function computeFloorPreviewSignature(vertices: THREE.Vector3[]): string {
  if (!vertices.length) {
    return 'empty'
  }

  return vertices
    .map((p) => [encodePreviewNumber(p.x), encodePreviewNumber(p.z)].join(','))
    .join(';')
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

function buildFloorPreviewDefinition(vertices: THREE.Vector3[], center: THREE.Vector3): {
  center: THREE.Vector3
  definition: FloorDynamicMesh
} | null {
  if (vertices.length < 3) {
    return null
  }

  const normalizedVertices = vertices.map((p) => [p.x - center.x, center.z - p.z] as [number, number])

  const definition: FloorDynamicMesh = {
    type: 'Floor',
    vertices: normalizedVertices,
    materialId: null,
    smooth: FLOOR_DEFAULT_SMOOTH,
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

    const previewVertices = getPreviewVertices(session.points, session.previewEnd)
    if (previewVertices.length < 3) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
      return
    }

    const nextSignature = computeFloorPreviewSignature(previewVertices)
    if (nextSignature === signature) {
      return
    }

    const center = computePreviewCenter(session.points)
    if (!center) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
      return
    }

    const build = buildFloorPreviewDefinition(previewVertices, center)
    if (!build) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
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
