import type { SceneNode } from './core'
import { extractWaterSurfaceMeshMetadataFromUserData } from './waterSurfaceMesh'

const BOUNDARY_WALL_REFERENCE_DYNAMIC_TYPES = new Set(['Floor', 'Wall', 'Landform', 'Road', 'Region'])
const WATER_COMPONENT_TYPE = 'water'

export function findBoundaryWallReferenceNodeById(
  node: SceneNode | null | undefined,
  targetId: string | null | undefined,
): SceneNode | null {
  if (!node || !targetId) {
    return null
  }
  if (node.id === targetId) {
    return node
  }
  for (const child of node.children ?? []) {
    const match = findBoundaryWallReferenceNodeById(child, targetId)
    if (match) {
      return match
    }
  }
  return null
}

export function isBoundaryWallReferenceSourceNode(node: SceneNode | null | undefined): boolean {
  if (!node) {
    return false
  }
  const dynamicType = node.dynamicMesh?.type
  if (dynamicType && BOUNDARY_WALL_REFERENCE_DYNAMIC_TYPES.has(dynamicType)) {
    return true
  }
  if (node.components?.[WATER_COMPONENT_TYPE]) {
    return true
  }
  return extractWaterSurfaceMeshMetadataFromUserData(node.userData) !== null
}

export function hasBoundaryWallReferenceSourceInSubtree(node: SceneNode | null | undefined): boolean {
  if (!node) {
    return false
  }
  if (isBoundaryWallReferenceSourceNode(node)) {
    return true
  }
  for (const child of node.children ?? []) {
    if (hasBoundaryWallReferenceSourceInSubtree(child)) {
      return true
    }
  }
  return false
}

export function resolveBoundaryWallReferenceNodeIdForMount(node: SceneNode | null | undefined): string | null {
  if (!node) {
    return null
  }
  if (isBoundaryWallReferenceSourceNode(node)) {
    return node.id
  }
  const stack: SceneNode[] = [...(node.children ?? [])]
  while (stack.length) {
    const current = stack.shift()
    if (!current) {
      continue
    }
    if (isBoundaryWallReferenceSourceNode(current)) {
      return current.id
    }
    if (current.children?.length) {
      stack.unshift(...current.children)
    }
  }
  return null
}

export function resolveBoundaryWallReferenceNodeId(
  node: SceneNode | null | undefined,
  boundaryReferenceNodeId: string | null | undefined,
): string | null {
  const candidateId = typeof boundaryReferenceNodeId === 'string' && boundaryReferenceNodeId.trim().length
    ? boundaryReferenceNodeId.trim()
    : null
  if (!node) {
    return candidateId
  }
  if (candidateId) {
    const candidate = findBoundaryWallReferenceNodeById(node, candidateId)
    if (candidate && isBoundaryWallReferenceSourceNode(candidate)) {
      return candidate.id
    }
  }
  return resolveBoundaryWallReferenceNodeIdForMount(node)
}

export function resolveBoundaryWallReferenceNodes(
  node: SceneNode | null | undefined,
  boundaryReferenceNodeId: string | null | undefined,
): SceneNode[] {
  const resolvedId = resolveBoundaryWallReferenceNodeId(node, boundaryReferenceNodeId)
  if (!resolvedId) {
    return []
  }
  const resolvedNode = findBoundaryWallReferenceNodeById(node, resolvedId)
  return resolvedNode ? [resolvedNode] : []
}
