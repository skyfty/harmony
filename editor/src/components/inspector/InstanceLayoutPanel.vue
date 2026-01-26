<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSceneStore } from '@/stores/sceneStore'
import InspectorVectorControls from '@/components/common/VectorControls.vue'
import type { Vector3Like } from '@harmony/schema'
import {
  clampSceneNodeInstanceLayout,
  INSTANCE_LAYOUT_DEFAULT_COUNT,
  INSTANCE_LAYOUT_DEFAULT_FORWARD,
  INSTANCE_LAYOUT_DEFAULT_MODE,
  INSTANCE_LAYOUT_DEFAULT_ROLL_DEGREES,
  INSTANCE_LAYOUT_DEFAULT_SPACING,
  INSTANCE_LAYOUT_DEFAULT_UP,
  type SceneNodeInstanceLayout,
} from '@schema/instanceLayout'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const currentLayout = computed<SceneNodeInstanceLayout>(() => {
  return clampSceneNodeInstanceLayout(selectedNode.value?.instanceLayout)
})

const templateAssetId = computed(() => {
  const raw = selectedNode.value?.sourceAssetId
  return typeof raw === 'string' ? raw.trim() : ''
})

const localMode = ref<'single' | 'grid'>('single')
const localTemplateAssetIdOverride = ref<string>('')

const localBasisMode = ref<'axis' | 'vector'>(INSTANCE_LAYOUT_DEFAULT_MODE)
const localCountX = ref(INSTANCE_LAYOUT_DEFAULT_COUNT)
const localCountY = ref(INSTANCE_LAYOUT_DEFAULT_COUNT)
const localCountZ = ref(INSTANCE_LAYOUT_DEFAULT_COUNT)
const localSpacingX = ref(INSTANCE_LAYOUT_DEFAULT_SPACING)
const localSpacingY = ref(INSTANCE_LAYOUT_DEFAULT_SPACING)
const localSpacingZ = ref(INSTANCE_LAYOUT_DEFAULT_SPACING)
const localForward = ref<Vector3Like>({ ...INSTANCE_LAYOUT_DEFAULT_FORWARD })
const localUp = ref<Vector3Like>({ ...INSTANCE_LAYOUT_DEFAULT_UP })
const localRollDegrees = ref(INSTANCE_LAYOUT_DEFAULT_ROLL_DEGREES)

const isSyncingFromScene = ref(false)

watch(
  currentLayout,
  (layout) => {
    isSyncingFromScene.value = true
    try {
      localMode.value = layout.mode
      localTemplateAssetIdOverride.value = typeof layout.templateAssetId === 'string' ? layout.templateAssetId : ''

      if (layout.mode === 'grid') {
        localBasisMode.value = layout.basisMode
        localCountX.value = layout.countX
        localCountY.value = layout.countY
        localCountZ.value = layout.countZ
        localSpacingX.value = layout.spacingX
        localSpacingY.value = layout.spacingY
        localSpacingZ.value = layout.spacingZ
        localForward.value = layout.forwardLocal
        localUp.value = layout.upLocal
        localRollDegrees.value = layout.rollDegrees
      } else {
        localBasisMode.value = INSTANCE_LAYOUT_DEFAULT_MODE
        localCountX.value = INSTANCE_LAYOUT_DEFAULT_COUNT
        localCountY.value = INSTANCE_LAYOUT_DEFAULT_COUNT
        localCountZ.value = INSTANCE_LAYOUT_DEFAULT_COUNT
        localSpacingX.value = INSTANCE_LAYOUT_DEFAULT_SPACING
        localSpacingY.value = INSTANCE_LAYOUT_DEFAULT_SPACING
        localSpacingZ.value = INSTANCE_LAYOUT_DEFAULT_SPACING
        localForward.value = { ...INSTANCE_LAYOUT_DEFAULT_FORWARD }
        localUp.value = { ...INSTANCE_LAYOUT_DEFAULT_UP }
        localRollDegrees.value = INSTANCE_LAYOUT_DEFAULT_ROLL_DEGREES
      }
    } finally {
      nextTick(() => {
        isSyncingFromScene.value = false
      })
    }
  },
  { immediate: true, deep: true },
)

function normalizeTemplateOverride(raw: string): string | null {
  const trimmed = String(raw ?? '').trim()
  return trimmed.length ? trimmed : null
}

function commitLayout(): void {
  if (isSyncingFromScene.value) {
    return
  }
  const nodeId = selectedNodeId.value
  if (!nodeId) {
    return
  }

  const templateOverride = normalizeTemplateOverride(localTemplateAssetIdOverride.value)

  const nextLayout: SceneNodeInstanceLayout =
    localMode.value === 'single'
      ? { mode: 'single', templateAssetId: templateOverride }
      : {
          mode: 'grid',
          templateAssetId: templateOverride,
          countX: localCountX.value,
          countY: localCountY.value,
          countZ: localCountZ.value,
          spacingX: localSpacingX.value,
          spacingY: localSpacingY.value,
          spacingZ: localSpacingZ.value,
          basisMode: localBasisMode.value,
          forwardLocal: localForward.value,
          upLocal: localUp.value,
          rollDegrees: localRollDegrees.value,
        }

  // Clamp/sanitize once more before writing to the scene.
  const sanitized = clampSceneNodeInstanceLayout(nextLayout)
  sceneStore.updateNodeInstanceLayout(nodeId, sanitized)
}

function handleReset(): void {
  if (isSyncingFromScene.value) {
    return
  }
  localMode.value = 'single'
  localTemplateAssetIdOverride.value = ''
  localBasisMode.value = INSTANCE_LAYOUT_DEFAULT_MODE
  localCountX.value = INSTANCE_LAYOUT_DEFAULT_COUNT
  localCountY.value = INSTANCE_LAYOUT_DEFAULT_COUNT
  localCountZ.value = INSTANCE_LAYOUT_DEFAULT_COUNT
  localSpacingX.value = INSTANCE_LAYOUT_DEFAULT_SPACING
  localSpacingY.value = INSTANCE_LAYOUT_DEFAULT_SPACING
  localSpacingZ.value = INSTANCE_LAYOUT_DEFAULT_SPACING
  localForward.value = { ...INSTANCE_LAYOUT_DEFAULT_FORWARD }
  localUp.value = { ...INSTANCE_LAYOUT_DEFAULT_UP }
  localRollDegrees.value = INSTANCE_LAYOUT_DEFAULT_ROLL_DEGREES
  commitLayout()
}
</script>

<template>
  <v-expansion-panel value="instanceLayout">
    <v-expansion-panel-title>
      <div class="title-row">
        <span>Layout</span>
        <v-btn icon size="small" variant="text" @click="handleReset" title="Reset Layout" aria-label="Reset Layout">
          <v-icon size="18">mdi-refresh</v-icon>
        </v-btn>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="panel-content">
        <v-select
          v-model="localMode"
          :items="[
            { title: 'Single', value: 'single' },
            { title: 'Grid', value: 'grid' },
          ]"
          label="Mode"
          density="compact"
          variant="underlined"
          @update:model-value="commitLayout"
        />

  

        <template v-if="localMode === 'grid'">
          <div class="grid-row">
            <v-text-field
              v-model.number="localCountX"
              type="number"
              label="Count X"
              density="compact"
              variant="underlined"
              min="1"
              @update:model-value="commitLayout"
            />
            <v-text-field
              v-model.number="localCountY"
              type="number"
              label="Count Y"
              density="compact"
              variant="underlined"
              min="1"
              @update:model-value="commitLayout"
            />
            <v-text-field
              v-model.number="localCountZ"
              type="number"
              label="Count Z"
              density="compact"
              variant="underlined"
              min="1"
              @update:model-value="commitLayout"
            />
          </div>

          <div class="grid-row">
            <v-text-field
              v-model.number="localSpacingX"
              type="number"
              label="Spacing X"
              density="compact"
              variant="underlined"
              @update:model-value="commitLayout"
            />
            <v-text-field
              v-model.number="localSpacingY"
              type="number"
              label="Spacing Y"
              density="compact"
              variant="underlined"
              @update:model-value="commitLayout"
            />
            <v-text-field
              v-model.number="localSpacingZ"
              type="number"
              label="Spacing Z"
              density="compact"
              variant="underlined"
              @update:model-value="commitLayout"
            />
          </div>

          <v-select
            v-model="localBasisMode"
            :items="[
              { title: 'Axis', value: 'axis' },
              { title: 'Vector', value: 'vector' },
            ]"
            label="Basis"
            density="compact"
            variant="underlined"
            @update:model-value="commitLayout"
          />

          <template v-if="localBasisMode === 'vector'">
            <InspectorVectorControls
              v-model="localForward"
              label="Forward"
              @update:model-value="commitLayout"
            />
            <InspectorVectorControls
              v-model="localUp"
              label="Up"
              @update:model-value="commitLayout"
            />
            <v-text-field
              v-model.number="localRollDegrees"
              type="number"
              label="Roll (degrees)"
              density="compact"
              variant="underlined"
              @update:model-value="commitLayout"
            />
          </template>
        </template>

        
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.panel-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.grid-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.template-hint {
  display: flex;
  gap: 6px;
  font-size: 12px;
  opacity: 0.8;
}

.template-hint__value {
  user-select: text;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
</style>
