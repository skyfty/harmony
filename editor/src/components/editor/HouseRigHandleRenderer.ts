import * as THREE from 'three'
import type { SceneNode } from '@schema/core'
import {
  type HouseRigDimensionKey,
  type HouseRigHandles,
} from '@schema/houseRig'
import { getHouseRigRuntimeSnapshot } from '@schema/components'
import { getEndpointGizmoPartInfoFromObject, type EndpointGizmoPart } from './EndpointGizmo'
import { computeWorldUnitsPerPixel } from './handleScreenScaleUtils'
import { createHouseRigScaleGizmoObject } from './HouseRigScaleGizmo'

export const HOUSE_RIG_HANDLE_GROUP_NAME = '__HouseRigHandles'
const HOUSE_RIG_HANDLE_RENDER_ORDER = 1002
export const HOUSE_RIG_HANDLE_DIAMETER_PX = 54

export type HouseRigHandlePickResult = {
  nodeId: string
  dimension: HouseRigDimensionKey
  gizmoPart: EndpointGizmoPart
  point: THREE.Vector3
}

type HandleState = {
  nodeId: string
  signature: string
  group: THREE.Group
  handles: HouseRigHandles
  byDimension: Map<HouseRigDimensionKey, THREE.Object3D>
}

type RendererOptions = {
  active: boolean
  selectedNodeId: string | null
  isSelectionLocked: (nodeId: string) => boolean
  resolveNode: (nodeId: string) => SceneNode | null
  resolveRuntimeObject: (nodeId: string) => THREE.Object3D | null
}

function handlePosition(handles: HouseRigHandles, dimension: HouseRigDimensionKey): THREE.Vector3 {
  const value = handles[dimension]
  return new THREE.Vector3(value.x, value.y, value.z)
}

function signatureFor(nodeId: string, handles: HouseRigHandles): string {
  const entries = (['width', 'depth', 'wallHeight'] as HouseRigDimensionKey[]).map((key) => {
    const point = handles[key]
    return `${key}:${point.x.toFixed(5)},${point.y.toFixed(5)},${point.z.toFixed(5)}`
  })
  return `${nodeId}|${entries.join('|')}`
}

function disposeGroup(group: THREE.Group): void {
  group.children.forEach((child) => {
    const gizmo = child.userData?.endpointGizmo as { dispose?: () => void } | undefined
    gizmo?.dispose?.()
  })
}

export function createHouseRigHandleRenderer() {
  let state: HandleState | null = null
  let hovered: { nodeId: string; dimension: HouseRigDimensionKey; part: EndpointGizmoPart } | null = null
  let active: { nodeId: string; dimension: HouseRigDimensionKey; part: EndpointGizmoPart } | null = null
  const scratchWorld = new THREE.Vector3()
  const scratchCamera = new THREE.Vector3()
  const scratchParentScale = new THREE.Vector3(1, 1, 1)

  function clear(): void {
    if (!state) {
      return
    }
    const existing = state
    state = null
    existing.group.removeFromParent()
    disposeGroup(existing.group)
    hovered = null
    active = null
  }

  function refreshHighlight(): void {
    if (!state) {
      return
    }
    const currentState = state
    currentState.byDimension.forEach((handle, dimension) => {
      const gizmo = handle.userData?.endpointGizmo as
        | { clearStates?: () => void; setState?: (part: EndpointGizmoPart, state: 'normal' | 'hover' | 'active') => void }
        | undefined
      if (!gizmo?.clearStates || !gizmo.setState) {
        return
      }
      gizmo.clearStates()
      if (active?.nodeId === currentState.nodeId && active.dimension === dimension) {
        gizmo.setState(active.part, 'active')
      } else if (hovered?.nodeId === currentState.nodeId && hovered.dimension === dimension) {
        gizmo.setState(hovered.part, 'hover')
      }
    })
  }

  function attachOrRebuild(options: RendererOptions & { force?: boolean }): void {
    const nodeId = options.selectedNodeId
    if (!options.active || !nodeId || options.isSelectionLocked(nodeId)) {
      clear()
      return
    }
    const node = options.resolveNode(nodeId)
    const runtimeObject = options.resolveRuntimeObject(nodeId)
    const snapshot = getHouseRigRuntimeSnapshot(nodeId)
    if (!node || !runtimeObject || !snapshot?.plan) {
      clear()
      return
    }
    const handles = snapshot.plan.handles
    const signature = signatureFor(nodeId, handles)
    if (!options.force && state && state.nodeId === nodeId && state.signature === signature) {
      if (!runtimeObject.children.includes(state.group)) {
        runtimeObject.add(state.group)
      }
      return
    }

    clear()
    const group = new THREE.Group()
    group.name = HOUSE_RIG_HANDLE_GROUP_NAME
    group.userData.editorOnly = true
    group.userData.isHouseRigHandles = true
    const byDimension = new Map<HouseRigDimensionKey, THREE.Object3D>()
    const axes: Record<HouseRigDimensionKey, 'x' | 'y' | 'z'> = {
      width: 'x',
      depth: 'z',
      wallHeight: 'y',
    }
    const colors: Record<HouseRigDimensionKey, number> = {
      width: 0xff5252,
      depth: 0x448aff,
      wallHeight: 0x4caf50,
    }

    ;(['width', 'depth', 'wallHeight'] as HouseRigDimensionKey[]).forEach((dimension) => {
      const axis = axes[dimension]
      const gizmo = createHouseRigScaleGizmoObject({
        axis,
        renderOrder: HOUSE_RIG_HANDLE_RENDER_ORDER,
        color: colors[dimension],
      })
      const handle = gizmo.root
      handle.name = `HouseRig_${dimension}`
      handle.position.copy(handlePosition(handles, dimension))
      handle.layers.enableAll()
      handle.userData.isHouseRigHandle = true
      handle.userData.nodeId = nodeId
      handle.userData.houseRigDimension = dimension
      handle.userData.endpointGizmo = gizmo
      handle.userData.baseDiameter = gizmo.baseDiameter
      handle.traverse((child) => {
        const mesh = child as THREE.Mesh
        if (!mesh?.isMesh) {
          return
        }
        mesh.userData.isHouseRigHandle = true
        mesh.userData.nodeId = nodeId
        mesh.userData.houseRigDimension = dimension
      })
      group.add(handle)
      byDimension.set(dimension, handle)
    })

    runtimeObject.add(group)
    state = {
      nodeId,
      signature,
      group,
      handles: {
        width: { ...handles.width },
        depth: { ...handles.depth },
        wallHeight: { ...handles.wallHeight },
      },
      byDimension,
    }
    hovered = null
    active = null
  }

  function pick(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    event: PointerEvent
    pointer: THREE.Vector2
    raycaster: THREE.Raycaster
  }): HouseRigHandlePickResult | null {
    if (!state || !options.camera || !options.canvas) {
      return null
    }
    const rect = options.canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) {
      return null
    }
    const screenPickRadius = 26
    const candidates: Array<{ dimension: HouseRigDimensionKey; distance: number; point: THREE.Vector3 }> = []
    state.group.updateWorldMatrix(true, true)
    state.byDimension.forEach((handle, dimension) => {
      handle.getWorldPosition(scratchWorld)
      const projected = scratchWorld.clone().project(options.camera!)
      const screenX = rect.left + ((projected.x + 1) * 0.5) * rect.width
      const screenY = rect.top + ((1 - projected.y) * 0.5) * rect.height
      const distance = Math.hypot(options.event.clientX - screenX, options.event.clientY - screenY)
      if (distance <= screenPickRadius) {
        candidates.push({
          dimension,
          distance,
          point: scratchWorld.clone(),
        })
      }
    })
    const closest = candidates.sort((a, b) => a.distance - b.distance)[0] ?? null
    if (closest) {
      return {
        nodeId: state.nodeId,
        dimension: closest.dimension,
        gizmoPart:
          closest.dimension === 'width'
            ? 'px'
            : closest.dimension === 'wallHeight'
              ? 'py'
              : 'pz',
        point: closest.point,
      }
    }
    options.pointer.x = ((options.event.clientX - rect.left) / rect.width) * 2 - 1
    options.pointer.y = -((options.event.clientY - rect.top) / rect.height) * 2 + 1
    options.raycaster.setFromCamera(options.pointer, options.camera)
    state.group.updateWorldMatrix(true, true)
    const hit = options.raycaster.intersectObjects(state.group.children, true)[0]
    if (!hit) {
      return null
    }
    const target = hit.object
    const nodeId = typeof target.userData?.nodeId === 'string' ? target.userData.nodeId : ''
    const dimension = target.userData?.houseRigDimension as HouseRigDimensionKey | undefined
    const part = target.userData?.endpointGizmoPart as EndpointGizmoPart | undefined
    if (!nodeId || !dimension || !part || !getEndpointGizmoPartInfoFromObject(target)) {
      return null
    }
    return {
      nodeId,
      dimension,
      gizmoPart: part,
      point: hit.point.clone(),
    }
  }

  function updateHover(options: Parameters<typeof pick>[0]): void {
    const hit = pick(options)
    if (!hit) {
      if (hovered) {
        hovered = null
        refreshHighlight()
      }
      return
    }
    if (
      hovered?.nodeId === hit.nodeId
      && hovered.dimension === hit.dimension
      && hovered.part === hit.gizmoPart
    ) {
      return
    }
    hovered = {
      nodeId: hit.nodeId,
      dimension: hit.dimension,
      part: hit.gizmoPart,
    }
    refreshHighlight()
  }

  function updateAnchors(handles: HouseRigHandles, signatureNodeId?: string): void {
    if (!state) {
      return
    }
    state.handles = {
      width: { ...handles.width },
      depth: { ...handles.depth },
      wallHeight: { ...handles.wallHeight },
    }
    state.signature = signatureFor(signatureNodeId ?? state.nodeId, handles)
    state.byDimension.forEach((handle, dimension) => {
      handle.position.copy(handlePosition(handles, dimension))
    })
    state.group.updateMatrixWorld(true)
  }

  function updateScreenSize(options: {
    camera: THREE.Camera | null
    canvas: HTMLCanvasElement | null
    diameterPx?: number
  }): void {
    if (!state || !options.camera || !options.canvas) {
      return
    }
    const diameterPx = options.diameterPx ?? HOUSE_RIG_HANDLE_DIAMETER_PX
    const viewportHeight = Math.max(1, options.canvas.getBoundingClientRect().height)
    options.camera.getWorldPosition(scratchCamera)
    state.group.updateWorldMatrix(true, false)
    state.byDimension.forEach((handle) => {
      handle.getWorldPosition(scratchWorld)
      const distance = Math.max(1e-6, scratchWorld.distanceTo(scratchCamera))
      const unitsPerPixel = computeWorldUnitsPerPixel({
        camera: options.camera!,
        distance,
        viewportHeightPx: viewportHeight,
      })
      const baseDiameter =
        typeof handle.userData.baseDiameter === 'number' && handle.userData.baseDiameter > 1e-6
          ? handle.userData.baseDiameter
          : 1
      handle.parent?.getWorldScale(scratchParentScale)
      const parentScale = Math.max(
        1e-6,
        Math.max(scratchParentScale.x, scratchParentScale.y, scratchParentScale.z),
      )
      handle.scale.setScalar((diameterPx * unitsPerPixel) / (baseDiameter * parentScale))
    })
  }

  return {
    clear,
    clearHover: () => {
      hovered = null
      refreshHighlight()
    },
    setActive: (next: { nodeId: string; dimension: HouseRigDimensionKey; part: EndpointGizmoPart } | null) => {
      active = next
      refreshHighlight()
    },
    ensure: (options: RendererOptions) => attachOrRebuild(options),
    forceRebuild: (options: RendererOptions) => attachOrRebuild({ ...options, force: true }),
    pick,
    updateHover,
    updateAnchors,
    updateScreenSize,
    getState: () => state,
  }
}
