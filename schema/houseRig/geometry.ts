import * as THREE from 'three'
import { hashString, stableSerialize } from '../stableSerialize'
import { objectPathFromSegments, houseRigPartKey, parseHouseRigPartName } from './naming'
import {
  HOUSE_RIG_DEFAULT_MIN_SCALE,
  type HouseRigAssetDescriptor,
  type HouseRigDeformPlan,
  type HouseRigDeformPlanPart,
  type HouseRigDimensionLimits,
  type HouseRigDimensions,
  type HouseRigHandles,
  type HouseRigPartBounds,
  type HouseRigRestPart,
  type HouseRigRestSnapshot,
} from './types'

const EMPTY_BOUNDS = new THREE.Box3(
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, 0),
)

function toFiniteNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export function cloneHouseRigDimensions(
  dimensions: Partial<HouseRigDimensions> | null | undefined,
  fallback: HouseRigDimensions,
): HouseRigDimensions {
  return {
    width: Math.max(1e-4, toFiniteNumber(dimensions?.width, fallback.width)),
    depth: Math.max(1e-4, toFiniteNumber(dimensions?.depth, fallback.depth)),
    wallHeight: Math.max(1e-4, toFiniteNumber(dimensions?.wallHeight, fallback.wallHeight)),
  }
}

export function createHouseRigDimensionLimits(
  rest: HouseRigDimensions,
  options: {
    minScale?: number
    step?: number
  } = {},
): HouseRigDimensionLimits {
  const minScale = Math.max(0.05, toFiniteNumber(options.minScale, HOUSE_RIG_DEFAULT_MIN_SCALE))
  const step = Math.max(0.001, toFiniteNumber(options.step, 0.01))
  return {
    width: { min: rest.width * minScale, max: null, step },
    depth: { min: rest.depth * minScale, max: null, step },
    wallHeight: { min: rest.wallHeight * minScale, max: null, step },
  }
}

function clampDimension(
  value: number,
  limit: { min: number; max: number | null },
): number {
  const aboveMinimum = Math.max(value, limit.min)
  return limit.max == null ? aboveMinimum : Math.min(aboveMinimum, limit.max)
}

export function clampHouseRigDimensions(
  dimensions: Partial<HouseRigDimensions> | null | undefined,
  limits: HouseRigDimensionLimits,
  fallback: HouseRigDimensions,
): HouseRigDimensions {
  const initial = cloneHouseRigDimensions(dimensions, fallback)
  return {
    width: clampDimension(initial.width, limits.width),
    depth: clampDimension(initial.depth, limits.depth),
    wallHeight: clampDimension(initial.wallHeight, limits.wallHeight),
  }
}

export function boundsToPlain(box: THREE.Box3): HouseRigPartBounds {
  const safe = box.isEmpty() ? EMPTY_BOUNDS : box
  const min = safe.min.clone()
  const max = safe.max.clone()
  const center = min.clone().add(max).multiplyScalar(0.5)
  const size = max.clone().sub(min)
  return {
    min: { x: min.x, y: min.y, z: min.z },
    max: { x: max.x, y: max.y, z: max.z },
    center: { x: center.x, y: center.y, z: center.z },
    size: { x: size.x, y: size.y, z: size.z },
  }
}

export function houseRigBoundsBox(bounds: HouseRigPartBounds): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
  )
}

function updateBoxFromRootPositions(box: THREE.Box3, positions: ArrayLike<number>): void {
  for (let index = 0; index + 2 < positions.length; index += 3) {
    box.expandByPoint(new THREE.Vector3(
      positions[index] ?? 0,
      positions[index + 1] ?? 0,
      positions[index + 2] ?? 0,
    ))
  }
}

function computePartBounds(positions: ArrayLike<number>): HouseRigPartBounds {
  const box = new THREE.Box3()
  updateBoxFromRootPositions(box, positions)
  return boundsToPlain(box)
}

function resolveMeshMatrixToRoot(mesh: THREE.Mesh, root: THREE.Object3D): THREE.Matrix4 {
  root.updateMatrixWorld(true)
  mesh.updateMatrixWorld(true)
  return new THREE.Matrix4()
    .copy(root.matrixWorld)
    .invert()
    .multiply(mesh.matrixWorld)
}

export function readHouseRigMeshPositionsRoot(
  mesh: THREE.Mesh,
  root: THREE.Object3D,
): Float32Array {
  const position = mesh.geometry?.getAttribute?.('position')
  if (!position) {
    return new Float32Array()
  }
  const matrix = resolveMeshMatrixToRoot(mesh, root)
  const result = new Float32Array(position.count * 3)
  const point = new THREE.Vector3()
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index).applyMatrix4(matrix)
    result[index * 3] = point.x
    result[index * 3 + 1] = point.y
    result[index * 3 + 2] = point.z
  }
  return result
}

function readUvs(mesh: THREE.Mesh): Float32Array | null {
  const uv = mesh.geometry?.getAttribute?.('uv')
  if (!uv) {
    return null
  }
  const result = new Float32Array(uv.count * 2)
  for (let index = 0; index < uv.count; index += 1) {
    result[index * 2] = uv.getX(index)
    result[index * 2 + 1] = uv.getY(index)
  }
  return result
}

function collectRootMeshes(root: THREE.Object3D): Array<{
  mesh: THREE.Mesh
  objectPath: string
  segments: number[]
}> {
  const result: Array<{ mesh: THREE.Mesh; objectPath: string; segments: number[] }> = []
  const visit = (object: THREE.Object3D, segments: number[]): void => {
    const mesh = object as THREE.Mesh
    if (mesh?.isMesh) {
      result.push({
        mesh,
        objectPath: objectPathFromSegments(segments),
        segments: [...segments],
      })
    }
    object.children.forEach((child, index) => {
      visit(child, [...segments, index])
    })
  }
  visit(root, [])
  return result
}

export function computeHouseRigTopologyHash(
  root: THREE.Object3D,
  assetId: string | null,
): string {
  const parts = collectRootMeshes(root).map(({ mesh, objectPath }) => {
    const position = mesh.geometry?.getAttribute?.('position')
    const index = mesh.geometry?.getIndex?.()
    return {
      objectPath,
      name: mesh.name || mesh.parent?.name || '',
      vertexCount: position?.count ?? 0,
      indexCount: index?.count ?? position?.count ?? 0,
    }
  })
  return hashString(stableSerialize({ assetId, parts }))
}

export function buildHouseRigRestSnapshot(options: {
  root: THREE.Object3D
  assetId: string | null
  dimensions?: Partial<HouseRigDimensions> | null
  limits?: Partial<HouseRigDimensionLimits> | null
}): HouseRigRestSnapshot {
  const { root, assetId } = options
  const warnings: string[] = []
  const overallBox = new THREE.Box3()
  const wallBox = new THREE.Box3()
  const parts: HouseRigRestPart[] = []

  for (const entry of collectRootMeshes(root)) {
    const { mesh, objectPath } = entry
    const positionsRoot = readHouseRigMeshPositionsRoot(mesh, root)
    if (!positionsRoot.length) {
      warnings.push(`Skipped mesh without positions: ${mesh.name || objectPath || '(unnamed)'}`)
      continue
    }
    const meshName = mesh.name || mesh.parent?.name || `Mesh ${objectPath || 'root'}`
    const parsed = parseHouseRigPartName(meshName, mesh.userData)
    const partBounds = computePartBounds(positionsRoot)
    const box = houseRigBoundsBox(partBounds)
    overallBox.union(box)
    if (parsed.role === 'wall') {
      wallBox.union(box)
    }
    if (parsed.role === 'unknown') {
      warnings.push(`Unclassified House Rig part: ${meshName}`)
    }
    parts.push({
      key: houseRigPartKey(objectPath, meshName),
      objectPath,
      meshName,
      role: parsed.role,
      side: parsed.side,
      layer: parsed.layer,
      vertexCount: positionsRoot.length / 3,
      positionsRoot,
      uvs: readUvs(mesh),
      bounds: partBounds,
    })
  }

  if (!parts.length) {
    throw new Error('House Rig could not find any mesh parts on the imported model')
  }

  const overallBounds = boundsToPlain(overallBox)
  const wallBounds = wallBox.isEmpty() ? overallBounds : boundsToPlain(wallBox)
  const fallbackDimensions: HouseRigDimensions = {
    width: Math.max(1e-3, overallBounds.size.x),
    depth: Math.max(1e-3, overallBounds.size.z),
    wallHeight: Math.max(
      1e-3,
      (wallBounds.max.y - overallBounds.min.y) || overallBounds.size.y,
    ),
  }
  const dimensions = cloneHouseRigDimensions(options.dimensions, fallbackDimensions)
  const limits = options.limits
    ? {
        width: {
          ...createHouseRigDimensionLimits(dimensions).width,
          ...options.limits.width,
        },
        depth: {
          ...createHouseRigDimensionLimits(dimensions).depth,
          ...options.limits.depth,
        },
        wallHeight: {
          ...createHouseRigDimensionLimits(dimensions).wallHeight,
          ...options.limits.wallHeight,
        },
      }
    : createHouseRigDimensionLimits(dimensions)

  return {
    assetId,
    topologyHash: computeHouseRigTopologyHash(root, assetId),
    dimensions,
    limits,
    bounds: overallBounds,
    parts,
    warnings,
  }
}

export function toHouseRigAssetDescriptor(
  rest: HouseRigRestSnapshot,
): HouseRigAssetDescriptor {
  return {
    assetId: rest.assetId,
    topologyHash: rest.topologyHash,
    dimensions: { ...rest.dimensions },
    parts: rest.parts.map((part) => ({
      key: part.key,
      objectPath: part.objectPath,
      meshName: part.meshName,
      role: part.role,
      side: part.side,
      layer: part.layer,
      vertexCount: part.vertexCount,
    })),
  }
}

export function cloneRootPositions(part: HouseRigRestPart): Float32Array {
  return new Float32Array(part.positionsRoot)
}

export function createHouseRigHandles(
  bounds: HouseRigPartBounds,
  lift = 0,
): HouseRigHandles {
  const center = bounds.center
  const min = bounds.min
  const max = bounds.max
  const midY = (min.y + max.y) * 0.5
  return {
    width: { x: max.x + lift, y: midY, z: center.z },
    depth: { x: center.x, y: midY, z: max.z + lift },
    wallHeight: { x: center.x, y: max.y + lift, z: center.z },
  }
}

export function planBounds(planParts: readonly HouseRigDeformPlanPart[]): HouseRigPartBounds {
  const box = new THREE.Box3()
  planParts.forEach((part) => updateBoxFromRootPositions(box, part.positionsRoot))
  return boundsToPlain(box)
}

export function validateHouseRigDeformPlan(
  rest: HouseRigRestSnapshot,
  plan: HouseRigDeformPlan,
): string[] {
  const issues: string[] = []
  const restByKey = new Map(rest.parts.map((part) => [part.key, part]))
  const seen = new Set<string>()
  plan.parts.forEach((part) => {
    const source = restByKey.get(part.key)
    if (!source) {
      issues.push(`Plan contains unknown part ${part.key}`)
      return
    }
    if (seen.has(part.key)) {
      issues.push(`Plan contains duplicate part ${part.key}`)
    }
    seen.add(part.key)
    if (part.positionsRoot.length !== source.positionsRoot.length) {
      issues.push(
        `Part ${source.meshName} has ${part.positionsRoot.length / 3} vertices; expected ${source.vertexCount}`,
      )
    }
    for (let index = 0; index < part.positionsRoot.length; index += 1) {
      const value = part.positionsRoot[index]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push(`Part ${source.meshName} contains a non-finite vertex coordinate`)
        break
      }
    }
    if (part.uvs) {
      const expectedUvLength = source.vertexCount * 2
      if (part.uvs.length !== expectedUvLength) {
        issues.push(
          `Part ${source.meshName} UV length ${part.uvs.length} does not match ${expectedUvLength}`,
        )
      }
    }
  })
  rest.parts.forEach((part) => {
    if (!seen.has(part.key)) {
      issues.push(`Plan is missing part ${part.meshName}`)
    }
  })
  return issues
}

export function applyHouseRigDeformPlan(
  root: THREE.Object3D,
  rest: HouseRigRestSnapshot,
  plan: HouseRigDeformPlan,
): void {
  const issues = validateHouseRigDeformPlan(rest, plan)
  if (issues.length) {
    throw new Error(issues.join('; '))
  }
  const restByKey = new Map(rest.parts.map((part) => [part.key, part]))
  const meshes = new Map<string, THREE.Mesh>()
  for (const entry of collectRootMeshes(root)) {
    const meshName = entry.mesh.name || entry.mesh.parent?.name || ''
    const key = houseRigPartKey(entry.objectPath, meshName)
    meshes.set(key, entry.mesh)
  }

  root.updateMatrixWorld(true)
  plan.parts.forEach((plannedPart) => {
    const source = restByKey.get(plannedPart.key)
    const mesh = meshes.get(plannedPart.key)
    if (!source || !mesh) {
      return
    }
    const position = mesh.geometry.getAttribute('position')
    if (!position || position.count !== source.vertexCount) {
      throw new Error(`House Rig geometry changed after binding: ${source.meshName}`)
    }
    const inverseMesh = resolveMeshMatrixToRoot(mesh, root).invert()
    const point = new THREE.Vector3()
    for (let index = 0; index < position.count; index += 1) {
      point.set(
        plannedPart.positionsRoot[index * 3] ?? 0,
        plannedPart.positionsRoot[index * 3 + 1] ?? 0,
        plannedPart.positionsRoot[index * 3 + 2] ?? 0,
      ).applyMatrix4(inverseMesh)
      position.setXYZ(index, point.x, point.y, point.z)
    }
    position.needsUpdate = true
    if (plannedPart.uvs) {
      const uv = mesh.geometry.getAttribute('uv')
      if (uv && uv.count === source.vertexCount) {
        for (let index = 0; index < uv.count; index += 1) {
          uv.setXY(
            index,
            plannedPart.uvs[index * 2] ?? 0,
            plannedPart.uvs[index * 2 + 1] ?? 0,
          )
        }
        uv.needsUpdate = true
      }
    }
    mesh.geometry.computeVertexNormals()
    mesh.geometry.computeBoundingBox()
    mesh.geometry.computeBoundingSphere()
  })
}

export function restoreHouseRigRestPose(
  root: THREE.Object3D,
  rest: HouseRigRestSnapshot,
): void {
  const parts: HouseRigDeformPlanPart[] = rest.parts.map((part) => ({
    key: part.key,
    positionsRoot: part.positionsRoot,
    uvs: part.uvs,
  }))
  applyHouseRigDeformPlan(root, rest, {
    parts,
    handles: createHouseRigHandles(rest.bounds),
    bounds: rest.bounds,
    warnings: [],
  })
}
