import type { GroundDynamicMesh, SceneJsonExportDocument, SceneNode } from '@schema'
import { buildGroundOptimizedMeshData, type GroundOptimizedMeshBuildOptions } from '@schema/groundOptimizedMesh'
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
    console.info('[GroundOptimizedMesh] Scene document already contains optimized mesh', {
      chunkCount: groundNode.dynamicMesh.optimizedMesh.chunkCount,
      chunkCells: groundNode.dynamicMesh.optimizedMesh.chunkCells,
      optimizedTriangles: groundNode.dynamicMesh.optimizedMesh.optimizedTriangleCount,
      sourceTriangles: groundNode.dynamicMesh.optimizedMesh.sourceTriangleCount,
    })
    return document
  }
  groundNode.dynamicMesh.optimizedMesh = buildGroundOptimizedMeshData(groundNode.dynamicMesh, options)
  console.info('[GroundOptimizedMesh] Rebuilt missing optimized mesh during scene load', {
    chunkCount: groundNode.dynamicMesh.optimizedMesh.chunkCount,
    chunkCells: groundNode.dynamicMesh.optimizedMesh.chunkCells,
    optimizedTriangles: groundNode.dynamicMesh.optimizedMesh.optimizedTriangleCount,
    sourceTriangles: groundNode.dynamicMesh.optimizedMesh.sourceTriangleCount,
  })
  return document
}

export function rebuildOptimizedGroundMeshForDefinition(
  definition: GroundDynamicMesh,
  options: GroundOptimizedMeshBuildOptions = {},
) {
  const optimizedMesh = buildGroundOptimizedMeshData(definition, options)
  definition.optimizedMesh = optimizedMesh
  return optimizedMesh
}
