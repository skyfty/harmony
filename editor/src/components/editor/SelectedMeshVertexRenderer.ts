import * as THREE from 'three'

const GROUP_NAME = '__SelectedMeshVertexRenderer'
const MAX_DISPLAY_VERTICES = 20000
const POINT_COLOR = 0xffb74d
const POINT_SIZE = 7

function isHelperObject(object: THREE.Object3D): boolean {
  const userData = object.userData as Record<string, unknown> | undefined
  if (userData?.editorOnly === true) {
    return true
  }
  return String(object.name ?? '').startsWith('__')
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    const points = child as THREE.Points
    points.geometry?.dispose?.()
    const material = points.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
}

function collectLocalVertices(root: THREE.Object3D): Float32Array | null {
  root.updateMatrixWorld(true)
  const inverseRootMatrix = root.matrixWorld.clone().invert()
  const positions: number[] = []
  const localVertex = new THREE.Vector3()
  const worldVertex = new THREE.Vector3()
  let totalVertexCount = 0

  root.traverse((child) => {
    if (isHelperObject(child)) {
      return
    }
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || (mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) {
      return
    }
    const position = mesh.geometry?.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position || position.itemSize < 3 || position.count <= 0) {
      return
    }
    totalVertexCount += position.count
    const stride = totalVertexCount > MAX_DISPLAY_VERTICES
      ? Math.max(1, Math.ceil(totalVertexCount / MAX_DISPLAY_VERTICES))
      : 1
    for (let index = 0; index < position.count; index += stride) {
      localVertex.fromBufferAttribute(position, index)
      worldVertex.copy(localVertex).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRootMatrix)
      positions.push(worldVertex.x, worldVertex.y, worldVertex.z)
    }
  })

  if (!positions.length) {
    return null
  }
  return new Float32Array(positions)
}

export type SelectedMeshVertexRenderer = {
  clear(): void
  ensure(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): { nodeId: string; vertexIndex: number; point: THREE.Vector3 } | null
}

export function createSelectedMeshVertexRenderer(): SelectedMeshVertexRenderer {
  let state: { nodeId: string; group: THREE.Group } | null = null

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
    isSelectionLocked: (nodeId: string) => boolean
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void {
    const selectedId = options.selectedNodeId
    if (!options.active || !selectedId || options.isSelectionLocked(selectedId)) {
      clear()
      return
    }
    const runtimeObject = options.resolveRuntimeObject(selectedId)
    if (!runtimeObject) {
      clear()
      return
    }
    const positions = collectLocalVertices(runtimeObject)
    if (!positions) {
      clear()
      return
    }
    if (state && state.nodeId === selectedId && runtimeObject.children.includes(state.group)) {
      return
    }
    clear()

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      color: POINT_COLOR,
      size: POINT_SIZE,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
    })
    const points = new THREE.Points(geometry, material)
    points.renderOrder = 100
    points.userData.editorOnly = true
    points.userData.pickableEditorOnly = false
    points.userData.nodeId = selectedId

    const group = new THREE.Group()
    group.name = GROUP_NAME
    group.userData.editorOnly = true
    group.add(points)
    runtimeObject.add(group)
    state = { nodeId: selectedId, group }
  }

  function pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): { nodeId: string; vertexIndex: number; point: THREE.Vector3 } | null {
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
    const first = intersections[0]
    if (!first || first.object?.type !== 'Points') {
      return null
    }
    const vertexIndex = typeof first.index === 'number' ? first.index : -1
    if (vertexIndex < 0) {
      return null
    }
    const nodeId = typeof first.object.userData?.nodeId === 'string' ? first.object.userData.nodeId : state.nodeId
    return {
      nodeId,
      vertexIndex,
      point: first.point.clone(),
    }
  }

  return { clear, ensure, pick }
}