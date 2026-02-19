import type { Project } from '@schema/index'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import type { ProjectCreateParams } from '@/types/project-summary'
import { useProjectsStore } from '@/stores/projectsStore'
import { useScenesStore } from '@/stores/scenesStore'
import { useSceneStore } from '@/stores/sceneStore'

export async function createProjectWithDefaultScene(
  params: ProjectCreateParams,
): Promise<{ project: Project; scene: StoredSceneDocument }> {
  const projectsStore = useProjectsStore()
  const scenesStore = useScenesStore()
  const sceneStore = useSceneStore()

  await Promise.all([projectsStore.initialize(), scenesStore.initialize()])

  const project = await projectsStore.createProject(params.name)
  projectsStore.setActiveProject(project.id)

  const widthCandidate = Number(params.defaultScene?.groundWidth)
  const depthCandidate = Number(params.defaultScene?.groundDepth)

  const sceneId = await sceneStore.createScene(params.defaultScene?.name ?? 'Untitled Scene', {
    groundSettings: {
      width: Number.isFinite(widthCandidate) ? widthCandidate : undefined,
      depth: Number.isFinite(depthCandidate) ? depthCandidate : undefined,
    },
  })

  const [freshProject, freshScene] = await Promise.all([
    projectsStore.loadProjectDocument(project.id),
    scenesStore.loadSceneDocument(sceneId),
  ])

  if (!freshProject) {
    throw new Error('Failed to load created project')
  }
  if (!freshScene) {
    throw new Error('Failed to load created scene')
  }

  return { project: freshProject, scene: freshScene }
}
