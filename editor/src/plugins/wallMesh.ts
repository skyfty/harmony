import * as THREE from 'three'
import type { WallDynamicMesh, WallSegment } from '@/types/dynamic-mesh'

const DEFAULT_COLOR = 0xcfd2d6
const CAP_VISIBILITY_THRESHOLD = 0.5
const SEGMENT_ENDPOINT_EPSILON = 1e-4

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

function buildPanel(
  segment: WallSegment,
  direction: THREE.Vector3,
  perpendicular: THREE.Vector3,
  material: THREE.Material,
  { offsetAlongPerp = 0, offsetAlongDir = 0, width = 1, height = 1, depth = 0.2 },
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true

  const midpoint = new THREE.Vector3(
    (segment.start.x + segment.end.x) * 0.5,
    (segment.start.y + segment.end.y) * 0.5,
    (segment.start.z + segment.end.z) * 0.5,
  )
  const wallBaseY = midpoint.y
  const offset = perpendicular.clone().multiplyScalar(offsetAlongPerp)
  if (offsetAlongDir !== 0) {
    offset.add(direction.clone().multiplyScalar(offsetAlongDir))
  }
  mesh.position.copy(midpoint).add(offset)
  // Lift panel so its base aligns with the wall baseline instead of sinking below ground.
  mesh.position.y = wallBaseY + height * 0.5
  mesh.quaternion.copy(directionToQuaternion(direction))
  return mesh
}

function rebuildWallGroup(group: THREE.Group, definition: WallDynamicMesh) {
  disposeObject3D(group)
  group.clear()

  if (!definition.segments.length) {
    return
  }

  const segmentEndpoints = definition.segments.map((segment) => ({
    start: new THREE.Vector3(segment.start.x, segment.start.y, segment.start.z),
    end: new THREE.Vector3(segment.end.x, segment.end.y, segment.end.z),
  }))

  const pointsApproximatelyEqual = (a: THREE.Vector3, b: THREE.Vector3, epsilon = SEGMENT_ENDPOINT_EPSILON) =>
    a.distanceToSquared(b) <= epsilon * epsilon

  definition.segments.forEach((segment, index) => {
    const { start, end } = segmentEndpoints[index]!
    const direction = end.clone().sub(start)
    const length = direction.length()
    if (length <= 1e-6) {
      return
    }
    direction.normalize()
    const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x)
    if (perpendicular.lengthSq() < 1e-6) {
      perpendicular.set(0, 0, 1)
    } else {
      perpendicular.normalize()
    }

    const midpoint = new THREE.Vector3(
      (segment.start.x + segment.end.x) * 0.5,
      (segment.start.y + segment.end.y) * 0.5,
      (segment.start.z + segment.end.z) * 0.5,
    )

    const thickness = Math.max(1e-3, segment.thickness)
    const width = Math.max(thickness, segment.width)
    const height = Math.max(1e-3, segment.height)

    const hasNeighborAtStart = segmentEndpoints.some((candidate, candidateIndex) => {
      if (candidateIndex === index) {
        return false
      }
      return pointsApproximatelyEqual(start, candidate.start) || pointsApproximatelyEqual(start, candidate.end)
    })

    const hasNeighborAtEnd = segmentEndpoints.some((candidate, candidateIndex) => {
      if (candidateIndex === index) {
        return false
      }
      return pointsApproximatelyEqual(end, candidate.start) || pointsApproximatelyEqual(end, candidate.end)
    })

    const neighborOverlap = thickness * 0.5
    const expansionStart = hasNeighborAtStart ? neighborOverlap : 0
    const expansionEnd = hasNeighborAtEnd ? neighborOverlap : 0
    const effectiveLength = length + expansionStart + expansionEnd
    const alongDirOffset = (expansionEnd - expansionStart) * 0.5

    const material = createSegmentMaterial()

    const panels: THREE.Mesh[] = []
    const perpOffset = width * 0.5 - thickness * 0.5
    panels.push(
      buildPanel(segment, direction, perpendicular, material.clone(), {
        offsetAlongPerp: perpOffset,
        offsetAlongDir: alongDirOffset,
        width: effectiveLength,
        height,
        depth: thickness,
      }),
    )
    panels.push(
      buildPanel(segment, direction, perpendicular, material.clone(), {
        offsetAlongPerp: -perpOffset,
        offsetAlongDir: alongDirOffset,
        width: effectiveLength,
        height,
        depth: thickness,
      }),
    )

    if (width > CAP_VISIBILITY_THRESHOLD) {
      const dirOffsetStart = length * 0.5 + expansionStart - thickness * 0.5
      const dirOffsetEnd = length * 0.5 + expansionEnd - thickness * 0.5
      panels.push(
        buildPanel(segment, perpendicular, direction.clone().negate(), material.clone(), {
          offsetAlongPerp: dirOffsetStart,
          width: width,
          height,
          depth: thickness,
        }),
      )
      panels.push(
        buildPanel(segment, perpendicular.clone().negate(), direction, material.clone(), {
          offsetAlongPerp: dirOffsetEnd,
          width: width,
          height,
          depth: thickness,
        }),
      )
    }

  const baseHeight = Math.max(0.01, Math.min(thickness, 0.1))
    const baseMaterial = material.clone()
    const baseGeometry = new THREE.BoxGeometry(effectiveLength, baseHeight, width)
    const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial)
    baseMesh.castShadow = false
    baseMesh.receiveShadow = true
    const bottomCenter = midpoint.clone()
    bottomCenter.add(direction.clone().multiplyScalar(alongDirOffset))
    bottomCenter.y = midpoint.y - baseHeight * 0.5
    baseMesh.position.copy(bottomCenter)
    baseMesh.quaternion.copy(directionToQuaternion(direction))
    panels.push(baseMesh)

    const segmentGroup = new THREE.Group()
    segmentGroup.name = `WallSegment_${index + 1}`
    segmentGroup.userData.wallSegmentIndex = index
    panels.forEach((panel) => {
      panel.userData.wallSegmentIndex = index
      segmentGroup.add(panel)
    })
    group.add(segmentGroup)
  })
}

export function createWallGroup(definition: WallDynamicMesh): THREE.Group {
  const group = new THREE.Group()
  group.name = 'WallGroup'
  group.userData.dynamicMeshType = 'wall'
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
