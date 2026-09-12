import * as THREE from 'three'

export type OrientedBoxFit = {
  center: THREE.Vector3
  halfSize: THREE.Vector3
  dimensions: THREE.Vector3
  rotation: THREE.Euler
}

export type OrientedBoxFitOptions = {
  maxPoints?: number
  perMeshSample?: number
  minHalfSize?: number
  eigenTolerance?: number
}

const DEFAULT_MAX_POINTS = 4096
const DEFAULT_PER_MESH_SAMPLE = 512
const DEFAULT_MIN_HALF_SIZE = 1e-4
const DEFAULT_EIGEN_TOLERANCE = 1e-10
const MAX_JACOBI_ITERATIONS = 64

function collectLocalMeshPoints(
  object: THREE.Object3D,
  maxPoints: number,
  perMeshSample: number,
): THREE.Vector3[] {
  object.updateMatrixWorld(true)
  const inverseRoot = new THREE.Matrix4().copy(object.matrixWorld).invert()
  const localMatrix = new THREE.Matrix4()
  const scratch = new THREE.Vector3()
  const points: THREE.Vector3[] = []

  object.traverse((child) => {
    if (points.length >= maxPoints) {
      return
    }
    const mesh = child as THREE.Object3D & {
      isMesh?: boolean
      isSkinnedMesh?: boolean
      geometry?: THREE.BufferGeometry
    }
    if (!(mesh.isMesh || mesh.isSkinnedMesh) || !mesh.geometry) {
      return
    }
    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position) {
      return
    }
    const stride = Math.max(1, Math.floor(position.count / perMeshSample))
    localMatrix.copy(inverseRoot).multiply(mesh.matrixWorld)
    for (let index = 0; index < position.count && points.length < maxPoints; index += stride) {
      scratch.fromBufferAttribute(position, index).applyMatrix4(localMatrix)
      if (Number.isFinite(scratch.x) && Number.isFinite(scratch.y) && Number.isFinite(scratch.z)) {
        points.push(scratch.clone())
      }
    }
  })

  return points
}

function jacobiEigenDecomposition(matrix: number[][]): {
  values: [number, number, number]
  vectors: [THREE.Vector3, THREE.Vector3, THREE.Vector3]
} {
  const a = matrix.map((row) => row.slice())
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]

  for (let iteration = 0; iteration < MAX_JACOBI_ITERATIONS; iteration += 1) {
    let p = 0
    let q = 1
    let maxOffDiagonal = Math.abs(a[0]![1]!)
    const candidatePairs: Array<[number, number]> = [
      [0, 2],
      [1, 2],
    ]
    candidatePairs.forEach(([row, column]) => {
      const value = Math.abs(a[row]![column]!)
      if (value > maxOffDiagonal) {
        maxOffDiagonal = value
        p = row
        q = column
      }
    })
    const diagonalScale = Math.max(
      Math.abs(a[0]![0]!),
      Math.abs(a[1]![1]!),
      Math.abs(a[2]![2]!),
    )
    if (maxOffDiagonal <= Number.EPSILON * Math.max(1, diagonalScale)) {
      break
    }

    const app = a[p]![p]!
    const aqq = a[q]![q]!
    const apq = a[p]![q]!
    const theta = 0.5 * Math.atan2(2 * apq, aqq - app)
    const c = Math.cos(theta)
    const s = Math.sin(theta)

    for (let row = 0; row < 3; row += 1) {
      const arp = a[row]![p]!
      const arq = a[row]![q]!
      a[row]![p] = c * arp - s * arq
      a[row]![q] = s * arp + c * arq
    }
    for (let column = 0; column < 3; column += 1) {
      const apc = a[p]![column]!
      const aqc = a[q]![column]!
      a[p]![column] = c * apc - s * aqc
      a[q]![column] = s * apc + c * aqc
    }
    for (let row = 0; row < 3; row += 1) {
      const vrp = v[row]![p]!
      const vrq = v[row]![q]!
      v[row]![p] = c * vrp - s * vrq
      v[row]![q] = s * vrp + c * vrq
    }
  }

  return {
    values: [a[0]![0]!, a[1]![1]!, a[2]![2]!],
    vectors: [
      new THREE.Vector3(v[0]![0]!, v[1]![0]!, v[2]![0]!),
      new THREE.Vector3(v[0]![1]!, v[1]![1]!, v[2]![1]!),
      new THREE.Vector3(v[0]![2]!, v[1]![2]!, v[2]![2]!),
    ],
  }
}

function stabilizeAxisSign(axis: THREE.Vector3): void {
  let dominantIndex = 0
  let dominantValue = Math.abs(axis.x)
  if (Math.abs(axis.y) > dominantValue) {
    dominantIndex = 1
    dominantValue = Math.abs(axis.y)
  }
  if (Math.abs(axis.z) > dominantValue) {
    dominantIndex = 2
  }
  const dominant = dominantIndex === 0 ? axis.x : dominantIndex === 1 ? axis.y : axis.z
  if (dominant < 0) {
    axis.multiplyScalar(-1)
  }
}

function buildOrthonormalBasis(
  values: [number, number, number],
  vectors: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  tolerance: number,
): [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null {
  const entries = vectors.map((vector, index) => ({
    value: values[index] ?? 0,
    vector: vector.clone().normalize(),
  }))
  entries.sort((left, right) => right.value - left.value)

  const axisX = entries[0]!.vector.clone().normalize()
  const axisYCandidate = entries[1]!.vector.clone().normalize()
  const axisY = axisYCandidate
    .clone()
    .addScaledVector(axisX, -axisYCandidate.dot(axisX))
  if (axisY.lengthSq() <= tolerance) {
    return null
  }
  axisY.normalize()
  const axisZ = axisX.clone().cross(axisY).normalize()
  if (!Number.isFinite(axisZ.x) || !Number.isFinite(axisZ.y) || !Number.isFinite(axisZ.z)) {
    return null
  }

  stabilizeAxisSign(axisX)
  stabilizeAxisSign(axisY)
  if (axisX.clone().cross(axisY).dot(axisZ) < 0) {
    axisY.multiplyScalar(-1)
  }

  return [axisX, axisY, axisZ]
}

export function computeOrientedBoxFromObject(
  object: THREE.Object3D,
  options: OrientedBoxFitOptions = {},
): OrientedBoxFit | null {
  const maxPoints = Math.max(16, Math.trunc(options.maxPoints ?? DEFAULT_MAX_POINTS))
  const perMeshSample = Math.max(8, Math.trunc(options.perMeshSample ?? DEFAULT_PER_MESH_SAMPLE))
  const minHalfSize = Math.max(1e-6, options.minHalfSize ?? DEFAULT_MIN_HALF_SIZE)
  const eigenTolerance = Math.max(1e-12, options.eigenTolerance ?? DEFAULT_EIGEN_TOLERANCE)
  const points = collectLocalMeshPoints(object, maxPoints, perMeshSample)
  if (points.length < 4) {
    return null
  }

  const mean = new THREE.Vector3()
  points.forEach((point) => mean.add(point))
  mean.multiplyScalar(1 / points.length)

  let xx = 0
  let xy = 0
  let xz = 0
  let yy = 0
  let yz = 0
  let zz = 0
  for (const point of points) {
    const dx = point.x - mean.x
    const dy = point.y - mean.y
    const dz = point.z - mean.z
    xx += dx * dx
    xy += dx * dy
    xz += dx * dz
    yy += dy * dy
    yz += dy * dz
    zz += dz * dz
  }
  const inverseCount = 1 / points.length
  const covariance = [
    [xx * inverseCount, xy * inverseCount, xz * inverseCount],
    [xy * inverseCount, yy * inverseCount, yz * inverseCount],
    [xz * inverseCount, yz * inverseCount, zz * inverseCount],
  ]
  const decomposition = jacobiEigenDecomposition(covariance)
  const maxEigenValue = Math.max(...decomposition.values.map((value) => Math.abs(value)))
  const tolerance = Math.max(eigenTolerance, maxEigenValue * eigenTolerance)
  const significantValues = decomposition.values.filter((value) => value > tolerance)
  if (significantValues.length < 2) {
    return null
  }

  const basis = buildOrthonormalBasis(decomposition.values, decomposition.vectors, tolerance)
  if (!basis) {
    return null
  }
  const [axisX, axisY, axisZ] = basis

  const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
  const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
  const projected = new THREE.Vector3()
  const relative = new THREE.Vector3()
  points.forEach((point) => {
    relative.copy(point).sub(mean)
    projected.set(relative.dot(axisX), relative.dot(axisY), relative.dot(axisZ))
    min.min(projected)
    max.max(projected)
  })

  const center = new THREE.Vector3()
    .addScaledVector(axisX, (min.x + max.x) * 0.5)
    .addScaledVector(axisY, (min.y + max.y) * 0.5)
    .addScaledVector(axisZ, (min.z + max.z) * 0.5)
    .add(mean)
  const halfSize = new THREE.Vector3(
    Math.max(minHalfSize, (max.x - min.x) * 0.5),
    Math.max(minHalfSize, (max.y - min.y) * 0.5),
    Math.max(minHalfSize, (max.z - min.z) * 0.5),
  )
  if (![center.x, center.y, center.z, halfSize.x, halfSize.y, halfSize.z].every(Number.isFinite)) {
    return null
  }

  const rotationMatrix = new THREE.Matrix4().makeBasis(axisX, axisY, axisZ)
  const rotation = new THREE.Euler().setFromRotationMatrix(rotationMatrix, 'XYZ')
  return {
    center,
    halfSize,
    dimensions: halfSize.clone().multiplyScalar(2),
    rotation,
  }
}
