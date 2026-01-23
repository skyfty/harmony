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

    pickSceneInstancedTargetAtPointer: (event: PointerEvent) => unknown | null
    tryEraseRepairTargetAtPointer: (event: PointerEvent, options?: { skipKey?: string | null }) => EraseRepairResult

    beginRepairClick: (event: PointerEvent) => void

    handleGroundEditorPointerDown: (event: PointerEvent) => boolean
  },
): PointerDownResult | null {
  // Scatter erase mode: left click (and drag) erases continuous instanced instances.
  // - If Ground is selected and we're not hovering an instanced target, allow ground-scatter erase to handle left click.
  if (ctx.scatterEraseModeActive && ctx.hasInstancedMeshes && event.button === 0) {
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
    // so the ground-scatter erase can handle left click.
  }

  // Scatter erase mode: if continuous instanced models exist, allow camera controls.
  // We only treat a left-click with minimal movement as an erase action, handled on pointerup.
  // If Ground is selected, let ground-scatter erase handle the click instead.
  if (ctx.scatterEraseModeActive && ctx.hasInstancedMeshes && event.button === 0 && !ctx.selectedNodeIsGround) {
    ctx.beginRepairClick(event)
    return { handled: true, clearPointerTrackingState: true }
  }

  if (ctx.handleGroundEditorPointerDown(event)) {
    return { handled: true, clearPointerTrackingState: true }
  }

  return null
}
