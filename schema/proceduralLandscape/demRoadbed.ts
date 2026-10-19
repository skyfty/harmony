import * as THREE from 'three'
import type { RoadBandRow } from './roadBandRows'
import type { RoadProximityIndex } from './roadProximity'
import { smoothstep } from './noise'

export interface DemRoadbedTargetOptions {
  roadField: RoadProximityIndex
  rawHeightAt(x: number, z: number): number | null
  halfWidth: number
  shoulderWidth: number
  demCellSize: number
  sideWidth?: number
  coverageWidth?: number
  roadDrop?: number
  coarseClearance?: number
}

/**
 * DEM cut/fill design surface. The carriageway and shoulder share one
 * centerline height per row; the outer slope returns to the raw DEM surface.
 */
export interface DemRoadbedTarget {
  readonly halfWidth: number
  readonly shoulderWidth: number
  readonly sideWidth: number
  readonly outerHalfWidth: number
  readonly meshHalfWidth: number
  readonly influenceHalfWidth: number
  readonly coarseClearance: number
  distanceAt(x: number, z: number): number
  roadProximityAt(x: number, z: number): number
  heightAt(x: number, z: number): number
  coarseHeightAt(x: number, z: number): number
  rawHeightAt(x: number, z: number): number
  rawNormalAt(x: number, z: number): { x: number; y: number; z: number }
}

export function createDemRoadbedTarget(options: DemRoadbedTargetOptions): DemRoadbedTarget {
  const halfWidth = Math.max(0.5, options.halfWidth)
  const shoulderWidth = Math.max(0, options.shoulderWidth)
  const innerHalfWidth = halfWidth + shoulderWidth
  const sideWidth = Math.max(1, options.sideWidth ?? Math.max(30, options.demCellSize * 1.5))
  const coverageWidth = Math.max(0, options.coverageWidth ?? options.demCellSize * 0.5)
  const outerHalfWidth = innerHalfWidth + sideWidth
  const meshHalfWidth = outerHalfWidth + coverageWidth
  const roadDrop = Math.max(0, options.roadDrop ?? 0.05)
  const coarseClearance = Math.max(0, options.coarseClearance ?? 0.1)
  const rawAt = (x: number, z: number): number => options.rawHeightAt(x, z) ?? 0

  const heightAt = (x: number, z: number): number => {
    const terrainY = rawAt(x, z)
    const distance = options.roadField.distanceAt(x, z)
    const designY = options.roadField.heightAt(x, z)
    if (designY == null || distance > meshHalfWidth) {
      return terrainY
    }
    if (distance <= innerHalfWidth) {
      return designY - roadDrop
    }
    if (distance >= outerHalfWidth) {
      return terrainY
    }
    const t = smoothstep(innerHalfWidth, outerHalfWidth, distance)
    return (designY - roadDrop) + (terrainY - (designY - roadDrop)) * t
  }

  return {
    halfWidth,
    shoulderWidth,
    sideWidth,
    outerHalfWidth,
    meshHalfWidth,
    influenceHalfWidth: meshHalfWidth,
    coarseClearance,
    distanceAt: (x, z) => options.roadField.distanceAt(x, z),
    roadProximityAt: (x, z) => options.roadField.distanceAt(x, z) - halfWidth,
    heightAt,
    coarseHeightAt(x: number, z: number): number {
      const distance = options.roadField.distanceAt(x, z)
      const target = heightAt(x, z)
      if (distance >= meshHalfWidth) {
        return rawAt(x, z)
      }
      const fade = 1 - smoothstep(outerHalfWidth, meshHalfWidth, distance)
      return target - coarseClearance * fade
    },
    rawHeightAt: rawAt,
    rawNormalAt(x: number, z: number): { x: number; y: number; z: number } {
      const step = Math.max(0.75, options.demCellSize * 0.05)
      const dx = (rawAt(x + step, z) - rawAt(x - step, z)) / (2 * step)
      const dz = (rawAt(x, z + step) - rawAt(x, z - step)) / (2 * step)
      const inverseLength = 1 / Math.hypot(dx, 1, dz)
      return { x: -dx * inverseLength, y: inverseLength, z: -dz * inverseLength }
    },
  }
}

export interface DemRoadbedGeometryOptions {
  rows: ReadonlyArray<RoadBandRow>
  halfWidth: number
  shoulderWidth: number
  /** Horizontal width of the cut/fill slope on each side. */
  sideWidth: number
  /** Extra ring outside the slope so the mesh tucks under the coarse terrain. */
  coverageWidth: number
  /** Roadbed height relative to the design road height (negative = below road). */
  roadDrop: number
  /** Outer coverage ring drop below the raw terrain, hides the seam. */
  edgeDrop: number
  lateralStep: number
  rawHeightAt: (x: number, z: number) => number | null
  hostInverse: THREE.Matrix4
}

export interface DemRoadbedGeometryResult {
  geometry: THREE.BufferGeometry
  innerHalfWidth: number
  outerHalfWidth: number
  meshHalfWidth: number
  vertexCount: number
  triangleCount: number
}

export interface DemRoadbedTargetGeometryResult extends DemRoadbedGeometryResult {
  maxCutFill: number
  outerError: number
}

/**
 * High-resolution DEM roadbed side ribbons whose outer edge is exactly the raw
 * terrain. The asphalt width is intentionally left open: the road band owns
 * that surface, so a cut/fill apron can never be rendered above the asphalt.
 * The extra attributes keep the gravel/rock palette continuous with the
 * adjacent coarse terrain.
 */
export function createDemRoadbedTargetGeometry(
  rows: ReadonlyArray<RoadBandRow>,
  target: DemRoadbedTarget,
  options: {
    lateralStep?: number
    rowSpacing?: number
    lift?: number
    /** Extend the apron inward under the asphalt to seal the edge seam. */
    asphaltOverlap?: number
    hostInverse: THREE.Matrix4
  },
): DemRoadbedTargetGeometryResult | null {
  if (rows.length < 2) {
    return null
  }
  const lateralStep = Math.max(1, options.lateralStep ?? 3)
  const lift = options.lift ?? 0.01
  const baseRowSpacing = Math.max(0.1, Math.hypot(
    rows[1]!.x - rows[0]!.x,
    rows[1]!.z - rows[0]!.z,
  ))
  const rowStride = options.rowSpacing
    ? Math.max(1, Math.round(options.rowSpacing / baseRowSpacing))
    : 1
  const selectedRows: RoadBandRow[] = []
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += rowStride) {
    selectedRows.push(rows[rowIndex]!)
  }
  if (selectedRows[selectedRows.length - 1] !== rows[rows.length - 1]) {
    selectedRows.push(rows[rows.length - 1]!)
  }
  const halfWidth = target.meshHalfWidth
  const asphaltOverlap = Math.max(0, options.asphaltOverlap ?? 0.5)
  const asphaltHalfWidth = Math.max(
    0,
    Math.min(halfWidth, target.halfWidth - asphaltOverlap),
  )
  const sideSpan = Math.max(0.001, halfWidth - asphaltHalfWidth)
  const columns = Math.max(2, Math.ceil(sideSpan / lateralStep) + 1)
  const stripCount = 2
  const verticesPerStrip = selectedRows.length * columns
  const vertexCount = verticesPerStrip * stripCount
  const triangleCount = (selectedRows.length - 1) * (columns - 1) * 2 * stripCount
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const baseHeights = new Float32Array(vertexCount)
  const baseNormals = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array(triangleCount * 3)
  const point = new THREE.Vector3()
  let maxCutFill = 0
  let outerError = 0

  const crossSpacing = sideSpan / (columns - 1)
  const rowSpan = Math.max(0.5, Math.hypot(
    selectedRows[1]!.x - selectedRows[0]!.x,
    selectedRows[1]!.z - selectedRows[0]!.z,
  ))
  let cursor = 0

  for (let strip = 0; strip < stripCount; strip += 1) {
    const side = strip === 0 ? -1 : 1
    const vertexBase = strip * verticesPerStrip

    for (let rowIndex = 0; rowIndex < selectedRows.length; rowIndex += 1) {
      const row = selectedRows[rowIndex]!
      const normalX = -Math.sin(row.heading)
      const normalZ = Math.cos(row.heading)
      for (let column = 0; column < columns; column += 1) {
        const t = column / (columns - 1)
        const lateral = side * (asphaltHalfWidth + t * sideSpan)
        const x = row.x + normalX * lateral
        const z = row.z + normalZ * lateral
        const index = vertexBase + rowIndex * columns + column
        const rawY = target.rawHeightAt(x, z)
        const y = column === columns - 1
          ? rawY
          : target.heightAt(x, z)
        maxCutFill = Math.max(maxCutFill, Math.abs(y - rawY))
        baseHeights[index] = rawY
        if (column === columns - 1) {
          outerError = Math.max(outerError, Math.abs(y - rawY))
        }
        const baseNormal = target.rawNormalAt(x, z)
        baseNormals[index * 3] = baseNormal.x
        baseNormals[index * 3 + 1] = baseNormal.y
        baseNormals[index * 3 + 2] = baseNormal.z
        point.set(x, y + lift, z).applyMatrix4(options.hostInverse)
        positions[index * 3] = point.x
        positions[index * 3 + 1] = point.y
        positions[index * 3 + 2] = point.z
      }
    }

    for (let rowIndex = 0; rowIndex < selectedRows.length; rowIndex += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = vertexBase + rowIndex * columns + column
        const leftIndex = vertexBase + rowIndex * columns + Math.max(0, column - 1)
        const rightIndex = vertexBase + rowIndex * columns + Math.min(columns - 1, column + 1)
        const upIndex = vertexBase + Math.max(0, rowIndex - 1) * columns + column
        const downIndex = vertexBase + Math.min(selectedRows.length - 1, rowIndex + 1) * columns + column
        const dx = (positions[rightIndex * 3 + 1]! - positions[leftIndex * 3 + 1]!)
          / Math.max(1e-4, crossSpacing * 2)
        const dz = (positions[downIndex * 3 + 1]! - positions[upIndex * 3 + 1]!)
          / Math.max(1e-4, rowSpan * 2)
        const inverseLength = 1 / Math.hypot(dx, 1, dz)
        normals[index * 3] = -dx * inverseLength
        normals[index * 3 + 1] = inverseLength
        normals[index * 3 + 2] = -dz * inverseLength
      }
    }

    for (let rowIndex = 0; rowIndex < selectedRows.length - 1; rowIndex += 1) {
      for (let column = 0; column < columns - 1; column += 1) {
        const a = vertexBase + rowIndex * columns + column
        const b = a + 1
        const c = a + columns
        const d = c + 1
        if (side < 0) {
          indices[cursor++] = a
          indices[cursor++] = c
          indices[cursor++] = d
          indices[cursor++] = a
          indices[cursor++] = d
          indices[cursor++] = b
        } else {
          indices[cursor++] = a
          indices[cursor++] = d
          indices[cursor++] = c
          indices[cursor++] = a
          indices[cursor++] = b
          indices[cursor++] = d
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('aBaseHeight', new THREE.BufferAttribute(baseHeights, 1))
  geometry.setAttribute('aBaseNormal', new THREE.BufferAttribute(baseNormals, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return {
    geometry,
    innerHalfWidth: target.halfWidth + target.shoulderWidth,
    outerHalfWidth: target.outerHalfWidth,
    meshHalfWidth: target.meshHalfWidth,
    vertexCount,
    triangleCount,
    maxCutFill,
    outerError,
  }
}

/**
 * High-resolution cut/fill roadbed for DEM terrain.
 *
 * The coarse DEM triangle can rise several meters between its 30m vertices.
 * Hiding the road under a shader-flattened coarse surface is not reliable, so
 * this mesh spans the asphalt/shoulder, a smooth side slope and a small
 * coverage ring, and meets the raw terrain at its outer edge.
 */
export function createDemRoadbedGeometry(
  options: DemRoadbedGeometryOptions,
): DemRoadbedGeometryResult | null {
  const rows = options.rows
  if (rows.length < 2) {
    return null
  }
  const innerHalfWidth = Math.max(0, options.halfWidth + options.shoulderWidth)
  const outerHalfWidth = innerHalfWidth + Math.max(0, options.sideWidth)
  const meshHalfWidth = outerHalfWidth + Math.max(0, options.coverageWidth)
  const lateralStep = Math.max(0.75, options.lateralStep)
  const columns = Math.max(3, Math.ceil((meshHalfWidth * 2) / lateralStep) + 1)
  const vertexCount = rows.length * columns
  const triangleCount = (rows.length - 1) * (columns - 1) * 2
  const positions = new Float32Array(vertexCount * 3)
  const indices = new Uint32Array(triangleCount * 3)
  const point = new THREE.Vector3()
  let vertexCursor = 0

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!
    const normalX = -Math.sin(row.heading)
    const normalZ = Math.cos(row.heading)
    const roadY = row.y - options.roadDrop
    for (let col = 0; col < columns; col += 1) {
      const t = columns > 1 ? col / (columns - 1) : 0.5
      const lateral = -meshHalfWidth + t * meshHalfWidth * 2
      const distance = Math.abs(lateral)
      const x = row.x + normalX * lateral
      const z = row.z + normalZ * lateral
      const raw = options.rawHeightAt(x, z) ?? row.y
      let y: number
      if (distance <= innerHalfWidth) {
        y = roadY
      } else if (distance < outerHalfWidth) {
        y = roadY + (raw - roadY) * smoothstep(innerHalfWidth, outerHalfWidth, distance)
      } else {
        // Tuck the outer ring slightly under the raw surface so any DEM
        // interpolation difference reads as a seam-free join, not a crack.
        y = raw - options.edgeDrop * smoothstep(outerHalfWidth, meshHalfWidth, distance)
      }
      point.set(x, y, z).applyMatrix4(options.hostInverse)
      positions[vertexCursor++] = point.x
      positions[vertexCursor++] = point.y
      positions[vertexCursor++] = point.z
    }
  }

  let indexCursor = 0
  for (let row = 0; row < rows.length - 1; row += 1) {
    const rowOffset = row * columns
    for (let col = 0; col < columns - 1; col += 1) {
      const a = rowOffset + col
      const b = a + 1
      const c = a + columns
      const d = c + 1
      indices[indexCursor++] = a
      indices[indexCursor++] = b
      indices[indexCursor++] = c
      indices[indexCursor++] = b
      indices[indexCursor++] = d
      indices[indexCursor++] = c
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return {
    geometry,
    innerHalfWidth,
    outerHalfWidth,
    meshHalfWidth,
    vertexCount,
    triangleCount,
  }
}
