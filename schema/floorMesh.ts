import * as THREE from 'three'
import type { FloorDynamicMesh } from '@harmony/schema'

export type FloorRenderAssetObjects = {
  surfaceObject?: THREE.Object3D | null
}

function buildFloorGeometry(definition: FloorDynamicMesh): THREE.BufferGeometry {
  const footprint = Array.isArray(definition.points) ? definition.points : []
  if (footprint.length < 3) {
    return new THREE.BufferGeometry()
  }

  const shape = new THREE.Shape()
  const first = footprint[0]!
  shape.moveTo(first.x, first.y)
  for (let index = 1; index < footprint.length; index += 1) {
    const vertex = footprint[index]!
    shape.lineTo(vertex.x, vertex.y)
  }

  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function createFloorMesh(definition: FloorDynamicMesh): THREE.Mesh {
  const geometry = buildFloorGeometry(definition)
  const material = new THREE.MeshStandardMaterial({
    color: '#9ea7ad',
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'Floor'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.dynamicMeshType = 'Floor'
  return mesh
}

export function updateFloorMesh(mesh: THREE.Mesh, definition: FloorDynamicMesh): void {
  const nextGeometry = buildFloorGeometry(definition)
  const previous = mesh.geometry
  mesh.geometry = nextGeometry
  if (previous) {
    previous.dispose()
  }
}

export function createFloorRenderGroup(
  definition: FloorDynamicMesh,
  assets: FloorRenderAssetObjects,
): THREE.Object3D {
  const asset = assets.surfaceObject ?? null
  if (asset) {
    // Asset-backed render path: show the imported model, but keep a dynamic fallback.
    // (Mirrors wall behavior: assets are optional and dynamic mesh is always available.)
    const group = new THREE.Group()
    group.name = 'Floor'
    const clone = asset.clone(true)
    clone.name = clone.name || 'FloorAsset'
    group.add(clone)

    const fallback = createFloorMesh(definition)
    fallback.name = 'FloorDynamicFallback'
    fallback.visible = false
    group.add(fallback)

    group.userData.dynamicMeshType = 'Floor'
    group.userData.floorRenderMode = 'asset'
    return group
  }

  const mesh = createFloorMesh(definition)
  mesh.userData.floorRenderMode = 'dynamic'
  return mesh
}

export function updateFloorRenderGroup(object: THREE.Object3D, definition: FloorDynamicMesh): void {
  const mode = object.userData?.floorRenderMode as string | undefined
  if (mode === 'asset' && (object as THREE.Group).isGroup) {
    const group = object as THREE.Group
    const fallback = group.children.find((child) => child.name === 'FloorDynamicFallback') as THREE.Mesh | undefined
    if (fallback && (fallback as any).isMesh) {
      updateFloorMesh(fallback, definition)
    }
    return
  }

  const mesh = object as THREE.Mesh
  if ((mesh as any).isMesh) {
    updateFloorMesh(mesh, definition)
  }
}
