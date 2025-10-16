import type { LightNodeType, SceneNodeType } from './scene'

export interface HierarchyTreeItem {
  id: string
  name: string
  visible: boolean
  locked: boolean
  nodeType?: SceneNodeType
  lightType?: LightNodeType
  children?: HierarchyTreeItem[]
}
