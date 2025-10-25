<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import TresViewport from '@/components/editor/TresViewport.vue'
import { useTresSceneStore, type LightType, type PrimitiveType } from '@/stores/tresSceneStore'

const sceneStore = useTresSceneStore()
const {
  nodes,
  selectedNodeId,
  selectedNode,
  transformMode,
  showGrid,
  showHelpers,
  backgroundColor,
  environmentIntensity,
} = storeToRefs(sceneStore)

const axisLabels = ['X', 'Y', 'Z'] as const

const transformModes = [
  { key: 'translate', label: '移动', icon: 'mdi-cursor-move' },
  { key: 'rotate', label: '旋转', icon: 'mdi-rotate-3d-variant' },
  { key: 'scale', label: '缩放', icon: 'mdi-crop-free' },
] as const

const selectedPrimitive = computed(() =>
  selectedNode.value?.kind === 'primitive' ? selectedNode.value : null,
)

const selectedLight = computed(() =>
  selectedNode.value?.kind === 'light' ? selectedNode.value : null,
)

onMounted(() => {
  sceneStore.initializeDefaultScene()
})

function addPrimitive(type: PrimitiveType) {
  sceneStore.addPrimitive(type)
}

function addLight(type: LightType) {
  sceneStore.addLight(type)
}

function handleSelect(nodeId: string | null) {
  sceneStore.selectNode(nodeId)
}

function handleVectorChange(key: 'position' | 'rotation' | 'scale', axis: number, value: string) {
  if (!selectedNodeId.value) {
    return
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  sceneStore.updateNodeVector(selectedNodeId.value, key, axis, numeric)
}

function handleColorChange(color: string) {
  if (!selectedNodeId.value) {
    return
  }
  const normalized = color.startsWith('#') ? color : `#${color}`
  sceneStore.updateNodeColor(selectedNodeId.value, normalized)
}

function handleVisibilityChange(value: boolean | null) {
  if (!selectedNodeId.value) {
    return
  }
  sceneStore.updateNode(selectedNodeId.value, { visible: Boolean(value) })
}

function handleIntensityChange(value: number | string) {
  if (!selectedNodeId.value || !selectedLight.value) {
    return
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  sceneStore.updateLightIntensity(selectedNodeId.value, numeric)
}

function updateNodeName(value: string) {
  if (!selectedNodeId.value) {
    return
  }
  sceneStore.updateNode(selectedNodeId.value, { name: value })
}

function updateRoughness(value: number | string) {
  if (!selectedNodeId.value || !selectedPrimitive.value) {
    return
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  sceneStore.updateNode(selectedNodeId.value, { roughness: numeric })
}

function updateMetalness(value: number | string) {
  if (!selectedNodeId.value || !selectedPrimitive.value) {
    return
  }
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  sceneStore.updateNode(selectedNodeId.value, { metalness: numeric })
}

function vectorComponent(vector: [number, number, number], axis: number): number {
  return vector[axis] ?? 0
}

function removeSelected() {
  if (!selectedNodeId.value) {
    return
  }
  sceneStore.removeNode(selectedNodeId.value)
}

function duplicateSelected() {
  if (!selectedNodeId.value) {
    return
  }
  sceneStore.duplicateNode(selectedNodeId.value)
}

function setTransformMode(mode: typeof transformModes[number]['key']) {
  sceneStore.setTransformMode(mode)
}

function toggleGrid() {
  sceneStore.toggleGrid()
}

function toggleHelpers() {
  sceneStore.toggleHelpers()
}

function updateEnvironmentIntensity(value: number | string) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  sceneStore.setEnvironmentIntensity(numeric)
}

function updateBackgroundColor(value: string) {
  const normalized = value.startsWith('#') ? value : `#${value}`
  sceneStore.setBackgroundColor(normalized)
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(1)
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(2)
  }
  if (Math.abs(value) >= 1) {
    return value.toFixed(3)
  }
  return value.toFixed(4)
}
</script>

<template>
  <div class="tres-editor-view">
    <header class="tres-editor-toolbar">
      <div class="toolbar-section">
        <span class="toolbar-label">几何体</span>
        <v-btn icon="mdi-cube-outline" density="comfortable" variant="tonal" color="primary" @click="addPrimitive('box')" />
        <v-btn icon="mdi-sphere" density="comfortable" variant="tonal" color="primary" @click="addPrimitive('sphere')" />
        <v-btn icon="mdi-texture-box" density="comfortable" variant="tonal" color="primary" @click="addPrimitive('plane')" />
        <v-btn icon="mdi-barrel-outline" density="comfortable" variant="tonal" color="primary" @click="addPrimitive('cylinder')" />
        <v-divider vertical class="mx-4" />
        <span class="toolbar-label">灯光</span>
        <v-btn icon="mdi-weather-sunny" density="comfortable" variant="text" @click="addLight('directional')" />
        <v-btn icon="mdi-weather-night" density="comfortable" variant="text" @click="addLight('ambient')" />
        <v-btn icon="mdi-weather-hazy" density="comfortable" variant="text" @click="addLight('hemisphere')" />
      </div>
      <div class="toolbar-section">
        <v-btn-group density="compact" variant="tonal">
          <v-btn
            v-for="mode in transformModes"
            :key="mode.key"
            :color="transformMode === mode.key ? 'primary' : undefined"
            @click="setTransformMode(mode.key)"
          >
            <v-icon :icon="mode.icon" start />
            {{ mode.label }}
          </v-btn>
        </v-btn-group>
        <v-divider vertical class="mx-4" />
        <v-btn
          density="comfortable"
          variant="tonal"
          :color="showGrid ? 'primary' : undefined"
          @click="toggleGrid"
        >
          <v-icon icon="mdi-grid" start /> 网格
        </v-btn>
        <v-btn
          density="comfortable"
          variant="tonal"
          :color="showHelpers ? 'primary' : undefined"
          @click="toggleHelpers"
        >
          <v-icon icon="mdi-axis-arrow" start /> 辅助
        </v-btn>
      </div>
    </header>

    <main class="tres-editor-body">
      <section class="tres-editor-viewport">
        <TresViewport
          :nodes="nodes"
          :selected-node-id="selectedNodeId"
          :show-grid="showGrid"
          :show-helpers="showHelpers"
          :background-color="backgroundColor"
          :environment-intensity="environmentIntensity"
          @select="handleSelect"
        />
      </section>
      <aside class="tres-editor-sidebar">
        <v-card elevation="8" class="sidebar-card">
          <v-card-title>场景对象</v-card-title>
          <v-divider />
          <v-card-text class="pa-0">
            <v-list density="compact" nav>
              <v-list-item
                v-for="node in nodes"
                :key="node.id"
                :value="node.id"
                :active="selectedNodeId === node.id"
                @click="handleSelect(node.id)"
              >
                <template #prepend>
                  <v-avatar size="28" class="mr-2" color="primary-darken-2">
                    <v-icon v-if="node.kind === 'primitive'" icon="mdi-shape" />
                    <v-icon v-else icon="mdi-lightbulb-on" />
                  </v-avatar>
                </template>
                <v-list-item-title>{{ node.name }}</v-list-item-title>
                <v-list-item-subtitle>{{ node.kind === 'primitive' ? node.primitive : `${node.light} light` }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card-text>
          <v-divider />
          <v-card-actions>
            <v-btn color="primary" variant="tonal" :disabled="!selectedNodeId" @click="duplicateSelected">
              <v-icon icon="mdi-content-duplicate" start /> 复制
            </v-btn>
            <v-spacer />
            <v-btn color="error" variant="text" :disabled="!selectedNodeId" @click="removeSelected">
              <v-icon icon="mdi-delete-outline" start /> 删除
            </v-btn>
          </v-card-actions>
        </v-card>

        <v-card elevation="8" class="sidebar-card" v-if="selectedNode">
          <v-card-title>属性</v-card-title>
          <v-divider />
          <v-card-text class="pb-4">
            <div class="property-section">
              <div class="property-row">
                <span class="property-label">名称</span>
                <v-text-field
                  variant="outlined"
                  density="compact"
                  hide-details
                  :model-value="selectedNode?.name ?? ''"
                  @update:model-value="updateNodeName"
                />
              </div>
              <div class="property-row">
                <span class="property-label">可见</span>
                <v-switch
                  color="primary"
                  density="compact"
                  hide-details
                  :model-value="selectedNode?.visible ?? true"
                  @update:model-value="handleVisibilityChange"
                />
              </div>
            </div>

            <template v-if="selectedPrimitive">
              <div class="property-section">
                <h3 class="section-title">位置</h3>
                <div class="vector-inputs">
                  <v-text-field
                    v-for="(axisLabel, axisIndex) in axisLabels"
                    :key="`pos-${axisLabel}`"
                    variant="outlined"
                    density="compact"
                    type="number"
                    hide-details
                    :label="axisLabel"
                    :model-value="formatNumber(vectorComponent(selectedPrimitive.position, axisIndex))"
                    @update:model-value="(value) => handleVectorChange('position', axisIndex, value)"
                  />
                </div>
              </div>

              <div class="property-section">
                <h3 class="section-title">旋转 (弧度)</h3>
                <div class="vector-inputs">
                  <v-text-field
                    v-for="(axisLabel, axisIndex) in axisLabels"
                    :key="`rot-${axisLabel}`"
                    variant="outlined"
                    density="compact"
                    type="number"
                    hide-details
                    :label="axisLabel"
                    :model-value="formatNumber(vectorComponent(selectedPrimitive.rotation, axisIndex))"
                    @update:model-value="(value) => handleVectorChange('rotation', axisIndex, value)"
                  />
                </div>
              </div>

              <div class="property-section">
                <h3 class="section-title">缩放</h3>
                <div class="vector-inputs">
                  <v-text-field
                    v-for="(axisLabel, axisIndex) in axisLabels"
                    :key="`scale-${axisLabel}`"
                    variant="outlined"
                    density="compact"
                    type="number"
                    hide-details
                    :label="axisLabel"
                    :model-value="formatNumber(vectorComponent(selectedPrimitive.scale, axisIndex))"
                    @update:model-value="(value) => handleVectorChange('scale', axisIndex, value)"
                  />
                </div>
              </div>

              <div class="property-section">
                <h3 class="section-title">材质</h3>
                <v-text-field
                  variant="outlined"
                  density="compact"
                  hide-details
                  label="颜色"
                  :model-value="selectedPrimitive.color"
                  @update:model-value="handleColorChange"
                />
                <v-slider
                  class="mt-4"
                  step="0.05"
                  min="0"
                  max="1"
                  density="compact"
                  label="粗糙度"
                  :model-value="selectedPrimitive.roughness"
                  @update:model-value="updateRoughness"
                />
                <v-slider
                  step="0.05"
                  min="0"
                  max="1"
                  density="compact"
                  label="金属度"
                  :model-value="selectedPrimitive.metalness"
                  @update:model-value="updateMetalness"
                />
              </div>
            </template>

            <template v-if="selectedLight">
              <div class="property-section">
                <h3 class="section-title">光源</h3>
                <div class="vector-inputs" v-if="selectedLight.light !== 'ambient'">
                  <v-text-field
                    v-for="(axisLabel, axisIndex) in axisLabels"
                    :key="`light-pos-${axisLabel}`"
                    variant="outlined"
                    density="compact"
                    type="number"
                    hide-details
                    :label="axisLabel"
                    :model-value="formatNumber(vectorComponent(selectedLight.position, axisIndex))"
                    @update:model-value="(value) => handleVectorChange('position', axisIndex, value)"
                  />
                </div>
                <v-text-field
                  class="mt-3"
                  variant="outlined"
                  density="compact"
                  hide-details
                  label="颜色"
                  :model-value="selectedLight.color"
                  @update:model-value="handleColorChange"
                />
                <v-slider
                  class="mt-4"
                  step="0.05"
                  min="0"
                  max="3"
                  density="compact"
                  label="强度"
                  :model-value="selectedLight.intensity"
                  @update:model-value="handleIntensityChange"
                />
              </div>
            </template>
          </v-card-text>
        </v-card>

        <v-card elevation="8" class="sidebar-card">
          <v-card-title>环境</v-card-title>
          <v-divider />
          <v-card-text>
            <v-text-field
              variant="outlined"
              density="compact"
              hide-details
              label="背景颜色"
              :model-value="backgroundColor"
              @update:model-value="updateBackgroundColor"
            />
            <v-slider
              class="mt-4"
              density="compact"
              step="0.05"
              min="0.2"
              max="2"
              label="环境强度"
              :model-value="environmentIntensity"
              @update:model-value="updateEnvironmentIntensity"
            />
          </v-card-text>
        </v-card>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.tres-editor-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 16px;
  gap: 16px;
  background: radial-gradient(circle at top, rgba(32, 38, 56, 0.9), rgba(12, 14, 18, 0.96) 55%, #080a0f 100%);
}

.tres-editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-radius: 14px;
  background: rgba(20, 24, 34, 0.85);
  backdrop-filter: blur(18px);
  border: 1px solid rgba(92, 110, 149, 0.18);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}

.toolbar-section {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-label {
  font-size: 0.8rem;
  opacity: 0.7;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.tres-editor-body {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  min-height: 0;
}

.tres-editor-viewport {
  position: relative;
  min-height: 0;
}

.tres-editor-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sidebar-card {
  background: rgba(20, 24, 34, 0.92);
  border-radius: 14px;
  border: 1px solid rgba(82, 99, 136, 0.18);
}

.property-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-block: 12px;
}

.property-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.property-label {
  font-size: 0.85rem;
  opacity: 0.7;
}

.section-title {
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin: 0;
  opacity: 0.65;
}

.vector-inputs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.v-list-item--active {
  border-left: 3px solid var(--v-theme-primary);
  background: rgba(59, 98, 201, 0.1);
}

@media (max-width: 1280px) {
  .tres-editor-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .tres-editor-sidebar {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .sidebar-card {
    flex: 1 1 300px;
  }
}
</style>
