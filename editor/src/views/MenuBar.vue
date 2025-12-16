

<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore, type EditorPanel } from '@/stores/sceneStore'
import AddNodeMenu from '@/components/common/AddNodeMenu.vue'
import UserAccountControls from '@/components/layout/UserAccountControls.vue'
import PlanningDialog from '@/components/layout/PlanningDialog.vue'

type QuickAction = {
  icon: string
  label: string
  action: string
}

const quickActions: QuickAction[] = [
  { icon: 'mdi-play-circle-outline', label: 'Preview', action: 'Preview' },
]

const props = defineProps<{ showStats: boolean }>()

const sceneStore = useSceneStore()
const { canUndo, canRedo, currentSceneMeta, panelVisibility, hasUnsavedChanges } = storeToRefs(sceneStore)
const sceneName = computed(() => currentSceneMeta.value?.name?.trim() || 'Untitled Scene')
const showUnsavedIndicator = computed(() => hasUnsavedChanges.value)

const emit = defineEmits<{
  (event: 'menu-action', action: string): void
  (event: 'toggle-stats'): void
}>()

const isPlanningDialogOpen = ref(false)

function handleMenuAction(action: string) {
  if ((action === 'Undo' && !canUndo.value) || (action === 'Redo' && !canRedo.value)) {
    return
  }
  emit('menu-action', action)
}

function handleTogglePanel(panel: EditorPanel) {
  sceneStore.togglePanelVisibility(panel)
}

function handleToggleStats() {
  emit('toggle-stats')
}

function openPlanningDialog() {
  isPlanningDialogOpen.value = true
}

</script>

<template>
  <section class="menu-bar">
      <div class="menu-left">
        <div class="brand">Harmony</div>
        <div class="menu-items">
          <div class="menu-item">
            <v-btn
              class="menu-button"
              variant="text"
              color="rgba(255, 255, 255, 0.72)"
              density="comfortable"
              rounded="xl"
            >
              <v-menu transition="none">
                <template #activator="{ props }">
                  <span v-bind="props">File</span>
                </template>
                <v-list class="menu-dropdown">
                  <v-list-item @click="handleMenuAction('New')" class="menu-list-item">
                    New
                    <template  #append>
                      <span class="shortcut-label">Ctrl+N</span>
                    </template>
                  </v-list-item>
                  <v-list-item @click="handleMenuAction('Open')" class="menu-list-item">
                    Open
                    <template #append>
                      <span class="shortcut-label">Ctrl+O</span>
                    </template>
                  </v-list-item>
                  <v-list-item @click="handleMenuAction('Save')" class="menu-list-item">
                    Save
                    <template   #append>
                      <span class="shortcut-label">Ctrl+S</span>
                    </template>
                  </v-list-item>
                  <v-list-item @click="handleMenuAction('SaveAs')" class="menu-list-item">
                    Save as
                  </v-list-item>
                  <v-divider />
                  <v-list-item @click="handleMenuAction('Import')" class="menu-list-item">
                    Import
                  </v-list-item>
                  <v-list-item @click="handleMenuAction('Export')" class="menu-list-item">
                    Export
                  </v-list-item>
                  <v-divider />
                  <v-list-item @click="openPlanningDialog" class="menu-list-item">
                    Planning
                  </v-list-item>
       
                </v-list>
                </v-menu>
                <v-icon size="18" class="ml-1">mdi-menu-down</v-icon>

            </v-btn>
            <v-btn
              class="menu-button"
              variant="text"
              color="rgba(255, 255, 255, 0.72)"
              density="comfortable"
              rounded="xl"
            >
              <v-menu transition="none">
                <template #activator="{ props }">
                  <span v-bind="props">Edit</span>
                </template>
                <v-list class="menu-dropdown">
                  <v-list-item
                    @click="handleMenuAction('Undo')"
                    class="menu-list-item"
                    :disabled="!canUndo"
                  >
                    Undo
                    <template  #append>
                      <span class="shortcut-label">Ctrl+Z</span>
                    </template>
                  </v-list-item>
                  <v-list-item
                    @click="handleMenuAction('Redo')"
                    class="menu-list-item"
                    :disabled="!canRedo"
                  >
                    Redo
                    <template   #append>
                      <span class="shortcut-label">Ctrl+Y</span>
                    </template>
                  </v-list-item>
                  <v-divider />
                  <v-list-item @click="handleMenuAction('Copy')" class="menu-list-item">
                    Copy
                    <template #append>
                      <span class="shortcut-label">Ctrl+C</span>
                    </template>
                  </v-list-item>
                  <v-list-item @click="handleMenuAction('Cut')" class="menu-list-item">
                    Cut
                    <template  #append>
                      <span class="shortcut-label">Ctrl+X</span>
                    </template>
                  </v-list-item>
                  <v-list-item @click="handleMenuAction('Paste')" class="menu-list-item">
                    Paste
                    <template #append>
                      <span class="shortcut-label">Ctrl+V</span>
                    </template>
                  </v-list-item>
                  <v-list-item @click="handleMenuAction('Delete')" class="menu-list-item">
                    Delete
                    <template   #append>
                      <span class="shortcut-label">Ctrl+D</span>
                    </template>
                  </v-list-item>
                  <v-divider />
                  <v-list-item @click="handleMenuAction('Select All')" class="menu-list-item">
                    Select All
                    <template #append>
                      <span class="shortcut-label">Ctrl+A</span>
                    </template>
                  </v-list-item>
                  <v-list-item @click="handleMenuAction('Deselect All')" class="menu-list-item">
                    Deselect All
                    <template  #append>
                      <span class="shortcut-label">Ctrl+D</span>
                    </template>
                  </v-list-item>
                  <v-divider />
                  <v-list-item @click="handleMenuAction('CleanUnusedAssets')" class="menu-list-item">
                    Clean Unused Assets    </v-list-item>
                </v-list>
                </v-menu>
                <v-icon size="18" class="ml-1">mdi-menu-down</v-icon>

            </v-btn>
            <v-btn
              class="menu-button"
              variant="text"
              color="rgba(255, 255, 255, 0.72)"
              density="comfortable"
              rounded="xl"
            >
              <AddNodeMenu>
                <template #activator="{ props }">
                  <span v-bind="props">Add</span>
                </template>
              </AddNodeMenu>
              <v-icon size="18" class="ml-1">mdi-menu-down</v-icon>
            </v-btn>
            <v-btn
              class="menu-button"
              variant="text"
              color="rgba(255, 255, 255, 0.72)"
              density="comfortable"
              rounded="xl"
            >
              <v-menu transition="none">
                <template #activator="{ props }">
                  <span v-bind="props">Views</span>
                </template>
                <v-list class="menu-dropdown">
                  <v-list-item
                    class="menu-list-item"
                    @click="handleTogglePanel('hierarchy')"
                  >
                    Hierarchy
                    <template #append>
                      <span class="menu-item-check">
                        <v-icon v-if="panelVisibility.hierarchy" size="18">mdi-check</v-icon>
                      </span>
                    </template>
                  </v-list-item>
                  <v-list-item
                    class="menu-list-item"
                    @click="handleTogglePanel('inspector')"
                  >
                    Inspector
                    <template #append>
                      <span class="menu-item-check">
                        <v-icon v-if="panelVisibility.inspector" size="18">mdi-check</v-icon>
                      </span>
                    </template>
                  </v-list-item>
                  <v-list-item
                    class="menu-list-item"
                    @click="handleTogglePanel('project')"
                  >
                    Project
                    <template #append>
                      <span class="menu-item-check">
                        <v-icon v-if="panelVisibility.project" size="18">mdi-check</v-icon>
                      </span>
                    </template>
                  </v-list-item>
                  <v-divider />
                  <v-list-item
                    class="menu-list-item"
                    @click="handleToggleStats"
                  >
                    Stats Panel
                    <template #append>
                      <span class="menu-item-check">
                        <v-icon v-if="props.showStats" size="18">mdi-check</v-icon>
                      </span>
                    </template>
                  </v-list-item>
                </v-list>
              </v-menu>
              <v-icon size="18" class="ml-1">mdi-menu-down</v-icon>
            </v-btn>
            <v-btn
              class="menu-button"
              variant="text"
              color="rgba(255, 255, 255, 0.72)"
              density="comfortable"
              rounded="xl"
              @click="handleMenuAction('Help')"
            >
              Help
            </v-btn>
          </div>



        
        </div>
      </div>
      <div class="menu-center">
  <v-icon class="scene-icon" size="18">mdi-shape-outline</v-icon>
        <span class="scene-title">{{ sceneName }}</span>
        <v-icon
          v-if="showUnsavedIndicator"
          class="scene-unsaved-indicator"
          size="16"
          title="有未保存的更改"
          aria-label="有未保存的更改"
        >mdi-content-save-alert-outline</v-icon>
      </div>
      <div class="menu-right">
        <v-btn
          class="save-button"
          variant="tonal"
          color="primary"
          density="comfortable"
          size="small"
          rounded
          :disabled="!hasUnsavedChanges"
          @click="handleMenuAction('Save')"
        >
          <v-icon start>mdi-content-save</v-icon>
          Save
        </v-btn>
        <v-btn
          v-for="action in quickActions"
          :key="action.icon"
          class="action-button"
          variant="tonal"
          color="primary"
          density="comfortable"
          size="small"
          rounded
          @click="handleMenuAction(action.action)"
        >
          <v-icon start>{{ action.icon }}</v-icon>
          {{ action.label }}
        </v-btn>
        <UserAccountControls />
      </div>
    </section>
    <PlanningDialog v-model="isPlanningDialogOpen" />

</template>

<style scoped>

.menu-bar {
  grid-area: menu;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  padding: 2px 12px;
  background: rgba(16, 19, 24, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 14px;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
  column-gap: 16px;
}

.menu-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.brand {
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #f4f6fb;
}

.menu-items {
  display: flex;
  gap: 2px;
}

.menu-item {
  position: relative;
}

.menu-button {
  color: rgba(244, 247, 255, 0.76);
  font-weight: 500;
  text-transform: none;
}

.menu-dropdown {
  background: rgba(18, 21, 26, 0.95);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
  padding: 6px;
}

.menu-submenu {
  padding: 6px;
}

.menu-list-item {
  color: rgba(244, 247, 255, 0.9);
  font-size: 0.9rem;
  padding: 0px 18px;
  border-radius: 8px;
  transition: background-color 0.18s ease;
  min-width: 160px;
  min-height: 28px;
  
}

.menu-list-item:not(:last-child) {
  margin-bottom: 6px;
}

.menu-list-item:hover {
  background-color: rgba(74, 106, 187, 0.18);
}

.menu-item-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.menu-dropdown :deep(.v-divider) {
  margin: 4px 0;
  opacity: 0.32;
}

.menu-list-item.has-children :deep(.v-list-item__append) {
  margin-inline-start: auto;
}

.menu-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.menu-center {
  justify-self: center;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #f4f6fb;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.scene-icon {
  color: rgba(244, 247, 255, 0.72);
}

.scene-title {
  white-space: nowrap;
}

.scene-unsaved-indicator {
  color: #ffb74d;
}

.action-button {
  font-weight: 500;
  text-transform: none;
}

.shortcut-label {
  margin-inline-start: 24px;
  font-size: 0.75rem;
  color: rgba(244, 247, 255, 0.62);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

</style>
