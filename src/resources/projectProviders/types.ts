import type { ProjectDirectory } from '@/stores/sceneStore'

export interface ResourceProvider {
  id: string
  name: string
  url: string | null
  transform?: (payload: unknown) => ProjectDirectory[]
}
