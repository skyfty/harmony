import * as THREE from 'three'
import {
  createWaterSurfaceBufferGeometryFromMetadata,
  normalizeWaterSurfaceMeshInput,
} from '@schema'
import type { WaterBuildShape } from '@/types/water-build-shape'

export type WaterPreviewSession = {
  shape: WaterBuildShape
  points: THREE.Vector3[]
  previewEnd: THREE.Vector3 | null
  previewGroup: THREE.Group | null
}

export type WaterPreviewRenderer = {
  markDirty: () => void
  flushIfNeeded: (scene: THREE.Scene | null, session: WaterPreviewSession | null) => void
  flush: (scene: THREE.Scene | null, session: WaterPreviewSession | null) => void
  clear: (session: WaterPreviewSession | null) => void
  reset: () => void
  dispose: (session: WaterPreviewSession | null) => void
}

const PREVIEW_SIGNATURE_PRECISION = 1000
const PREVIEW_Y_OFFSET = 0.02
const CIRCLE_SEGMENTS = 32

function encodePreviewNumber(value: number): string {
  return `${Math.round(value * PREVIEW_SIGNATURE_PRECISION)}`
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
    new THREE.Vector3(minX, first.y, minZ),
    new THREE.Vector3(minX, first.y, maxZ),
    new THREE.Vector3(maxX, first.y, maxZ),
    new THREE.Vector3(maxX, first.y, minZ),
  ]
}

function buildCirclePreviewPoints(center: THREE.Vector3, previewEnd: THREE.Vector3): THREE.Vector3[] {
  const dx = previewEnd.x - center.x
  const dz = previewEnd.z - center.z
  const radius = Math.hypot(dx, dz)
  if (!Number.isFinite(radius) || radius <= 1e-6) {
    return []
  }

  const out: THREE.Vector3[] = []
  for (let index = 0; index < CIRCLE_SEGMENTS; index += 1) {
    const t = (index / CIRCLE_SEGMENTS) * Math.PI * 2
    out.push(new THREE.Vector3(
      center.x + Math.cos(t) * radius,
      center.y,
      center.z + Math.sin(t) * radius,
    ))
  }
  return out
}

function computePolygonArea2D(vertices: THREE.Vector3[]): number {
  let area = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!
    const next = vertices[(index + 1) % vertices.length]!
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
  offsetPoint.y = first.y
  let triangle = [first.clone(), offsetPoint.clone(), previewEnd.clone()]
  if (computePolygonArea2D(triangle) < 0) {
    const flipped = previewEnd.clone().sub(perp)
    flipped.y = first.y
    triangle = [first.clone(), flipped, previewEnd.clone()]
  }
  return triangle
}

function getPreviewVertices(
  shape: WaterBuildShape,
  points: THREE.Vector3[],
  previewEnd: THREE.Vector3 | null,
): THREE.Vector3[] {
  if (!points.length) {
    return []
  }

  if (shape === 'rectangle' && previewEnd) {
    const start = points[0]
    if (start) {
      return buildRectanglePreviewPoints(start, previewEnd)
    }
  }

  if (shape === 'circle' && previewEnd) {
    const center = points[0]
    if (center) {
      return buildCirclePreviewPoints(center, previewEnd)
    }
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

  const combined = points.map((point) => point.clone())
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

  points.forEach((point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) {
      return
    }
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minZ = Math.min(minZ, point.z)
    maxZ = Math.max(maxZ, point.z)
  })

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return null
  }

  const baseY = points[0] && Number.isFinite(points[0].y) ? points[0].y : 0
  return new THREE.Vector3((minX + maxX) * 0.5, baseY, (minZ + maxZ) * 0.5)
}

function computePreviewSignature(vertices: THREE.Vector3[]): string {
  if (!vertices.length) {
    return 'empty'
  }

  return vertices
    .map((point) => [encodePreviewNumber(point.x), encodePreviewNumber(point.y), encodePreviewNumber(point.z)].join(','))
    .join(';')
}

function buildPreviewGeometry(vertices: THREE.Vector3[], center: THREE.Vector3): THREE.BufferGeometry | null {
  if (vertices.length < 3) {
    return null
  }

  try {
    const metadata = normalizeWaterSurfaceMeshInput({
      // Water runtime keeps a -PI/2 X rotation, so local contour Y must be the negated world Z offset.
      contour: vertices.flatMap((point) => [point.x - center.x, center.z - point.z]),
    })
    return createWaterSurfaceBufferGeometryFromMetadata(metadata)
  } catch {
    return null
  }
}

function createPreviewGroup(geometry: THREE.BufferGeometry): THREE.Group {
  const group = new THREE.Group()
  group.name = '__WaterPreview'

  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0x03a9f4,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  fill.renderOrder = 100

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({
      color: 0x81d4fa,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  )
  outline.renderOrder = 101

  group.userData.fill = fill
  group.userData.outline = outline
  group.add(fill)
  group.add(outline)
  return group
}

function updatePreviewGroupGeometry(group: THREE.Group, geometry: THREE.BufferGeometry): void {
  const fill = group.userData.fill as THREE.Mesh | undefined
  const outline = group.userData.outline as THREE.LineSegments | undefined
  if (!fill || !outline) {
    return
  }

  fill.geometry?.dispose?.()
  fill.geometry = geometry

  outline.geometry?.dispose?.()
  outline.geometry = new THREE.EdgesGeometry(geometry)
}

function disposePreviewGroup(group: THREE.Group): void {
  const fill = group.userData.fill as THREE.Mesh | undefined
  const outline = group.userData.outline as THREE.LineSegments | undefined

  fill?.geometry?.dispose?.()
  outline?.geometry?.dispose?.()

  const fillMaterial = fill?.material as THREE.Material | THREE.Material[] | undefined
  if (Array.isArray(fillMaterial)) {
    fillMaterial.forEach((material) => material?.dispose?.())
  } else {
    fillMaterial?.dispose?.()
  }

  const outlineMaterial = outline?.material as THREE.Material | THREE.Material[] | undefined
  if (Array.isArray(outlineMaterial)) {
    outlineMaterial.forEach((material) => material?.dispose?.())
  } else {
    outlineMaterial?.dispose?.()
  }
}

export function createWaterPreviewRenderer(options: { rootGroup: THREE.Group }): WaterPreviewRenderer {
  let needsSync = false
  let signature: string | null = null

  const clear = (session: WaterPreviewSession | null) => {
    if (session?.previewGroup) {
      const preview = session.previewGroup
      preview.removeFromParent()
      disposePreviewGroup(preview)
      session.previewGroup = null
    }
    signature = null
  }

  const flush = (scene: THREE.Scene | null, session: WaterPreviewSession | null) => {
    needsSync = false

    if (!scene || !session) {
      clear(session)
      return
    }

    const previewVertices = getPreviewVertices(session.shape, session.points, session.previewEnd)
    if (previewVertices.length < 3) {
      clear(session)
      return
    }

    const nextSignature = computePreviewSignature(previewVertices)
    if (nextSignature === signature) {
      return
    }

    const centerSource = session.shape === 'polygon' ? session.points : previewVertices
    const center = computePreviewCenter(centerSource)
    if (!center) {
      clear(session)
      return
    }

    const geometry = buildPreviewGeometry(previewVertices, center)
    if (!geometry) {
      clear(session)
      return
    }

    signature = nextSignature

    if (!session.previewGroup) {
      session.previewGroup = createPreviewGroup(geometry)
      options.rootGroup.add(session.previewGroup)
    } else {
      updatePreviewGroupGeometry(session.previewGroup, geometry)
      if (!options.rootGroup.children.includes(session.previewGroup)) {
        options.rootGroup.add(session.previewGroup)
      }
    }

    session.previewGroup.position.copy(center)
    session.previewGroup.position.y += PREVIEW_Y_OFFSET
    session.previewGroup.rotation.set(-Math.PI / 2, 0, 0)
  }

  return {
    markDirty: () => {
      needsSync = true
    },
    flushIfNeeded: (scene, session) => {
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
    dispose: (session) => {
      clear(session)
      needsSync = false
      signature = null
    },
  }
}
