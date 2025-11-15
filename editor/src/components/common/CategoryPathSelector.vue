<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ResourceCategory } from '@/types/resource-category'
import { createResourceCategory } from '@/api/resourceAssets'
import { buildCategoryPathString, isAssetTypeName, isRootCategoryName, stripAssetTypeSegments } from '@/utils/categoryPath'

type CategoryOption = {
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
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: string | null): void
  (event: 'category-selected', payload: { id: string | null; label: string }): void
  (event: 'category-created', category: ResourceCategory): void
}>()

const searchText = ref('')
const loading = ref(false)
const initialOptions = ref<CategoryOption[]>([])
const selectedId = ref<string | null>(props.modelValue ?? null)
const menuOpen = ref(false)
const navigationStack = ref<ResourceCategory[]>([])

watch(
  () => props.modelValue,
  (value) => {
    if (value !== selectedId.value) {
      selectedId.value = value ?? null
      if (menuOpen.value) {
        resetNavigationToSelected()
      }
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

function toOption(category: ResourceCategory): CategoryOption | null {
  const rawPath = Array.isArray(category.path) && category.path.length
    ? category.path.map((item) => item?.name ?? '').filter((name) => name.length > 0)
    : [category.name]
  const sanitizedPath = stripAssetTypeSegments(rawPath)
  if (!sanitizedPath.length && rawPath.length <= 1 && (isAssetTypeName(category.name) || isRootCategoryName(category.name))) {
    return null
  }
  const effectivePath = sanitizedPath.length ? sanitizedPath : rawPath
  const pathString = effectivePath.join(' / ')
  const label = pathString.length ? pathString : category.name
  return {
    id: category.id,
    label,
    pathString: label,
    path: effectivePath,
  }
}

function collectCategories(categories: ResourceCategory[], bucket: Map<string, CategoryOption>): void {
  categories.forEach((category) => {
    if (!category || typeof category.id !== 'string') {
      return
    }
    const option = toOption(category)
    if (option && !bucket.has(option.id)) {
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
    collectCategories(categories ?? [], bucket)
    initialOptions.value = Array.from(bucket.values()).sort((a, b) => a.pathString.localeCompare(b.pathString))
    if (menuOpen.value) {
      resetNavigationToSelected()
    }
  },
  { immediate: true },
)

const categoryIndex = computed(() => {
  const map = new Map<string, ResourceCategory>()
  const traverse = (nodes: ResourceCategory[]) => {
    nodes.forEach((node) => {
      if (!node || typeof node.id !== 'string') {
        return
      }
      map.set(node.id, node)
      if (Array.isArray(node.children) && node.children.length) {
        traverse(node.children)
      }
    })
  }
  traverse(props.categories ?? [])
  return map
})

function scheduleSearch(value: string | null): void {
  searchText.value = value ?? ''
}

const optionMap = computed(() => {
  const map = new Map<string, CategoryOption>()
  initialOptions.value.forEach((option) => map.set(option.id, option))
  return map
})

function getPathLabelById(id: string): string {
  const option = optionMap.value.get(id)
  if (option) {
    return option.pathString
  }
  const node = categoryIndex.value.get(id)
  if (node) {
    const segments = Array.isArray(node.path) && node.path.length
      ? node.path.map((item) => item?.name ?? '').filter((name) => name.length > 0)
      : [node.name]
    return buildCategoryPathString(segments)
  }
  return ''
}

const selectedLabel = computed(() => {
  if (!selectedId.value) {
    return ''
  }
  return getPathLabelById(selectedId.value)
})

const breadcrumbs = computed(() => navigationStack.value.map((node) => ({ id: node.id, name: node.name })))

const isSearching = computed(() => searchText.value.trim().length > 0)

function flattenRootCategories(nodes: ResourceCategory[] | undefined): ResourceCategory[] {
  if (!Array.isArray(nodes)) {
    return []
  }
  const result: ResourceCategory[] = []
  nodes.forEach((node) => {
    if (!node) {
      return
    }
    if ((isAssetTypeName(node.name) || isRootCategoryName(node.name)) && Array.isArray(node.children) && node.children.length) {
      node.children.forEach((child) => {
        if (child) {
          result.push(child)
        }
      })
    } else {
      result.push(node)
    }
  })
  return result
}

const currentChildren = computed(() => {
  const parent = navigationStack.value.length ? navigationStack.value[navigationStack.value.length - 1] : null
  const children = parent ? parent.children ?? [] : flattenRootCategories(props.categories)
  return Array.isArray(children)
    ? [...children].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    : []
})

const searchItems = computed(() => {
  const keyword = searchText.value.trim()
  if (!keyword.length) {
    return []
  }
  const lowerKeyword = keyword.toLowerCase()
  const result: CategoryOption[] = []
  currentChildren.value.forEach((child) => {
    const option = optionMap.value.get(child.id)
    if (!option) {
      return
    }
    const candidate = `${child.name}`.toLowerCase()
    const labelCandidate = option.pathString.toLowerCase()
    if (candidate.includes(lowerKeyword) || labelCandidate.includes(lowerKeyword)) {
      result.push(option)
    }
  })
  const exactMatch = currentChildren.value.some((child) => child.name.trim().toLowerCase() === lowerKeyword)
  if (!exactMatch) {
    result.push({
      id: `__create__:${keyword}`,
      label: `创建分类 “${keyword}”`,
      pathString: keyword,
      path: normalizeSegments(keyword),
    })
  }
  return result
})

function resetNavigationToSelected(): void {
  if (!selectedId.value) {
    navigationStack.value = []
    return
  }
  const node = categoryIndex.value.get(selectedId.value)
  if (!node || !Array.isArray(node.path)) {
    navigationStack.value = []
    return
  }
  const ancestorIds = node.path
    .slice(0, -1)
    .map((item) => item.id)
    .filter((id): id is string => Boolean(id))
  const resolved: ResourceCategory[] = []
  ancestorIds.forEach((id) => {
    const target = categoryIndex.value.get(id)
    if (target && !isAssetTypeName(target.name) && !isRootCategoryName(target.name)) {
      resolved.push(target)
    }
  })
  navigationStack.value = resolved
}

function clearSearchState(): void {
  searchText.value = ''
  loading.value = false
}

function handleMenuChange(open: boolean): void {
  menuOpen.value = open
  if (open) {
    resetNavigationToSelected()
  } else {
    clearSearchState()
  }
}

function navigateTo(index: number | null): void {
  if (index === null) {
    navigationStack.value = []
    return
  }
  navigationStack.value = navigationStack.value.slice(0, index + 1)
}

function enterNode(category: ResourceCategory): void {
  if (!Array.isArray(category.children) || !category.children.length) {
    return
  }
  const existing = navigationStack.value.findIndex((item) => item.id === category.id)
  if (existing >= 0) {
    navigationStack.value = navigationStack.value.slice(0, existing + 1)
    return
  }
  navigationStack.value = [...navigationStack.value, category]
}

function selectCategoryById(id: string | null): void {
  if (!id) {
    selectedId.value = null
    emit('update:modelValue', null)
    emit('category-selected', { id: null, label: '' })
    clearSearchState()
    menuOpen.value = false
    return
  }
  selectedId.value = id
  emit('update:modelValue', id)
  const label = getPathLabelById(id)
  emit('category-selected', { id, label })
  clearSearchState()
  menuOpen.value = false
}

function handleTreeItemClick(category: ResourceCategory): void {
  const canExpand = Array.isArray(category.children) && category.children.length > 0
  if (canExpand) {
    enterNode(category)
    return
  }
  selectCategoryById(category.id)
}

function handleSearchSelect(option: CategoryOption): void {
  if (option.id.startsWith('__create__')) {
    const path = option.id.slice('__create__:'.length)
    void handleCreate(path.length ? path : option.pathString)
    return
  }
  selectCategoryById(option.id)
}

function getCurrentParentSegments(): string[] {
  const parent = navigationStack.value.length ? navigationStack.value[navigationStack.value.length - 1] : null
  if (!parent) {
    return []
  }
  if (Array.isArray(parent.path) && parent.path.length) {
    return parent.path.map((item) => item?.name ?? '').filter((name) => name.length > 0)
  }
  return parent.name ? [parent.name] : []
}

async function handleCreate(pathString: string): Promise<void> {
  const relativeSegments = normalizeSegments(pathString)
  if (!relativeSegments.length) {
    return
  }
  const baseSegments = getCurrentParentSegments()
  const segments = [...baseSegments, ...relativeSegments]
  if (!segments.length) {
    return
  }
  loading.value = true
  try {
    const created = await createResourceCategory({ path: segments })
    emit('category-created', created)
    const option = toOption(created)
    if (option) {
      const next = [...initialOptions.value.filter((item) => item.id !== option.id), option]
      initialOptions.value = next.sort((a, b) => a.pathString.localeCompare(b.pathString))
    }
    searchText.value = ''
    selectCategoryById(created.id)
  } catch (error) {
    console.error('创建分类失败', error)
  } finally {
    loading.value = false
  }
}

function handleClear(): void {
  selectCategoryById(null)
}
</script>

<template>
  <div class="category-selector">
    <v-menu
      :model-value="menuOpen"
      :close-on-content-click="false"
      transition="scale-transition"
      location="bottom start"
      content-class="category-menu__overlay"
      max-width="420"
      :offset="[-4, 4]"
      @update:model-value="handleMenuChange"
    >
      <template #activator="{ props: menuProps }">
        <v-text-field
          v-bind="menuProps"
          :model-value="selectedLabel"
          :label="label ?? '资源分类'"
          :placeholder="placeholder ?? '选择分类'"
          :hint="hint"
                variant="underlined"
          :persistent-hint="Boolean(hint)"
          density="compact"
          :disabled="disabled"
          :loading="loading"
          readonly
          clearable
          class="category-selector__field"
          @click:clear="handleClear"
        >
          <template #append-inner>
            <v-icon size="18">mdi-menu-down</v-icon>
          </template>
        </v-text-field>
      </template>
      <v-sheet class="category-menu" elevation="6" rounded="lg">
        <v-progress-linear v-if="loading" indeterminate color="primary" height="2" />
        <div class="category-menu__search">
          <v-text-field
            :model-value="searchText"
            density="compact"
            variant="outlined"
            placeholder="搜索分类或输入路径创建"
            clearable
            autofocus
            hide-details
            prepend-inner-icon="mdi-magnify"
            @update:model-value="scheduleSearch"
          />
        </div>
        <div v-if="!isSearching" class="category-menu__breadcrumbs">
          <v-btn variant="text" size="small" @click="navigateTo(null)">全部分类</v-btn>
          <template v-for="(crumb, index) in breadcrumbs" :key="crumb.id">
            <span class="category-menu__divider">/</span>
            <v-btn variant="text" size="small" @click="navigateTo(index)">{{ crumb.name }}</v-btn>
          </template>
        </div>
        <div class="category-menu__list">
          <template v-if="!isSearching">
            <v-list density="compact" nav>
              <v-list-item
                v-for="child in currentChildren"
                :key="child.id"
                :value="child.id"
                :class="[
                  'category-menu__item',
                  { 'category-menu__item--active': selectedId === child.id },
                ]"
                rounded="sm"
                @click="handleTreeItemClick(child)"
              >
                <v-list-item-title>{{ child.name }}</v-list-item-title>
                <template #append>
                  <v-icon
                    v-if="Array.isArray(child.children) && child.children.length"
                    size="18"
                    class="category-menu__append"
                    @click.stop="enterNode(child)"
                  >
                    mdi-chevron-right
                  </v-icon>
                </template>
              </v-list-item>
            </v-list>
            <div v-if="!currentChildren.length" class="category-menu__empty text-medium-emphasis">
              没有子分类
            </div>
          </template>
          <template v-else>
            <v-list density="compact">
              <v-list-item
                v-for="option in searchItems"
                :key="option.id"
                class="category-menu__item"
                @click="handleSearchSelect(option)"
              >
                <v-list-item-title>{{ option.label }}</v-list-item-title>
              </v-list-item>
            </v-list>
            <div v-if="!searchItems.length" class="category-menu__empty text-medium-emphasis">
              没有匹配的分类，可输入完整路径创建。
            </div>
          </template>
        </div>
      </v-sheet>
    </v-menu>
  </div>
</template>

<style scoped>
.category-selector {
  min-width: 220px;
}

.category-selector__field :deep(.v-field) {
  cursor: pointer;
}

.category-menu__overlay {
  padding: 0;
  border-radius: 12px;
}

.category-menu {
  width: 340px;
  max-height: 420px;
  display: flex;
  flex-direction: column;
  background: white;
}

.category-menu__search {
  padding: 8px 12px 4px;
}

.category-menu__breadcrumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 0 12px 8px;
  gap: 4px;
}

.category-menu__divider {
  color: rgba(0, 0, 0, 0.38);
  margin: 0 4px;
}

.category-menu__list {
  padding: 0 0 8px;
  overflow-y: auto;
  flex: 1;
}

.category-menu__item {
  cursor: pointer;
}

.category-menu__item--active {
  background-color: color-mix(in srgb, var(--v-theme-primary) 12%, transparent);
}

.category-menu__item--active :deep(.v-list-item-title) {
  color: var(--v-theme-primary);
  font-weight: 600;
}

.category-menu__append {
  color: rgba(0, 0, 0, 0.54);
}

.category-menu__append:hover {
  color: rgba(0, 0, 0, 0.87);
}

.category-menu__empty {
  padding: 12px 16px;
  text-align: center;
}
</style>
