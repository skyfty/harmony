import type { SceneJsonExportDocument, SceneNode } from '@schema'
import { buildGroundOptimizedMeshData } from '@schema/groundOptimizedMesh'
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

export function attachOptimizedGroundMeshToDocument(document: SceneJsonExportDocument): SceneJsonExportDocument {
  const groundNode = findGroundNode(document.nodes)
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    return document
  }
  groundNode.dynamicMesh.optimizedMesh = buildGroundOptimizedMeshData(groundNode.dynamicMesh)
  return document
}
