import type { SceneNodeType } from './scene'
import type { LightNodeType } from './light'

export interface HierarchyTreeItem {
  id: string
  name: string
  visible: boolean
  locked: boolean
  nodeType?: SceneNodeType
  lightType?: LightNodeType
  children?: HierarchyTreeItem[]
}
