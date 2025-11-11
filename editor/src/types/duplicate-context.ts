import type { Object3D } from 'three'
import type { useAssetCacheStore } from '@/stores/assetCacheStore'

export interface DuplicateContext {
  assetCache: ReturnType<typeof useAssetCacheStore>
  runtimeSnapshots: Map<string, Object3D>
  idMap?: Map<string, string>
  regenerateBehaviorIds?: boolean
  behaviorComponentIdMap?: Map<string, string>
  behaviorSequenceIdMap?: Map<string, string>
}
