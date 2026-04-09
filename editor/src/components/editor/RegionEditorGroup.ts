import * as THREE from 'three'
import type { RegionDynamicMesh } from '@schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'

const FILL_Y_OFFSET = 0.01
const LINE_Y_OFFSET = 0.04

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
  shape.moveTo(firstX, firstZ)
  for (let index = 1; index < points.length; index += 1) {
    const [x, z] = points[index]!
    shape.lineTo(x, z)
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

  const previousLine = group.userData.regionLine as THREE.LineLoop | undefined
  const previousFill = group.userData.regionFill as THREE.Mesh | undefined
  previousLine?.geometry?.dispose?.()
  previousFill?.geometry?.dispose?.()

  previousLine?.removeFromParent()
  previousFill?.removeFromParent()

  const linePoints = points.map(([x, z]) => new THREE.Vector3(x, LINE_Y_OFFSET, z))
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(linePoints.length >= 2 ? linePoints : [new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({
      color: 0x26a69a,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }),
  )
  line.renderOrder = 101
  line.name = 'RegionOutline'
  line.userData.dynamicMeshType = 'Region'
  group.add(line)
  group.userData.regionLine = line

  if (!shape) {
    return
  }

  const fill = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({
      color: 0x26a69a,
      transparent: true,
      opacity: 0.08,
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