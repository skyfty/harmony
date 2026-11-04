<script setup lang="ts">
import { computed } from 'vue'
import AssetPanel from './AssetPanel.vue'

const props = defineProps<{
  floating?: boolean
}>()

const emit = defineEmits<{
  (event: 'collapse'): void
  (event: 'toggle-placement'): void
}>()

const floating = computed(() => props.floating ?? false)
// Match HierarchyPanel: icon toggles when floating; title reflects action
const placementIcon = computed(() => (floating.value ? 'mdi-dock-left' : 'mdi-arrow-expand'))
const placementTitle = computed(() => (floating.value ? 'Dock to left' : 'Float panel'))
</script>

<template>
  <v-card
    :class="['panel-card', { 'is-floating': floating }]"
    :elevation="floating ? 12 : 8"
  >
    <v-toolbar density="compact" title="Project" class="panel-toolbar" height="40px">
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
      <AssetPanel />
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

.panel-toolbar :deep(.v-toolbar-title) {
  font-size: 0.86rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: rgba(233, 236, 241, 0.82);
  margin-inline-start: 0;
}

.placement-toggle {
  color: rgba(233, 236, 241, 0.72);
}

.panel-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

</style>
