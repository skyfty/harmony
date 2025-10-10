<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'

const emit = defineEmits<{
  (event: 'collapse'): void
}>()

const sceneStore = useSceneStore()
const { hierarchyItems, selectedNodeId } = storeToRefs(sceneStore)

const opened = ref<string[]>([])

const selected = computed({
  get: () => (selectedNodeId.value ? [selectedNodeId.value] : []),
  set: (ids: string[]) => {
    const nextId = ids[0] ?? null
    if (nextId !== selectedNodeId.value) {
      sceneStore.selectNode(nextId)
    }
  },
})

watch(
  hierarchyItems,
  (items) => {
    opened.value = expandAll(items)
  },
  { immediate: true }
)

function expandAll(items: Array<{ id: string; children?: Array<unknown> }>): string[] {
  const collected: string[] = []
  for (const item of items) {
    collected.push(item.id)
    if (Array.isArray(item.children) && item.children.length) {
      collected.push(...expandAll(item.children as Array<{ id: string; children?: Array<unknown> }>))
    }
  }
  return collected
}
</script>

<template>
  <v-card class="panel-card" elevation="4">
    <v-toolbar density="compact" title="Hierarchy" class="panel-toolbar">
      <v-spacer />
      <v-btn icon="mdi-window-minimize" variant="text" @click="emit('collapse')" />
    </v-toolbar>
    <v-divider />
    <div class="panel-body hierarchy-body">
      <v-treeview
        v-model:opened="opened"
        v-model:selected="selected"
        :items="hierarchyItems"
        item-title="name"
        item-value="id"
        color="primary"
        activatable
        open-on-click
        class="hierarchy-tree"
      >
        <template #prepend>
          <v-icon size="small" class="mr-1">mdi-cube-outline</v-icon>
        </template>
      </v-treeview>
    </div>
  </v-card>
</template>

<style scoped>
.panel-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: rgba(36, 38, 41, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
}

.panel-body {
  flex: 1;
  overflow: hidden;
  padding: 0;
}

.hierarchy-body {
  padding: 0.75rem;
}

.hierarchy-tree {
  height: 100%;
  overflow-y: auto;
}
</style>
