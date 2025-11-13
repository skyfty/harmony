<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AssetPanel from './AssetPanel.vue'
import AIChatPanel from '@/components/layout/AIChatPanel.vue'

defineProps<{
  floating?: boolean
  captureViewportScreenshot?: () => Promise<Blob | null>
}>()

const emit = defineEmits<{
  (event: 'collapse'): void
  (event: 'toggle-placement'): void
}>()

type ProjectPanelTab = 'project' | 'assistant'

const PROJECT_TAB_STORAGE_KEY = 'harmony:project-panel:active-tab'

function restoreActiveTab(): ProjectPanelTab {
  if (typeof window === 'undefined') {
    return 'project'
  }
  const stored = window.localStorage.getItem(PROJECT_TAB_STORAGE_KEY)
  return stored === 'assistant' ? 'assistant' : 'project'
}

function persistActiveTab(tab: ProjectPanelTab): void {
  if (typeof window === 'undefined') {
    return
  }
  window.localStorage.setItem(PROJECT_TAB_STORAGE_KEY, tab)
}

const activeTab = ref<ProjectPanelTab>(restoreActiveTab())

watch(activeTab, (tab) => {
  persistActiveTab(tab)
})

function selectTab(tab: ProjectPanelTab): void {
  if (activeTab.value === tab) {
    return
  }
  activeTab.value = tab
}

const placementIcon = computed(() => 'mdi-dock-window')
const placementTitle = computed(() => 'Toggle placement')
</script>

<template>
  <v-card
    :class="['panel-card', { 'is-floating': floating }]"
    :elevation="floating ? 12 : 8"
  >
    <v-toolbar class="panel-toolbar" height="40px">
      <div class="panel-toolbar__left">
        <div class="panel-toolbar-tabs">
          <v-btn
            class="panel-toolbar-tab"
            :class="{ 'is-active': activeTab === 'project' }"
            variant="text"
            size="small"
            @click="selectTab('project')"
          >
            <span class="panel-toolbar-tab__label">Project</span>
          </v-btn>
          <v-btn
            class="panel-toolbar-tab"
            :class="{ 'is-active': activeTab === 'assistant' }"
            variant="text"
            size="small"
            @click="selectTab('assistant')"
          >
            <span class="panel-toolbar-tab__label">AI Chat</span>
          </v-btn>
        </div>
      </div>
      <v-spacer />
      <v-btn
        class="placement-toggle"
        variant="text"
        size="small"
        :icon="placementIcon"
        :title="placementTitle"
        @click="emit('toggle-placement')"
      />
      <v-btn icon="mdi-window-minimize" size="small" variant="text" @click="emit('collapse')" />
    </v-toolbar>
    <v-divider />
    <div class="panel-content">
      <AssetPanel v-if="activeTab === 'project'" />
      <div v-else class="assistant-panel">
        <AIChatPanel :capture-viewport-screenshot="captureViewportScreenshot" />
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.panel-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: rgba(18, 22, 28, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
}

.panel-card.is-floating {
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.35);
}

.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  padding: 0 8px;
}

.panel-title {
  font-size: 0.86rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-weight: 700;
  color: rgba(233, 236, 241, 0.82);
}

.placement-toggle {
  color: rgba(233, 236, 241, 0.72);
}

.panel-toolbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.panel-toolbar-tabs {
  display: flex;
  align-items: center;
  gap: 12px;
}

.panel-toolbar-tab {
  position: relative;
  flex: 0 0 auto;
  border-radius: 0;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.72);
  padding: 0 14px;
  min-width: max-content;
  max-width: 160px;
  transition: color 0.18s ease;
}

.panel-toolbar-tab::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -6px;
  height: 2px;
  background-color: transparent;
  transition: background-color 0.18s ease, transform 0.18s ease;
  transform-origin: center;
}

.panel-toolbar-tab.is-active {
  color: #f5fbff;
}

.panel-toolbar-tab.is-active::after {
  background-color: rgba(0, 169, 255, 0.85);
  transform: scaleX(1);
}

.panel-toolbar-tab :deep(.v-btn__content) {
  justify-content: center;
  max-width: 100%;
  gap: 4px;
}

.panel-toolbar-tab__label {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.assistant-panel {
  flex: 1;
  display: flex;
  min-height: 0;
  padding: 6px 8px 10px;
}
</style>
