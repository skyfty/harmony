import { PRESET_SCENES } from '@/data/presetScenes'
import type { PresetSceneDetail, PresetSceneSummary } from '@/types/presetScene'

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function listPresetScenes(): PresetSceneSummary[] {
  return PRESET_SCENES.map((scene) => ({
    id: scene.id,
    name: scene.name,
    thumbnailUrl: scene.thumbnailUrl,
    description: scene.description ?? null,
  }))
}

export function getPresetSceneDetail(id: string): PresetSceneDetail | null {
  const found = PRESET_SCENES.find((scene) => scene.id === id)
  if (!found) {
    return null
  }
  return {
    id: found.id,
    name: found.name,
    thumbnailUrl: found.thumbnailUrl,
    description: found.description ?? null,
    document: deepClone(found.document),
  }
}
