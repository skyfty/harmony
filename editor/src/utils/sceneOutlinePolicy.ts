import type { SceneNode } from '@schema/core'
import type { ProceduralLandscapeComponentProps } from '@schema/proceduralLandscape/config'
import {
  getAssetTypeFromExtension,
  getLastExtensionFromFilenameOrUrl,
  isConfigAssetExtension,
  normalizeExtension,
} from '@schema/assetTypeConversion'
import { isExpandedImportedModelRoot, isLightweightImportNode } from '@schema/core'

const PROCEDURAL_LANDSCAPE_COMPONENT_KEY = 'proceduralLandscape'

type OutlineAssetSource = {
  extension?: string | null
  fileKey?: string | null
  downloadUrl?: string | null
  name?: string | null
} | null | undefined

export function isDemTerrainSceneNode(
  node: Pick<SceneNode, 'userData' | 'components'> | null | undefined,
): boolean {
  if (node?.userData?.proceduralLandscapeDem === true) {
    return true
  }
  const component = node?.components?.[PROCEDURAL_LANDSCAPE_COMPONENT_KEY]
  const dem = (component?.props as Partial<ProceduralLandscapeComponentProps> | undefined)?.dem
  return Boolean(
    dem
    && typeof dem.assetId === 'string'
    && dem.assetId.trim().length > 0
    && typeof dem.runtimeGridUrl === 'string'
    && dem.runtimeGridUrl.trim().length > 0,
  )
}

export function shouldGenerateOutlineMeshForNode(
  node: SceneNode,
  options: { lazyLoadMeshes?: boolean | null },
): boolean {
  if (!options.lazyLoadMeshes) {
    return false
  }
  if (!node.sourceAssetId || typeof node.sourceAssetId !== 'string') {
    return false
  }
  // Expanded lightweight nodes render one asset node each; the whole-asset
  // outline placeholder would not match their geometry.
  if (isLightweightImportNode(node)) {
    return false
  }
  // Expanded imported model roots render the real asset instead of an outline
  // placeholder, so a whole-model outline would only bloat the package.
  if (isExpandedImportedModelRoot(node)) {
    return false
  }
  if (node.dynamicMesh) {
    return false
  }
  if (node.editorFlags?.editorOnly) {
    return false
  }
  if (isDemTerrainSceneNode(node)) {
    return false
  }
  return true
}

/**
 * Outline meshes are only meaningful for model assets. Config and non-model
 * assets may still be attached as source assets (for example DEM terrain uses
 * its metadata `dem.json`), so they must never be handed to a model loader.
 */
export function shouldAttemptOutlineAssetLoad(asset: OutlineAssetSource): boolean {
  const extension = normalizeExtension(asset?.extension)
    ?? getLastExtensionFromFilenameOrUrl(asset?.fileKey ?? asset?.downloadUrl ?? asset?.name)
  if (!extension) {
    // Keep the attempt for extension-less server assets; the per-asset export
    // guard will skip it if the loader cannot resolve it.
    return true
  }
  if (isConfigAssetExtension(extension)) {
    return false
  }
  const assetType = getAssetTypeFromExtension(extension)
  return assetType == null || assetType === 'model'
}
