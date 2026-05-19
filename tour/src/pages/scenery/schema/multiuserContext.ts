let currentSceneId: string | null = null

export function setActiveMultiuserSceneId(sceneId: string | null): void {
  currentSceneId = sceneId
}

export function getActiveMultiuserSceneId(): string | null {
  return currentSceneId
}