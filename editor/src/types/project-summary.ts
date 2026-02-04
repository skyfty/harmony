export interface ProjectSummary {
  id: string
  name: string
  sceneCount: number
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