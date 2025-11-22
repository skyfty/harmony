import type { SceneNode } from '@harmony/schema'

declare module '@harmony/schema' {
  interface SceneNode {
    /**
     * When false, the editor must not allow child nodes to be created under this node.
     */
    allowChildNodes?: boolean
  }
}
