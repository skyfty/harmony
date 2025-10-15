import type { ProjectDirectory } from '@/types/scene-store/project-directory'

export interface ResourceProvider {
  id: string
  name: string
  url: string | null
  transform?: (payload: unknown) => ProjectDirectory[]
}
