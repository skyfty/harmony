import * as THREE from 'three'
import type { ModelCollisionDynamicMesh } from '@schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'

const GROUP_NAME = '__ModelCollisionFaceOverlay'
const FILL_COLOR = 0xff7043
const SELECTED_COLOR = 0xffcc80

function computeSignature(definition: ModelCollisionDynamicMesh | null, selectedFaceId: string | null): string {
  return hashString(stableSerialize({ definition, selectedFaceId }))
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    const drawable = child as THREE.Mesh | THREE.LineSegments
    drawable.geometry?.dispose?.()
    const material = drawable.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
}

function computeNormal(vertices: THREE.Vector3[]): THREE.Vector3 | null {
  if (vertices.length < 3) {
    return null
  }
  const normal = new THREE.Vector3()
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!
    const next = vertices[(index + 1) % vertices.length]!
    normal.x += (current.y - next.y) * (current.z + next.z)
    normal.y += (current.z - next.z) * (current.x + next.x)
    normal.z += (current.x - next.x) * (current.y + next.y)
  }
  if (normal.lengthSq() <= 1e-10) {
    return null
  }
  return normal.normalize()
}

function buildFaceGeometry(vertices: THREE.Vector3[]): THREE.BufferGeometry | null {
  const normal = computeNormal(vertices)
  if (!normal) {
    return null
  }
  const seed = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  const tangent = seed.cross(normal).normalize()
  const bitangent = normal.clone().cross(tangent).normalize()
  const origin = vertices.reduce((sum, entry) => sum.add(entry), new THREE.Vector3()).multiplyScalar(1 / vertices.length)
  const outline2D: THREE.Vector2[] = []
  const planarVertices: THREE.Vector3[] = []
  const helper = new THREE.Vector3()
  for (const vertex of vertices) {
    helper.copy(vertex).sub(origin)
    const u = helper.dot(tangent)
    const v = helper.dot(bitangent)
    outline2D.push(new THREE.Vector2(u, v))
    planarVertices.push(origin.clone().addScaledVector(tangent, u).addScaledVector(bitangent, v))
  }
  const triangles = THREE.ShapeUtils.triangulateShape(outline2D, [])
  if (!triangles.length) {
    return null
  }
  const positions: number[] = []
  for (const triangle of triangles) {
    if (!Array.isArray(triangle) || triangle.length !== 3) {
      continue
    }
    for (const index of triangle) {
      const point = planarVertices[index ?? -1]
      if (!point) {
        continue
      }
      positions.push(point.x, point.y, point.z)
    }
  }
  if (!positions.length) {
    return null
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

export type ModelCollisionFaceOverlayPickResult = {
  nodeId: string
  faceId: string
}

export type ModelCollisionFaceOverlayRenderer = {
  clear(): void
  ensure(options: {
    active: boolean
    selectedNodeId: string | null
    selectedFaceId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveDefinition: (nodeId: string) => ModelCollisionDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: MouseEvent | PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): ModelCollisionFaceOverlayPickResult | null
}

export function createModelCollisionFaceOverlayRenderer(): ModelCollisionFaceOverlayRenderer {
  let state: { nodeId: string; group: THREE.Group; signature: string } | null = null

  function clear(): void {
    if (!state) {
      return
    }
    const existing = state
    state = null
    existing.group.removeFromParent()
    disposeGroup(existing.group)
  }

  function ensure(options: {
    active: boolean
    selectedNodeId: string | null
    selectedFaceId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveDefinition: (nodeId: string) => ModelCollisionDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void {
    const selectedId = options.selectedNodeId
    if (!options.active || !selectedId || options.isSelectionLocked(selectedId)) {
      clear()
      return
    }
    const runtimeObject = options.resolveRuntimeObject(selectedId)
    const definition = options.resolveDefinition(selectedId)
    if (!runtimeObject || !definition || !Array.isArray(definition.faces) || !definition.faces.length) {
      clear()
      return
    }
    const signature = computeSignature(definition, options.selectedFaceId)
    if (state && state.nodeId === selectedId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }
    clear()

    const group = new THREE.Group()
    group.name = GROUP_NAME
    group.userData.editorOnly = true
    definition.faces.forEach((face) => {
      const vertices = Array.isArray(face?.vertices)
        ? face.vertices
          .map((vertex) => new THREE.Vector3(Number(vertex?.x), Number(vertex?.y), Number(vertex?.z)))
          .filter((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.z))
        : []
      if (vertices.length < 3) {
        return
      }
      const geometry = buildFaceGeometry(vertices)
      if (!geometry) {
        return
      }
      const selected = options.selectedFaceId === face.id
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: selected ? SELECTED_COLOR : FILL_COLOR,
          transparent: true,
          opacity: selected ? 0.38 : 0.2,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      )
      mesh.renderOrder = 102
      mesh.userData.editorOnly = true
      mesh.userData.pickableEditorOnly = true
      mesh.userData.modelCollisionFaceId = face.id
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({
          color: selected ? SELECTED_COLOR : FILL_COLOR,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
        }),
      )
      edges.renderOrder = 103
      edges.userData.editorOnly = true
      edges.userData.pickableEditorOnly = true
      edges.userData.modelCollisionFaceId = face.id
      const faceGroup = new THREE.Group()
      faceGroup.userData.editorOnly = true
      faceGroup.userData.pickableEditorOnly = true
      faceGroup.userData.modelCollisionFaceId = face.id
      faceGroup.add(mesh)
      faceGroup.add(edges)
      group.add(faceGroup)
    })
    runtimeObject.add(group)
    state = { nodeId: selectedId, group, signature }
  }

  function pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: MouseEvent | PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): ModelCollisionFaceOverlayPickResult | null {
    if (!state || !options.camera || !options.canvas) {
      return null
    }
    const rect = options.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }
    options.pointer.x = ((options.event.clientX - rect.left) / rect.width) * 2 - 1
    options.pointer.y = -((options.event.clientY - rect.top) / rect.height) * 2 + 1
    options.raycaster.setFromCamera(options.pointer, options.camera)
    state.group.updateWorldMatrix(true, true)
    const intersections = options.raycaster.intersectObjects(state.group.children, true)
    intersections.sort((a, b) => a.distance - b.distance)
    const first = intersections[0]
    if (!first) {
      return null
    }
    let current: THREE.Object3D | null = first.object
    while (current) {
      const faceId = typeof current.userData?.modelCollisionFaceId === 'string' ? current.userData.modelCollisionFaceId : null
      if (faceId) {
        return { nodeId: state.nodeId, faceId }
      }
      current = current.parent ?? null
    }
    return null
  }

  return { clear, ensure, pick }
}