import type { PlanningSceneData } from '@/types/planning-scene-data'

export interface ProjectSummary {
  id: string
  name: string
  sceneCount: number
  lastEditedSceneId: string | null
  updatedAt: string
}

export interface ProjectCreateParams {
  name: string
  defaultScene: { 
    name: string
    planningData?: PlanningSceneData | null
  }
}