<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema'
import { useSceneStore } from '@/stores/sceneStore'
import { resolvePlanningImageMedia } from '@/utils/planningImageComponentResolver'
import {
  PLANNING_IMAGES_COMPONENT_TYPE,
  type PlanningImagesComponentProps,
  type PlanningImageDisplayEntry,
  clampPlanningImagesComponentProps,
  clonePlanningImagesComponentProps,
} from '@schema/components'

type PlanningImageDraft = PlanningImageDisplayEntry & {
  displayOpacityPercent: number
}

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const planningImagesComponent = computed(
  () => selectedNode.value?.components?.[PLANNING_IMAGES_COMPONENT_TYPE] as
    | SceneNodeComponentState<PlanningImagesComponentProps>
    | undefined,
)

const componentEnabled = computed(() => planningImagesComponent.value?.enabled !== false)
const localImages = ref<PlanningImageDraft[]>([])
const syncing = ref(false)
const previewUrls = ref<Record<string, string>>({})
const previewDisposers = new Map<string, () => void>()
let previewLoadVersion = 0

const previewSourceSignature = computed(() => localImages.value
  .map((image) => `${image.id}:${image.imageHash ?? ''}:${image.sourceUrl ?? ''}`)
  .join('|'))

watch(
  () => planningImagesComponent.value?.props,
  (props) => {
    const normalized = clampPlanningImagesComponentProps(props as Partial<PlanningImagesComponentProps> | undefined)
    syncing.value = true
    localImages.value = normalized.images.map((entry) => ({
      ...entry,
      position: { ...entry.position },
      size: { ...entry.size },
      displayOpacityPercent: Math.round(entry.opacity * 100),
    }))
    syncing.value = false
  },
  { immediate: true, deep: true },
)

function clearPreviewDisposers(): void {
  previewDisposers.forEach((dispose) => {
    try {
      dispose()
    } catch (_error) {
      // noop
    }
  })
  previewDisposers.clear()
}

function previewUrlFor(imageId: string): string | null {
  return previewUrls.value[imageId] ?? null
}

watch(
  previewSourceSignature,
  async () => {
    const version = ++previewLoadVersion
    clearPreviewDisposers()
    previewUrls.value = {}

    const records = await Promise.all(localImages.value.map(async (image) => {
      try {
        const resolved = await resolvePlanningImageMedia(image)
        return {
          id: image.id,
          resolved,
        }
      } catch (_error) {
        return {
          id: image.id,
          resolved: null,
        }
      }
    }))

    if (version !== previewLoadVersion) {
      records.forEach((record) => {
        try {
          record.resolved?.dispose?.()
        } catch (_error) {
          // noop
        }
      })
      return
    }

    const nextUrls: Record<string, string> = {}
    records.forEach((record) => {
      if (!record.resolved?.url) {
        return
      }
      nextUrls[record.id] = record.resolved.url
      if (record.resolved.dispose) {
        previewDisposers.set(record.id, record.resolved.dispose)
      }
    })
    previewUrls.value = nextUrls
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  previewLoadVersion += 1
  clearPreviewDisposers()
})

function updateImages(nextImages: PlanningImageDraft[]): void {
  const component = planningImagesComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  const normalized = clampPlanningImagesComponentProps({
    images: nextImages.map((entry) => ({
      ...entry,
      position: { ...entry.position },
      size: { ...entry.size },
      opacity: Math.min(1, Math.max(0, entry.opacity)),
    })),
  })
  sceneStore.updateNodeComponentProps(nodeId, component.id, {
    images: clonePlanningImagesComponentProps(normalized).images,
  })
}

function updateImageById(imageId: string, patch: Partial<PlanningImageDisplayEntry>): void {
  if (!componentEnabled.value || syncing.value) {
    return
  }
  const nextImages = localImages.value.map((entry) => {
    if (entry.id !== imageId) {
      return {
        ...entry,
        position: { ...entry.position },
        size: { ...entry.size },
      }
    }
    const nextOpacity = typeof patch.opacity === 'number' ? Math.min(1, Math.max(0, patch.opacity)) : entry.opacity
    return {
      ...entry,
      ...patch,
      position: patch.position ? { ...patch.position } : { ...entry.position },
      size: patch.size ? { ...patch.size } : { ...entry.size },
      opacity: nextOpacity,
      displayOpacityPercent: Math.round(nextOpacity * 100),
    }
  })
  localImages.value = nextImages
  updateImages(nextImages)
}

function handleVisibilityChange(imageId: string, value: boolean | null): void {
  if (value === null) {
    return
  }
  updateImageById(imageId, { visible: value })
}

function handleOpacitySlider(imageId: string, value: number | readonly number[]): void {
  const numeric = Array.isArray(value) ? Number(value[0]) : Number(value)
  if (!Number.isFinite(numeric)) {
    return
  }
  const clampedPercent = Math.min(100, Math.max(0, Math.round(numeric)))
  const nextImages = localImages.value.map((entry) => {
    if (entry.id !== imageId) {
      return entry
    }
    return {
      ...entry,
      displayOpacityPercent: clampedPercent,
      opacity: clampedPercent / 100,
    }
  })
  localImages.value = nextImages
  updateImages(nextImages)
}

</script>

<template>
  <v-expansion-panel value="planningImages">
    <v-expansion-panel-title>
      <div class="planning-images-panel-header">
        <span class="planning-images-panel-title">Planning Images</span>
        <v-spacer />
        
      </div>
    </v-expansion-panel-title>

    <v-expansion-panel-text>
      <div class="planning-images-panel-body" :class="{ 'is-disabled': !componentEnabled }">
        <div v-if="!localImages.length" class="planning-images-empty">
          No planning images.
        </div>

        <div v-for="(image, index) in localImages" :key="image.id" class="planning-image-card">
          <div class="planning-image-card-header">
            <div class="planning-image-thumbnail">
              <img
                v-if="previewUrlFor(image.id)"
                :src="previewUrlFor(image.id) || undefined"
                :alt="image.name || `Planning Image ${index + 1}`"
                class="planning-image-thumbnail__img"
              >
              <div v-else class="planning-image-thumbnail__placeholder">
                <v-icon size="18">mdi-image-outline</v-icon>
              </div>
            </div>
            <div class="planning-image-card-title-wrap">
              <div class="planning-image-card-title">{{ image.name || `Planning Image ${index + 1}` }}</div>
            </div>
            <v-switch
              :model-value="image.visible"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="handleVisibilityChange(image.id, $event)"
            />
          </div>

          <div class="planning-image-row">
            <div class="planning-image-row-label">Opacity</div>
            <div class="planning-image-opacity-controls">
              <v-slider
                :model-value="image.displayOpacityPercent"
                :min="0"
                :max="100"
                :step="1"
                density="compact"
                hide-details
                color="primary"
                thumb-label
                :disabled="!componentEnabled"
                @update:model-value="handleOpacitySlider(image.id, $event)"
              />
            </div>
          </div>
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.planning-images-panel-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0.4rem;
}

.planning-images-panel-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.planning-images-panel-subtitle {
  font-size: 0.78rem;
  opacity: 0.78;
}

.planning-images-panel-body {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.planning-images-panel-body.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.planning-images-empty {
  font-size: 0.85rem;
  opacity: 0.7;
}

.planning-image-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.7rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.planning-image-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.planning-image-thumbnail {
  width: 56px;
  height: 56px;
  flex: 0 0 56px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
}

.planning-image-thumbnail__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.planning-image-thumbnail__placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(233, 236, 241, 0.58);
}

.planning-image-card-title-wrap {
  min-width: 0;
  flex: 1 1 auto;
}

.planning-image-card-title {
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.2;
  word-break: break-word;
}

.planning-image-card-meta {
  margin-top: 0.15rem;
  font-size: 0.76rem;
  opacity: 0.7;
}

.planning-image-row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.planning-image-row-label {
  font-size: 0.78rem;
  opacity: 0.78;
}

.planning-image-opacity-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 92px;
  gap: 0.6rem;
  align-items: center;
}

.planning-image-opacity-input {
  min-width: 0;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}
</style>