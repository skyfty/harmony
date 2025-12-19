import * as THREE from 'three'
import  {type WallDynamicMesh } from '@harmony/schema'

export type WallRenderAssetObjects = {
  bodyObject?: THREE.Object3D | null
  jointObject?: THREE.Object3D | null
}

const DEFAULT_COLOR = 0xcfd2d6

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (mesh.isMesh) {
      const geometry = mesh.geometry
      if (geometry) {
        geometry.dispose()
      }
      const material = mesh.material
      if (Array.isArray(material)) {
        material.forEach((entry: THREE.Material) => entry.dispose())
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

function collectInstancableMeshes(object: THREE.Object3D): Array<THREE.Mesh> {
  const meshes: Array<THREE.Mesh> = []
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (!mesh || !(mesh as unknown as { isMesh?: boolean }).isMesh) {
      return
    }
    if (!mesh.geometry || !mesh.material) {
      return
    }
    meshes.push(mesh)
  })
  return meshes
}

function computeObjectBounds(object: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  box.setFromObject(object)
  return box
}

const WALL_INSTANCE_EPSILON = 1e-6

function directionToQuaternionFromXAxis(direction: THREE.Vector3): THREE.Quaternion {
  const base = new THREE.Vector3(1, 0, 0)
  const target = direction.clone().normalize()
  if (target.lengthSq() < WALL_INSTANCE_EPSILON) {
    return new THREE.Quaternion()
  }
  return new THREE.Quaternion().setFromUnitVectors(base, target)
}

function buildInstancedMeshesFromTemplate(
  templateObject: THREE.Object3D,
  instanceMatrices: THREE.Matrix4[],
  options: { namePrefix: string },
): THREE.Group | null {
  const templates = collectInstancableMeshes(templateObject)
  if (!templates.length || !instanceMatrices.length) {
    return null
  }

  const group = new THREE.Group()
  group.name = options.namePrefix

  templates.forEach((template, index) => {
    const instanced = new THREE.InstancedMesh(template.geometry, template.material as any, instanceMatrices.length)
    instanced.name = `${options.namePrefix}_${index + 1}`
    instanced.castShadow = template.castShadow
    instanced.receiveShadow = template.receiveShadow
    for (let i = 0; i < instanceMatrices.length; i += 1) {
      instanced.setMatrixAt(i, instanceMatrices[i]!)
    }
    instanced.instanceMatrix.needsUpdate = true
    group.add(instanced)
  })

  return group
}

function computeWallBodyInstanceMatrices(definition: WallDynamicMesh, templateObject: THREE.Object3D): THREE.Matrix4[] {
  const bounds = computeObjectBounds(templateObject)
  const baseLength = Math.max(Math.abs(bounds.max.x - bounds.min.x), 1e-3)

  const matrices: THREE.Matrix4[] = []
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const direction = new THREE.Vector3()
  definition.segments.forEach((segment) => {
    const start = new THREE.Vector3(segment.start.x, segment.start.y, segment.start.z)
    const end = new THREE.Vector3(segment.end.x, segment.end.y, segment.end.z)
    direction.copy(end).sub(start)
    const length = direction.length()
    if (length <= WALL_INSTANCE_EPSILON) {
      return
    }

    const quaternion = directionToQuaternionFromXAxis(direction)
    position.set(
      (segment.start.x + segment.end.x) * 0.5,
      (segment.start.y + segment.end.y) * 0.5,
      (segment.start.z + segment.end.z) * 0.5,
    )
    scale.set(length / baseLength, 1, 1)

    const matrix = new THREE.Matrix4().compose(position, quaternion, scale)
    matrices.push(matrix)
  })

  return matrices
}

function computeWallJointInstanceMatrices(definition: WallDynamicMesh): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = []
  if (definition.segments.length < 2) {
    return matrices
  }

  const inDir = new THREE.Vector3()
  const outDir = new THREE.Vector3()
  const bisector = new THREE.Vector3()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3(1, 1, 1)

  for (let i = 0; i < definition.segments.length - 1; i += 1) {
    const prev = definition.segments[i]
    const next = definition.segments[i + 1]
    if (!prev || !next) {
      continue
    }

    const prevStart = new THREE.Vector3(prev.start.x, prev.start.y, prev.start.z)
    const prevEnd = new THREE.Vector3(prev.end.x, prev.end.y, prev.end.z)
    const nextStart = new THREE.Vector3(next.start.x, next.start.y, next.start.z)
    const nextEnd = new THREE.Vector3(next.end.x, next.end.y, next.end.z)

    inDir.copy(prevEnd).sub(prevStart)
    outDir.copy(nextEnd).sub(nextStart)

    if (inDir.lengthSq() <= WALL_INSTANCE_EPSILON || outDir.lengthSq() <= WALL_INSTANCE_EPSILON) {
      continue
    }
    inDir.normalize()
    outDir.normalize()

    const angle = inDir.angleTo(outDir)
    if (!Number.isFinite(angle) || angle <= 1e-3) {
      continue
    }

    bisector.copy(inDir).add(outDir)
    if (bisector.lengthSq() <= WALL_INSTANCE_EPSILON) {
      bisector.copy(outDir)
    }
    bisector.normalize()

    const quaternion = directionToQuaternionFromXAxis(bisector)
    position.set(prev.end.x, prev.end.y, prev.end.z)
    const matrix = new THREE.Matrix4().compose(position, quaternion, scale)
    matrices.push(matrix)
  }

  return matrices
}

export function createWallRenderGroup(
  definition: WallDynamicMesh,
  assets: WallRenderAssetObjects = {},
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'WallGroup'
  group.userData.dynamicMeshType = 'Wall'

  const canUseBody = Boolean(assets.bodyObject)
  const canUseJoint = Boolean(assets.jointObject)

  let hasBodyInstances = false
  if (canUseBody && assets.bodyObject) {
    const bodyMatrices = computeWallBodyInstanceMatrices(definition, assets.bodyObject)
    const bodyInstancedGroup = buildInstancedMeshesFromTemplate(assets.bodyObject, bodyMatrices, { namePrefix: 'WallBody' })
    if (bodyInstancedGroup) {
      hasBodyInstances = true
      group.add(bodyInstancedGroup)
    }
  }

  if (!hasBodyInstances) {
    rebuildWallGroup(group, definition)
  }

  if (canUseJoint && assets.jointObject) {
    const jointMatrices = computeWallJointInstanceMatrices(definition)
    const jointInstancedGroup = buildInstancedMeshesFromTemplate(
      assets.jointObject,
      jointMatrices,
      { namePrefix: 'WallJoint' },
    )
    if (jointInstancedGroup) {
      group.add(jointInstancedGroup)
    }
  }

  return group
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
