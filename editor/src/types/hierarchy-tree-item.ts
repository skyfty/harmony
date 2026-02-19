import type { SceneNodeType,LightNodeType } from  '@schema'

export interface HierarchyTreeItem {
  id: string
  name: string
  visible: boolean
  locked: boolean
  nodeType?: SceneNodeType
  instanced:boolean
  lightType?: LightNodeType
  dynamicMeshType?: string
  children?: HierarchyTreeItem[]
}
