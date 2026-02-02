import * as THREE from 'three'
import type { WallDynamicMesh } from '@harmony/schema'
import { hashString, stableSerialize } from '@schema/stableSerialize'
import { splitWallSegmentsIntoChains } from './wallSegmentUtils'

export type WallEndpointHandleState = {
  nodeId: string
  group: THREE.Group
  signature: string
}

export type WallEndpointHandlePickResult = {
  nodeId: string
  chainStartIndex: number
  chainEndIndex: number
  endpointKind: 'start' | 'end'
  point: THREE.Vector3
}

export type WallEndpointRenderer = {
  clear(): void
  ensure(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveWallDefinition: (nodeId: string) => WallDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveWallDefinition: (nodeId: string) => WallDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }): void
  updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }): void
  pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): WallEndpointHandlePickResult | null
  getState(): WallEndpointHandleState | null
}

export const WALL_ENDPOINT_HANDLE_GROUP_NAME = '__WallEndpointHandles'
export const WALL_ENDPOINT_HANDLE_Y_OFFSET = 0.03

const WALL_ENDPOINT_HANDLE_RENDER_ORDER = 1001
const WALL_ENDPOINT_HANDLE_SCREEN_DIAMETER_PX = 12

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

function disposeWallEndpointHandleGroup(group: THREE.Group) {
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

function computeWallEndpointHandleSignature(definition: WallDynamicMesh): string {
  const segments = Array.isArray(definition.segments) ? definition.segments : []
  const serialized = stableSerialize(
    segments.map((s) => ({
      start: { x: Number((s as any).start?.x) || 0, y: Number((s as any).start?.y) || 0, z: Number((s as any).start?.z) || 0 },
      end: { x: Number((s as any).end?.x) || 0, y: Number((s as any).end?.y) || 0, z: Number((s as any).end?.z) || 0 },
    })),
  )
  return hashString(serialized)
}

function createWallEndpointHandleMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0x4caf50,
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

export function createWallEndpointRenderer(): WallEndpointRenderer {
  let state: WallEndpointHandleState | null = null
  const tmpWorldPos = new THREE.Vector3()

  function clear() {
    if (!state) {
      return
    }
    const existing = state
    state = null
    existing.group.removeFromParent()
    disposeWallEndpointHandleGroup(existing.group)
  }

  function attachOrRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveWallDefinition: (nodeId: string) => WallDynamicMesh | null
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

    const definition = options.resolveWallDefinition(selectedNodeId)
    if (!definition || definition.type !== 'Wall') {
      clear()
      return
    }

    const runtimeObject = options.resolveRuntimeObject(selectedNodeId)
    if (!runtimeObject) {
      clear()
      return
    }

    const signature = computeWallEndpointHandleSignature(definition)
    if (!options.force && state && state.nodeId === selectedNodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()

    const group = new THREE.Group()
    group.name = WALL_ENDPOINT_HANDLE_GROUP_NAME
    group.userData.isWallEndpointHandles = true
    group.userData.editorOnly = true

    const segments = Array.isArray(definition.segments) ? definition.segments : []
    if (!segments.length) {
      state = { nodeId: selectedNodeId, group, signature }
      runtimeObject.add(group)
      return
    }

    const sample = segments[0] as any
    const width = Number.isFinite(Number(sample?.width)) ? Math.max(0.2, Number(sample.width)) : 0.2
    const radius = Math.max(0.15, width * 0.75)

    const baseGeometry = new THREE.CircleGeometry(radius, 32)
    baseGeometry.rotateX(-Math.PI / 2)

    const baseMaterial = createWallEndpointHandleMaterial()

    const chainRanges = splitWallSegmentsIntoChains(segments as any[])
    chainRanges.forEach((range, chainIndex) => {
      const startSeg = segments[range.startIndex] as any
      const endSeg = segments[range.endIndex] as any
      if (!startSeg || !endSeg) {
        return
      }

      const start = startSeg.start
      const end = endSeg.end
      if (!start || !end) {
        return
      }

      const addHandle = (kind: 'start' | 'end', point: any) => {
        const x = Number(point?.x)
        const y = Number(point?.y)
        const z = Number(point?.z)
        if (!Number.isFinite(x + z)) {
          return
        }
        const mesh = new THREE.Mesh(baseGeometry.clone(), baseMaterial.clone())
        mesh.name = `WallEndpointHandle_${chainIndex + 1}_${kind}`
        mesh.position.set(x, (Number.isFinite(y) ? y : 0) + WALL_ENDPOINT_HANDLE_Y_OFFSET, z)
        mesh.renderOrder = WALL_ENDPOINT_HANDLE_RENDER_ORDER
        mesh.layers.enableAll()
        mesh.userData.editorOnly = true
        mesh.userData.isWallEndpointHandle = true
        mesh.userData.nodeId = selectedNodeId
        mesh.userData.chainStartIndex = range.startIndex
        mesh.userData.chainEndIndex = range.endIndex
        mesh.userData.endpointKind = kind
        mesh.userData.baseDiameter = radius * 2
        group.add(mesh)
      }

      addHandle('start', start)
      addHandle('end', end)
    })

    runtimeObject.add(group)
    state = { nodeId: selectedNodeId, group, signature }
  }

  function ensure(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveWallDefinition: (nodeId: string) => WallDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }) {
    attachOrRebuild({ ...options, force: false })
  }

  function forceRebuild(options: {
    active: boolean
    selectedNodeId: string | null
    isSelectionLocked: (nodeId: string) => boolean
    resolveWallDefinition: (nodeId: string) => WallDynamicMesh | null
    resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
  }) {
    attachOrRebuild({ ...options, force: true })
  }

  function updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }) {
    if (!state || !options.camera || !options.canvas) {
      return
    }

    const diameterPx = Number.isFinite(options.diameterPx)
      ? Math.max(1, Number(options.diameterPx))
      : WALL_ENDPOINT_HANDLE_SCREEN_DIAMETER_PX

    const rect = options.canvas.getBoundingClientRect()
    if (rect.height <= 0) {
      return
    }

    state.group.updateWorldMatrix(true, true)

    for (const child of state.group.children) {
      const mesh = child as THREE.Mesh
      if (!mesh?.isMesh) {
        continue
      }
      const baseDiameter = Number(mesh.userData?.baseDiameter)
      if (!Number.isFinite(baseDiameter) || baseDiameter <= 1e-6) {
        continue
      }

      mesh.getWorldPosition(tmpWorldPos)
      const distance = tmpWorldPos.distanceTo((options.camera as any).position ?? new THREE.Vector3())
      const unitsPerPixel = computeWorldUnitsPerPixel({
        camera: options.camera,
        distance,
        viewportHeightPx: rect.height,
      })
      const desiredDiameterWorld = unitsPerPixel * diameterPx
      const scale = desiredDiameterWorld / baseDiameter
      if (!Number.isFinite(scale) || scale <= 0) {
        continue
      }
      mesh.scale.setScalar(scale)
    }
  }

  function pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): WallEndpointHandlePickResult | null {
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
    const chainStartIndex = Math.trunc(Number(target.userData?.chainStartIndex))
    const chainEndIndex = Math.trunc(Number(target.userData?.chainEndIndex))
    const endpointKind = target.userData?.endpointKind === 'end' ? 'end' : 'start'

    if (!nodeId || chainStartIndex < 0 || chainEndIndex < chainStartIndex) {
      return null
    }

    return {
      nodeId,
      chainStartIndex,
      chainEndIndex,
      endpointKind,
      point: first.point.clone(),
    }
  }

  return {
    clear,
    ensure,
    forceRebuild,
    updateScreenSize,
    pick,
    getState: () => state,
  }
}
