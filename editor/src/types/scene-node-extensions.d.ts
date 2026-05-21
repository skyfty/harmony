import type { SceneNode } from '@schema/core'

declare module '@schema' {
  interface SceneNode {
    /**
     * When false, the editor must not allow child nodes to be created under this node.
     */
    allowChildNodes?: boolean
  }
}
