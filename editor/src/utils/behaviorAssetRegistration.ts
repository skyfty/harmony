import type { ProjectAsset } from '@/types/project-asset'

type BehaviorAssetRegistrar = {
  ensureSceneAssetRegistered: (
    asset: ProjectAsset,
    options?: {
      source?: ProjectAsset['source']
      commitOptions?: { updateNodes?: boolean }
    },
  ) => ProjectAsset
}

export function ensureBehaviorAssetRegistered(
  sceneStore: BehaviorAssetRegistrar,
  asset: ProjectAsset,
  context: string,
): ProjectAsset {
  try {
    return sceneStore.ensureSceneAssetRegistered(asset, {
      source: asset.source,
      commitOptions: { updateNodes: false },
    })
  } catch (error) {
    console.warn(`Failed to register behavior asset for ${context}`, asset.id, error)
    return asset
  }
}
