export interface StoredProjectSceneMeta {
  id: string
  name: string
  sceneJsonUrl: string
  projectId: string
}

export interface StoredProjectPayload {
  id: string
  name: string
  categoryId?: string | null
  scenes: StoredProjectSceneMeta[]
  lastEditedSceneId: string | null
}
