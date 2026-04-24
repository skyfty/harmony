import type { GroundContourBounds, GroundDynamicMesh, SceneJsonExportDocument, SceneNode } from '@schema'
import { buildGroundOptimizedMeshData, buildGroundOptimizedMeshDataFromSampler, rebuildGroundOptimizedMeshData, type GroundOptimizedMeshBuildOptions } from '@schema/groundOptimizedMesh'
import type { GroundHeightFieldSampler } from '@schema/groundMesh'
import { isGroundDynamicMesh } from '@schema/groundHeightfield'

function findGroundNode(nodes: SceneNode[]): SceneNode | null {
  const stack: SceneNode[] = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (isGroundDynamicMesh(node.dynamicMesh)) {
      return node
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stack.push(...node.children)
    }
  }
  return null
}

export function attachOptimizedGroundMeshToDocument(
  document: SceneJsonExportDocument,
  options: GroundOptimizedMeshBuildOptions = {},
): SceneJsonExportDocument {
  const groundNode = findGroundNode(document.nodes)
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    return document
  }
  groundNode.dynamicMesh.optimizedMesh = buildGroundOptimizedMeshData(groundNode.dynamicMesh, options)
  return document
}

export function ensureOptimizedGroundMeshOnDocument(
  document: SceneJsonExportDocument,
  options: GroundOptimizedMeshBuildOptions = {},
): SceneJsonExportDocument {
  const groundNode = findGroundNode(document.nodes)
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    return document
  }
  if (groundNode.dynamicMesh.optimizedMesh?.chunks?.length) {
    return document
  }
  groundNode.dynamicMesh.optimizedMesh = buildGroundOptimizedMeshData(groundNode.dynamicMesh, options)
  return document
}

export function rebuildOptimizedGroundMeshForDefinition(
  definition: GroundDynamicMesh,
  previousMesh: GroundDynamicMesh['optimizedMesh'] | null | undefined,
  options: GroundOptimizedMeshBuildOptions = {},
  dirtyBounds: GroundContourBounds | null = null,
  sampler: GroundHeightFieldSampler | null = null,
) {
  const optimizedMesh = sampler
    ? buildGroundOptimizedMeshDataFromSampler(definition, sampler, options)
    : rebuildGroundOptimizedMeshData(definition, previousMesh ?? null, options, dirtyBounds)
  definition.optimizedMesh = optimizedMesh
  return optimizedMesh
}
