import type { SceneNode } from  '@harmony/scene-schema'

export interface DetachResult {
  tree: SceneNode[]
  node: SceneNode | null
}
