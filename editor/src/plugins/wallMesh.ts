import * as THREE from 'three'
import  {type WallDynamicMesh } from '@harmony/schema'

const DEFAULT_COLOR = 0xcfd2d6

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      const geometry = mesh.geometry
      if (geometry) {
        geometry.dispose()
      }
      const material = mesh.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose())
      } else if (material) {
        material.dispose()
      }
    }
  })
}

function createSegmentMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: DEFAULT_COLOR,
    metalness: 0,
    roughness: 0.92,
  })
  material.name = 'WallMaterial'
  material.side = THREE.DoubleSide
  return material
}

function directionToQuaternion(direction: THREE.Vector3): THREE.Quaternion {
  const base = new THREE.Vector3(1, 0, 0)
  const target = direction.clone().normalize()
  if (target.lengthSq() < 1e-6) {
    return new THREE.Quaternion()
  }
  return new THREE.Quaternion().setFromUnitVectors(base, target)
}

function rebuildWallGroup(group: THREE.Group, definition: WallDynamicMesh) {
  disposeObject3D(group)
  group.clear()

  if (!definition.segments.length) {
    return
  }

  definition.segments.forEach((segment, index) => {
    const start = new THREE.Vector3(segment.start.x, segment.start.y, segment.start.z)
    const end = new THREE.Vector3(segment.end.x, segment.end.y, segment.end.z)
    const direction = end.clone().sub(start)
    const length = direction.length()
    if (length <= 1e-6) {
      return
    }
    direction.normalize()
    const midpoint = new THREE.Vector3(
      (segment.start.x + segment.end.x) * 0.5,
      (segment.start.y + segment.end.y) * 0.5,
      (segment.start.z + segment.end.z) * 0.5,
    )

    const width = Math.max(1e-3, segment.width)
    const height = Math.max(1e-3, segment.height)

    const material = createSegmentMaterial()
    const geometry = new THREE.BoxGeometry(length, height, width)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true

    const wallBaseY = midpoint.y
    mesh.position.copy(midpoint)
    mesh.position.y = wallBaseY + height * 0.5
    mesh.quaternion.copy(directionToQuaternion(direction))

    const segmentGroup = new THREE.Group()
    segmentGroup.name = `WallSegment_${index + 1}`
    segmentGroup.userData.wallSegmentIndex = index
    mesh.userData.wallSegmentIndex = index
    segmentGroup.add(mesh)
    group.add(segmentGroup)
  })
}

export function createWallGroup(definition: WallDynamicMesh): THREE.Group {
  const group = new THREE.Group()
  group.name = 'WallGroup'
  group.userData.dynamicMeshType = 'Wall'
  rebuildWallGroup(group, definition)
  return group
}

export function updateWallGroup(object: THREE.Object3D, definition: WallDynamicMesh): boolean {
  const group = object as THREE.Group
  if (!group || !group.isGroup) {
    return false
  }
  rebuildWallGroup(group, definition)
  return true
}
