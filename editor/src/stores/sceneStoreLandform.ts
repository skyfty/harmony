import { Shape, ShapeGeometry, Vector2, Vector3 } from 'three'
import type { GroundDynamicMesh, LandformDynamicMesh, SceneNode, Vector3Like, Vector2Like } from '@schema'
import { sampleGroundHeight } from '@schema/groundMesh'
import {
  clampLandformComponentProps,
  LANDFORM_DEFAULT_FEATHER,
  LANDFORM_DEFAULT_UV_SCALE,
  type LandformComponentProps,
} from '@schema/components'
import type { Object3D } from 'three'
import type { SceneMaterialProps, SceneNodeMaterial } from '@/types/material'

export type SceneStoreLandformHelpersDeps = {
  createLandformNodeMaterials: (options: { surfaceName: string }) => SceneNodeMaterial[]
  createNodeMaterial: (
    materialId: string | null,
    props: SceneMaterialProps,
    options: { id?: string; name?: string; type?: any },
  ) => SceneNodeMaterial
  getRuntimeObject: (id: string) => Object3D | null
  updateLandformGroup: (runtime: Object3D, mesh: LandformDynamicMesh) => void
}

type GroundTransform = {
  position: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
}

function buildWorldPoints(points: Vector3Like[]): Vector3[] {
  const out: Vector3[] = []
  points.forEach((point) => {
    if (!point) {
      return
    }
    const x = Number(point.x)
    const y = Number(point.y)
    const z = Number(point.z)
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return
    }
    const next = new Vector3(x, Number.isFinite(y) ? y : 0, z)
    const previous = out[out.length - 1]
    if (previous && previous.distanceToSquared(next) <= 1e-10) {
      return
    }
    out.push(next)
  })
  if (out.length >= 3) {
    const first = out[0]!
    const last = out[out.length - 1]!
    if (Math.abs(first.x - last.x) <= 1e-10 && Math.abs(first.z - last.z) <= 1e-10) {
      out.pop()
    }
  }
  return out
}

function computeCenter(points: Vector3[]): Vector3 {
  const min = new Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY)
  const max = new Vector3(Number.NEGATIVE_INFINITY, 0, Number.NEGATIVE_INFINITY)
  points.forEach((point) => {
    min.x = Math.min(min.x, point.x)
    min.z = Math.min(min.z, point.z)
    max.x = Math.max(max.x, point.x)
    max.z = Math.max(max.z, point.z)
  })
  const baseY = points[0] && Number.isFinite(points[0].y) ? points[0].y : 0
  return new Vector3((min.x + max.x) * 0.5, baseY, (min.z + max.z) * 0.5)
}

function getGroundTransform(groundNode: SceneNode | null): GroundTransform {
  const position = groundNode?.position ?? { x: 0, y: 0, z: 0 }
  const scaleLike = groundNode?.scale ?? { x: 1, y: 1, z: 1 }
  return {
    position: {
      x: Number.isFinite(position.x) ? position.x : 0,
      y: Number.isFinite(position.y) ? position.y : 0,
      z: Number.isFinite(position.z) ? position.z : 0,
    },
    scale: {
      x: Number.isFinite(scaleLike.x) && Math.abs(scaleLike.x) > 1e-6 ? scaleLike.x : 1,
      y: Number.isFinite(scaleLike.y) && Math.abs(scaleLike.y) > 1e-6 ? scaleLike.y : 1,
      z: Number.isFinite(scaleLike.z) && Math.abs(scaleLike.z) > 1e-6 ? scaleLike.z : 1,
    },
  }
}

function worldToGroundLocal(point: Vector3, transform: GroundTransform): Vector3 {
  return new Vector3(
    (point.x - transform.position.x) / transform.scale.x,
    (point.y - transform.position.y) / transform.scale.y,
    (point.z - transform.position.z) / transform.scale.z,
  )
}

function groundLocalToWorld(point: Vector3, transform: GroundTransform): Vector3 {
  return new Vector3(
    transform.position.x + point.x * transform.scale.x,
    transform.position.y + point.y * transform.scale.y,
    transform.position.z + point.z * transform.scale.z,
  )
}

function computeSignedAreaXZ(points: Vector3[]): number {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    area += current.x * next.z - next.x * current.z
  }
  return area * 0.5
}

function normalizePolygonWinding(points: Vector3[]): Vector3[] {
  if (points.length < 3) {
    return points
  }
  const area = computeSignedAreaXZ(points)
  if (Number.isFinite(area) && area < 0) {
    return [...points].reverse()
  }
  return points
}

function buildShapeTriangulation(points: Vector3[]): { vertices: Vector2[]; indices: number[] } | null {
  if (points.length < 3) {
    return null
  }

  const contour = points.map((point) => new Vector2(point.x, point.z))
  const shape = new Shape(contour)
  const geometry = new ShapeGeometry(shape)
  const position = geometry.getAttribute('position')
  if (!position || position.count < 3) {
    geometry.dispose()
    return null
  }

  const vertices: Vector2[] = []
  for (let index = 0; index < position.count; index += 1) {
    vertices.push(new Vector2(position.getX(index), position.getY(index)))
  }

  const indexAttribute = geometry.getIndex()
  const indices: number[] = []
  if (indexAttribute && indexAttribute.count >= 3) {
    for (let index = 0; index < indexAttribute.count; index += 1) {
      indices.push(indexAttribute.getX(index))
    }
  } else {
    for (let index = 0; index < position.count; index += 1) {
      indices.push(index)
    }
  }

  geometry.dispose()
  if (indices.length < 3) {
    return null
  }

  return { vertices, indices }
}

function isPointInsidePolygon2D(pointX: number, pointZ: number, polygon: Vector3[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!
    const b = polygon[j]!
    const intersects = ((a.z > pointZ) !== (b.z > pointZ))
      && (pointX < ((b.x - a.x) * (pointZ - a.z)) / ((b.z - a.z) || 1e-12) + a.x)
    if (intersects) {
      inside = !inside
    }
  }
  return inside
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

function pointToSegmentDistance2D(
  pointX: number,
  pointZ: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const abX = endX - startX
  const abZ = endZ - startZ
  const apX = pointX - startX
  const apZ = pointZ - startZ
  const abLengthSq = abX * abX + abZ * abZ
  if (abLengthSq <= 1e-12) {
    return Math.hypot(apX, apZ)
  }
  const projection = clamp01((apX * abX + apZ * abZ) / abLengthSq)
  const closestX = startX + abX * projection
  const closestZ = startZ + abZ * projection
  return Math.hypot(pointX - closestX, pointZ - closestZ)
}

function distanceToFootprintBoundary(pointX: number, pointZ: number, footprint: Array<[number, number]>): number {
  if (footprint.length < 2) {
    return 0
  }
  let minDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < footprint.length; index += 1) {
    const a = footprint[index]!
    const b = footprint[(index + 1) % footprint.length]!
    const distance = pointToSegmentDistance2D(pointX, pointZ, a[0], a[1], b[0], b[1])
    if (distance < minDistance) {
      minDistance = distance
    }
  }
  return Number.isFinite(minDistance) ? minDistance : 0
}

function buildLandformSurfaceFeather(
  footprint: Array<[number, number]>,
  surfaceVertices: Array<{ x: number; z: number }>,
  featherWidth: number,
): number[] {
  const normalizedWidth = Number.isFinite(featherWidth) ? Math.max(0, featherWidth) : 0
  if (normalizedWidth <= 1e-6 || footprint.length < 3 || !surfaceVertices.length) {
    return surfaceVertices.map(() => 1)
  }

  return surfaceVertices.map((vertex) => {
    const distance = distanceToFootprintBoundary(vertex.x, vertex.z, footprint)
    const t = clamp01(distance / normalizedWidth)
    // smoothstep for a softer, more natural transition.
    return t * t * (3 - 2 * t)
  })
}

export function createSceneStoreLandformHelpers(deps: SceneStoreLandformHelpersDeps) {
  return {
    ensureLandformMaterialConvention(node: SceneNode): { materialsChanged: boolean; meshChanged: boolean } {
      if (node.dynamicMesh?.type !== 'Landform') {
        return { materialsChanged: false, meshChanged: false }
      }

      const currentMaterials = Array.isArray(node.materials) ? node.materials : []
      let nextMaterials = currentMaterials
      if (!currentMaterials.length) {
        nextMaterials = deps.createLandformNodeMaterials({ surfaceName: 'Surface' })
      }

      const materialsChanged = nextMaterials !== currentMaterials
      if (materialsChanged) {
        node.materials = nextMaterials as any
      }

      const normalizeId = (value: unknown) => (typeof value === 'string' && value.trim().length ? value.trim() : null)
      const materialIds = (nextMaterials as any[]).map((entry) => entry.id)
      const fallbackId = (nextMaterials as any[])[0]?.id ?? null
      let materialConfigId = normalizeId((node.dynamicMesh as any).materialConfigId) ?? fallbackId
      if (materialConfigId && !materialIds.includes(materialConfigId)) {
        materialConfigId = fallbackId
      }

      const mesh = node.dynamicMesh as LandformDynamicMesh
      const footprint = Array.isArray(mesh.footprint)
        ? mesh.footprint
          .map((entry) => [Number(entry?.[0]), Number(entry?.[1])] as [number, number])
          .filter((entry) => Number.isFinite(entry[0]) && Number.isFinite(entry[1]))
        : []
      const surfaceVertices = Array.isArray(mesh.surfaceVertices)
        ? mesh.surfaceVertices
          .map((entry) => ({ x: Number(entry?.x), z: Number(entry?.z) }))
          .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.z))
        : []
      const expectedFeather = buildLandformSurfaceFeather(footprint, surfaceVertices, Number(mesh.feather))
      const currentFeather = Array.isArray(mesh.surfaceFeather) ? mesh.surfaceFeather : []
      const featherNeedsSync = expectedFeather.length !== currentFeather.length
        || expectedFeather.some((value, index) => Math.abs(value - Number(currentFeather[index])) > 1e-5)

      const meshChanged = mesh.materialConfigId !== materialConfigId || featherNeedsSync
      if (meshChanged) {
        node.dynamicMesh = {
          ...mesh,
          materialConfigId,
          surfaceFeather: expectedFeather,
        }
      }

      return { materialsChanged, meshChanged }
    },

    buildLandformDynamicMeshFromWorldPoints(
      points: Vector3Like[],
      groundDefinition: GroundDynamicMesh | null,
      groundNode: SceneNode | null,
      options: Partial<LandformComponentProps> = {},
    ): { center: Vector3; definition: LandformDynamicMesh } | null {
      const worldPoints = normalizePolygonWinding(buildWorldPoints(points))
      if (worldPoints.length < 3) {
        return null
      }

      const center = computeCenter(worldPoints)
      const normalizedProps = clampLandformComponentProps(options)
      const footprint = worldPoints.map((point) => [point.x - center.x, point.z - center.z] as [number, number])

      if (!groundDefinition) {
        const triangulation = buildShapeTriangulation(worldPoints)
        if (!triangulation) {
          return null
        }

        const yByKey = new Map<string, number>()
        worldPoints.forEach((point) => {
          yByKey.set(`${point.x.toFixed(6)},${point.z.toFixed(6)}`, point.y)
        })
        const surfaceWorldVertices = triangulation.vertices.map((vertex) => {
          const key = `${vertex.x.toFixed(6)},${vertex.y.toFixed(6)}`
          const y = yByKey.get(key)
          return new Vector3(vertex.x, Number.isFinite(y as number) ? (y as number) : center.y, vertex.y)
        })

        const surfaceVertices = surfaceWorldVertices.map((point) => ({ x: point.x - center.x, y: point.y - center.y, z: point.z - center.z }))
        const surfaceIndices = [...triangulation.indices]
        const surfaceUvs = surfaceWorldVertices.map((point) => ({
          x: (point.x - center.x) / normalizedProps.uvScale.x,
          y: (point.z - center.z) / normalizedProps.uvScale.y,
        }) satisfies Vector2Like)
        return {
          center,
          definition: {
            type: 'Landform',
            footprint,
            surfaceVertices,
            surfaceIndices,
            surfaceUvs,
            materialConfigId: null,
            feather: normalizedProps.feather,
            uvScale: { ...normalizedProps.uvScale },
            surfaceFeather: buildLandformSurfaceFeather(footprint, surfaceVertices, normalizedProps.feather),
          },
        }
      }

      const transform = getGroundTransform(groundNode)
      const polygonLocal = normalizePolygonWinding(worldPoints.map((point) => worldToGroundLocal(point, transform)))
      const halfWidth = groundDefinition.width * 0.5
      const halfDepth = groundDefinition.depth * 0.5
      const cellSize = Math.max(1e-6, groundDefinition.cellSize)
      const columns = Math.max(1, Math.trunc(groundDefinition.columns))
      const rows = Math.max(1, Math.trunc(groundDefinition.rows))

      const minX = Math.min(...polygonLocal.map((point) => point.x))
      const maxX = Math.max(...polygonLocal.map((point) => point.x))
      const minZ = Math.min(...polygonLocal.map((point) => point.z))
      const maxZ = Math.max(...polygonLocal.map((point) => point.z))

      const minColumn = Math.max(0, Math.min(columns - 1, Math.floor((minX + halfWidth) / cellSize)))
      const maxColumn = Math.max(0, Math.min(columns - 1, Math.ceil((maxX + halfWidth) / cellSize)))
      const minRow = Math.max(0, Math.min(rows - 1, Math.floor((minZ + halfDepth) / cellSize)))
      const maxRow = Math.max(0, Math.min(rows - 1, Math.ceil((maxZ + halfDepth) / cellSize)))

      const vertexIndexByKey = new Map<string, number>()
      const surfaceWorldVertices: Vector3[] = []
      const surfaceIndices: number[] = []

      const resolveVertexIndex = (localX: number, localZ: number): number => {
        const key = `${localX.toFixed(6)},${localZ.toFixed(6)}`
        const cached = vertexIndexByKey.get(key)
        if (cached !== undefined) {
          return cached
        }
        const localHeight = sampleGroundHeight(groundDefinition, localX, localZ)
        const world = groundLocalToWorld(new Vector3(localX, localHeight, localZ), transform)
        const index = surfaceWorldVertices.length
        surfaceWorldVertices.push(world)
        vertexIndexByKey.set(key, index)
        return index
      }

      const pushTriangleIfInside = (a: Vector3, b: Vector3, c: Vector3): void => {
        const centroidX = (a.x + b.x + c.x) / 3
        const centroidZ = (a.z + b.z + c.z) / 3
        if (!isPointInsidePolygon2D(centroidX, centroidZ, polygonLocal)) {
          return
        }
        surfaceIndices.push(resolveVertexIndex(a.x, a.z), resolveVertexIndex(b.x, b.z), resolveVertexIndex(c.x, c.z))
      }

      for (let row = minRow; row <= maxRow; row += 1) {
        const z0 = -halfDepth + row * cellSize
        const z1 = -halfDepth + (row + 1) * cellSize
        for (let column = minColumn; column <= maxColumn; column += 1) {
          const x0 = -halfWidth + column * cellSize
          const x1 = -halfWidth + (column + 1) * cellSize
          pushTriangleIfInside(new Vector3(x0, 0, z0), new Vector3(x1, 0, z0), new Vector3(x1, 0, z1))
          pushTriangleIfInside(new Vector3(x0, 0, z0), new Vector3(x1, 0, z1), new Vector3(x0, 0, z1))
        }
      }

      if (surfaceWorldVertices.length < 3 || surfaceIndices.length < 3) {
        return null
      }

      const surfaceVertices = surfaceWorldVertices.map((point) => ({
        x: point.x - center.x,
        y: point.y - center.y,
        z: point.z - center.z,
      }))
      const surfaceUvs = surfaceWorldVertices.map((point) => ({
        x: (point.x - center.x) / normalizedProps.uvScale.x,
        y: (point.z - center.z) / normalizedProps.uvScale.y,
      }) satisfies Vector2Like)

      return {
        center,
        definition: {
          type: 'Landform',
          footprint,
          surfaceVertices,
          surfaceIndices,
          surfaceUvs,
          surfaceFeather: buildLandformSurfaceFeather(footprint, surfaceVertices, normalizedProps.feather),
          materialConfigId: null,
          feather: normalizedProps.feather,
          uvScale: { ...normalizedProps.uvScale },
        },
      }
    },

    applyLandformComponentPropsToNode(node: SceneNode, props: LandformComponentProps): boolean {
      if (node.dynamicMesh?.type !== 'Landform') {
        return false
      }
      const normalized = clampLandformComponentProps(props)
      const mesh = node.dynamicMesh as LandformDynamicMesh
      const currentFeather = Number.isFinite(mesh.feather) ? Number(mesh.feather) : LANDFORM_DEFAULT_FEATHER
      const currentU = Number.isFinite(mesh.uvScale?.x) ? Number(mesh.uvScale?.x) : LANDFORM_DEFAULT_UV_SCALE.x
      const currentV = Number.isFinite(mesh.uvScale?.y) ? Number(mesh.uvScale?.y) : LANDFORM_DEFAULT_UV_SCALE.y
      const unchanged = Math.abs(currentFeather - normalized.feather) <= 1e-6
        && Math.abs(currentU - normalized.uvScale.x) <= 1e-6
        && Math.abs(currentV - normalized.uvScale.y) <= 1e-6
      if (unchanged) {
        return false
      }

      const nextMesh: LandformDynamicMesh = {
        ...mesh,
        feather: normalized.feather,
        uvScale: { x: normalized.uvScale.x, y: normalized.uvScale.y },
        surfaceFeather: buildLandformSurfaceFeather(
          Array.isArray(mesh.footprint)
            ? mesh.footprint
              .map((entry) => [Number(entry?.[0]), Number(entry?.[1])] as [number, number])
              .filter((entry) => Number.isFinite(entry[0]) && Number.isFinite(entry[1]))
            : [],
          Array.isArray(mesh.surfaceVertices)
            ? mesh.surfaceVertices
              .map((entry) => ({ x: Number(entry?.x), z: Number(entry?.z) }))
              .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.z))
            : [],
          normalized.feather,
        ),
      }
      node.dynamicMesh = nextMesh
      const runtime = deps.getRuntimeObject(node.id)
      if (runtime) {
        deps.updateLandformGroup(runtime, nextMesh)
      }
      return true
    },
  }
}