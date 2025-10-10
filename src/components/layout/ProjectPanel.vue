<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore, type ProjectAsset } from '@/stores/sceneStore'

const emit = defineEmits<{
  (event: 'collapse'): void
}>()

const sceneStore = useSceneStore()
const { projectTree, activeDirectoryId, currentAssets, selectedAssetId } = storeToRefs(sceneStore)

const openedDirectories = ref<string[]>([])

const selectedDirectory = computed({
  get: () => (activeDirectoryId.value ? [activeDirectoryId.value] : []),
  set: (ids: string[]) => {
    const target = ids[0]
    if (target) {
      sceneStore.setActiveDirectory(target)
    }
  },
})

watch(
  projectTree,
  (tree) => {
    openedDirectories.value = expandAllDirectories(tree)
  },
  { immediate: true }
)

function expandAllDirectories(tree: Array<{ id: string; children?: unknown[] }>): string[] {
  const ids: string[] = []
  for (const node of tree) {
    ids.push(node.id)
    if (Array.isArray(node.children) && node.children.length) {
      ids.push(...expandAllDirectories(node.children as Array<{ id: string; children?: unknown[] }>))
    }
  }
  return ids
}

function selectAsset(asset: ProjectAsset) {
  sceneStore.selectAsset(asset.id)
}

function addAssetToScene(asset: ProjectAsset) {
  sceneStore.addNodeFromAsset(asset)
}

function assetIcon(type: ProjectAsset['type']) {
  switch (type) {
    case 'texture':
      return 'mdi-texture-box'
    case 'image':
      return 'mdi-image-outline'
    default:
      return 'mdi-cube'
  }
}
</script>

<template>
  <v-card class="panel-card" elevation="8">
    <v-toolbar density="compact" class="panel-toolbar" height="40">
      <v-toolbar-title class="toolbar-title">
        <v-icon start size="18">mdi-folder-outline</v-icon>
        Project
      </v-toolbar-title>
      <v-spacer />
      <v-btn icon="mdi-window-minimize" variant="text" @click="emit('collapse')" />
    </v-toolbar>
    <v-divider />
    <div class="project-content">
      <div class="project-tree">
        <v-toolbar density="compact" flat height="36">
          <v-toolbar-title class="text-subtitle-2">Assets</v-toolbar-title>
        </v-toolbar>
        <v-divider />
        <v-treeview
          v-model:opened="openedDirectories"
          v-model:selected="selectedDirectory"
          :items="projectTree"
          density="compact"
          item-title="name"
          item-value="id"
          activatable
          open-on-click
          class="tree-view"
        >
          <template #prepend>
            <v-icon size="small">mdi-folder</v-icon>
          </template>
        </v-treeview>
      </div>
      <div class="project-gallery">
        <v-toolbar density="compact" flat height="36">
          <v-toolbar-title class="text-subtitle-2">Thumbnails</v-toolbar-title>
        </v-toolbar>
        <v-divider />
        <div v-if="currentAssets.length" class="gallery-grid">
          <v-card
            v-for="asset in currentAssets"
            :key="asset.id"
            :class="['asset-card', { 'is-selected': selectedAssetId === asset.id }]"
            elevation="4"
            @click="selectAsset(asset)"
          >
            <div class="asset-preview" :style="{ background: asset.previewColor }">
              <v-icon size="32" color="white">{{ assetIcon(asset.type) }}</v-icon>
            </div>
            <v-card-item>
              <v-card-title>{{ asset.name }}</v-card-title>
              <v-card-subtitle class="text-uppercase">{{ asset.type }}</v-card-subtitle>
            </v-card-item>
            <v-card-actions>
              <v-btn
                color="primary"
                variant="tonal"
                density="comfortable"
                block
                @click.stop="addAssetToScene(asset)"
              >
                Add to Scene
              </v-btn>
            </v-card-actions>
          </v-card>
        </div>
        <div v-else class="placeholder-text">Select a folder to preview assets.</div>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.panel-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: rgba(28, 30, 33, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
}

.project-content {
  display: grid;
  grid-template-columns: 240px 1fr;
  flex: 1;
  min-height: 0;
}

.project-tree {
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  min-height: 0;
}

.project-gallery {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.tree-view {
  flex: 1;
  overflow-y: auto;
}

.tree-view :deep(.v-treeview-node__root) {
  padding-inline-start: 12px;
}

.tree-view :deep(.v-treeview-node__level) {
  margin-inline-start: 12px;
}

.gallery-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  padding: 12px;
  overflow-y: auto;
}

.asset-card {
  display: flex;
  flex-direction: column;
  background-color: rgba(18, 20, 24, 0.9);
  border: 1px solid transparent;
  transition: border-color 150ms ease, transform 150ms ease;
  cursor: pointer;
}

.asset-card:hover {
  border-color: rgba(77, 208, 225, 0.45);
  transform: translateY(-2px);
}

.asset-card.is-selected {
  border-color: rgba(0, 172, 193, 0.9);
  box-shadow: 0 0 12px rgba(0, 172, 193, 0.35);
}

.asset-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 96px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.placeholder-text {
  color: rgba(233, 236, 241, 0.32);
  font-size: 0.9rem;
  text-align: center;
  margin: auto;
}

.panel-toolbar :deep(.v-toolbar-title),
.project-tree :deep(.v-toolbar-title),
.project-gallery :deep(.v-toolbar-title) {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  margin-inline-start: 0px;
}

.toolbar-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.panel-toolbar :deep(.v-btn) {
  width: 32px;
  height: 32px;
}

.asset-card :deep(.v-card-title) {
  font-size: 0.85rem;
}

.asset-card :deep(.v-card-subtitle) {
  font-size: 0.7rem;
  letter-spacing: 0.08em;
}
</style>
