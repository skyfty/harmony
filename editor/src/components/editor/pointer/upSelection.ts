import type * as THREE from 'three'
import type { SceneNode } from '@harmony/schema'
import type { PointerUpResult } from './types'
import type { PointerTrackingState } from '@/types/scene-viewport-pointer-tracking-state'

function resolveRotateAnchorIdForHit(
  hitNodeId: string,
  selectedNodeIds: string[],
  findSceneNode: (nodes: SceneNode[], nodeId: string) => SceneNode | null,
  sceneNodes: SceneNode[],
  isDescendant: (ancestorId: string, nodeId: string) => boolean,
): string | null {
  if (selectedNodeIds.includes(hitNodeId)) {
    return hitNodeId
  }

  const candidates = selectedNodeIds.filter((selectedId) => {
    const selectedNode = findSceneNode(sceneNodes, selectedId)
    return Boolean(selectedNode?.nodeType === 'Group' && isDescendant(selectedId, hitNodeId))
  })

  if (!candidates.length) {
    return null
  }
  if (candidates.length === 1) {
    return candidates[0]!
  }

  // Prefer the closest selected group ancestor.
  let best = candidates[0]!
  let bestScore = -1
  for (const candidate of candidates) {
    let score = 0
    for (const other of candidates) {
      if (other !== candidate && isDescendant(other, candidate)) {
        score += 1
      }
    }
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

export function handlePointerUpSelection(
  event: PointerEvent,
  ctx: {
    pointerTrackingState: PointerTrackingState | null
    clearPointerTrackingState: () => void
    pointerInteractionReleaseIfCaptured: (pointerId: number) => void

    transformControlsDragging: boolean

    restoreOrbitAfterSelectDrag: () => void
    updateGridHighlightFromObject: (object: THREE.Object3D) => void
    commitSelectionDragTransforms: (drag: any) => void
    sceneStoreEndTransformInteraction: () => void
    updateSelectionHighlights: () => void
    onSelectionDragEnd?: (nodeId: string) => void

    activeTool: string
    rotateActiveSelection: (primaryId: string) => void

    sceneSelectedNodeId: string | null
    selectedNodeIdProp: string | null
    selectedNodeIds: string[]
    sceneStoreIsNodeSelectionLocked: (nodeId: string) => boolean
    sceneStoreIsDescendant: (ancestorId: string, nodeId: string) => boolean
    findSceneNode: (nodes: SceneNode[], nodeId: string) => SceneNode | null
    sceneNodes: SceneNode[]

    pickNodeAtPointer: (event: PointerEvent) => any | null
    pickActiveSelectionBoundingBoxHit: (event: PointerEvent) => any | null

    handleClickSelection: (
      event: PointerEvent,
      trackingState: PointerTrackingState,
      options: { allowDeselectOnReselect: boolean },
    ) => void
  },
): PointerUpResult | null {
  if (!ctx.pointerTrackingState || event.pointerId !== ctx.pointerTrackingState.pointerId) {
    return null
  }

  const trackingState = ctx.pointerTrackingState
  ctx.clearPointerTrackingState()
  ctx.pointerInteractionReleaseIfCaptured(event.pointerId)

  if (ctx.transformControlsDragging) {
    return { handled: true }
  }

  const drag = trackingState.selectionDrag
  if (drag) {
    ctx.restoreOrbitAfterSelectDrag()
    ctx.updateGridHighlightFromObject(drag.object)
    if (drag.hasDragged) {
      ctx.commitSelectionDragTransforms(drag)
      ctx.sceneStoreEndTransformInteraction()
      ctx.updateSelectionHighlights()
      ctx.onSelectionDragEnd?.(drag.nodeId)
      return { handled: true }
    }
  }

  if (trackingState.button === 2) {
    if (!trackingState.moved) {
      if (ctx.activeTool === 'select') {
        const primaryId = ctx.sceneSelectedNodeId ?? ctx.selectedNodeIdProp ?? null
        const unlockedSelected = ctx.selectedNodeIds.filter((id) => !ctx.sceneStoreIsNodeSelectionLocked(id))
        const selectionForRotate = unlockedSelected.slice()
        if (primaryId && !ctx.sceneStoreIsNodeSelectionLocked(primaryId) && !selectionForRotate.includes(primaryId)) {
          selectionForRotate.push(primaryId)
        }

        if (selectionForRotate.length) {
          let hit = ctx.pickNodeAtPointer(event) ?? trackingState.hitResult
          if (!hit) {
            hit = ctx.pickActiveSelectionBoundingBoxHit(event)
          }

          const hitNodeId = hit?.nodeId as string | undefined
          const anchorId = hitNodeId
            ? resolveRotateAnchorIdForHit(
                hitNodeId,
                selectionForRotate,
                ctx.findSceneNode,
                ctx.sceneNodes,
                ctx.sceneStoreIsDescendant,
              )
            : null

          if (anchorId) {
            ctx.rotateActiveSelection(anchorId)
            return {
              handled: true,
              preventDefault: true,
              stopPropagation: true,
            }
          }
        }
      }

      return {
        handled: true,
        preventDefault: true,
        stopPropagation: true,
      }
    }
    return { handled: true }
  }

  if (trackingState.button !== 0) {
    return { handled: true }
  }

  if (trackingState.moved) {
    return { handled: true }
  }

  if (ctx.activeTool !== 'select' && trackingState.transformAxis) {
    return { handled: true }
  }

  ctx.handleClickSelection(event, trackingState, {
    allowDeselectOnReselect: ctx.activeTool === 'select',
  })

  return { handled: true }
}
