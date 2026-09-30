import * as THREE from 'three'
import type { RegionDynamicMesh } from '@schema/core'
import { hashString, stableSerialize } from '@schema/stableSerialize'

const FILL_Y_OFFSET = 0.2
const LINE_Y_OFFSET = 0.2
const REGION_FILL_COLOR = 0x607d8b
const REGION_FILL_OPACITY = 0.18
const REGION_OUTLINE_HALO_COLOR = 0x101418
const REGION_OUTLINE_CORE_COLOR = 0xffd54f
const REGION_OUTLINE_HALO_RADIUS = 0.075
const REGION_OUTLINE_CORE_RADIUS = 0.035

function toXZPoints(definition: RegionDynamicMesh): Array<[number, number]> {
  return (Array.isArray(definition.vertices) ? definition.vertices : [])
    .map((entry) => [Number(entry?.[0]), Number(entry?.[1])] as [number, number])
    .filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z))
}

function buildShape(points: Array<[number, number]>): THREE.Shape | null {
  if (points.length < 3) {
    return null
  }
  const shape = new THREE.Shape()
  const [firstX, firstZ] = points[0]!
  shape.moveTo(firstX, -firstZ)
  for (let index = 1; index < points.length; index += 1) {
    const [x, z] = points[index]!
    shape.lineTo(x, -z)
  }
  shape.closePath()
  return shape
}

export function computeRegionDynamicMeshSignature(definition: RegionDynamicMesh): string {
  return hashString(stableSerialize([toXZPoints(definition)]))
}

export function createRegionEditorGroup(definition: RegionDynamicMesh): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Region'
  group.userData.dynamicMeshType = 'Region'
  updateRegionEditorGroup(group, definition)
  return group
}

export function updateRegionEditorGroup(group: THREE.Group, definition: RegionDynamicMesh): void {
  const points = toXZPoints(definition)
  const shape = buildShape(points)

  const previousOutline = group.userData.regionLine as THREE.Group | undefined
  const previousFill = group.userData.regionFill as THREE.Mesh | undefined
  previousOutline?.traverse((child) => {
    (child as THREE.Mesh).geometry?.dispose?.()
    const material = (child as THREE.Mesh).material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
  previousFill?.geometry?.dispose?.()

  previousOutline?.removeFromParent()
  previousFill?.removeFromParent()

  const linePoints = points.map(([x, z]) => new THREE.Vector3(x, LINE_Y_OFFSET, z))
  const outline = new THREE.Group()
  outline.name = 'RegionOutline'
  outline.userData.dynamicMeshType = 'Region'
  const addOutlineSegment = (start: THREE.Vector3, end: THREE.Vector3, radius: number, color: number, renderOrder: number) => {
    const direction = end.clone().sub(start)
    const length = direction.length()
    if (!Number.isFinite(length) || length <= 1e-6) {
      return
    }
    const segment = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 12),
      new THREE.MeshBasicMaterial({ color, depthWrite: false }),
    )
    segment.position.copy(start).add(end).multiplyScalar(0.5)
    segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
    segment.renderOrder = renderOrder
    segment.userData.dynamicMeshType = 'Region'
    outline.add(segment)
  }
  if (linePoints.length >= 2) {
    for (let index = 0; index < linePoints.length; index += 1) {
      const start = linePoints[index]!
      const end = linePoints[(index + 1) % linePoints.length]!
      addOutlineSegment(start, end, REGION_OUTLINE_HALO_RADIUS, REGION_OUTLINE_HALO_COLOR, 101)
      addOutlineSegment(start, end, REGION_OUTLINE_CORE_RADIUS, REGION_OUTLINE_CORE_COLOR, 102)
    }
  }
  group.add(outline)
  group.userData.regionLine = outline

  if (!shape) {
    return
  }

  const fill = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({
      color: REGION_FILL_COLOR,
      transparent: true,
      opacity: REGION_FILL_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  fill.name = 'RegionFill'
  fill.rotation.x = -Math.PI / 2
  fill.position.y = FILL_Y_OFFSET
  fill.renderOrder = 100
  fill.userData.dynamicMeshType = 'Region'
  group.add(fill)
  group.userData.regionFill = fill
}
