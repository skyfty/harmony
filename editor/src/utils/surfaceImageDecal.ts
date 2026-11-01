import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import {
  COMPILED_STATIC_MESH_USERDATA_KEY,
  createCompiledStaticMeshRuntimeMesh,
  extractCompiledStaticMeshMetadataFromUserData,
  orientCompiledStaticMeshTrianglesTowardPositiveZ,
} from '@schema/compiledStaticMesh'
import { resolveNodeMaterialTextureAssignmentOptions } from '@schema/material'
import type { SceneNode } from '@schema/core'

export const SURFACE_IMAGE_USERDATA_KEY = '__surfaceImage'
export const SURFACE_IMAGE_VERSION = 1
export const SURFACE_IMAGE_DEFAULT_WIDTH_METERS = 1
export const SURFACE_IMAGE_NORMAL_OFFSET_METERS = 0.002

export type SurfaceImageAttachmentMode = 'target' | 'ancestor' | 'world'

export interface SurfaceImageMetadataV1 {
  version: 1
  assetId: string
  targetNodeId: string
  attachmentMode: SurfaceImageAttachmentMode
  widthMeters: number
  heightMeters: number
}

export interface SurfaceImageTargetMesh {
  mesh: THREE.Mesh
  instanceId?: number | null
}

export interface SurfaceImageProjector {
  center: THREE.Vector3
  normal: THREE.Vector3
  quaternion: THREE.Quaternion
  width: number
  height: number
  depth?: number
}

export interface BuiltSurfaceImageDecal {
  geometry: THREE.BufferGeometry
  triangleCount: number
  width: number
  height: number
  depth: number
}

type ClipVertex = {
  position: THREE.Vector3
  normal: THREE.Vector3
}

const geometryBvhCache = new WeakMap<THREE.BufferGeometry, MeshBVH>()
const worldUp = new THREE.Vector3(0, 1, 0)
const worldX = new THREE.Vector3(1, 0, 0)
const unitScale = new THREE.Vector3(1, 1, 1)

function normalizePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function resolveFiniteVector(candidate: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 {
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y) || !Number.isFinite(candidate.z)) {
    return fallback.clone()
  }
  const lengthSq = candidate.lengthSq()
  return lengthSq > 1e-12 ? candidate.clone().multiplyScalar(1 / Math.sqrt(lengthSq)) : fallback.clone()
}

export function resolveSurfaceImageBasis(
  normalInput: THREE.Vector3,
  preferredRightInput?: THREE.Vector3 | null,
): {
  normal: THREE.Vector3
  axisU: THREE.Vector3
  axisV: THREE.Vector3
  quaternion: THREE.Quaternion
} {
  const normal = resolveFiniteVector(normalInput, worldUp)
  const preferredRight = preferredRightInput
    ? resolveFiniteVector(preferredRightInput, worldX)
    : worldX.clone()
  const verticalAlignment = Math.abs(normal.dot(worldUp))

  const axisU = new THREE.Vector3()
  const axisV = new THREE.Vector3()

  if (verticalAlignment < 0.7) {
    axisV.copy(worldUp).addScaledVector(normal, -worldUp.dot(normal))
    if (axisV.lengthSq() <= 1e-10) {
      axisV.copy(preferredRight).cross(normal)
    }
    axisV.normalize()
    axisU.crossVectors(axisV, normal).normalize()
  } else {
    axisU.copy(preferredRight).addScaledVector(normal, -preferredRight.dot(normal))
    if (axisU.lengthSq() <= 1e-10) {
      axisU.crossVectors(normal, worldUp)
    }
    if (axisU.lengthSq() <= 1e-10) {
      axisU.crossVectors(normal, worldX)
    }
    axisU.normalize()
    axisV.crossVectors(normal, axisU).normalize()
  }

  const matrix = new THREE.Matrix4().makeBasis(axisU, axisV, normal)
  return {
    normal,
    axisU,
    axisV,
    quaternion: new THREE.Quaternion().setFromRotationMatrix(matrix),
  }
}

export function cloneSurfaceImageMetadata(metadata: SurfaceImageMetadataV1): SurfaceImageMetadataV1 {
  return {
    version: SURFACE_IMAGE_VERSION,
    assetId: metadata.assetId,
    targetNodeId: metadata.targetNodeId,
    attachmentMode: metadata.attachmentMode,
    widthMeters: metadata.widthMeters,
    heightMeters: metadata.heightMeters,
  }
}

export function normalizeSurfaceImageMetadata(value: unknown): SurfaceImageMetadataV1 | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const raw = value as Partial<SurfaceImageMetadataV1>
  if (Number(raw.version) !== SURFACE_IMAGE_VERSION) {
    return null
  }
  const assetId = typeof raw.assetId === 'string' ? raw.assetId.trim() : ''
  const targetNodeId = typeof raw.targetNodeId === 'string' ? raw.targetNodeId.trim() : ''
  const attachmentMode: SurfaceImageAttachmentMode | null =
    raw.attachmentMode === 'target' || raw.attachmentMode === 'ancestor' || raw.attachmentMode === 'world'
      ? raw.attachmentMode
      : null
  const widthMeters = Number(raw.widthMeters)
  const heightMeters = Number(raw.heightMeters)
  if (
    !assetId
    || !targetNodeId
    || !attachmentMode
    || !Number.isFinite(widthMeters)
    || !Number.isFinite(heightMeters)
    || widthMeters <= 0
    || heightMeters <= 0
  ) {
    return null
  }
  return {
    version: SURFACE_IMAGE_VERSION,
    assetId,
    targetNodeId,
    attachmentMode,
    widthMeters,
    heightMeters,
  }
}

export function extractSurfaceImageMetadataFromUserData(
  userData: Record<string, unknown> | null | undefined,
): SurfaceImageMetadataV1 | null {
  return normalizeSurfaceImageMetadata(userData?.[SURFACE_IMAGE_USERDATA_KEY])
}

export function createSurfaceImageRuntimeMesh(node: SceneNode): THREE.Mesh | null {
  const surfaceImage = extractSurfaceImageMetadataFromUserData(node.userData)
  const compiledMesh = extractCompiledStaticMeshMetadataFromUserData(node.userData)
  if (!surfaceImage || !compiledMesh || node.sourceAssetId || node.dynamicMesh) {
    return null
  }
  const orientedMesh = orientCompiledStaticMeshTrianglesTowardPositiveZ(compiledMesh)
  const mesh = createCompiledStaticMeshRuntimeMesh(orientedMesh, {
    name: node.name ?? orientedMesh.name ?? 'Surface Image',
  })
  mesh.castShadow = false
  mesh.receiveShadow = true
  mesh.userData = {
    ...(mesh.userData ?? {}),
    [COMPILED_STATIC_MESH_USERDATA_KEY]: orientedMesh,
    [SURFACE_IMAGE_USERDATA_KEY]: surfaceImage,
  }
  return mesh
}

export function markSurfaceImageRuntimeOwnership(nodeId: string, object: THREE.Object3D): void {
  object.userData ??= {}
  delete object.userData.nodeId
  object.userData.ownerNodeId = nodeId
}

export function resetSurfaceImageRuntimeTransform(object: THREE.Object3D): void {
  object.position.set(0, 0, 0)
  object.rotation.set(0, 0, 0)
  object.scale.set(1, 1, 1)
  object.updateMatrix()
}

export function resolvePreviewSurfaceMaterialOptions<T extends {
  hideTransparentMaterials?: boolean
  inheritUnspecifiedTextures?: boolean
}>(
  node: SceneNode,
  options: T,
  importedModelOverride = false,
): T {
  return resolveNodeMaterialTextureAssignmentOptions(node, options, importedModelOverride)
}

export function isSurfaceImageObject(object: THREE.Object3D | null | undefined): boolean {
  let current = object
  while (current) {
    const metadata = current.userData as Record<string, unknown> | undefined
    if (metadata?.[SURFACE_IMAGE_USERDATA_KEY]) {
      return true
    }
    current = current.parent
  }
  return false
}

export function collectSurfaceImageTargetMeshes(
  targetRoot: THREE.Object3D,
  hitObject: THREE.Object3D,
  hitInstanceId?: number | null,
): SurfaceImageTargetMesh[] {
  const hitMesh = hitObject as THREE.Mesh & {
    isInstancedMesh?: boolean
    instanceId?: number
  }
  if (hitMesh?.isMesh && hitMesh.isInstancedMesh && Number.isInteger(hitInstanceId)) {
    return [{ mesh: hitMesh, instanceId: hitInstanceId }]
  }

  const targets: SurfaceImageTargetMesh[] = []
  const visit = (object: THREE.Object3D, parentVisible: boolean): void => {
    const visible = parentVisible && object.visible
    if (!visible) {
      return
    }
    const mesh = object as THREE.Mesh & {
      isSkinnedMesh?: boolean
      isInstancedMesh?: boolean
    }
    const editorOnly = object.userData?.editorOnly === true
      || object.userData?.instancedPickProxy === true
      || isSurfaceImageObject(object)
    if (
      mesh.isMesh
      && !mesh.isInstancedMesh
      && !mesh.isSkinnedMesh
      && !editorOnly
    ) {
      targets.push({ mesh })
    }
    object.children.forEach((child) => visit(child, visible))
  }

  visit(targetRoot, true)
  return targets
}

export function resolveSurfaceImageAttachmentParent(
  targetNodeId: string,
  getParentId: (nodeId: string) => string | null,
  canContainChildren: (nodeId: string | null) => boolean,
): { parentNodeId: string | null; attachmentMode: SurfaceImageAttachmentMode } {
  let parentNodeId: string | null = targetNodeId.trim() || null
  let attachmentMode: SurfaceImageAttachmentMode = 'target'
  while (parentNodeId) {
    if (canContainChildren(parentNodeId)) {
      return { parentNodeId, attachmentMode }
    }
    const ancestorId = getParentId(parentNodeId)
    if (ancestorId) {
      attachmentMode = 'ancestor'
    }
    parentNodeId = ancestorId
  }
  return { parentNodeId: null, attachmentMode: 'world' }
}

function resolveDefaultDepth(width: number, height: number): number {
  return THREE.MathUtils.clamp(Math.min(width, height) * 0.02, 0.005, 0.05)
}

function resolveInstanceWorldMatrix(mesh: THREE.Mesh, instanceId: number | null): THREE.Matrix4 {
  const instanced = mesh as THREE.InstancedMesh & { isInstancedMesh?: boolean }
  if (!instanced.isInstancedMesh || instanceId === null) {
    return mesh.matrixWorld.clone()
  }
  const instanceMatrix = new THREE.Matrix4()
  instanced.getMatrixAt(instanceId, instanceMatrix)
  return mesh.matrixWorld.clone().multiply(instanceMatrix)
}

function collectProjectorLocalBounds(
  center: THREE.Vector3,
  axisU: THREE.Vector3,
  axisV: THREE.Vector3,
  normal: THREE.Vector3,
  width: number,
  height: number,
  depth: number,
  worldToLocal: THREE.Matrix4,
): THREE.Box3 {
  const box = new THREE.Box3()
  const point = new THREE.Vector3()
  for (const xSign of [-1, 1]) {
    for (const ySign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        point.copy(center)
          .addScaledVector(axisU, xSign * width * 0.5)
          .addScaledVector(axisV, ySign * height * 0.5)
          .addScaledVector(normal, zSign * depth * 0.5)
          .applyMatrix4(worldToLocal)
        box.expandByPoint(point)
      }
    }
  }
  return box
}

function getGeometryBvh(geometry: THREE.BufferGeometry): MeshBVH | null {
  const cached = geometryBvhCache.get(geometry)
  if (cached) {
    return cached
  }
  const existing = (geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree
  if (existing instanceof MeshBVH) {
    geometryBvhCache.set(geometry, existing)
    return existing
  }
  try {
    const bvh = new MeshBVH(geometry)
    geometryBvhCache.set(geometry, bvh)
    return bvh
  } catch {
    return null
  }
}

function clipAgainstAxis(
  vertices: ClipVertex[],
  axis: 'x' | 'y' | 'z',
  side: 1 | -1,
  limit: number,
): ClipVertex[] {
  if (!vertices.length) {
    return vertices
  }
  const result: ClipVertex[] = []
  const distance = (vertex: ClipVertex): number => side * vertex.position[axis] - limit
  let previous = vertices[vertices.length - 1]!
  let previousDistance = distance(previous)
  let previousInside = previousDistance <= 1e-9

  for (const current of vertices) {
    const currentDistance = distance(current)
    const currentInside = currentDistance <= 1e-9
    if (currentInside !== previousInside) {
      const denominator = previousDistance - currentDistance
      if (Math.abs(denominator) > 1e-12) {
        const t = THREE.MathUtils.clamp(previousDistance / denominator, 0, 1)
        result.push({
          position: previous.position.clone().lerp(current.position, t),
          normal: previous.normal.clone().lerp(current.normal, t).normalize(),
        })
      }
    }
    if (currentInside) {
      result.push({
        position: current.position.clone(),
        normal: current.normal.clone(),
      })
    }
    previousDistance = currentDistance
    previousInside = currentInside
    previous = current
  }
  return result
}

function clipTriangleToProjector(
  worldVertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  worldNormals: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
  worldToProjector: THREE.Matrix4,
  width: number,
  height: number,
  depth: number,
): ClipVertex[] {
  let vertices: ClipVertex[] = worldVertices.map((position, index) => ({
    position: position.clone().applyMatrix4(worldToProjector),
    normal: worldNormals[index]!.clone(),
  }))

  vertices = clipAgainstAxis(vertices, 'x', 1, width * 0.5)
  vertices = clipAgainstAxis(vertices, 'x', -1, width * 0.5)
  vertices = clipAgainstAxis(vertices, 'y', 1, height * 0.5)
  vertices = clipAgainstAxis(vertices, 'y', -1, height * 0.5)
  vertices = clipAgainstAxis(vertices, 'z', 1, depth * 0.5)
  vertices = clipAgainstAxis(vertices, 'z', -1, depth * 0.5)
  return vertices
}

function readGeometryTriangle(
  geometry: THREE.BufferGeometry,
  triangleIndex: number,
): [THREE.Vector3, THREE.Vector3, THREE.Vector3] | null {
  const position = geometry.getAttribute('position')
  if (!position || position.count < 3) {
    return null
  }
  const indices = geometry.index
  const readIndex = (corner: number): number => {
    const offset = triangleIndex * 3 + corner
    return indices ? indices.getX(offset) : offset
  }
  const ia = readIndex(0)
  const ib = readIndex(1)
  const ic = readIndex(2)
  if (ia < 0 || ib < 0 || ic < 0 || ia >= position.count || ib >= position.count || ic >= position.count) {
    return null
  }
  return [
    new THREE.Vector3().fromBufferAttribute(position, ia),
    new THREE.Vector3().fromBufferAttribute(position, ib),
    new THREE.Vector3().fromBufferAttribute(position, ic),
  ]
}

function appendClippedTriangle(
  positions: number[],
  uvs: number[],
  indices: number[],
  clipped: ClipVertex[],
  projectorQuaternionInverse: THREE.Quaternion,
  width: number,
  height: number,
  normalOffset: number,
): boolean {
  if (clipped.length < 3) {
    return false
  }
  let appended = false
  for (let index = 1; index < clipped.length - 1; index += 1) {
    const triangle = [clipped[0]!, clipped[index]!, clipped[index + 1]!]
    let edgeA = triangle[1]!.position.clone().sub(triangle[0]!.position)
    let edgeB = triangle[2]!.position.clone().sub(triangle[0]!.position)
    let faceNormal = edgeA.clone().cross(edgeB)
    if (faceNormal.lengthSq() <= 1e-14) {
      continue
    }
    // Compiled geometry does not persist normals; computeVertexNormals derives
    // them from winding. The decal front is projector-local +Z, so orient every
    // emitted triangle toward that direction to keep the image lit even when
    // the ray hit the target's back face.
    if (faceNormal.z < 0) {
      const second = triangle[1]!
      triangle[1] = triangle[2]!
      triangle[2] = second
      edgeA = triangle[1]!.position.clone().sub(triangle[0]!.position)
      edgeB = triangle[2]!.position.clone().sub(triangle[0]!.position)
      faceNormal = edgeA.clone().cross(edgeB)
    }

    const baseIndex = positions.length / 3
    for (const vertex of triangle) {
      const normal = vertex.normal.lengthSq() > 1e-12
        ? vertex.normal.clone().normalize().applyQuaternion(projectorQuaternionInverse)
        : new THREE.Vector3()
      const local = vertex.position.clone().addScaledVector(normal, normalOffset)
      positions.push(local.x, local.y, local.z)
      uvs.push(
        THREE.MathUtils.clamp(0.5 + vertex.position.x / width, 0, 1),
        THREE.MathUtils.clamp(0.5 + vertex.position.y / height, 0, 1),
      )
    }
    indices.push(baseIndex, baseIndex + 1, baseIndex + 2)
    appended = true
  }
  return appended
}

function createOutputGeometry(
  positions: number[],
  uvs: number[],
  indices: number[],
): THREE.BufferGeometry | null {
  if (positions.length < 9 || indices.length < 3) {
    return null
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  const maxIndex = indices.reduce((max, value) => Math.max(max, value), 0)
  geometry.setIndex(
    maxIndex > 65535
      ? new THREE.Uint32BufferAttribute(indices, 1)
      : new THREE.Uint16BufferAttribute(indices, 1),
  )
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function buildSurfaceImageDecalGeometry(options: {
  targets: readonly SurfaceImageTargetMesh[]
  projector: SurfaceImageProjector
  normalOffset?: number
}): BuiltSurfaceImageDecal | null {
  const width = normalizePositive(options.projector.width, SURFACE_IMAGE_DEFAULT_WIDTH_METERS)
  const height = normalizePositive(options.projector.height, SURFACE_IMAGE_DEFAULT_WIDTH_METERS)
  const depth = normalizePositive(
    options.projector.depth ?? resolveDefaultDepth(width, height),
    resolveDefaultDepth(width, height),
  )
  const normalOffset = Number.isFinite(options.normalOffset)
    ? Math.max(0, options.normalOffset!)
    : SURFACE_IMAGE_NORMAL_OFFSET_METERS
  const normal = resolveFiniteVector(options.projector.normal, worldUp)
  const quaternion = options.projector.quaternion.clone().normalize()
  const projectorMatrix = new THREE.Matrix4().compose(options.projector.center.clone(), quaternion, unitScale)
  const worldToProjector = projectorMatrix.clone().invert()
  const projectorQuaternionInverse = quaternion.clone().invert()
  const axisU = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion)
  const axisV = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion)

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let triangleCount = 0
  const seenTargets = new Set<string>()

  for (const target of options.targets) {
    const mesh = target.mesh
    if (!mesh?.isMesh || !mesh.geometry?.getAttribute('position')) {
      continue
    }
    const meshFlags = mesh as THREE.Mesh & {
      isSkinnedMesh?: boolean
      isInstancedMesh?: boolean
      morphTargetInfluences?: number[]
    }
    if (
      meshFlags.isSkinnedMesh
      || Object.keys(mesh.geometry.morphAttributes ?? {}).length > 0
      || (meshFlags.morphTargetInfluences?.length ?? 0) > 0
    ) {
      continue
    }
    const instanceId = Number.isInteger(target.instanceId) ? Number(target.instanceId) : null
    const targetKey = `${mesh.uuid}:${instanceId ?? 'static'}`
    if (seenTargets.has(targetKey)) {
      continue
    }
    seenTargets.add(targetKey)

    mesh.updateWorldMatrix(true, false)
    const worldMatrix = resolveInstanceWorldMatrix(mesh, instanceId)
    const worldToLocal = worldMatrix.clone().invert()
    const localProjectorBounds = collectProjectorLocalBounds(
      options.projector.center,
      axisU,
      axisV,
      normal,
      width,
      height,
      depth,
      worldToLocal,
    )
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(worldMatrix)
    const normalAttribute = mesh.geometry.getAttribute('normal')

    const processTriangle = (
      localA: THREE.Vector3,
      localB: THREE.Vector3,
      localC: THREE.Vector3,
      indexA: number,
      indexB: number,
      indexC: number,
    ): void => {
      const worldVertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
        localA.clone().applyMatrix4(worldMatrix),
        localB.clone().applyMatrix4(worldMatrix),
        localC.clone().applyMatrix4(worldMatrix),
      ]
      const faceNormal = new THREE.Vector3()
        .subVectors(worldVertices[1], worldVertices[0])
        .cross(new THREE.Vector3().subVectors(worldVertices[2], worldVertices[0]))
      if (faceNormal.lengthSq() <= 1e-14) {
        return
      }
      faceNormal.normalize()
      const readNormal = (index: number): THREE.Vector3 => {
        if (!normalAttribute || index >= normalAttribute.count) {
          return faceNormal.clone()
        }
        const result = new THREE.Vector3().fromBufferAttribute(normalAttribute, index).applyMatrix3(normalMatrix)
        if (result.lengthSq() <= 1e-12) {
          return faceNormal.clone()
        }
        result.normalize()
        if (result.dot(normal) < 0) {
          result.negate()
        }
        return result
      }
      const clipped = clipTriangleToProjector(
        worldVertices,
        [readNormal(indexA), readNormal(indexB), readNormal(indexC)],
        worldToProjector,
        width,
        height,
        depth,
      )
      if (appendClippedTriangle(
        positions,
        uvs,
        indices,
        clipped,
        projectorQuaternionInverse,
        width,
        height,
        normalOffset,
      )) {
        triangleCount += Math.max(0, clipped.length - 2)
      }
    }

    const indexAttribute = mesh.geometry.index
    const positionAttribute = mesh.geometry.getAttribute('position')
    const triangleTotal = Math.floor((indexAttribute?.count ?? positionAttribute.count) / 3)
    const processTriangleIndex = (triangleIndex: number): void => {
      const triangle = readGeometryTriangle(mesh.geometry, triangleIndex)
      if (!triangle) {
        return
      }
      const offsets = triangleIndex * 3
      const indexA = indexAttribute?.getX(offsets) ?? offsets
      const indexB = indexAttribute?.getX(offsets + 1) ?? offsets + 1
      const indexC = indexAttribute?.getX(offsets + 2) ?? offsets + 2
      processTriangle(triangle[0], triangle[1], triangle[2], indexA, indexB, indexC)
    }

    const bvh = getGeometryBvh(mesh.geometry)
    if (bvh) {
      const positionCountBeforeCast = positions.length
      const uvCountBeforeCast = uvs.length
      const indexCountBeforeCast = indices.length
      const triangleCountBeforeCast = triangleCount
      try {
        bvh.shapecast({
          intersectsBounds: (box) => box.intersectsBox(localProjectorBounds),
          intersectsTriangle: (triangle, triangleIndex) => {
            const offsets = triangleIndex * 3
            const indexA = indexAttribute?.getX(offsets) ?? offsets
            const indexB = indexAttribute?.getX(offsets + 1) ?? offsets + 1
            const indexC = indexAttribute?.getX(offsets + 2) ?? offsets + 2
            processTriangle(triangle.a, triangle.b, triangle.c, indexA, indexB, indexC)
            return false
          },
        })
        continue
      } catch {
        // Malformed or dynamically edited geometry can fall back to a complete scan.
        positions.length = positionCountBeforeCast
        uvs.length = uvCountBeforeCast
        indices.length = indexCountBeforeCast
        triangleCount = triangleCountBeforeCast
      }
    }

    for (let triangleIndex = 0; triangleIndex < triangleTotal; triangleIndex += 1) {
      processTriangleIndex(triangleIndex)
    }
  }

  const geometry = createOutputGeometry(positions, uvs, indices)
  if (!geometry || triangleCount === 0) {
    geometry?.dispose()
    return null
  }
  return {
    geometry,
    triangleCount: indices.length / 3,
    width,
    height,
    depth,
  }
}
