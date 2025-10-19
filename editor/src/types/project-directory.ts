import type { ProjectAsset } from './project-asset'

export interface ProjectDirectory {
  id: string
  name: string
  children?: ProjectDirectory[]
  assets?: ProjectAsset[]
}
