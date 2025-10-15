export interface HierarchyTreeItem {
  id: string
  name: string
  visible: boolean
  children?: HierarchyTreeItem[]
}
