import type { SceneNode } from '@/types/scene'

export interface DetachResult {
  tree: SceneNode[]
  node: SceneNode | null
}
