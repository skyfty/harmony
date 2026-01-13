export interface StoredProjectSceneMeta {
  id: string
  name: string
  sceneJsonUrl: string
  projectId: string
}

export interface StoredProjectPayload {
  id: string
  name: string
  scenes: StoredProjectSceneMeta[]
  lastEditedSceneId: string | null
}
