import type { SceneNode } from '@schema'

declare module '@schema' {
  interface SceneNode {
    /**
     * When false, the editor must not allow child nodes to be created under this node.
     */
    allowChildNodes?: boolean
  }
}
