import * as THREE from 'three'
import type { SurfaceDynamicMesh } from '@harmony/schema'

function buildSurfaceGeometry(definition: SurfaceDynamicMesh): THREE.BufferGeometry {
  const footprint = Array.isArray(definition.points) ? definition.points : []
  if (footprint.length < 3) {
    return new THREE.BufferGeometry()
  }

  const shape = new THREE.Shape()
  const first = footprint[0]!
  shape.moveTo(first.x, first.z)
  for (let index = 1; index < footprint.length; index += 1) {
    const vertex = footprint[index]!
    shape.lineTo(vertex.x, vertex.z)
  }

  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function createSurfaceMesh(definition: SurfaceDynamicMesh): THREE.Mesh {
  const geometry = buildSurfaceGeometry(definition)
  const material = new THREE.MeshStandardMaterial({
    color: '#9ea7ad',
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'Surface'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.dynamicMeshType = 'Surface'
  return mesh
}

export function updateSurfaceMesh(mesh: THREE.Mesh, definition: SurfaceDynamicMesh): void {
  const nextGeometry = buildSurfaceGeometry(definition)
  const previous = mesh.geometry
  mesh.geometry = nextGeometry
  if (previous) {
    previous.dispose()
  }
}
