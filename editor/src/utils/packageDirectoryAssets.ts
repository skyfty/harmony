import { ref } from 'vue'
import type { ProjectAsset } from '@/types/project-asset'
import type { ProjectDirectory } from '@/types/project-directory'
import { useSceneStore } from '@/stores/sceneStore'
import { SERVER_ASSET_PROVIDER_ID } from '@/utils/serverAssetSource'

export function flattenProjectDirectories(directories: ProjectDirectory[]): ProjectAsset[] {
  const bucket: ProjectAsset[] = []
  const visit = (list: ProjectDirectory[]) => {
    list.forEach((directory) => {
      if (directory.assets?.length) {
        bucket.push(...directory.assets)
      }
      if (directory.children?.length) {
        visit(directory.children)
      }
    })
  }
  visit(directories)
  return bucket
}

export function usePackageDirectoryAssets(providerId: string = SERVER_ASSET_PROVIDER_ID) {
  const sceneStore = useSceneStore()
  const assets = ref<ProjectAsset[]>([])
  const loaded = ref(false)
  const loading = ref(false)

  async function load(): Promise<void> {
    if (loaded.value || loading.value) {
      return
    }
    loading.value = true
    try {
      const directories = await sceneStore.ensurePackageDirectoriesLoaded(providerId)
      assets.value = flattenProjectDirectories(directories)
      loaded.value = true
    } catch (error) {
      console.warn('Failed to load package directory assets', providerId, error)
      throw error
    } finally {
      loading.value = false
    }
  }

  return {
    assets,
    loaded,
    loading,
    load,
  }
}