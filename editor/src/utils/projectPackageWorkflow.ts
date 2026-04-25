import type { GroundChunkManifest } from '@schema'
import type { StoredSceneDocument } from '@/types/stored-scene-document'
import { useProjectsStore } from '@/stores/projectsStore'
import { useScenesStore } from '@/stores/scenesStore'
import { useUiStore } from '@/stores/uiStore'
import { cloneSceneDocumentForExport } from '@/stores/sceneStore'
import { loadStoredScenesFromScenePackage } from '@/utils/scenePackageImport'
import { exportScenePackageZip } from '@/utils/scenePackageExport'
import type { ScenePackageExportScene } from '@/utils/scenePackageExport'
import { generateUuid } from '@/utils/uuid'

type ProjectsStore = ReturnType<typeof useProjectsStore>
type ScenesStore = ReturnType<typeof useScenesStore>
type UiStore = ReturnType<typeof useUiStore>

export type DuplicateProjectResolution = 'replace' | 'create'

type DuplicateProjectInfo = {
  incomingName: string
  duplicates: Array<{ id: string; name: string }>
}

function readFileAsArrayBuffer(file: File, onProgress?: (percent: number) => void): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        const percent = (event.loaded / event.total) * 100
        onProgress(Math.min(Math.max(percent, 0), 100))
      }
    }
    reader.onload = () => {
      const result = reader.result
      if (result instanceof ArrayBuffer) {
        resolve(result)
        return
      }
      reject(new Error('读取文件失败'))
    }
    reader.readAsArrayBuffer(file)
  })
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.style.display = 'none'
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}

export function sanitizeExportFileName(input: string): string {
  const trimmed = input.trim()
  const fallback = 'project'
  const normalized = trimmed.length ? trimmed : fallback
  const cleaned = normalized
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length ? cleaned : fallback
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneSceneDocument<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

function resolveUniqueName(baseName: string, existingNames: Set<string>, suffixLabel = 'Imported'): string {
  const normalizedBase = baseName.trim() || 'Imported Project'
  if (!existingNames.has(normalizedBase)) {
    existingNames.add(normalizedBase)
    return normalizedBase
  }

  const firstCandidate = `${normalizedBase} (${suffixLabel})`
  if (!existingNames.has(firstCandidate)) {
    existingNames.add(firstCandidate)
    return firstCandidate
  }

  let index = 2
  while (index < 10000) {
    const candidate = `${normalizedBase} (${suffixLabel} ${index})`
    if (!existingNames.has(candidate)) {
      existingNames.add(candidate)
      return candidate
    }
    index += 1
  }

  const timestamped = `${normalizedBase} (${suffixLabel} ${Date.now()})`
  existingNames.add(timestamped)
  return timestamped
}

export async function runProjectImportWorkflow(options: {
  file: File
  projectsStore: ProjectsStore
  scenesStore: ScenesStore
  uiStore: UiStore
  onDuplicateProjectName?: (info: DuplicateProjectInfo) => DuplicateProjectResolution | Promise<DuplicateProjectResolution>
}): Promise<{ projectName: string; sceneCount: number }> {
  const { file, projectsStore, scenesStore, uiStore, onDuplicateProjectName } = options

  uiStore.showLoadingOverlay({
    title: '导入工程',
    message: '读取 ZIP 文件…',
    mode: 'determinate',
    progress: 5,
    closable: false,
    autoClose: false,
  })

  try {
    await Promise.all([projectsStore.initialize(), scenesStore.initialize()])

    const bytes = await readFileAsArrayBuffer(file, (percent) => {
      const progress = 5 + Math.round((percent / 100) * 35)
      uiStore.updateLoadingProgress(Math.min(progress, 40))
    })

    uiStore.updateLoadingOverlay({ message: '解析工程包…' })
    uiStore.updateLoadingProgress(48)

    const loaded = await loadStoredScenesFromScenePackage(bytes)

    const existingProjectNames = new Set(projectsStore.metadata.map((entry) => entry.name))
    const existingSceneNames = new Set(scenesStore.metadata.map((entry) => entry.name))

    const projectRaw = isPlainObject(loaded.project) ? loaded.project : {}
    const importedProjectName = typeof projectRaw.name === 'string' && projectRaw.name.trim().length
      ? projectRaw.name.trim()
      : sanitizeExportFileName(file.name.replace(/\.[^./\\]+$/, ''))

    const duplicateProjects = projectsStore.metadata
      .filter((entry) => entry.name === importedProjectName)
      .map((entry) => ({ id: entry.id, name: entry.name }))

    let nextProjectName: string
    if (duplicateProjects.length) {
      const resolution = onDuplicateProjectName
        ? await onDuplicateProjectName({ incomingName: importedProjectName, duplicates: duplicateProjects })
        : 'create'

      if (resolution === 'replace') {
        uiStore.updateLoadingOverlay({ message: '正在替换已有同名工程…' })
        uiStore.updateLoadingProgress(55)
        for (const duplicate of duplicateProjects) {
          await projectsStore.deleteProjectCascade(duplicate.id)
        }
        await Promise.all([projectsStore.refreshMetadata(), scenesStore.refreshMetadata()])
        nextProjectName = importedProjectName
      } else {
        nextProjectName = resolveUniqueName(importedProjectName, existingProjectNames)
      }
    } else {
      nextProjectName = resolveUniqueName(importedProjectName, existingProjectNames)
    }

    const createdProject = await projectsStore.createProject(nextProjectName)

    uiStore.updateLoadingOverlay({ message: '写入场景数据…' })
    uiStore.updateLoadingProgress(62)

    const idMap = new Map<string, string>()
    const preparedScenes: StoredSceneDocument[] = []
    const preparedHeightSidecars: Record<string, ArrayBuffer | null> = {}
    const preparedScatterSidecars: Record<string, ArrayBuffer | null> = {}
    const preparedPaintSidecars: Record<string, ArrayBuffer | null> = {}
    const preparedChunkManifests: Record<string, GroundChunkManifest | null> = {}
    const preparedChunkData: Record<string, Record<string, ArrayBuffer | null>> = {}

    loaded.scenes.forEach((scene, index) => {
      const oldId = scene.id
      const nextId = generateUuid()
      idMap.set(oldId, nextId)

      const baseSceneName = typeof scene.name === 'string' && scene.name.trim().length
        ? scene.name.trim()
        : `Imported Scene ${index + 1}`
      const nextSceneName = resolveUniqueName(baseSceneName, existingSceneNames, 'Imported')
      const now = new Date().toISOString()
      const cloned = cloneSceneDocument(scene)
      const prepared: StoredSceneDocument = {
        ...cloned,
        id: nextId,
        name: nextSceneName,
        projectId: createdProject.id,
        createdAt: now,
        updatedAt: now,
      }
      preparedScenes.push(prepared)
      preparedHeightSidecars[nextId] = loaded.groundHeightSidecars[oldId] ?? null
      preparedScatterSidecars[nextId] = loaded.groundScatterSidecars[oldId] ?? null
      preparedPaintSidecars[nextId] = loaded.groundPaintSidecars[oldId] ?? null
      preparedChunkManifests[nextId] = loaded.groundChunkManifests[oldId] ?? null
      preparedChunkData[nextId] = loaded.groundChunkData[oldId] ?? {}
    })

    await scenesStore.saveSceneDocuments(preparedScenes, {
      groundHeightSidecars: preparedHeightSidecars,
      groundScatterSidecars: preparedScatterSidecars,
      groundPaintSidecars: preparedPaintSidecars,
      groundChunkManifests: preparedChunkManifests,
      groundChunkData: preparedChunkData,
    })

    for (const scene of preparedScenes) {
      await projectsStore.addSceneToProject(createdProject.id, { id: scene.id, name: scene.name })
    }

    const importedLastEditedRaw = typeof projectRaw.lastEditedSceneId === 'string' ? projectRaw.lastEditedSceneId.trim() : ''
    const importedLastEditedMapped = importedLastEditedRaw ? idMap.get(importedLastEditedRaw) ?? null : null
    if (importedLastEditedMapped) {
      await projectsStore.setLastEditedScene(createdProject.id, importedLastEditedMapped)
    }

    await Promise.all([projectsStore.refreshMetadata(), scenesStore.refreshMetadata()])

    uiStore.updateLoadingOverlay({
      title: '导入工程',
      message: `已导入工程 "${nextProjectName}"（${preparedScenes.length} 个场景）`,
      closable: true,
      autoClose: true,
      autoCloseDelay: 1200,
    })
    uiStore.updateLoadingProgress(100, { autoClose: true, autoCloseDelay: 1200 })

    return {
      projectName: nextProjectName,
      sceneCount: preparedScenes.length,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '导入工程失败'
    uiStore.updateLoadingOverlay({
      title: '导入工程',
      message,
      closable: true,
      autoClose: false,
    })
    uiStore.updateLoadingProgress(100, { autoClose: false })
    throw error
  }
}

export async function runProjectExportWorkflow(options: {
  projectId: string
  projectsStore: ProjectsStore
  scenesStore: ScenesStore
  uiStore: UiStore
}): Promise<{ fileName: string }> {
  const { projectId, projectsStore, scenesStore, uiStore } = options

  uiStore.showLoadingOverlay({
    title: '导出工程',
    message: '准备导出…',
    mode: 'determinate',
    progress: 5,
    closable: false,
    autoClose: false,
  })

  try {
    await Promise.all([projectsStore.initialize(), scenesStore.initialize()])

    const project = await projectsStore.loadProjectDocument(projectId)
    if (!project) {
      throw new Error('未找到要导出的工程')
    }

    const orderedSceneIds = Array.isArray(project.scenes) ? project.scenes.map((entry) => entry.id) : []
    if (!orderedSceneIds.length) {
      throw new Error('当前工程没有可导出的场景')
    }

    const embeddedScenes: ScenePackageExportScene[] = []
    for (let index = 0; index < orderedSceneIds.length; index += 1) {
      const sceneId = orderedSceneIds[index]!
      const progress = 10 + Math.round(((index + 1) / orderedSceneIds.length) * 60)
      uiStore.updateLoadingOverlay({ message: `读取场景 ${index + 1}/${orderedSceneIds.length}…` })
      uiStore.updateLoadingProgress(Math.min(progress, 72))

      const scene = await scenesStore.loadSceneDocument(sceneId, { hydrateGroundRuntime: true })
      if (!scene) {
        throw new Error(`场景不存在或无法读取：${sceneId}`)
      }

      const exportDocument = await cloneSceneDocumentForExport(scene)
      embeddedScenes.push({
        id: exportDocument.id,
        document: exportDocument,
        planningData: exportDocument.planningData ?? null,
      })
    }

    uiStore.updateLoadingOverlay({ message: '生成 ZIP 包…' })
    uiStore.updateLoadingProgress(82)

    const bundleBlob = await exportScenePackageZip({
      project: {
        id: project.id,
        name: project.name,
        defaultSceneId: project.lastEditedSceneId ?? embeddedScenes[0]!.id,
        lastEditedSceneId: project.lastEditedSceneId,
        sceneOrder: embeddedScenes.map((entry) => entry.id),
      },
      scenes: embeddedScenes,
      embedAssets: true,
      includePlanningData: false,
    })

    const fileNameBase = sanitizeExportFileName(project.name)
    const fileName = `${fileNameBase}.zip`
    triggerDownload(bundleBlob, fileName)

    uiStore.updateLoadingOverlay({
      title: '导出工程',
      message: `导出完成：${fileName}`,
      closable: true,
      autoClose: true,
      autoCloseDelay: 1000,
    })
    uiStore.updateLoadingProgress(100, { autoClose: true, autoCloseDelay: 1000 })

    return { fileName }
  } catch (error) {
    const message = error instanceof Error ? error.message : '导出工程失败'
    uiStore.updateLoadingOverlay({
      title: '导出工程',
      message,
      closable: true,
      autoClose: false,
    })
    uiStore.updateLoadingProgress(100, { autoClose: false })
    throw error
  }
}
