<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import AssetPickerDialog from '@/components/common/AssetPickerDialog.vue'
import type { ProjectAsset } from '@/types/project-asset'
import { collectAnimationClipOptionsWithExternalAsset } from '@/utils/externalAnimationClipOptions'
import {
  ANIMATION_COMPONENT_TYPE,
  clampAnimationComponentProps,
  type AnimationComponentProps,
} from '@schema/components'
import { useSceneStore, getRuntimeObject } from '@/stores/sceneStore'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const component = computed(() =>
  selectedNode.value?.components?.[ANIMATION_COMPONENT_TYPE] as
    | SceneNodeComponentState<AnimationComponentProps>
    | undefined,
)

const componentEnabled = computed(() => component.value?.enabled !== false)
const normalizedProps = computed(() => clampAnimationComponentProps(component.value?.props ?? null))
const clipOptions = ref<Array<{ label: string; value: string }>>([])
const isLoadingClips = ref(false)
const clipLoadError = ref<string | null>(null)
const externalAnimationAssetDialogVisible = ref(false)
const externalAnimationAssetDialogSelectedId = ref('')
const externalAnimationAssetAnchor = ref<{ x: number; y: number } | null>(null)
let clipLoadRequestId = 0

const externalAnimationAssetName = computed(() => {
  const assetId = normalizedProps.value.animationAssetId
  if (!assetId) {
    return null
  }
  return sceneStore.collectCatalogAssetMap().get(assetId)?.name ?? assetId
})

function openExternalAnimationAssetDialog(event?: MouseEvent): void {
  externalAnimationAssetDialogSelectedId.value = normalizedProps.value.animationAssetId ?? ''
  externalAnimationAssetAnchor.value = event ? { x: event.clientX, y: event.clientY } : null
  externalAnimationAssetDialogVisible.value = true
}

function handleExternalAnimationAssetUpdate(asset: ProjectAsset | null): void {
  updateComponent({
    animationAssetId: asset?.id ?? null,
  })
  externalAnimationAssetDialogVisible.value = false
}

function handleExternalAnimationAssetCancel(): void {
  externalAnimationAssetDialogVisible.value = false
}

function clearExternalAnimationAsset(): void {
  updateComponent({
    animationAssetId: null,
  })
}

function updateComponent(patch: Partial<AnimationComponentProps>) {
  const nodeId = selectedNodeId.value
  const currentComponent = component.value
  if (!nodeId || !currentComponent) {
    return
  }
  const nextProps = clampAnimationComponentProps({
    ...normalizedProps.value,
    ...patch,
  })
  sceneStore.updateNodeComponentProps(
    nodeId,
    currentComponent.id,
    nextProps as unknown as Partial<Record<string, unknown>>,
  )
}

function handleToggleComponent() {
  const currentComponent = component.value
  const nodeId = selectedNodeId.value
  if (!currentComponent || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, currentComponent.id)
}

function handleRemoveComponent() {
  const currentComponent = component.value
  const nodeId = selectedNodeId.value
  if (!currentComponent || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, currentComponent.id)
}

function updateDefaultClip(value: string | null) {
  updateComponent({
    defaultClipName: value,
  })
}

function updateAutoplay(value: boolean) {
  updateComponent({
    autoplay: value,
  })
}

function updateLoop(value: boolean) {
  updateComponent({
    loop: value,
  })
}

function updateTimeScale(value: unknown) {
  updateComponent({
    timeScale: Number(value),
  })
}

async function loadClipsForNode(nodeId: string | null) {
  const requestId = ++clipLoadRequestId
  clipOptions.value = []
  clipLoadError.value = null
  if (!nodeId) {
    return
  }
  isLoadingClips.value = true
  try {
    let runtimeObject = getRuntimeObject(nodeId)
    if (!runtimeObject) {
      const node = selectedNode.value
      if (node) {
        await sceneStore.ensureSceneAssetsReady({ nodes: [node], showOverlay: false, refreshViewport: false })
      }
      runtimeObject = getRuntimeObject(nodeId)
    }
    const nextOptions = await collectAnimationClipOptionsWithExternalAsset(
      runtimeObject,
      normalizedProps.value.animationAssetId,
      selectedNode.value?.sourceAssetId ?? null,
    )
    if (requestId === clipLoadRequestId) {
      clipOptions.value = nextOptions
    }
  } catch (error) {
    console.warn('[AnimationComponentPanel] Failed to load animation clips', error)
    if (requestId === clipLoadRequestId) {
      clipLoadError.value = 'Unable to load animation clips.'
    }
  } finally {
    if (requestId === clipLoadRequestId) {
      isLoadingClips.value = false
    }
  }
}

watch(
  () => [selectedNode.value?.id ?? null, normalizedProps.value.animationAssetId] as const,
  ([nodeId]) => {
    void loadClipsForNode(nodeId)
  },
  { immediate: true },
)

watch(
  clipOptions,
  (options) => {
    const selectedClip = normalizedProps.value.defaultClipName
    if (!selectedClip) {
      return
    }
    if (!options.some((option) => option.value === selectedClip)) {
      updateDefaultClip(null)
    }
  },
  { deep: true },
)
</script>

<template>
  <v-expansion-panel value="animationComponent">
    <v-expansion-panel-title>
      <div class="animation-component-panel__header">
        <span class="animation-component-panel__title">Animation</span>
        <v-spacer />
        <v-menu
          v-if="component"
          location="bottom end"
          origin="auto"
          transition="fade-transition"
        >
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon
              variant="text"
              size="small"
              class="component-menu-btn"
              @click.stop
            >
              <v-icon size="18">mdi-dots-vertical</v-icon>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item @click.stop="handleToggleComponent()">
              <v-list-item-title>{{ componentEnabled ? 'Disable' : 'Enable' }}</v-list-item-title>
            </v-list-item>
            <v-divider class="component-menu-divider" inset />
            <v-list-item @click.stop="handleRemoveComponent()">
              <v-list-item-title>Remove</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="animation-component-panel">

        <div class="animation-component-panel__field">
          <div class="animation-component-panel__field-label">External animation asset</div>
          <div class="animation-component-panel__asset-row">
            <v-btn
              variant="tonal"
              density="compact"
              prepend-icon="mdi-movie-open-play"
              class="animation-component-panel__asset-button"
              :disabled="!componentEnabled"
              @click="openExternalAnimationAssetDialog"
            >
              {{ externalAnimationAssetName ?? 'Select animation asset' }}
            </v-btn>
            <v-btn
              v-if="normalizedProps.animationAssetId"
              icon
              size="x-small"
              variant="text"
              density="compact"
              :disabled="!componentEnabled"
              @click="clearExternalAnimationAsset"
            >
              <v-icon size="16">mdi-close</v-icon>
            </v-btn>
          </div>
        </div>

        <v-select
          :model-value="normalizedProps.defaultClipName"
          :items="clipOptions"
          item-title="label"
          item-value="value"
          label="Default Animation"
          density="compact"
          variant="underlined"
          hide-details
          clearable
          :disabled="!componentEnabled || isLoadingClips"
          :loading="isLoadingClips"
          @update:model-value="(value) => updateDefaultClip(value ? String(value) : null)"
        />

        <div v-if="clipLoadError" class="animation-component-panel__message animation-component-panel__message--error">
          {{ clipLoadError }}
        </div>

        <v-switch
          :model-value="normalizedProps.autoplay"
          label="Autoplay Default Animation"
          density="compact"
          hide-details
          :disabled="!componentEnabled"
          @update:model-value="updateAutoplay(Boolean($event))"
        />

        <v-switch
          :model-value="normalizedProps.loop"
          label="Loop Default Animation"
          density="compact"
          hide-details
          :disabled="!componentEnabled"
          @update:model-value="updateLoop(Boolean($event))"
        />

        <v-text-field
          :model-value="normalizedProps.timeScale"
          type="number"
          label="Playback Speed"
          density="compact"
          variant="underlined"
          hide-details
          :disabled="!componentEnabled"
          @update:model-value="updateTimeScale"
        />
      </div>

      <AssetPickerDialog
        v-model="externalAnimationAssetDialogVisible"
        :asset-id="externalAnimationAssetDialogSelectedId"
        assetType="model,mesh"
        title="Select External Animation Asset"
        :anchor="externalAnimationAssetAnchor"
        @update:asset="handleExternalAnimationAssetUpdate"
        @cancel="handleExternalAnimationAssetCancel"
      />
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.animation-component-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.animation-component-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.animation-component-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.animation-component-panel__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.animation-component-panel__field-label {
  font-size: 0.82rem;
  font-weight: 500;
}

.animation-component-panel__asset-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.animation-component-panel__asset-button {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-start;
  overflow: hidden;
  text-overflow: ellipsis;
}

.animation-component-panel__message {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.65);
}

.animation-component-panel__message--error {
  color: #ff8a80;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}
</style>
