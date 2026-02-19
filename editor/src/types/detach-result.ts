import type { SceneNode } from  '@schema'

export interface DetachResult {
  tree: SceneNode[]
  node: SceneNode | null
}
