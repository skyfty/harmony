import { Box3, type Object3D } from 'three'
import type { SceneJsonExportDocument, SceneNode } from './core'
import ResourceCache from './ResourceCache'
import type { SceneGraphBuildOptions } from './sceneGraph'
import {
  cloneRuntimePrefabNode,
  createRuntimePrefabDocument,
  parseRuntimePrefabData,
  type NodePrefabData,
  type RuntimePrefabCloneResult,
} from './runtimePrefab'

export interface RuntimePrefabControlSwitchInstance<TGraph = unknown> {
  prefab: NodePrefabData
  cloned: RuntimePrefabCloneResult
  runtimeDocument: SceneJsonExportDocument
  graph: TGraph
  sceneRootObject: Object3D
}

export interface RuntimePrefabControlSwitchInstantiationOptions<TGraph> {
  buildOptions: SceneGraphBuildOptions | ((document: SceneJsonExportDocument, prefab: NodePrefabData, cloned: RuntimePrefabCloneResult) => SceneGraphBuildOptions | Promise<SceneGraphBuildOptions>)
  createResourceCache: (document: SceneJsonExportDocument, buildOptions: SceneGraphBuildOptions) => ResourceCache
  buildSceneGraph: (document: SceneJsonExportDocument, resourceCache: ResourceCache, buildOptions: SceneGraphBuildOptions) => Promise<TGraph>
  prepareClonedRoot?: (clonedRoot: SceneNode, prefab: NodePrefabData) => void | Promise<void>
  resolveEffectiveNode?: (clonedRoot: SceneNode) => SceneNode | null
}

export interface RuntimePrefabControlSwitchActivationResult {
  success: boolean
  message?: string
}

export interface RuntimePrefabControlSwitchSwapContext<TGraph> {
  document: SceneJsonExportDocument
  targetNodeId: string
  previousNode: SceneNode
  oldObject: Object3D | null
  instance: RuntimePrefabControlSwitchInstance<TGraph>
}

export interface RuntimePrefabControlSwitchSwapOptions<TGraph> {
  scene: { add: (object: Object3D) => void; remove: (object: Object3D) => void } | null
  replaceSceneNodeById: (nodes: SceneNode[] | null | undefined, nodeId: string, replacement: SceneNode) => boolean
  rebuildNodeMap: (document: SceneJsonExportDocument) => void
  onCommit?: (context: RuntimePrefabControlSwitchSwapContext<TGraph>) => Promise<void> | void
  onRollback?: (context: RuntimePrefabControlSwitchSwapContext<TGraph>) => Promise<void> | void
  cleanupOldObject?: (context: RuntimePrefabControlSwitchSwapContext<TGraph>) => Promise<void> | void
  cleanupNewObject?: (context: RuntimePrefabControlSwitchSwapContext<TGraph>) => Promise<void> | void
  activate: (context: RuntimePrefabControlSwitchSwapContext<TGraph>) => Promise<RuntimePrefabControlSwitchActivationResult> | RuntimePrefabControlSwitchActivationResult
}

export async function instantiateRuntimePrefabControlSwitchInstance<TGraph>(
  raw: string,
  options: RuntimePrefabControlSwitchInstantiationOptions<TGraph>,
): Promise<RuntimePrefabControlSwitchInstance<TGraph> | null> {
  const prefab = parseRuntimePrefabData(raw)
  return await instantiateRuntimePrefabControlSwitchInstanceFromPrefab(prefab, options)
}

export async function instantiateRuntimePrefabControlSwitchInstanceFromPrefab<TGraph>(
  prefab: NodePrefabData,
  options: RuntimePrefabControlSwitchInstantiationOptions<TGraph>,
): Promise<RuntimePrefabControlSwitchInstance<TGraph> | null> {
  const cloned = cloneRuntimePrefabNode(prefab)

  if (options.prepareClonedRoot) {
    await options.prepareClonedRoot(cloned.root, prefab)
  }
  const runtimeDocument = createRuntimePrefabDocument(prefab, cloned.root)
  const buildOptions = typeof options.buildOptions === 'function'
    ? await options.buildOptions(runtimeDocument, prefab, cloned)
    : options.buildOptions
  const resourceCache = options.createResourceCache(runtimeDocument, buildOptions)
  const graph = await options.buildSceneGraph(runtimeDocument, resourceCache, buildOptions) 
  if (!graph || !graph.root) {
    return null
  }
  const sceneRootObject = graph.root.children?.[0] ?? null
  if (!sceneRootObject) {
    return null
  }
  return {
    prefab,
    cloned,
    runtimeDocument,
    graph,
    sceneRootObject
  }
}

async function cleanupSceneObject(object: Object3D | null | undefined, remove: (object: Object3D) => void): Promise<void> {
  if (!object) {
    return
  }
  remove(object)
  if (object.parent) {
    object.parent.remove(object)
  }
}

function getObjectWorldBounds(object: Object3D | null | undefined): Box3 | null {
  if (!object) {
    return null
  }
  object.updateWorldMatrix(true, true)
  const bounds = new Box3().setFromObject(object)
  return bounds.isEmpty() ? null : bounds
}

function alignReplacementObjectBottomToOldObject(
  replacementObject: Object3D,
  replacementNode: SceneNode,
  oldObject: Object3D | null,
): { oldMinY: number; newMinY: number; deltaY: number } | null {
  const oldBounds = getObjectWorldBounds(oldObject)
  const newBounds = getObjectWorldBounds(replacementObject)
  if (!oldBounds || !newBounds) {
    return null
  }
  const deltaY = oldBounds.min.y - newBounds.min.y
  if (!Number.isFinite(deltaY) || Math.abs(deltaY) < 1e-6) {
    return {
      oldMinY: oldBounds.min.y,
      newMinY: newBounds.min.y,
      deltaY: 0,
    }
  }
  replacementObject.position.y += deltaY
  replacementNode.position.y += deltaY
  replacementObject.updateMatrixWorld(true)
  return {
    oldMinY: oldBounds.min.y,
    newMinY: newBounds.min.y,
    deltaY,
  }
}

export async function performRuntimePrefabControlSwitch<TGraph>(
  context: RuntimePrefabControlSwitchSwapContext<TGraph>,
  options: RuntimePrefabControlSwitchSwapOptions<TGraph>,
): Promise<RuntimePrefabControlSwitchActivationResult> {
  const scene = options.scene
  if (!scene) {
    return { success: false, message: 'Scene is not ready.' }
  }
  const { document, targetNodeId, previousNode, oldObject, instance } = context
  const { sceneRootObject, cloned } = instance
  const effectiveNode = cloned.root
  const effectiveNodeId = effectiveNode.id ?? null
  if (!effectiveNodeId) {
    return { success: false, message: 'Prefab root is missing a usable control node.' }
  }
  if (!options.replaceSceneNodeById(document.nodes, targetNodeId, effectiveNode)) {
    return { success: false, message: 'Failed to replace the active control node.' }
  }

  document.updatedAt = new Date().toISOString()
  scene.add(sceneRootObject)
  const placementAlignment = alignReplacementObjectBottomToOldObject(sceneRootObject, effectiveNode, oldObject)
  if (placementAlignment) {
    console.info(
      `[RuntimePrefabControlSwitch] bottom-align targetNodeId=${targetNodeId} oldMinY=${placementAlignment.oldMinY.toFixed(3)} newMinY=${placementAlignment.newMinY.toFixed(3)} deltaY=${placementAlignment.deltaY.toFixed(3)} oldObjectExists=${Boolean(oldObject)}`,
    )
  }

  try {
    await options.onCommit?.(context)
  } catch (error) {
    await options.cleanupNewObject?.(context)
    await cleanupSceneObject(sceneRootObject, scene.remove)
    options.replaceSceneNodeById(document.nodes, effectiveNodeId, previousNode)
    document.updatedAt = new Date().toISOString()
    options.rebuildNodeMap(document)
    await options.onRollback?.(context)
    return {
      success: false,
      message: (error as Error)?.message ?? 'Failed to apply the control node replacement.',
    }
  }

  const activation = await options.activate(context)
  if (!activation.success) {
    await options.cleanupNewObject?.(context)
    await cleanupSceneObject(sceneRootObject, scene.remove)
    options.replaceSceneNodeById(document.nodes, effectiveNodeId, previousNode)
    document.updatedAt = new Date().toISOString()
    options.rebuildNodeMap(document)
    await options.onRollback?.(context)
    return activation
  }

  await options.cleanupOldObject?.(context)
  return activation
}
