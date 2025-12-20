import * as THREE from 'three'
import type { RoadDynamicMesh } from '@harmony/schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'

export type RoadVertexHandleState = {
  nodeId: string
  group: THREE.Group
  signature: string
}

export type RoadVertexHandlePickResult = {
  nodeId: string
  vertexIndex: number
  point: THREE.Vector3
}

export type RoadVertexRenderer = {
  clear(): void
  ensure(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRoadDefinition: (nodeId: string) => RoadDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): RoadVertexHandlePickResult | null
  // Useful when external code wants to refresh even if signatures match.
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRoadDefinition: (nodeId: string) => RoadDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  getState(): RoadVertexHandleState | null
}

const ROAD_VERTEX_HANDLE_Y_OFFSET = 0.03
const ROAD_VERTEX_HANDLE_RENDER_ORDER = 1001
const HANDLE_GROUP_NAME = '__RoadVertexHandles'

function disposeRoadVertexHandleGroup(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      mesh.geometry?.dispose?.()
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) {
        mat.forEach((entry) => entry?.dispose?.())
      } else {
        mat?.dispose?.()
      }
    }
  })
}

function computeRoadVertexHandleSignature(definition: RoadDynamicMesh): string {
  const serialized = stableSerialize([
    Array.isArray(definition.vertices) ? definition.vertices : [],
    Number.isFinite(definition.width) ? definition.width : null,
  ])
  return hashString(serialized)
}

function createRoadVertexHandleMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffc107,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  })
  material.polygonOffset = true
  material.polygonOffsetFactor = -2
  material.polygonOffsetUnits = -2
  return material
}

export function createRoadVertexRenderer(): RoadVertexRenderer {
  let state: RoadVertexHandleState | null = null

  function clear() {
    if (!state) {
      return
    }
    const existing = state
    state = null
    existing.group.removeFromParent()
    disposeRoadVertexHandleGroup(existing.group)
  }

  function attachOrRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRoadDefinition: (nodeId: string) => RoadDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
    force?: boolean
  }) {
    const { active, selectedNodeId } = options

    if (!active || !selectedNodeId) {
      clear()
      return
    }

    if (options.isSelectionLocked(selectedNodeId)) {
      clear()
      return
    }

    const definition = options.resolveRoadDefinition(selectedNodeId)
    if (!definition || definition.type !== 'Road') {
      clear()
      return
    }

    const runtimeObject = options.resolveRuntimeObject(selectedNodeId)
    if (!runtimeObject) {
      clear()
      return
    }

    const signature = computeRoadVertexHandleSignature(definition)
    if (!options.force && state && state.nodeId === selectedNodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()

    const group = new THREE.Group()
    group.name = HANDLE_GROUP_NAME
    group.userData.isRoadVertexHandles = true

    const width = Number.isFinite(definition.width) ? Math.max(0.2, definition.width) : 2
    const radius = Math.max(0.1, width * 0.5)

    const baseGeometry = new THREE.CircleGeometry(radius, 32)
    baseGeometry.rotateX(-Math.PI / 2)

    const baseMaterial = createRoadVertexHandleMaterial()

    const vertices = Array.isArray(definition.vertices) ? definition.vertices : []
    vertices.forEach((v, index) => {
      if (!Array.isArray(v) || v.length < 2) {
        return
      }
      const x = Number(v[0])
      const z = Number(v[1])
      if (!Number.isFinite(x) || !Number.isFinite(z)) {
        return
      }
      const mesh = new THREE.Mesh(baseGeometry.clone(), baseMaterial.clone())
      mesh.name = `RoadVertexHandle_${index + 1}`
      mesh.position.set(x, ROAD_VERTEX_HANDLE_Y_OFFSET, z)
      mesh.renderOrder = ROAD_VERTEX_HANDLE_RENDER_ORDER
      mesh.layers.enableAll()
      mesh.userData.isRoadVertexHandle = true
      mesh.userData.nodeId = selectedNodeId
      mesh.userData.roadVertexIndex = index
      group.add(mesh)
    })

    runtimeObject.add(group)
    state = { nodeId: selectedNodeId, group, signature }
  }

  function ensure(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRoadDefinition: (nodeId: string) => RoadDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }) {
    attachOrRebuild({ ...options, force: false })
  }

  function forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveRoadDefinition: (nodeId: string) => RoadDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }) {
    attachOrRebuild({ ...options, force: true })
  }

  function pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): RoadVertexHandlePickResult | null {
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

    const target = first.object as THREE.Object3D
    const nodeId = typeof target.userData?.nodeId === 'string' ? target.userData.nodeId : ''
    const vertexIndexRaw = target.userData?.roadVertexIndex
    const vertexIndex =
      typeof vertexIndexRaw === 'number' && Number.isFinite(vertexIndexRaw)
        ? Math.max(0, Math.floor(vertexIndexRaw))
        : -1

    if (!nodeId || vertexIndex < 0) {
      return null
    }

    return { nodeId, vertexIndex, point: first.point.clone() }
  }

  function getState() {
    return state
  }

  return { clear, ensure, forceRebuild, pick, getState }
}

export const ROAD_VERTEX_HANDLE_GROUP_NAME = HANDLE_GROUP_NAME
export const ROAD_VERTEX_HANDLE_Y = ROAD_VERTEX_HANDLE_Y_OFFSET
