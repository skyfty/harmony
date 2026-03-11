import type { ProjectAsset } from './project-asset'

export type ProjectDirectoryKind =
  | 'assets-root'
  | 'resource-category'
  | 'package-root'
  | 'package-provider'
  | 'package-directory'

export interface ProjectDirectory {
  id: string
  name: string
  kind?: ProjectDirectoryKind
  parentId?: string | null
  children?: ProjectDirectory[]
  assets?: ProjectAsset[]
}
