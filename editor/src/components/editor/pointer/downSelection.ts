import * as THREE from 'three'
import type { SceneNode } from '@harmony/schema'
import type { PointerDownResult } from './types'
import type { PointerTrackingState } from '@/types/scene-viewport-pointer-tracking-state'
import type { NodeHitResult } from '@/types/scene-viewport-node-hit-result'

type SelectionHit = {
  nodeId: string
  object: THREE.Object3D
  point: THREE.Vector3
}

function resolveDragAnchorIdForHit(
  hitNodeId: string,
  selectedNodeIds: string[],
  isDescendant: (ancestorId: string, nodeId: string) => boolean,
): string | null {
  if (selectedNodeIds.includes(hitNodeId)) {
    return hitNodeId
  }

  const candidates = selectedNodeIds.filter((selectedId) => isDescendant(selectedId, hitNodeId))
  if (!candidates.length) {
    return null
  }
  if (candidates.length === 1) {
    return candidates[0]!
  }

  // Prefer the closest selected ancestor (deepest in the hierarchy).
  // Approximate depth by choosing the candidate that has the most other candidates as ancestors.
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

export async function handlePointerDownSelection(
  event: PointerEvent,
  ctx: {
    activeTool: string

    selectedNodeIdProp: string | null
    sceneSelectedNodeId: string | null
    selectedNodeIds: string[]

    nodes: SceneNode[]
    findSceneNode: (nodes: SceneNode[], nodeId: string) => SceneNode | null

    isNodeSelectionLocked: (nodeId: string) => boolean
    isDescendant: (ancestorId: string, nodeId: string) => boolean

    duplicateNodes: (nodeIds: string[], options: { select: boolean }) => string[]
    ensureSceneAssetsReady: (options: { nodes: SceneNode[]; showOverlay: boolean; refreshViewport: boolean }) => Promise<void>

    nextTick: () => Promise<void>

    objectMap: Map<string, THREE.Object3D>

    pickNodeAtPointer: (event: PointerEvent) => NodeHitResult | null
    pickActiveSelectionBoundingBoxHit: (event: PointerEvent) => SelectionHit | null

    transformControlsDragging: boolean
    transformControlsAxis: string | null

    createSelectionDragState: (nodeId: string, object: THREE.Object3D, point: THREE.Vector3, event: PointerEvent) => unknown
    disableOrbitForSelectDrag: () => void
  },
): Promise<PointerDownResult | null> {
  const button = event.button
  const isSelectionButton = button === 0 || button === 2

  if (!isSelectionButton) {
    return { handled: true, clearPointerTrackingState: true }
  }

  if (ctx.transformControlsDragging) {
    return { handled: true, clearPointerTrackingState: true }
  }

  const shouldPickForRightClick = button === 2 && ctx.activeTool === 'select'
  let hit: NodeHitResult | null = button === 0 || shouldPickForRightClick ? ctx.pickNodeAtPointer(event) : null
  const initialHitPoint = hit ? hit.point.clone() : null

  const primaryBeforeDuplicate = ctx.sceneSelectedNodeId ?? ctx.selectedNodeIdProp ?? null

  if (
    button === 0 &&
    ctx.activeTool === 'select' &&
    hit &&
    (event.ctrlKey || event.metaKey) &&
    primaryBeforeDuplicate &&
    hit.nodeId === primaryBeforeDuplicate &&
    !ctx.isNodeSelectionLocked(hit.nodeId)
  ) {
    const unlockedSelection = ctx.selectedNodeIds.filter((id) => !ctx.isNodeSelectionLocked(id))
    const idsToDuplicate = unlockedSelection.length ? unlockedSelection : [hit.nodeId]
    const duplicateIds = ctx.duplicateNodes(idsToDuplicate, { select: true })

    if (duplicateIds.length) {
      const duplicateNodes = duplicateIds
        .map((id) => ctx.findSceneNode(ctx.nodes, id))
        .filter((node): node is SceneNode => Boolean(node))

      if (duplicateNodes.length) {
        await ctx.ensureSceneAssetsReady({ nodes: duplicateNodes, showOverlay: false, refreshViewport: false })
      }

      await ctx.nextTick()
      await ctx.nextTick()

      const updatedHit = ctx.pickNodeAtPointer(event)
      if (updatedHit && duplicateIds.includes(updatedHit.nodeId)) {
        hit = updatedHit
      } else {
        const primaryId = ctx.sceneSelectedNodeId ?? null
        if (primaryId) {
          const object = ctx.objectMap.get(primaryId) ?? null
          if (object) {
            object.updateMatrixWorld(true)
            const fallbackPoint = initialHitPoint
              ? initialHitPoint.clone()
              : (() => {
                  const world = new THREE.Vector3()
                  object.getWorldPosition(world)
                  return world
                })()
            hit = {
              nodeId: primaryId,
              object,
              point: fallbackPoint,
            } as unknown as NodeHitResult
          }
        }
      }
    }
  }

  if (!hit && shouldPickForRightClick) {
    const boundingHit = ctx.pickActiveSelectionBoundingBoxHit(event)
    if (boundingHit) {
      hit = boundingHit as unknown as NodeHitResult
    }
  }

  const currentPrimaryId = ctx.sceneSelectedNodeId ?? ctx.selectedNodeIdProp ?? null

  const allowBoundingBoxDragFallback = (() => {
    if (!currentPrimaryId) {
      return true
    }
    const node = ctx.findSceneNode(ctx.nodes, currentPrimaryId)
    // Roads can be highly concave (e.g. arcs). Using an AABB allows drag-starts from empty space
    // inside the road's bounding box, which feels like dragging "through" the road.
    if (node?.dynamicMesh?.type === 'Road' || node?.dynamicMesh?.type === 'Wall') {
      return false
    }
    return true
  })()

  let dragHit = hit as unknown as SelectionHit | null

  if (button === 0 && ctx.activeTool === 'select') {
    if (dragHit && currentPrimaryId && dragHit.nodeId !== currentPrimaryId) {
      const hitIsSelected = ctx.selectedNodeIds.includes(dragHit.nodeId)
      const primaryNode = ctx.findSceneNode(ctx.nodes, currentPrimaryId)
      const allowPrimaryGroupDescendantRedirect = Boolean(primaryNode?.nodeType === 'Group')

      if (!hitIsSelected && allowPrimaryGroupDescendantRedirect && ctx.isDescendant(currentPrimaryId, dragHit.nodeId)) {
        const primaryObject = ctx.objectMap.get(currentPrimaryId)
        if (primaryObject) {
          const worldPoint = dragHit.point.clone()
          dragHit = {
            nodeId: currentPrimaryId,
            object: primaryObject,
            point: worldPoint,
          }
        }
      }
    }

    if (!dragHit && allowBoundingBoxDragFallback) {
      dragHit = ctx.pickActiveSelectionBoundingBoxHit(event)
    }
  }

  const activeTransformAxis = button === 0 && ctx.activeTool !== 'select' ? (ctx.transformControlsAxis ?? null) : null

  // Option B: allow starting a selection drag by grabbing any selected node.
  // If a selected Group is an ancestor of the hit node, treat that Group as the drag anchor.
  if (button === 0 && ctx.activeTool === 'select' && dragHit) {
    const resolvedAnchorId = resolveDragAnchorIdForHit(dragHit.nodeId, ctx.selectedNodeIds, ctx.isDescendant)
    if (resolvedAnchorId && resolvedAnchorId !== dragHit.nodeId) {
      const anchorObject = ctx.objectMap.get(resolvedAnchorId) ?? null
      if (anchorObject) {
        const worldPoint = dragHit.point.clone()
        dragHit = {
          nodeId: resolvedAnchorId,
          object: anchorObject,
          point: worldPoint,
        }
      }
    }
  }

  const selectionDrag =
    button === 0 &&
    ctx.activeTool === 'select' &&
    dragHit &&
    !ctx.isNodeSelectionLocked(dragHit.nodeId) &&
    (ctx.selectedNodeIds.includes(dragHit.nodeId) || dragHit.nodeId === currentPrimaryId)
      ? ctx.createSelectionDragState(dragHit.nodeId, dragHit.object, dragHit.point, event)
      : null

  if (selectionDrag) {
    ctx.disableOrbitForSelectDrag()
  }

  const nextPointerTrackingState: PointerTrackingState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    button,
    hitResult: hit,
    selectionDrag: selectionDrag as any,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    transformAxis: activeTransformAxis,
  }

  return {
    handled: true,
    capturePointerId: event.pointerId,
    preventDefault: button === 2,
    nextPointerTrackingState,
  }
}
