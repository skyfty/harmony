<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ProjectSceneMeta } from '@harmony/schema'
import FloatingPopover from '@/components/common/FloatingPopover.vue'

type SceneListItem = ProjectSceneMeta

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    anchor?: { x: number; y: number } | null
    scenes: SceneListItem[]
    title?: string
    placeholder?: string
    selectedSceneId?: string
  }>(),
  {
    anchor: null,
    title: '选择场景',
    placeholder: '搜索场景',
    selectedSceneId: '',
  },
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'select', value: SceneListItem): void
  (event: 'cancel'): void
}>()

const open = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const searchTerm = ref('')
const selectingSceneId = ref<string>(props.selectedSceneId || '')

watch(
  () => props.selectedSceneId,
  (value) => {
    selectingSceneId.value = value || ''
  },
)

const filteredScenes = computed(() => {
  const list = Array.isArray(props.scenes) ? props.scenes : []
  const term = searchTerm.value.trim().toLowerCase()
  if (!term) {
    return list
  }
  return list.filter((scene) => {
    const name = (scene.name ?? '').toLowerCase()
    const id = (scene.id ?? '').toLowerCase()
    return name.includes(term) || id.includes(term)
  })
})

function handleCancel() {
  emit('cancel')
  open.value = false
}

function handleSceneClick(scene: SceneListItem) {
  selectingSceneId.value = scene.id
  emit('select', scene)
  open.value = false
}
</script>

<template>
  <FloatingPopover v-model="open" :anchor="anchor" @cancel="handleCancel" panel-class="scene-select__panel">
    <template #header>
      <v-toolbar density="compact" class="scene-select__toolbar" height="40px">
        <div class="scene-select__title">{{ title }}</div>
        <v-spacer />
        <v-btn class="scene-select__close" icon="mdi-close" size="small" variant="text" @click="handleCancel" />
      </v-toolbar>
      <div class="scene-select__search-row">
        <v-text-field
          v-model="searchTerm"
          class="scene-select__search"
          density="compact"
          variant="underlined"
          prepend-inner-icon="mdi-magnify"
          :placeholder="placeholder"
          clearable
          hide-details
        />
      </div>
    </template>

    <div class="scene-select__body">
      <div v-if="!filteredScenes.length" class="scene-select__empty">没有可选场景</div>
      <div v-else class="scene-select__list" role="listbox" aria-label="Project scenes">
        <div
          v-for="scene in filteredScenes"
          :key="scene.id"
          class="scene-select__item"
          :class="{ 'scene-select__item--selected': scene.id === selectingSceneId }"
          role="option"
          :aria-selected="scene.id === selectingSceneId"
          @click="handleSceneClick(scene)"
        >
          <div class="scene-select__item-main">
            <div class="scene-select__item-name" :title="scene.name">{{ scene.name }}</div>
            <div class="scene-select__item-sub" :title="scene.id">{{ scene.id }}</div>
          </div>
          <v-icon v-if="scene.id === selectingSceneId" size="18" color="cyan-lighten-2">mdi-check</v-icon>
        </div>
      </div>
    </div>
  </FloatingPopover>
</template>

<style scoped>
.scene-select__panel {
  min-height: 320px;
}

.scene-select__toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.scene-select__title {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.94);
}

.scene-select__close {
  color: rgba(233, 236, 241, 0.72);
}

.scene-select__search-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1px 4px 4px;
}

.scene-select__search {
  flex: 1;
  margin-left: auto;
}

.scene-select__body {
  padding: 8px 12px 10px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 300px;
}

.scene-select__empty {
  padding: 12px 0 18px;
  text-align: center;
  color: rgba(233, 236, 241, 0.65);
  font-size: 0.82rem;
}

.scene-select__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scene-select__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: rgba(20, 24, 30, 0.8);
  cursor: pointer;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.scene-select__item:hover {
  border-color: rgba(77, 208, 225, 0.85);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
}

.scene-select__item--selected {
  border-color: rgba(77, 208, 225, 1);
  box-shadow: 0 6px 18px rgba(0, 188, 212, 0.35);
}

.scene-select__item-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.scene-select__item-name {
  font-size: 0.86rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.95);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scene-select__item-sub {
  font-size: 0.72rem;
  color: rgba(233, 236, 241, 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
