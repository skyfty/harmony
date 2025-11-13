<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ResourceCategory } from '@/types/resource-category'
import { createResourceCategory, searchResourceCategories } from '@/api/resourceAssets'

interface CategoryOption {
  id: string
  label: string
  pathString: string
  path: string[]
}

const props = defineProps<{
  modelValue: string | null
  categories: ResourceCategory[]
  label?: string
  placeholder?: string
  disabled?: boolean
  hint?: string
  dense?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string | null): void
  (event: 'category-created', category: ResourceCategory): void
}>()

const searchText = ref('')
const loading = ref(false)
const initialOptions = ref<CategoryOption[]>([])
const searchOptions = ref<CategoryOption[]>([])
const selectedId = ref<string | null>(props.modelValue ?? null)
const latestFetchToken = ref<number>(0)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.modelValue,
  (value) => {
    if (value !== selectedId.value) {
      selectedId.value = value ?? null
    }
  },
)

function normalizeSegments(path: string): string[] {
  return path
    .split(/[\\/>]|\s+->\s+/)
    .join('/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

function toOption(category: ResourceCategory): CategoryOption {
  const path = Array.isArray(category.path) && category.path.length
    ? category.path.map((item) => (item?.name ?? '').trim()).filter((name) => name.length > 0)
    : [category.name]
  const pathString = path.join(' / ')
  const label = pathString.length ? pathString : category.name
  return {
    id: category.id,
    label,
    pathString: label,
    path,
  }
}

function collectCategories(categories: ResourceCategory[], bucket: Map<string, CategoryOption>): void {
  categories.forEach((category) => {
    if (!category || typeof category.id !== 'string') {
      return
    }
    const option = toOption(category)
    if (!bucket.has(option.id)) {
      bucket.set(option.id, option)
    }
    if (Array.isArray(category.children) && category.children.length) {
      collectCategories(category.children, bucket)
    }
  })
}

watch(
  () => props.categories,
  (categories) => {
    const bucket = new Map<string, CategoryOption>()
    collectCategories(categories, bucket)
    initialOptions.value = Array.from(bucket.values()).sort((a, b) => a.pathString.localeCompare(b.pathString, 'zh-CN'))
  },
  { immediate: true },
)

function scheduleSearch(value: string): void {
  searchText.value = value
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (!value.trim().length) {
    searchOptions.value = []
    return
  }
  debounceTimer = setTimeout(runSearch, 250)
}

async function runSearch(): Promise<void> {
  const keyword = searchText.value.trim()
  if (!keyword.length) {
    searchOptions.value = []
    return
  }
  loading.value = true
  const token = Date.now()
  latestFetchToken.value = token
  try {
    const results = await searchResourceCategories(keyword, 20)
    if (latestFetchToken.value !== token) {
      return
    }
    const unique = new Map<string, CategoryOption>()
    results.forEach((category) => {
      const option = toOption(category)
      unique.set(option.id, option)
    })
    searchOptions.value = Array.from(unique.values()).sort((a, b) => a.pathString.localeCompare(b.pathString, 'zh-CN'))
  } catch (error) {
    console.warn('[CategoryPathSelector] search failed', error)
  } finally {
    if (latestFetchToken.value === token) {
      loading.value = false
    }
  }
}

const optionMap = computed(() => {
  const map = new Map<string, CategoryOption>()
  initialOptions.value.forEach((option) => map.set(option.id, option))
  searchOptions.value.forEach((option) => map.set(option.id, option))
  return map
})

const items = computed(() => {
  const base = Array.from(optionMap.value.values())
  const keyword = searchText.value.trim()
  const lowerKeyword = keyword.toLowerCase()
  const matched = keyword.length
    ? base.filter((option) => option.pathString.toLowerCase().includes(lowerKeyword))
    : base
  const result = [...matched]
  if (keyword.length) {
    const existing = base.some((option) => option.pathString.toLowerCase() === lowerKeyword)
    if (!existing) {
      result.push({
        id: `__create__:${keyword}`,
        label: `创建分类 “${keyword}”`,
        pathString: keyword,
        path: normalizeSegments(keyword),
      })
    }
  }
  return result
})

async function handleCreate(pathString: string): Promise<void> {
  const segments = normalizeSegments(pathString)
  if (!segments.length) {
    return
  }
  loading.value = true
  try {
    const created = await createResourceCategory({ path: segments })
    emit('category-created', created)
    const option = toOption(created)
    const next = [...initialOptions.value.filter((item) => item.id !== option.id), option]
    initialOptions.value = next.sort((a, b) => a.pathString.localeCompare(b.pathString, 'zh-CN'))
    searchOptions.value = []
    searchText.value = option.pathString
    selectedId.value = created.id
    emit('update:modelValue', created.id)
  } catch (error) {
    console.error('创建分类失败', error)
  } finally {
    loading.value = false
  }
}

function handleChange(value: string | null): void {
  if (!value) {
    selectedId.value = null
    emit('update:modelValue', null)
    return
  }
  if (value.startsWith('__create__')) {
    const path = value.slice('__create__:'.length)
    void handleCreate(path)
    return
  }
  selectedId.value = value
  emit('update:modelValue', value)
}

onBeforeUnmount(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
})
</script>

<template>
  <v-autocomplete
    :model-value="selectedId"
    :items="items"
    :label="label ?? '资产分类'"
    :placeholder="placeholder ?? '选择或创建分类'"
    :disabled="disabled"
    :loading="loading"
    :hint="hint"
    item-title="label"
    item-value="id"
    clearable
    hide-details="auto"
    :density="dense ? 'compact' : 'comfortable'"
    class="category-selector"
    @update:model-value="handleChange"
    @update:search="scheduleSearch"
  >
    <template #no-data>
      <div class="pa-3 text-medium-emphasis">没有匹配的分类，可输入完整路径创建新分类。</div>
    </template>
  </v-autocomplete>
</template>

<style scoped>
.category-selector {
  min-width: 220px;
}
</style>
