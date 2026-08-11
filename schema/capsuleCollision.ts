import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

export type CapsuleInfo = {
  segment: THREE.Line3
  radius: number
}

export type CapsuleCollisionHit = {
  normal: THREE.Vector3
  depth: number
  mesh: THREE.Mesh
}

export type GroundProbe = {
  point: THREE.Vector3
  normal: THREE.Vector3
  distance: number
  object: THREE.Object3D
}

export type CapsuleCollisionWorld = {
  addMesh(mesh: THREE.Mesh): void
  removeMesh(mesh: THREE.Mesh): void
  clear(): void
  ensureBVH(mesh: THREE.Mesh): void
  resolveCapsule(object: THREE.Object3D, capsule: CapsuleInfo): CapsuleCollisionHit[]
  probeGround(origin: THREE.Vector3, maxDistance: number): GroundProbe | null
}

type CollisionTemps = {
  inverseMatrix: THREE.Matrix4
  localSegment: THREE.Line3
  localBounds: THREE.Box3
  closestSegment: THREE.Vector3
  closestTriangle: THREE.Vector3
  worldCorrection: THREE.Vector3
  worldNormal: THREE.Vector3
}

function createCollisionTemps(): CollisionTemps {
  return {
    inverseMatrix: new THREE.Matrix4(),
    localSegment: new THREE.Line3(),
    localBounds: new THREE.Box3(),
    closestSegment: new THREE.Vector3(),
    closestTriangle: new THREE.Vector3(),
    worldCorrection: new THREE.Vector3(),
    worldNormal: new THREE.Vector3(),
  }
}

const bvhCache = new WeakMap<THREE.BufferGeometry, MeshBVH>()

function getGeometryBVH(geometry: THREE.BufferGeometry): MeshBVH {
  const geometryWithTree = geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }
  if (geometryWithTree.boundsTree) {
    return geometryWithTree.boundsTree
  }
  const cached = bvhCache.get(geometry)
  if (cached) {
    geometryWithTree.boundsTree = cached
    return cached
  }
  const tree = new MeshBVH(geometry)
  geometryWithTree.boundsTree = tree
  bvhCache.set(geometry, tree)
  return tree
}

function isRaycastMesh(mesh: THREE.Mesh): boolean {
  return Boolean(mesh.geometry && mesh.geometry.attributes.position)
}

function resolveCapsuleAgainstMesh(
  object: THREE.Object3D,
  capsule: CapsuleInfo,
  mesh: THREE.Mesh,
  temps: CollisionTemps,
): CapsuleCollisionHit | null {
  if (!isRaycastMesh(mesh)) return null

  const boundsTree = getGeometryBVH(mesh.geometry)
  mesh.updateWorldMatrix(true, false)
  object.updateWorldMatrix(true, false)

  temps.inverseMatrix.copy(mesh.matrixWorld).invert()
  temps.localSegment.start
    .copy(capsule.segment.start)
    .applyMatrix4(object.matrixWorld)
    .applyMatrix4(temps.inverseMatrix)
  temps.localSegment.end
    .copy(capsule.segment.end)
    .applyMatrix4(object.matrixWorld)
    .applyMatrix4(temps.inverseMatrix)

  temps.localBounds.makeEmpty()
    .expandByPoint(temps.localSegment.start)
    .expandByPoint(temps.localSegment.end)
    .expandByScalar(capsule.radius)

  let maxDepth = 0
  let bestNormal: THREE.Vector3 | null = null
  boundsTree.shapecast({
    intersectsBounds: (box: THREE.Box3) => box.intersectsBox(temps.localBounds),
    intersectsTriangle: (triangle: any) => {
      const distance = triangle.closestPointToSegment(
        temps.localSegment,
        temps.closestSegment,
        temps.closestTriangle,
      ) as number
      if (!(distance < capsule.radius)) return

      const direction = temps.worldNormal
        .copy(temps.closestTriangle)
        .sub(temps.closestSegment)
      if (direction.lengthSq() < 1e-10) {
        triangle.getNormal(direction)
      }
      if (direction.lengthSq() < 1e-10) return
      direction.normalize()

      const depth = capsule.radius - distance
      temps.localSegment.start.addScaledVector(direction, depth)
      temps.localSegment.end.addScaledVector(direction, depth)
      if (depth > maxDepth) {
        maxDepth = depth
        bestNormal = direction.clone()
      }
    },
  })

  if (!bestNormal || maxDepth <= 0) return null
  temps.worldCorrection.copy(bestNormal).transformDirection(mesh.matrixWorld).normalize()
  return {
    normal: temps.worldCorrection.clone(),
    depth: maxDepth,
    mesh,
  }
}

export function createCapsuleCollisionWorld(): CapsuleCollisionWorld {
  const meshes = new Set<THREE.Mesh>()
  const raycaster = new THREE.Raycaster()
  const rayDirection = new THREE.Vector3(0, -1, 0)
  const temps = createCollisionTemps()

  return {
    addMesh(mesh) {
      if (isRaycastMesh(mesh)) {
        meshes.add(mesh)
        getGeometryBVH(mesh.geometry)
      }
    },
    removeMesh(mesh) {
      meshes.delete(mesh)
    },
    clear() {
      meshes.clear()
    },
    ensureBVH(mesh) {
      if (isRaycastMesh(mesh)) getGeometryBVH(mesh.geometry)
    },
    resolveCapsule(object, capsule) {
      const hits: CapsuleCollisionHit[] = []
      for (const mesh of meshes) {
        const hit = resolveCapsuleAgainstMesh(object, capsule, mesh, temps)
        if (hit) hits.push(hit)
      }
      return hits
    },
    probeGround(origin, maxDistance) {
      raycaster.set(origin, rayDirection)
      raycaster.far = Math.max(0, maxDistance)
      const intersections = raycaster.intersectObjects(Array.from(meshes), false)
      const hit = intersections.find((entry) => entry.distance <= maxDistance)
      if (!hit) return null

      const normal = hit.face?.normal
        ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
        : new THREE.Vector3(0, 1, 0)
      return {
        point: hit.point.clone(),
        normal,
        distance: hit.distance,
        object: hit.object,
      }
    },
  }
}

