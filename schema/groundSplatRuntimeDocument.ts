import type {
  GroundDynamicMesh,
  SceneJsonExportDocument,
  SceneNode,
} from './core'

export type PrepareRuntimeGroundSplatSceneDocumentResult = {
  document: SceneJsonExportDocument
  hasBakedGroundSplat: boolean
  promotedGroundSplatBake: boolean
  strippedLandformNodes: boolean
  groundSurfaceChunkCount: number
  landformNodeCount: number
}

function findGroundNode(nodes: SceneNode[] | undefined | null): SceneNode | null {
  if (!Array.isArray(nodes)) {
    return null
  }
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (node.dynamicMesh?.type === 'Ground') {
      return node
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stack.push(...node.children)
    }
  }
  return null
}

function countLandformNodes(nodes: SceneNode[] | undefined | null): number {
  if (!Array.isArray(nodes)) {
    return 0
  }
  let count = 0
  const stack = [...nodes]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    if (node.dynamicMesh?.type === 'Landform') {
      count += 1
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stack.push(...node.children)
    }
  }
  return count
}

function stripLandformNodes(nodes: SceneNode[] | undefined | null): boolean {
  if (!Array.isArray(nodes)) {
    return false
  }
  let stripped = false
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (!node || typeof node !== 'object') {
      continue
    }
    const dynamicMesh = (node as { dynamicMesh?: { type?: string } | null }).dynamicMesh
    if (dynamicMesh?.type === 'Landform') {
      nodes.splice(index, 1)
      stripped = true
      continue
    }
    if (Array.isArray(node.children) && node.children.length > 0) {
      stripped = stripLandformNodes(node.children) || stripped
      if (node.children.length === 0) {
        delete node.children
      }
    }
  }
  return stripped
}

export async function prepareRuntimeGroundSplatSceneDocument(
  document: SceneJsonExportDocument,
): Promise<PrepareRuntimeGroundSplatSceneDocumentResult> {
  const groundNode = findGroundNode(document.nodes)
  const groundDefinition = groundNode?.dynamicMesh?.type === 'Ground' ? (groundNode.dynamicMesh as GroundDynamicMesh)  : null
  const directChunks = groundDefinition?.groundSurfaceChunks
  const bakedChunks = !directChunks? groundDefinition?.groundSplatBake?.chunkTextureMap  : null
  const nextChunks = directChunks ?? bakedChunks
  const hasBakedGroundSplat = Boolean(nextChunks)
  const promotedGroundSplatBake = Boolean(!directChunks && bakedChunks)

  if (groundNode && groundDefinition && nextChunks) {
    groundNode.dynamicMesh = {
      ...groundDefinition,
      groundSurfaceChunks: nextChunks,
    } as GroundDynamicMesh
  }

  return {
    document: document,
    hasBakedGroundSplat,
    promotedGroundSplatBake,
    strippedLandformNodes: hasBakedGroundSplat ? stripLandformNodes(document.nodes) : false,
    groundSurfaceChunkCount: nextChunks ? Object.keys(nextChunks).length : 0,
    landformNodeCount: countLandformNodes(document.nodes),
  }
}
