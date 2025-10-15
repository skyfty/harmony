import type { ProjectDirectory } from '@/types/project-directory'

export interface ResourceProvider {
  id: string
  name: string
  url: string | null
  transform?: (payload: unknown) => ProjectDirectory[]
}
