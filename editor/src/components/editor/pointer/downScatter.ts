import type * as THREE from 'three'
import type { SceneNode } from '@harmony/schema'
import type { PointerDownResult, InstancedEraseDragState } from './types'

type EraseRepairResult = {
  handled: boolean
  erasedKey?: string | null
}

export function handlePointerDownScatter(
  event: PointerEvent,
  ctx: {
    scatterEraseModeActive: boolean
    hasInstancedMeshes: boolean
    selectedNodeIsGround: boolean

    activeTool: string
    activeBuildTool: string | null

    selectedNodeId: string | null
    nodes: SceneNode[]
    objectMap: Map<string, THREE.Object3D>

    isNodeSelectionLocked: (nodeId: string) => boolean
    findSceneNode: (nodes: SceneNode[], nodeId: string) => SceneNode | null

    beginContinuousInstancedCreate: (event: PointerEvent, node: SceneNode, object: THREE.Object3D) => boolean

    pickSceneInstancedTargetAtPointer: (event: PointerEvent) => unknown | null
    tryEraseRepairTargetAtPointer: (event: PointerEvent, options?: { skipKey?: string | null }) => EraseRepairResult

    beginRepairClick: (event: PointerEvent) => void

    handleGroundEditorPointerDown: (event: PointerEvent) => boolean
  },
): PointerDownResult | null {
  // Scatter erase mode: middle click (and drag) erases continuous instanced instances.
  // - If Ground is selected and we're not hovering an instanced target, allow ground-scatter erase to handle middle click.
  if (ctx.scatterEraseModeActive && ctx.hasInstancedMeshes && event.button === 1) {
    const hit = ctx.pickSceneInstancedTargetAtPointer(event)
    if (hit || !ctx.selectedNodeIsGround) {
      const dragState: InstancedEraseDragState = {
        pointerId: event.pointerId,
        lastKey: null,
        lastAtMs: 0,
      }

      const result = ctx.tryEraseRepairTargetAtPointer(event)
      if (result.handled && result.erasedKey) {
        dragState.lastKey = result.erasedKey
        dragState.lastAtMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
      }

      return {
        handled: true,
        clearPointerTrackingState: true,
        nextInstancedEraseDragState: dragState,
        capturePointerId: event.pointerId,
        preventDefault: true,
        stopPropagation: true,
        stopImmediatePropagation: true,
      }
    }
    // If Ground is selected and no instanced target is under the cursor, fall through
    // so the ground-scatter erase can handle middle click.
  }

  // Middle mouse triggers continuous instanced creation (allows left/right for camera pan/rotate).
  if (
    !ctx.scatterEraseModeActive &&
    event.button === 1 &&
    ctx.activeTool === 'select' &&
    ctx.activeBuildTool !== 'wall' &&
    ctx.activeBuildTool !== 'road' &&
    ctx.activeBuildTool !== 'floor'
  ) {
    const nodeId = ctx.selectedNodeId
    if (nodeId && !ctx.isNodeSelectionLocked(nodeId)) {
      const node = ctx.findSceneNode(ctx.nodes, nodeId)
      const object = ctx.objectMap.get(nodeId) ?? null
      if (node && object) {
        const handled = ctx.beginContinuousInstancedCreate(event, node, object)
        if (handled) {
          return { handled: true, clearPointerTrackingState: true }
        }
      }
    }
  }

  // Scatter erase mode: if continuous instanced models exist, allow camera controls.
  // We only treat a left-click with minimal movement as an erase action, handled on pointerup.
  if (ctx.scatterEraseModeActive && ctx.hasInstancedMeshes && event.button === 0) {
    ctx.beginRepairClick(event)
    return { handled: true, clearPointerTrackingState: true }
  }

  if (ctx.handleGroundEditorPointerDown(event)) {
    return { handled: true, clearPointerTrackingState: true }
  }

  return null
}
