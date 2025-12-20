import * as THREE from 'three'
import type { RoadDynamicMesh } from '@harmony/schema'
import { MATERIAL_CONFIG_ID_KEY } from './material'

export type RoadRenderAssetObjects = {
  bodyObject?: THREE.Object3D | null
}

const DEFAULT_COLOR = 0x4b4f55

// Lift the road surface slightly above the ground plane to avoid z-fighting.
const ROAD_SURFACE_Y_OFFSET = 0.01

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
  material.name = 'RoadMaterial'
  material.side = THREE.DoubleSide
  return material
}

const ROAD_EPSILON = 1e-6

function directionToQuaternionFromXAxis(direction: THREE.Vector3): THREE.Quaternion {
  const base = new THREE.Vector3(1, 0, 0)
  const target = direction.clone().normalize()
  if (target.lengthSq() < ROAD_EPSILON) {
    return new THREE.Quaternion()
  }
  return new THREE.Quaternion().setFromUnitVectors(base, target)
}

function forEachRoadSegment(
  definition: RoadDynamicMesh,
  visit: (
    segment: { start: THREE.Vector3; end: THREE.Vector3; width: number; materialId: string | null },
    index: number,
  ) => void,
): void {
  const vertices = Array.isArray(definition.vertices) ? definition.vertices : []
  const segments = Array.isArray(definition.segments) ? definition.segments : []
  const width = Number.isFinite(definition.width) ? Math.max(1e-3, definition.width) : 2

  segments.forEach((segment, index) => {
    const a = vertices[segment.a]
    const b = vertices[segment.b]
    if (!a || !b || a.length < 2 || b.length < 2) {
      return
    }
    const start = new THREE.Vector3(a[0] ?? 0, 0, a[1] ?? 0)
    const end = new THREE.Vector3(b[0] ?? 0, 0, b[1] ?? 0)
    if (start.distanceToSquared(end) <= ROAD_EPSILON) {
      return
    }
    const rawMaterialId = typeof segment.materialId === 'string' ? segment.materialId.trim() : ''
    visit({ start, end, width, materialId: rawMaterialId || null }, index)
  })
}

function rebuildRoadGroup(group: THREE.Group, definition: RoadDynamicMesh) {
  disposeObject3D(group)
  group.clear()

  const material = createSegmentMaterial()

  forEachRoadSegment(definition, ({ start, end, width, materialId }, index) => {
    const direction = end.clone().sub(start)
    const length = direction.length()
    if (length <= ROAD_EPSILON) {
      return
    }

    const midpoint = start.clone().add(end).multiplyScalar(0.5)

    const geometry = new THREE.PlaneGeometry(length, width)
    geometry.rotateX(-Math.PI / 2)

    const mesh = new THREE.Mesh(geometry, material.clone())
    mesh.name = `RoadSegment_${index + 1}`
    mesh.castShadow = false
    mesh.receiveShadow = true

    const quaternion = directionToQuaternionFromXAxis(new THREE.Vector3(direction.x, 0, direction.z))
    mesh.position.copy(midpoint)
    mesh.quaternion.copy(quaternion)

    const segmentGroup = new THREE.Group()
    segmentGroup.name = `RoadSegmentGroup_${index + 1}`
    segmentGroup.userData.roadSegmentIndex = index
    mesh.userData.roadSegmentIndex = index
    mesh.userData[MATERIAL_CONFIG_ID_KEY] = materialId
    segmentGroup.add(mesh)
    group.add(segmentGroup)
  })
}

function ensureRoadContentGroup(root: THREE.Group): THREE.Group {
  const existing = root.getObjectByName('__RoadContent')
  if (existing && (existing as THREE.Group).isGroup) {
    return existing as THREE.Group
  }

  const content = new THREE.Group()
  content.name = '__RoadContent'
  content.position.y = ROAD_SURFACE_Y_OFFSET
  root.add(content)
  return content
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
    // For road bodies, instanceId aligns with segment index.
    instanced.userData.roadSegmentIndexMode = 'instanceId'
    for (let i = 0; i < instanceMatrices.length; i += 1) {
      instanced.setMatrixAt(i, instanceMatrices[i]!)
    }
    instanced.instanceMatrix.needsUpdate = true
    group.add(instanced)
  })

  return group
}

function computeRoadBodyInstanceMatrices(definition: RoadDynamicMesh, templateObject: THREE.Object3D): THREE.Matrix4[] {
  const bounds = computeObjectBounds(templateObject)
  const baseLength = Math.max(Math.abs(bounds.max.x - bounds.min.x), 1e-3)
  const baseWidth = Math.max(
    Math.max(Math.abs(bounds.max.z - bounds.min.z), Math.abs(bounds.max.y - bounds.min.y)),
    1e-3,
  )

  const matrices: THREE.Matrix4[] = []
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()

  forEachRoadSegment(definition, ({ start, end, width }) => {
    const direction = end.clone().sub(start)
    const length = direction.length()
    if (length <= ROAD_EPSILON) {
      return
    }

    const quaternion = directionToQuaternionFromXAxis(new THREE.Vector3(direction.x, 0, direction.z))
    position.copy(start).add(end).multiplyScalar(0.5)
    scale.set(length / baseLength, 1, width / baseWidth)

    const matrix = new THREE.Matrix4().compose(position, quaternion, scale)
    matrices.push(matrix)
  })

  return matrices
}

export function createRoadRenderGroup(definition: RoadDynamicMesh, assets: RoadRenderAssetObjects = {}): THREE.Group {
  const group = new THREE.Group()
  group.name = 'RoadGroup'
  group.userData.dynamicMeshType = 'Road'

  const content = ensureRoadContentGroup(group)

  let hasInstances = false
  if (assets.bodyObject) {
    const matrices = computeRoadBodyInstanceMatrices(definition, assets.bodyObject)
    const instancedGroup = buildInstancedMeshesFromTemplate(assets.bodyObject, matrices, { namePrefix: 'RoadBody' })
    if (instancedGroup) {
      hasInstances = true
      content.add(instancedGroup)
    }
  }

  if (!hasInstances) {
    rebuildRoadGroup(content, definition)
  }

  return group
}

export function createRoadGroup(definition: RoadDynamicMesh): THREE.Group {
  const group = new THREE.Group()
  group.name = 'RoadGroup'
  group.userData.dynamicMeshType = 'Road'
  const content = ensureRoadContentGroup(group)
  rebuildRoadGroup(content, definition)
  return group
}

export function updateRoadGroup(object: THREE.Object3D, definition: RoadDynamicMesh): boolean {
  const group = object as THREE.Group
  if (!group || !group.isGroup) {
    return false
  }

  const content = ensureRoadContentGroup(group)
  rebuildRoadGroup(content, definition)
  return true
}
