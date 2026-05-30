import type {
  GroundDynamicMesh,
  SceneJsonExportDocument,
  SceneNode,
} from './core'
import { buildGroundOptimizedMeshData } from './groundOptimizedMesh'
import { isGroundDynamicMesh } from './groundHeightfield'
import { resolveDocumentGroundNode } from './groundNode'

export type PrepareRuntimeGroundSplatSceneDocumentResult = {
  document: SceneJsonExportDocument
  hasBakedGroundSplat: boolean
  promotedGroundSplatBake: boolean
  strippedLandformNodes: boolean
  groundSurfaceChunkCount: number
  landformNodeCount: number
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

export function attachOptimizedGroundMeshToDocument(document: SceneJsonExportDocument): SceneJsonExportDocument {
  const groundNode = resolveDocumentGroundNode(document)
  if (!groundNode || !isGroundDynamicMesh(groundNode.dynamicMesh)) {
    return document
  }
  groundNode.dynamicMesh.optimizedMesh = buildGroundOptimizedMeshData(groundNode.dynamicMesh)
  return document
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
  const groundNode = resolveDocumentGroundNode(document)
  const groundDefinition = groundNode?.dynamicMesh?.type === 'Ground' ? (groundNode.dynamicMesh as GroundDynamicMesh)  : null
  const directChunks = groundDefinition?.groundSurfaceChunks
  const bakedChunks = !directChunks ? groundDefinition?.groundSplatBake?.chunkTextureMap : null
  const nextChunks = directChunks ?? bakedChunks
  const hasBakedGroundSplat = Boolean(nextChunks)
  const promotedGroundSplatBake = Boolean(!directChunks && bakedChunks)
  const landformNodeCount = countLandformNodes(document.nodes)

  if (groundNode && groundDefinition && nextChunks) {
    groundNode.dynamicMesh = {
      ...groundDefinition,
      groundSurfaceChunks: nextChunks,
    } as GroundDynamicMesh
  }

  if (landformNodeCount > 0 && !hasBakedGroundSplat) {
    throw new Error('Ground baked splat data is required before runtime landform stripping.')
  }

  return {
    document: document,
    hasBakedGroundSplat,
    promotedGroundSplatBake,
    strippedLandformNodes: stripLandformNodes(document.nodes),
    groundSurfaceChunkCount: nextChunks ? Object.keys(nextChunks).length : 0,
    landformNodeCount,
  }
}

export async function prepareRuntimeGroundSceneDocument(
  document: SceneJsonExportDocument,
): Promise<PrepareRuntimeGroundSplatSceneDocumentResult> {
  const prepared = await prepareRuntimeGroundSplatSceneDocument(document)
  attachOptimizedGroundMeshToDocument(prepared.document)
  return prepared
}
