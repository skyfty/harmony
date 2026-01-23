import { Box3, Matrix4, Quaternion, Vector3, type Object3D, type Mesh } from 'three'
import type { Vector3Like } from './index'

export type InstancedTilingMode = 'axis' | 'vector'

export interface InstancedTilingBasis {
  xAxis: Vector3
  yAxis: Vector3
  zAxis: Vector3
}

export interface InstancedTilingBasisOptions {
  mode: InstancedTilingMode
  forwardLocal?: Vector3Like | null
  upLocal?: Vector3Like | null
  rollDegrees?: number | null
}

const DEFAULT_FORWARD = new Vector3(0, 0, 1)
const DEFAULT_UP = new Vector3(0, 1, 0)
const EPSILON = 1e-6

const tempVecA = new Vector3()
const tempVecB = new Vector3()
const tempQuat = new Quaternion()
const tempMatrix = new Matrix4()

export function selectDefaultRenderableMesh(root: Object3D | null): Mesh | null {
  if (!root) {
    return null
  }
  const candidate = root as unknown as Mesh
  if ((candidate as any)?.isMesh && (candidate as any).geometry && (candidate as any).material) {
    return candidate
  }
  let found: Mesh | null = null
  root.traverse((child) => {
    if (found) {
      return
    }
    const mesh = child as unknown as Mesh
    if (!(mesh as any)?.isMesh) {
      return
    }
    if (!(mesh as any).geometry || !(mesh as any).material) {
      return
    }
    if ((mesh as any).visible === false) {
      return
    }
    found = mesh
  })
  return found
}

export function computeInstancedTilingBasis(options: InstancedTilingBasisOptions): InstancedTilingBasis {
  const mode = options.mode
  if (mode === 'axis') {
    return {
      xAxis: new Vector3(1, 0, 0),
      yAxis: new Vector3(0, 1, 0),
      zAxis: new Vector3(0, 0, 1),
    }
  }

  const forward = toNormalizedVector3(options.forwardLocal, DEFAULT_FORWARD)
  const upHint = toNormalizedVector3(options.upLocal, DEFAULT_UP)

  // Build an orthonormal basis.
  // right = up x forward (note: matches existing wall/route conventions where +Z is forward).
  const right = tempVecA.copy(upHint).cross(forward)
  if (right.lengthSq() < EPSILON) {
    // Degenerate up/forward (nearly parallel). Pick a fallback up that isn't parallel.
    const fallbackUp = Math.abs(forward.y) < 0.99 ? DEFAULT_UP : new Vector3(1, 0, 0)
    right.copy(fallbackUp).cross(forward)
  }
  right.normalize()

  const up = tempVecB.copy(forward).cross(right).normalize()

  const rollDeg = typeof options.rollDegrees === 'number' && Number.isFinite(options.rollDegrees) ? options.rollDegrees : 0
  if (Math.abs(rollDeg) > 1e-6) {
    const rollRad = (rollDeg * Math.PI) / 180
    tempQuat.setFromAxisAngle(forward, rollRad)
    right.applyQuaternion(tempQuat)
    up.applyQuaternion(tempQuat)
  }

  return {
    xAxis: right.clone(),
    yAxis: up.clone(),
    zAxis: forward.clone(),
  }
}

export function computeBoxExtentsAlongBasis(box: Box3, basis: InstancedTilingBasis): { x: number; y: number; z: number } {
  const corners = getBoxCorners(box)

  const x = computeProjectedExtent(corners, basis.xAxis)
  const y = computeProjectedExtent(corners, basis.yAxis)
  const z = computeProjectedExtent(corners, basis.zAxis)

  return { x, y, z }
}

export function buildInstancedTilingLocalMatrices(params: {
  countX: number
  countY: number
  countZ: number
  stepX: number
  stepY: number
  stepZ: number
  basis: InstancedTilingBasis
}): Matrix4[] {
  const countX = Math.max(1, Math.floor(params.countX))
  const countY = Math.max(1, Math.floor(params.countY))
  const countZ = Math.max(1, Math.floor(params.countZ))

  const stepX = Number.isFinite(params.stepX) ? params.stepX : 0
  const stepY = Number.isFinite(params.stepY) ? params.stepY : 0
  const stepZ = Number.isFinite(params.stepZ) ? params.stepZ : 0

  const { xAxis, yAxis, zAxis } = params.basis

  const result: Matrix4[] = []
  result.length = countX * countY * countZ

  let cursor = 0
  const offset = new Vector3()

  for (let z = 0; z < countZ; z += 1) {
    for (let y = 0; y < countY; y += 1) {
      for (let x = 0; x < countX; x += 1) {
        offset
          .set(0, 0, 0)
          .addScaledVector(xAxis, x * stepX)
          .addScaledVector(yAxis, y * stepY)
          .addScaledVector(zAxis, z * stepZ)
        const matrix = result[cursor] ?? new Matrix4()
        matrix.makeTranslation(offset.x, offset.y, offset.z)
        result[cursor] = matrix
        cursor += 1
      }
    }
  }

  return result
}

function toNormalizedVector3(source: Vector3Like | null | undefined, fallback: Vector3): Vector3 {
  const x = typeof source?.x === 'number' ? source.x : fallback.x
  const y = typeof source?.y === 'number' ? source.y : fallback.y
  const z = typeof source?.z === 'number' ? source.z : fallback.z
  const candidate = new Vector3(x, y, z)
  const len = candidate.length()
  if (!Number.isFinite(len) || len < EPSILON) {
    return fallback.clone()
  }
  return candidate.multiplyScalar(1 / len)
}

function getBoxCorners(box: Box3): Vector3[] {
  const min = box.min
  const max = box.max
  return [
    new Vector3(min.x, min.y, min.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(min.x, max.y, max.z),
    new Vector3(max.x, max.y, max.z),
  ]
}

function computeProjectedExtent(points: Vector3[], axis: Vector3): number {
  const unit = axis.clone()
  if (unit.lengthSq() < EPSILON) {
    return 0
  }
  unit.normalize()

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const point of points) {
    const value = point.dot(unit)
    if (value < min) {
      min = value
    }
    if (value > max) {
      max = value
    }
  }

  const extent = max - min
  if (!Number.isFinite(extent) || extent < 0) {
    return 0
  }
  return extent
}

// Silence unused temps in case tree-shaking changes.
void tempQuat
void tempMatrix
