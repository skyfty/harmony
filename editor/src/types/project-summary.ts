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
    groundWidth: number
    groundDepth: number 
  }
}