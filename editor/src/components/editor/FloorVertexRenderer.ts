import * as THREE from 'three'
import type { FloorDynamicMesh } from '@harmony/schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'

export type FloorVertexHandleState = {
  nodeId: string
  group: THREE.Group
  signature: string
}

export type FloorVertexHandlePickResult = {
  nodeId: string
  vertexIndex: number
  point: THREE.Vector3
}

export type FloorVertexRenderer = {
  clear(): void
  ensure(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveFloorDefinition: (nodeId: string) => FloorDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveFloorDefinition: (nodeId: string) => FloorDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): FloorVertexHandlePickResult | null
  updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }): void
  getState(): FloorVertexHandleState | null
}

const FLOOR_VERTEX_HANDLE_Y_OFFSET = 0.03
const FLOOR_VERTEX_HANDLE_RENDER_ORDER = 1001
const FLOOR_VERTEX_HANDLE_GROUP_NAME = '__FloorVertexHandles'
const FLOOR_VERTEX_HANDLE_SCREEN_DIAMETER_PX = 12
const FLOOR_VERTEX_HANDLE_COLOR = 0xff4081

function computeFloorVertexHandleSignature(definition: FloorDynamicMesh): string {
  const vertices = Array.isArray(definition.vertices) ? definition.vertices : []
  const serialized = stableSerialize(vertices)
  return hashString(serialized)
}

function createFloorVertexHandleMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: FLOOR_VERTEX_HANDLE_COLOR,
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

function disposeFloorVertexHandleGroup(group: THREE.Group) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh?.isMesh) {
      mesh.geometry?.dispose?.()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) {
        material.forEach((entry) => entry?.dispose?.())
      } else {
        material?.dispose?.()
      }
    }
  })
}

function computeWorldUnitsPerPixel(options: {
  camera: THREE.Camera
  distance: number
  viewportHeightPx: number
}): number {
  const { camera, distance, viewportHeightPx } = options
  const safeHeight = Math.max(1, viewportHeightPx)

  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const perspective = camera as THREE.PerspectiveCamera
    const vFovRad = THREE.MathUtils.degToRad(perspective.fov)
    const worldHeight = 2 * Math.max(1e-6, distance) * Math.tan(vFovRad / 2)
    return worldHeight / safeHeight
  }

  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as THREE.OrthographicCamera
    const worldHeight = Math.abs((ortho.top - ortho.bottom) / Math.max(1e-6, ortho.zoom))
    return worldHeight / safeHeight
  }

  return Math.max(1e-6, distance) / safeHeight
}

export function createFloorVertexRenderer(): FloorVertexRenderer {
  let state: FloorVertexHandleState | null = null
  const tmpWorldPos = new THREE.Vector3()

  function clear() {
    if (!state) {
      return
    }
    const existing = state
    state = null
    existing.group.removeFromParent()
    disposeFloorVertexHandleGroup(existing.group)
  }

  function attachOrRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveFloorDefinition: (nodeId: string) => FloorDynamicMesh | null
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

    const definition = options.resolveFloorDefinition(selectedNodeId)
    if (!definition || definition.type !== 'Floor') {
      clear()
      return
    }

    const runtimeObject = options.resolveRuntimeObject(selectedNodeId)
    if (!runtimeObject) {
      clear()
      return
    }

    const signature = computeFloorVertexHandleSignature(definition)
    if (!options.force && state && state.nodeId === selectedNodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()

    const group = new THREE.Group()
    group.name = FLOOR_VERTEX_HANDLE_GROUP_NAME
    group.userData.isFloorVertexHandles = true

    const radius = 0.25
    const baseGeometry = new THREE.CircleGeometry(radius, 32)
    baseGeometry.rotateX(-Math.PI / 2)

    const baseMaterial = createFloorVertexHandleMaterial()

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
      mesh.name = `FloorVertexHandle_${index + 1}`
      mesh.position.set(x, FLOOR_VERTEX_HANDLE_Y_OFFSET, -z)
      mesh.renderOrder = FLOOR_VERTEX_HANDLE_RENDER_ORDER
      mesh.layers.enableAll()
      mesh.userData.isFloorVertexHandle = true
      mesh.userData.nodeId = selectedNodeId
      mesh.userData.floorVertexIndex = index
      mesh.userData.baseDiameter = radius * 2
      group.add(mesh)
    })

    runtimeObject.add(group)
    state = { nodeId: selectedNodeId, group, signature }
  }

  function ensure(options: Parameters<FloorVertexRenderer['ensure']>[0]) {
    attachOrRebuild({ ...options, force: false })
  }

  function forceRebuild(options: Parameters<FloorVertexRenderer['ensure']>[0]) {
    attachOrRebuild({ ...options, force: true })
  }

  function pick(options: Parameters<FloorVertexRenderer['pick']>[0]): FloorVertexHandlePickResult | null {
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
    const vertexIndexRaw = target.userData?.floorVertexIndex
    const vertexIndex =
      typeof vertexIndexRaw === 'number' && Number.isFinite(vertexIndexRaw)
        ? Math.max(0, Math.floor(vertexIndexRaw))
        : -1

    if (!nodeId || vertexIndex < 0) {
      return null
    }

    return { nodeId, vertexIndex, point: first.point.clone() }
  }

  function updateScreenSize(options: Parameters<FloorVertexRenderer['updateScreenSize']>[0]) {
    if (!state || !options.camera || !options.canvas) {
      return
    }

    const diameterPx =
      typeof options.diameterPx === 'number' && Number.isFinite(options.diameterPx) && options.diameterPx > 0
        ? options.diameterPx
        : FLOOR_VERTEX_HANDLE_SCREEN_DIAMETER_PX

    const viewportHeightPx = Math.max(1, options.canvas.getBoundingClientRect().height)

    state.group.updateWorldMatrix(true, false)
    for (const child of state.group.children) {
      const mesh = child as THREE.Mesh
      if (!mesh?.isMesh) {
        continue
      }

      const baseDiameterRaw = mesh.userData?.baseDiameter
      const baseDiameter =
        typeof baseDiameterRaw === 'number' && Number.isFinite(baseDiameterRaw) && baseDiameterRaw > 1e-6
          ? baseDiameterRaw
          : 1

      mesh.getWorldPosition(tmpWorldPos)
      const distance = Math.max(1e-6, tmpWorldPos.distanceTo(options.camera.position))
      const unitsPerPx = computeWorldUnitsPerPixel({ camera: options.camera, distance, viewportHeightPx })
      const desiredWorldDiameter = Math.max(1e-6, diameterPx * unitsPerPx)
      const scale = THREE.MathUtils.clamp(desiredWorldDiameter / baseDiameter, 1e-4, 1e6)
      mesh.scale.setScalar(scale)
    }
  }

  function getState() {
    return state
  }

  return { clear, ensure, forceRebuild, pick, updateScreenSize, getState }
}

export { FLOOR_VERTEX_HANDLE_GROUP_NAME, FLOOR_VERTEX_HANDLE_Y_OFFSET as FLOOR_VERTEX_HANDLE_Y }
