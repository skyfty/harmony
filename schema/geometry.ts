import * as THREE from 'three'
import type { GeometryType, SceneNodeType } from '@harmony/schema'

export type PrimitiveNodeLike = GeometryType | SceneNodeType | string | null | undefined

export interface PrimitiveGeometryOptions {
  latheSegments?: number
}

export interface PrimitiveMeshOptions extends PrimitiveGeometryOptions {
  material?: THREE.Material | THREE.Material[]
  color?: THREE.ColorRepresentation
  doubleSided?: boolean
  castShadow?: boolean
  receiveShadow?: boolean
  name?: string | null
}

const DEFAULT_GEOMETRY_TYPE: GeometryType = 'Box'
const DEFAULT_COLOR: THREE.ColorRepresentation = 0xffffff
const DEFAULT_LATHE_SEGMENTS = 24

const LATHE_PROFILE: readonly THREE.Vector2[] = Array.from({ length: 10 }, (_value, index) => {
  const angle = index * 0.2
  return new THREE.Vector2(Math.sin(angle) * 0.5 + 0.5, (index - 5) * 0.2)
})

const GEOMETRY_FACTORIES: Record<GeometryType, (options?: PrimitiveGeometryOptions) => THREE.BufferGeometry> = {
  Box: () => new THREE.BoxGeometry(1, 1, 1),
  Sphere: () => new THREE.SphereGeometry(0.5, 32, 16),
  Capsule: () => new THREE.CapsuleGeometry(0.5, 1, 16, 32),
  Circle: () => new THREE.CircleGeometry(0.5, 32),
  Cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32),
  Dodecahedron: () => new THREE.DodecahedronGeometry(0.6, 0),
  Icosahedron: () => new THREE.IcosahedronGeometry(0.6, 0),
  Lathe: (options) => new THREE.LatheGeometry([...LATHE_PROFILE], options?.latheSegments ?? DEFAULT_LATHE_SEGMENTS),
  Octahedron: () => new THREE.OctahedronGeometry(0.6, 0),
  Plane: () => new THREE.PlaneGeometry(1, 1, 1, 1),
  Ring: () => new THREE.RingGeometry(0.3, 0.6, 32),
  Torus: () => new THREE.TorusGeometry(0.5, 0.2, 16, 64),
  TorusKnot: () => new THREE.TorusKnotGeometry(0.4, 0.15, 120, 12),
}

export function isGeometryType(candidate: PrimitiveNodeLike): candidate is GeometryType {
  if (typeof candidate !== 'string') {
    return false
  }
  return candidate in GEOMETRY_FACTORIES
}

export function normalizeGeometryType(candidate: PrimitiveNodeLike): GeometryType {
  if (isGeometryType(candidate)) {
    return candidate
  }
  return DEFAULT_GEOMETRY_TYPE
}

export function createPrimitiveGeometry(
  type: PrimitiveNodeLike,
  options?: PrimitiveGeometryOptions,
): THREE.BufferGeometry {
  const geometryType = normalizeGeometryType(type)
  const factory = GEOMETRY_FACTORIES[geometryType] ?? GEOMETRY_FACTORIES[DEFAULT_GEOMETRY_TYPE]
  const geometry = factory(options)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function buildDefaultMaterial(color: THREE.ColorRepresentation, doubleSided?: boolean): THREE.Material {
  const material = new THREE.MeshStandardMaterial({ color })
  if (doubleSided) {
    material.side = THREE.DoubleSide
  }
  return material
}

export function createPrimitiveMesh(type: PrimitiveNodeLike, options?: PrimitiveMeshOptions): THREE.Mesh {
  const geometry = createPrimitiveGeometry(type, options)
  const material = options?.material ?? buildDefaultMaterial(options?.color ?? DEFAULT_COLOR, options?.doubleSided)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = options?.name ?? normalizeGeometryType(type)
  mesh.castShadow = options?.castShadow ?? true
  mesh.receiveShadow = options?.receiveShadow ?? true
  return mesh
}
