import * as THREE from 'three'
import type { FloorDynamicMesh } from '@schema'
import { createFloorGroup, updateFloorGroup } from '@schema/floorMesh'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import type { FloorPresetData } from '@/utils/floorPreset'
import { buildFloorDynamicMeshPresetPatch } from '@/utils/floorPresetNodeMaterials'
import { buildRotatedRectangleFromCorner } from './rotatedRectangleBuild'

export type FloorPreviewSession = {
  shape: FloorBuildShape
  points: THREE.Vector3[]
  previewEnd: THREE.Vector3 | null
  rectangleDirection: THREE.Vector3 | null
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
const FLOOR_CIRCLE_PREVIEW_SEGMENTS = 32
const FLOOR_LINE_PREVIEW_Y_OFFSET = 0.02

function normalizeRegularPolygonSides(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  const rounded = Math.round(value)
  const clamped = Math.min(256, Math.max(0, rounded))
  return clamped >= 3 ? clamped : 0
}

function encodePreviewNumber(value: number): string {
  return `${Math.round(value * FLOOR_PREVIEW_SIGNATURE_PRECISION)}`
}

function buildRectanglePreviewPoints(
  first: THREE.Vector3,
  second: THREE.Vector3,
  rectangleDirection: THREE.Vector3 | null,
): THREE.Vector3[] {
  const rectangle = buildRotatedRectangleFromCorner(first, second, rectangleDirection)
  return rectangle ? rectangle.corners.map((point) => point.clone()) : []
}

export function buildFloorCircleOrRegularPolygonPoints(
  center: THREE.Vector3,
  previewEnd: THREE.Vector3,
  regularPolygonSides = 0,
): THREE.Vector3[] {
  const dx = previewEnd.x - center.x
  const dz = previewEnd.z - center.z
  const radius = Math.hypot(dx, dz)
  if (!Number.isFinite(radius) || radius <= 1e-6) {
    return []
  }

  const out: THREE.Vector3[] = []
  const resolvedSides = normalizeRegularPolygonSides(regularPolygonSides)
  const segments = resolvedSides >= 3
    ? resolvedSides
    : Math.max(8, Math.floor(FLOOR_CIRCLE_PREVIEW_SEGMENTS))
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2
    out.push(new THREE.Vector3(center.x + Math.cos(t) * radius, center.y, center.z + Math.sin(t) * radius))
  }
  return out
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
  shape: FloorBuildShape,
  points: THREE.Vector3[],
  previewEnd: THREE.Vector3 | null,
  rectangleDirection: THREE.Vector3 | null,
  regularPolygonSides = 0,
): THREE.Vector3[] {
  if (!points.length) {
    return []
  }

  if (shape === 'rectangle' && previewEnd) {
    const start = points[0]
    if (start) {
      return buildRectanglePreviewPoints(start, previewEnd, rectangleDirection)
    }
  }

  if (shape === 'circle' && previewEnd) {
    const center = points[0]
    if (center) {
      return buildFloorCircleOrRegularPolygonPoints(center, previewEnd, regularPolygonSides)
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
      const rectangle = buildRectanglePreviewPoints(first, second, rectangleDirection)
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

  const firstPoint = points[0]
  const baseY = firstPoint && Number.isFinite(firstPoint.y) ? firstPoint.y : 0

  return new THREE.Vector3((minX + maxX) * 0.5, baseY, (minZ + maxZ) * 0.5)
}

function computeFloorPreviewSignature(vertices: THREE.Vector3[]): string {
  if (!vertices.length) {
    return 'empty'
  }

  return vertices
    .map((p) => [encodePreviewNumber(p.x), encodePreviewNumber(p.y), encodePreviewNumber(p.z)].join(','))
    .join(';')
}

function disposeFloorPreviewGroup(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    const line = child as THREE.Line
    if (!mesh?.isMesh && !line?.isLine) {
      return
    }
    ;(child as THREE.Mesh | THREE.Line).geometry?.dispose?.()
    const mat = (child as THREE.Mesh | THREE.Line).material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) {
      mat.forEach((entry) => entry?.dispose?.())
    } else {
      mat?.dispose?.()
    }
  })
}

function createFloorLinePreviewGroup(points: THREE.Vector3[]): THREE.Group {
  const group = new THREE.Group()
  group.name = '__FloorLinePreview'
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: 0xffb74d,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  )
  line.renderOrder = 101
  group.userData.isFloorLinePreview = true
  group.userData.line = line
  group.add(line)
  return group
}

function updateFloorLinePreviewGroup(group: THREE.Group, points: THREE.Vector3[]): void {
  const line = group.userData.line as THREE.Line | undefined
  if (!line) {
    return
  }
  line.geometry?.dispose?.()
  line.geometry = new THREE.BufferGeometry().setFromPoints(points)
}

function computePresetSignature(preset: FloorPresetData | null | undefined): string {
  if (!preset) {
    return 'default'
  }
  return JSON.stringify({
    materialConfig: preset.materialConfig,
    floorProps: preset.floorProps,
    materialOrder: preset.materialOrder,
  })
}

function buildFloorPreviewDefinition(
  vertices: THREE.Vector3[],
  center: THREE.Vector3,
  presetData: FloorPresetData | null | undefined,
): {
  center: THREE.Vector3
  definition: FloorDynamicMesh
} | null {
  if (vertices.length < 3) {
    return null
  }

  // Local Z should preserve world Z (we no longer rotate/flip floor geometry).
  const normalizedVertices = vertices.map((p) => [p.x - center.x, p.z - center.z] as [number, number])

  const presetMeshPatch = buildFloorDynamicMeshPresetPatch(presetData)
  const definition: FloorDynamicMesh = {
    type: 'Floor',
    vertices: normalizedVertices,
    topBottomMaterialConfigId: presetMeshPatch?.topBottomMaterialConfigId ?? null,
    sideMaterialConfigId: presetMeshPatch?.sideMaterialConfigId ?? null,
    smooth: presetMeshPatch?.smooth ?? 0,
    thickness: presetMeshPatch?.thickness ?? 0,
    sideUvScale: presetMeshPatch?.sideUvScale ?? { x: 1, y: 1 },
  }

  return { center, definition }
}

export function createFloorPreviewRenderer(options: {
  rootGroup: THREE.Group
  getRegularPolygonSides?: () => number
  getPreviewPresetData?: () => FloorPresetData | null
  getPreviewSignature?: () => string
  applyPreviewMaterials?: (group: THREE.Group, presetData: FloorPresetData | null) => void
}): FloorPreviewRenderer {
  const resolvePreviewSignature = (): string => {
    const custom = options.getPreviewSignature?.()
    if (typeof custom === 'string') {
      return custom
    }
    return computePresetSignature(options.getPreviewPresetData?.() ?? null)
  }

  let needsSync = false
  let signature: string | null = null
  let lastRegularPolygonSides = normalizeRegularPolygonSides(options.getRegularPolygonSides?.() ?? 0)
  let lastPresetSignature = resolvePreviewSignature()

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
    lastRegularPolygonSides = normalizeRegularPolygonSides(options.getRegularPolygonSides?.() ?? 0)
    const presetData = options.getPreviewPresetData?.() ?? null
    lastPresetSignature = resolvePreviewSignature()

    if (!scene || !session) {
      if (signature !== null) {
        clear(session)
        signature = null
      }
      return
    }

    const previewVertices = getPreviewVertices(
      session.shape,
      session.points,
      session.previewEnd,
      session.rectangleDirection,
      lastRegularPolygonSides,
    )
    if (previewVertices.length < 2) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
      return
    }

    const geometrySignature = computeFloorPreviewSignature(previewVertices)
    const nextSignature = `${geometrySignature}|${lastPresetSignature}`
    if (nextSignature === signature) {
      return
    }

    const linePoints = previewVertices.map((point) => new THREE.Vector3(point.x, point.y + FLOOR_LINE_PREVIEW_Y_OFFSET, point.z))
    if (previewVertices.length < 3) {
      if (!session.previewGroup || session.previewGroup.userData?.isFloorLinePreview !== true) {
        clear(session)
        session.previewGroup = createFloorLinePreviewGroup(linePoints)
        options.rootGroup.add(session.previewGroup)
      } else {
        updateFloorLinePreviewGroup(session.previewGroup, linePoints)
      }
      signature = nextSignature
      return
    }

    const centerSource = session.shape === 'polygon' ? session.points : previewVertices
    const center = computePreviewCenter(centerSource)
    if (!center) {
      if (session.previewGroup) {
        clear(session)
      }
      signature = null
      return
    }

    const build = buildFloorPreviewDefinition(previewVertices, center, presetData)
    if (!build) {
      if (!session.previewGroup || session.previewGroup.userData?.isFloorLinePreview !== true) {
        clear(session)
        session.previewGroup = createFloorLinePreviewGroup(linePoints)
        options.rootGroup.add(session.previewGroup)
      } else {
        updateFloorLinePreviewGroup(session.previewGroup, linePoints)
      }
      signature = nextSignature
      return
    }

    if (!session.previewGroup || session.previewGroup.userData?.isFloorLinePreview === true) {
      clear(session)
      const preview = createFloorGroup(build.definition)
      preview.userData.isFloorPreview = true
      session.previewGroup = preview
      options.rootGroup.add(preview)
    } else {
      updateFloorGroup(session.previewGroup, build.definition)
      if (!options.rootGroup.children.includes(session.previewGroup)) {
        options.rootGroup.add(session.previewGroup)
      }
    }

    options.applyPreviewMaterials?.(session.previewGroup!, presetData)

    session.previewGroup!.position.copy(build.center)
    session.previewGroup!.position.y += FLOOR_PREVIEW_Y_OFFSET
    signature = nextSignature
  }

  return {
    markDirty: () => {
      needsSync = true
    },
    flushIfNeeded: (scene: THREE.Scene | null, session: FloorPreviewSession | null) => {
      const currentRegularPolygonSides = normalizeRegularPolygonSides(options.getRegularPolygonSides?.() ?? 0)
      const currentPresetSignature = resolvePreviewSignature()
      if (currentRegularPolygonSides !== lastRegularPolygonSides) {
        needsSync = true
      }
      if (currentPresetSignature !== lastPresetSignature) {
        needsSync = true
      }
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
      lastRegularPolygonSides = normalizeRegularPolygonSides(options.getRegularPolygonSides?.() ?? 0)
      lastPresetSignature = resolvePreviewSignature()
    },
    dispose: (session: FloorPreviewSession | null) => {
      clear(session)
      needsSync = false
      signature = null
      lastRegularPolygonSides = normalizeRegularPolygonSides(options.getRegularPolygonSides?.() ?? 0)
      lastPresetSignature = resolvePreviewSignature()
    },
  }
}
