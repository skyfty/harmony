import type {
  GroundDynamicMesh,
  GroundSurfaceChunkTextureMap,
  SceneJsonExportDocument,
  SceneNode,
} from './core'
import { resolveGroundTileMaterialMap } from './core'
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
function cloneSceneJsonExportDocument(document: SceneJsonExportDocument): SceneJsonExportDocument {

  return JSON.parse(JSON.stringify(document)) as SceneJsonExportDocument
}

function cloneGroundSurfaceChunkTextureMap(
  value: GroundSurfaceChunkTextureMap | null | undefined,
): GroundSurfaceChunkTextureMap | null {
  if (!value || Object.keys(value).length <= 0) {
    return null
  }
  return JSON.parse(JSON.stringify(value)) as GroundSurfaceChunkTextureMap
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
  const runtimeDocument = cloneSceneJsonExportDocument(document)
  const groundNode = resolveDocumentGroundNode(runtimeDocument)
  const groundDefinition = groundNode?.dynamicMesh?.type === 'Ground' ? (groundNode.dynamicMesh as GroundDynamicMesh)  : null
  const directChunks = cloneGroundSurfaceChunkTextureMap(resolveGroundTileMaterialMap(groundDefinition) ?? null)
  const bakedChunks = !directChunks
    ? cloneGroundSurfaceChunkTextureMap(groundDefinition?.groundSplatBake?.tileMaterialMap
      ?? groundDefinition?.groundSplatBake?.chunkTextureMap
      ?? null)
    : null
  const nextChunks = directChunks ?? bakedChunks
  const hasBakedGroundSplat = Boolean(nextChunks)
  const promotedGroundSplatBake = Boolean(!directChunks && bakedChunks)
  const landformNodeCount = countLandformNodes(document.nodes)

  if (groundNode && groundDefinition && nextChunks) {
    groundNode.dynamicMesh = {
      ...groundDefinition,
      groundSurfaceChunks: nextChunks,
      groundTileMaterialMap: nextChunks,
    } as GroundDynamicMesh
  }

  if (landformNodeCount > 0 && !hasBakedGroundSplat) {
    throw new Error('Ground baked splat data is required before runtime landform stripping.')
  }

  return {
    document: runtimeDocument,
    hasBakedGroundSplat,
    promotedGroundSplatBake,
    strippedLandformNodes: stripLandformNodes(runtimeDocument.nodes),
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
