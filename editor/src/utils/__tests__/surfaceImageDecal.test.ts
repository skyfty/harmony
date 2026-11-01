import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { orientCompiledStaticMeshTrianglesTowardPositiveZ } from '@schema/compiledStaticMesh'
import {
  buildSurfaceImageDecalGeometry,
  markSurfaceImageRuntimeOwnership,
  normalizeSurfaceImageMetadata,
  resetSurfaceImageRuntimeTransform,
  resolvePreviewSurfaceMaterialOptions,
  resolveSurfaceImageBasis,
  resolveSurfaceImageAttachmentParent,
} from '@/utils/surfaceImageDecal'

function createProjector(
  center: THREE.Vector3,
  normal: THREE.Vector3,
  width = 1,
  height = 0.5,
): {
  center: THREE.Vector3
  normal: THREE.Vector3
  quaternion: THREE.Quaternion
  width: number
  height: number
} {
  const basis = resolveSurfaceImageBasis(normal, new THREE.Vector3(1, 0, 0))
  return {
    center,
    normal: basis.normal,
    quaternion: basis.quaternion,
    width,
    height,
  }
}

function readPositions(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const position = geometry.getAttribute('position')
  return Array.from(
    { length: position.count },
    (_value, index) => new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)),
  )
}

function readUvs(geometry: THREE.BufferGeometry): THREE.Vector2[] {
  const uv = geometry.getAttribute('uv')
  return Array.from(
    { length: uv.count },
    (_value, index) => new THREE.Vector2(uv.getX(index), uv.getY(index)),
  )
}

function readNormals(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const normal = geometry.getAttribute('normal')
  return Array.from(
    { length: normal.count },
    (_value, index) => new THREE.Vector3(normal.getX(index), normal.getY(index), normal.getZ(index)),
  )
}

function createPlane(width: number, height: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height, 1, 1),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  )
  mesh.updateMatrixWorld(true)
  return mesh
}

describe('surface image decal geometry', () => {
  it('clips a square to a one-meter by aspect-correct rectangle and produces full UV coverage', () => {
    const mesh = createPlane(4, 4)
    const result = buildSurfaceImageDecalGeometry({
      targets: [{ mesh }],
      projector: createProjector(new THREE.Vector3(), new THREE.Vector3(0, 0, 1)),
    })

    expect(result).not.toBeNull()
    const positions = readPositions(result!.geometry)
    const uvs = readUvs(result!.geometry)
    expect(Math.min(...positions.map((point) => point.x))).toBeCloseTo(-0.5, 5)
    expect(Math.max(...positions.map((point) => point.x))).toBeCloseTo(0.5, 5)
    expect(Math.min(...positions.map((point) => point.y))).toBeCloseTo(-0.25, 5)
    expect(Math.max(...positions.map((point) => point.y))).toBeCloseTo(0.25, 5)
    expect(Math.min(...uvs.map((point) => point.x))).toBeCloseTo(0, 5)
    expect(Math.max(...uvs.map((point) => point.x))).toBeCloseTo(1, 5)
    expect(Math.min(...uvs.map((point) => point.y))).toBeCloseTo(0, 5)
    expect(Math.max(...uvs.map((point) => point.y))).toBeCloseTo(1, 5)
    expect(positions.every((point) => point.z > 0)).toBe(true)
    expect(readNormals(result!.geometry).every((normal) => normal.z > 0)).toBe(true)

    result!.geometry.dispose()
  })

  it('keeps every vertex on a sloped source surface', () => {
    const mesh = createPlane(8, 8)
    mesh.geometry.rotateX(-Math.PI / 4)
    mesh.updateMatrixWorld(true)
    const normal = new THREE.Vector3(0, Math.SQRT1_2, Math.SQRT1_2)
    const result = buildSurfaceImageDecalGeometry({
      targets: [{ mesh }],
      projector: createProjector(new THREE.Vector3(), normal, 1, 0.8),
      normalOffset: 0,
    })

    expect(result).not.toBeNull()
    const projectorMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3(),
      resolveSurfaceImageBasis(normal, new THREE.Vector3(1, 0, 0)).quaternion,
      new THREE.Vector3(1, 1, 1),
    )
    for (const point of readPositions(result!.geometry)) {
      const worldPoint = point.clone().applyMatrix4(projectorMatrix)
      expect(worldPoint.dot(normal)).toBeCloseTo(0, 5)
    }
    result!.geometry.dispose()
  })

  it('clips a decal that crosses the edge of the target rectangle', () => {
    const mesh = createPlane(10, 10)
    const result = buildSurfaceImageDecalGeometry({
      targets: [{ mesh }],
      projector: createProjector(new THREE.Vector3(5, 0, 0), new THREE.Vector3(0, 0, 1), 2, 0.5),
      normalOffset: 0,
    })

    expect(result).not.toBeNull()
    const positions = readPositions(result!.geometry)
    expect(Math.min(...positions.map((point) => point.x))).toBeCloseTo(-1, 5)
    expect(Math.max(...positions.map((point) => point.x))).toBeCloseTo(0, 5)
    expect(positions.every((point) => point.x <= 0.00001)).toBe(true)
    result!.geometry.dispose()
  })

  it('merges separate target meshes into one decal mesh', () => {
    const left = createPlane(4, 4)
    left.position.x = -2
    const right = createPlane(4, 4)
    right.position.x = 2
    left.updateMatrixWorld(true)
    right.updateMatrixWorld(true)
    const result = buildSurfaceImageDecalGeometry({
      targets: [{ mesh: left }, { mesh: right }],
      projector: createProjector(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 8, 1),
      normalOffset: 0,
    })

    expect(result).not.toBeNull()
    const positions = readPositions(result!.geometry)
    expect(Math.min(...positions.map((point) => point.x))).toBeCloseTo(-4, 5)
    expect(Math.max(...positions.map((point) => point.x))).toBeCloseTo(4, 5)
    expect(result!.triangleCount).toBeGreaterThanOrEqual(8)
    result!.geometry.dispose()
  })

  it('uses only the hit instance of an InstancedMesh', () => {
    const geometry = new THREE.PlaneGeometry(2, 2)
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    const mesh = new THREE.InstancedMesh(geometry, material, 2)
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 0))
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(10, 0, 0))
    mesh.updateMatrixWorld(true)
    const result = buildSurfaceImageDecalGeometry({
      targets: [{ mesh: mesh as unknown as THREE.Mesh, instanceId: 0 }],
      projector: createProjector(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 1, 1),
      normalOffset: 0,
    })

    expect(result).not.toBeNull()
    const positions = readPositions(result!.geometry)
    expect(Math.min(...positions.map((point) => point.x))).toBeGreaterThanOrEqual(-0.5)
    expect(Math.max(...positions.map((point) => point.x))).toBeLessThanOrEqual(0.5)
    result!.geometry.dispose()
  })

  it('supports a target viewed from its back side and offsets toward that side', () => {
    const mesh = createPlane(2, 2)
    mesh.rotation.y = Math.PI
    mesh.updateMatrixWorld(true)
    const result = buildSurfaceImageDecalGeometry({
      targets: [{ mesh }],
      projector: createProjector(new THREE.Vector3(), new THREE.Vector3(0, 0, -1)),
    })

    expect(result).not.toBeNull()
    expect(readPositions(result!.geometry).every((point) => point.z > 0)).toBe(true)
    expect(readNormals(result!.geometry).every((normal) => normal.z > 0)).toBe(true)
    result!.geometry.dispose()
  })

  it('returns null when the projector misses all target triangles', () => {
    const mesh = createPlane(2, 2)
    const result = buildSurfaceImageDecalGeometry({
      targets: [{ mesh }],
      projector: createProjector(new THREE.Vector3(20, 0, 0), new THREE.Vector3(0, 0, 1)),
    })
    expect(result).toBeNull()
  })

  it('normalizes valid persisted metadata and rejects unavailable targets', () => {
    expect(normalizeSurfaceImageMetadata({
      version: 1,
      assetId: 'image-1',
      targetNodeId: 'node-1',
      attachmentMode: 'ancestor',
      widthMeters: 1,
      heightMeters: 0.5,
    })).toEqual({
      version: 1,
      assetId: 'image-1',
      targetNodeId: 'node-1',
      attachmentMode: 'ancestor',
      widthMeters: 1,
      heightMeters: 0.5,
    })
    expect(normalizeSurfaceImageMetadata({
      version: 1,
      assetId: 'image-1',
      targetNodeId: '',
      attachmentMode: 'world',
      widthMeters: 1,
      heightMeters: 0.5,
    })).toBeNull()
  })

  it('migrates legacy surface-image triangles so computed normals face local +Z', () => {
    const oriented = orientCompiledStaticMeshTrianglesTowardPositiveZ({
      version: 3,
      vertices: [
        -0.5, 0, 0,
        0, 0.5, 0,
        0.5, 0, 0,
      ],
      indices: [0, 1, 2],
      uvs: [0, 0, 0.5, 1, 1, 0],
    })
    const a = new THREE.Vector3().fromArray(oriented.vertices, oriented.indices[0]! * 3)
    const b = new THREE.Vector3().fromArray(oriented.vertices, oriented.indices[1]! * 3)
    const c = new THREE.Vector3().fromArray(oriented.vertices, oriented.indices[2]! * 3)
    const normal = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
    expect(normal.z).toBeGreaterThan(0)
    expect(oriented.uvs).toEqual([0, 0, 0.5, 1, 1, 0])
  })

  it('marks nested surface-image runtimes as owned so material traversal reaches their meshes', () => {
    const runtime = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
    runtime.userData.nodeId = 'surface-image'
    markSurfaceImageRuntimeOwnership('surface-image', runtime)
    expect(runtime.userData.nodeId).toBeUndefined()
    expect(runtime.userData.ownerNodeId).toBe('surface-image')
  })

  it('drops the snapshot transform before wrapping a copied surface image in its node container', () => {
    const runtimeSnapshot = new THREE.Group()
    runtimeSnapshot.position.set(3, 2, 1)
    runtimeSnapshot.rotation.set(0.2, 0.4, 0.1)
    runtimeSnapshot.scale.set(2, 2, 2)
    resetSurfaceImageRuntimeTransform(runtimeSnapshot)
    expect(runtimeSnapshot.position.toArray()).toEqual([0, 0, 0])
    expect(runtimeSnapshot.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0])
    expect(runtimeSnapshot.scale.toArray()).toEqual([1, 1, 1])
  })

  it('keeps transparent Surface Image materials visible in Preview and SceneryViewer without changing normal node hiding', () => {
    const surfaceNode = {
      userData: {
        __surfaceImage: {
          version: 1,
          assetId: 'image-1',
          targetNodeId: 'wall-1',
          attachmentMode: 'world',
          widthMeters: 1,
          heightMeters: 1,
        },
      },
      materials: [],
    } as unknown as Parameters<typeof resolvePreviewSurfaceMaterialOptions>[0]
    const baseOptions = { hideTransparentMaterials: true }
    expect(resolvePreviewSurfaceMaterialOptions(surfaceNode, baseOptions)).toEqual({
      hideTransparentMaterials: false,
    })

    const normalNode = { userData: {}, materials: [] } as unknown as typeof surfaceNode
    expect(resolvePreviewSurfaceMaterialOptions(normalNode, baseOptions)).toBe(baseOptions)
  })

  it('attaches to the target, nearest capable ancestor, or world with deterministic fallback', () => {
    const parents = new Map<string, string | null>([
      ['mesh', 'group'],
      ['group', null],
      ['orphan', null],
    ])
    const getParent = (nodeId: string): string | null => parents.get(nodeId) ?? null

    expect(resolveSurfaceImageAttachmentParent(
      'group',
      getParent,
      (nodeId) => nodeId === 'group',
    )).toEqual({ parentNodeId: 'group', attachmentMode: 'target' })

    expect(resolveSurfaceImageAttachmentParent(
      'mesh',
      getParent,
      (nodeId) => nodeId === 'group',
    )).toEqual({ parentNodeId: 'group', attachmentMode: 'ancestor' })

    expect(resolveSurfaceImageAttachmentParent(
      'orphan',
      getParent,
      () => false,
    )).toEqual({ parentNodeId: null, attachmentMode: 'world' })
  })
})
