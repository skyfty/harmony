import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createAssetTag, listAssetTags } from '@/api/modules/resources'
import type { AssetTag } from '@/types'

export const useTagStore = defineStore('uploader-tags', () => {
  const items = ref<AssetTag[]>([])
  const loading = ref(false)
  const initialized = ref(false)
  const errorMessage = ref<string | null>(null)

  const sortedTags = computed(() =>
    [...items.value].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
  )

  async function fetchTags(force = false): Promise<void> {
    if (loading.value) {
      return
    }
    if (!force && initialized.value) {
      return
    }
    loading.value = true
    errorMessage.value = null
    try {
      const data = await listAssetTags()
      items.value = data
      initialized.value = true
    } catch (error) {
      console.warn('[uploader] failed to load asset tags', error)
      errorMessage.value = error instanceof Error ? error.message : '获取标签失败'
    } finally {
      loading.value = false
    }
  }

  async function createTag(name: string, description?: string | null): Promise<AssetTag> {
    const tag = await createAssetTag(name, description ?? undefined)
  const exists = items.value.find((item: AssetTag) => item.id === tag.id)
    if (!exists) {
      items.value = [...items.value, tag]
    }
    return tag
  }

  return {
    items,
    sortedTags,
    loading,
    errorMessage,
    fetchTags,
    createTag,
  }
})
