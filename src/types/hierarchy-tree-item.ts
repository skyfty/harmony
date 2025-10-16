export interface HierarchyTreeItem {
  id: string
  name: string
  visible: boolean
  locked: boolean
  children?: HierarchyTreeItem[]
}
