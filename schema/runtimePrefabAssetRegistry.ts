import type { SceneJsonExportDocument } from './core'
import type { NodePrefabData } from './runtimePrefab'

type RuntimePrefabAssetRegistrySource = Pick<NodePrefabData, 'assetRegistry'>

/**
 * Merge a runtime prefab's asset registry into the scene document that will
 * render that prefab.
 *
 * Runtime prefabs carry their own server/package asset descriptors. A cloned
 * prefab cannot resolve those descriptors unless they are present on the
 * document handed to the scene graph builder.
 */
export function mergeRuntimePrefabAssetRegistry(
  document: SceneJsonExportDocument,
  source: RuntimePrefabAssetRegistrySource | null | undefined,
): SceneJsonExportDocument {
  const incoming = source?.assetRegistry
  if (!incoming || !Object.keys(incoming).length) {
    return document
  }
  document.assetRegistry = {
    ...(document.assetRegistry ?? {}),
    ...incoming,
  }
  return document
}
