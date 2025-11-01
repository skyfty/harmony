<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LanternBehaviorParams, LanternSlideDefinition, LanternSlideLayout } from '@harmony/schema'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'

const props = defineProps<{
  modelValue: LanternBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: LanternBehaviorParams): void
}>()

let slideCounter = 0

const ASSET_DRAG_MIME = 'application/x-harmony-asset'
const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const draggingSlideIndex = ref<number | null>(null)

function createSlideId(): string {
  slideCounter += 1
  return `lantern_slide_ui_${Date.now()}_${slideCounter.toString(16)}`
}

function normalizeLayout(layout: string | null | undefined): LanternSlideLayout {
  switch (layout) {
    case 'imageLeft':
    case 'imageRight':
    case 'imageTop':
      return layout
    default:
      return 'imageTop'
  }
}

function normalizeSlide(input: Partial<LanternSlideDefinition> | undefined): LanternSlideDefinition {
  const id = typeof input?.id === 'string' && input.id.trim().length ? input.id.trim() : createSlideId()
  const title = typeof input?.title === 'string' ? input.title.trim() : ''
  const description = typeof input?.description === 'string' ? input.description.trim() : ''
  const imageAssetId = typeof input?.imageAssetId === 'string' && input.imageAssetId.trim().length
    ? input.imageAssetId.trim()
    : null
  return {
    id,
    title,
    description,
    imageAssetId,
    layout: normalizeLayout(input?.layout),
  }
}

function normalizeSlides(slides: LanternSlideDefinition[] | null | undefined): LanternSlideDefinition[] {
  if (!Array.isArray(slides) || !slides.length) {
    return []
  }
  return slides.map((slide) => normalizeSlide(slide))
}

function createDefaultSlide(): LanternSlideDefinition {
  return normalizeSlide({
    title: '',
    description: '',
    imageAssetId: null,
    layout: 'imageTop',
  })
}

const slides = computed<LanternSlideDefinition[]>(() => normalizeSlides(props.modelValue?.slides))

const layoutOptions: Array<{ label: string; value: LanternSlideLayout }> = [
  { value: 'imageTop', label: 'Image Above Text' },
  { value: 'imageLeft', label: 'Image Left' },
  { value: 'imageRight', label: 'Image Right' },
]

function emitSlides(next: LanternSlideDefinition[]) {
  emit('update:modelValue', { slides: normalizeSlides(next) })
}

function addSlide() {
  const next = [...slides.value, createDefaultSlide()]
  emitSlides(next)
}

function removeSlide(index: number) {
  const next = slides.value.slice()
  if (!next[index]) {
    return
  }
  next.splice(index, 1)
  emitSlides(next)
}

function moveSlide(index: number, offset: number) {
  const next = slides.value.slice()
  if (!next[index]) {
    return
  }
  const targetIndex = index + offset
  if (targetIndex < 0 || targetIndex >= next.length) {
    return
  }
  const [entry] = next.splice(index, 1)
  if (!entry) {
    return
  }
  next.splice(targetIndex, 0, entry)
  emitSlides(next)
}

function updateSlideDescription(index: number, value: string | number) {
  const next = slides.value.slice()
  if (!next[index]) {
    return
  }
  const description = typeof value === 'string' ? value : String(value)
  next[index] = {
    ...next[index],
    description: description.trim(),
  }
  emitSlides(next)
}

function updateSlideAsset(index: number, value: string | null | undefined) {
  const next = slides.value.slice()
  if (!next[index]) {
    return
  }
  const assetId = typeof value === 'string' && value.trim().length ? value.trim() : null
  next[index] = {
    ...next[index],
    imageAssetId: assetId,
  }
  emitSlides(next)
}

function updateSlideLayout(index: number, layout: LanternSlideLayout) {
  const next = slides.value.slice()
  if (!next[index]) {
    return
  }
  next[index] = {
    ...next[index],
    layout: normalizeLayout(layout),
  }
  emitSlides(next)
}

function parseDragPayload(event: DragEvent): { assetId: string } | null {
  if (event.dataTransfer) {
    const raw = event.dataTransfer.getData(ASSET_DRAG_MIME)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed?.assetId && typeof parsed.assetId === 'string') {
          return { assetId: parsed.assetId }
        }
      } catch (error) {
        console.warn('Failed to parse drag payload', error)
      }
    }
  }
  if (sceneStore.draggingAssetId) {
    return { assetId: sceneStore.draggingAssetId }
  }
  return null
}

function ensureImageAsset(assetId: string): ProjectAsset | null {
  const asset = sceneStore.getAsset(assetId)
  if (!asset) {
    return null
  }
  if (asset.type !== 'image' && asset.type !== 'texture') {
    return null
  }
  return asset
}

function isImageAssetDrag(event: DragEvent): boolean {
  const payload = parseDragPayload(event)
  if (!payload) {
    return false
  }
  return !!ensureImageAsset(payload.assetId)
}

function handleImageDragEnter(index: number, event: DragEvent) {
  if (!isImageAssetDrag(event)) {
    return
  }
  event.preventDefault()
  draggingSlideIndex.value = index
}

function handleImageDragOver(index: number, event: DragEvent) {
  if (!isImageAssetDrag(event)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  draggingSlideIndex.value = index
}

function handleImageDragLeave(index: number, event: DragEvent) {
  if (!isImageAssetDrag(event)) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  if (draggingSlideIndex.value === index) {
    draggingSlideIndex.value = null
  }
}

function handleImageDrop(index: number, event: DragEvent) {
  if (!isImageAssetDrag(event)) {
    return
  }
  const payload = parseDragPayload(event)
  if (!payload) {
    return
  }
  const asset = ensureImageAsset(payload.assetId)
  if (!asset) {
    console.warn('Dragged asset is not a compatible image resource')
    return
  }
  event.preventDefault()
  event.stopPropagation()
  draggingSlideIndex.value = null
  void assetCacheStore.downloaProjectAsset(asset).catch((error: unknown) => {
    console.warn('Failed to cache image asset for lantern slide', error)
  })
  updateSlideAsset(index, asset.id)
}

function clearSlideAsset(index: number) {
  updateSlideAsset(index, null)
}

function getSlideAsset(slide: LanternSlideDefinition): ProjectAsset | null {
  if (!slide.imageAssetId) {
    return null
  }
  return sceneStore.getAsset(slide.imageAssetId) ?? null
}

function resolveSlideImageStyle(slide: LanternSlideDefinition): Record<string, string> {
  const asset = getSlideAsset(slide)
  const fallback = 'rgba(233, 236, 241, 0.08)'
  if (asset?.thumbnail && asset.thumbnail.trim().length) {
    const backgroundColor = asset.previewColor?.trim().length ? asset.previewColor : fallback
    return {
      backgroundImage: `url(${asset.thumbnail})`,
      backgroundColor,
    }
  }
  if (asset?.previewColor && asset.previewColor.trim().length) {
    return {
      backgroundColor: asset.previewColor,
    }
  }
  return {
    backgroundColor: fallback,
  }
}

function resolveSlideImageLabel(slide: LanternSlideDefinition): string {
  const asset = getSlideAsset(slide)
  if (asset?.name) {
    return asset.name
  }
  if (slide.imageAssetId) {
    return slide.imageAssetId
  }
  return '未选择图片资源'
}
</script>

<template>
  <div class="lantern-params">
    <div class="lantern-params__header">
      <span class="lantern-params__title">Lantern Slides</span>
      <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="addSlide">
        Add Slide
      </v-btn>
    </div>
    <div v-if="slides.length" class="lantern-params__list">
      <div v-for="(slide, index) in slides" :key="slide.id" class="lantern-slide">

        <div class="lantern-slide__toolbar">
          <span class="lantern-slide__badge">
        <div class="lantern-slide__layout">
          <v-select
            :model-value="slide.layout"
            :items="layoutOptions"
            item-title="label"
            item-value="value"
            label=""
            size="small"
            density="compact"
            variant="underlined"
            hide-details
            @update:model-value="updateSlideLayout(index, $event)"
          />
        </div>
          </span>
          <div class="lantern-slide__actions">
            <v-btn
              icon="mdi-arrow-up"
              size="x-small"
              variant="text"
              :disabled="index === 0"
              @click="moveSlide(index, -1)"
            />
            <v-btn
              icon="mdi-arrow-down"
              size="x-small"
              variant="text"
              :disabled="index === slides.length - 1"
              @click="moveSlide(index, 1)"
            />
            <v-btn
              icon="mdi-delete-outline"
              size="x-small"
              variant="text"
              color="error"
              @click="removeSlide(index)"
            />
          </div>
        </div>
        <div class="lantern-slide__content" :class="`layout-${slide.layout}`">
          <div
            class="lantern-slide__image"
            :class="{
              'is-active-drop': draggingSlideIndex === index,
              'has-image': !!slide.imageAssetId,
            }"
            @dragenter="handleImageDragEnter(index, $event)"
            @dragover="handleImageDragOver(index, $event)"
            @dragleave="handleImageDragLeave(index, $event)"
            @drop="handleImageDrop(index, $event)"
          >
            <span class="lantern-slide__field-label">Image</span>
            <div class="lantern-slide__image-dropzone" :style="resolveSlideImageStyle(slide)">
              <div v-if="!slide.imageAssetId" class="lantern-slide__image-placeholder">
                <v-icon size="26" color="rgba(233, 236, 241, 0.7)">mdi-image-plus</v-icon>
                <span>Drag an image from Resources</span>
              </div>
            </div>
            <div class="lantern-slide__image-footer">
              <span class="lantern-slide__image-name">{{ resolveSlideImageLabel(slide) }}</span>
              <v-btn
                v-if="slide.imageAssetId"
                icon="mdi-close"
                size="x-small"
                variant="text"
                color="rgba(233, 236, 241, 0.85)"
                title="Remove image"
                @click.stop="clearSlideAsset(index)"
              />
            </div>
          </div>
          <div class="lantern-slide__description">
            <span class="lantern-slide__field-label">Description</span>
            <v-textarea
              class="lantern-slide__textarea"
              :model-value="slide.description"
              density="comfortable"
              variant="outlined"
              hide-details
              :auto-grow="false"
              rows="6"
              @update:model-value="updateSlideDescription(index, $event)"
            />
          </div>
        </div>
      </div>
    </div>
    <div v-else class="lantern-params__empty">
      No slides configured. Add at least one slide to show in the lantern overlay.
    </div>
  </div>
</template>

<style scoped>
.lantern-params {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.lantern-params__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.lantern-params__title {
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.86);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.lantern-params__list {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.lantern-params__empty {
  font-size: 0.85rem;
  color: rgba(233, 236, 241, 0.6);
}

.lantern-slide {
  padding: 0.9rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(20, 24, 32, 0.6);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.lantern-slide__layout {
  display: flex;
}

.lantern-slide__toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.lantern-slide__badge {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.82);
}

.lantern-slide__actions {
  display: flex;
  gap: 0.2rem;
}

.lantern-slide__content {
  display: grid;
  gap: 12px;
  padding: 12px;
  border-radius: 10px;
  border: 1px dashed rgba(233, 236, 241, 0.16);
  background: rgba(12, 16, 22, 0.55);
  height: clamp(260px, 38vh, 360px);
  min-height: 240px;
}

.lantern-slide__content.layout-imageTop {
  grid-template-columns: 1fr;
  grid-template-rows: repeat(2, minmax(0, 1fr));
  grid-template-areas:
    'image'
    'description';
}

.lantern-slide__content.layout-imageLeft {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: 1fr;
  grid-template-areas: 'image description';
}

.lantern-slide__content.layout-imageRight {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: 1fr;
  grid-template-areas: 'description image';
}

.lantern-slide__image {
  grid-area: image;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-radius: 8px;
  background: rgba(8, 12, 18, 0.5);
  border: 1px solid rgba(233, 236, 241, 0.08);
  overflow: hidden;
  transition: border-color 120ms ease, box-shadow 120ms ease;
  padding: 10px;
  min-height: 0;
}

.lantern-slide__image.is-active-drop {
  border-color: rgba(132, 202, 255, 0.75);
  box-shadow: 0 0 0 2px rgba(132, 202, 255, 0.35);
}

.lantern-slide__image-dropzone {
  position: relative;
  flex: 1;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  padding: 1rem;
  width: 100%;
}

.lantern-slide__image.has-image .lantern-slide__image-dropzone {
  padding: 0;
}

.lantern-slide__image.has-image .lantern-slide__image-dropzone::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(12, 16, 22, 0.12), rgba(12, 16, 22, 0.32));
}

.lantern-slide__image-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  text-align: center;
  color: rgba(233, 236, 241, 0.7);
  font-size: 0.85rem;
}

.lantern-slide__image-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding: 0;
}

.lantern-slide__image-name {
  font-size: 0.8rem;
  color: rgba(233, 236, 241, 0.82);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lantern-slide__description {
  grid-area: description;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 8px;
  background: rgba(8, 12, 18, 0.5);
  border: 1px solid rgba(233, 236, 241, 0.08);
  padding: 10px;
  min-height: 0;
}

.lantern-slide__field-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.58);
  pointer-events: none;
  margin: 0;
}

.lantern-slide__image .lantern-slide__field-label,
.lantern-slide__description .lantern-slide__field-label {
  margin-bottom: 4px;
}

.lantern-slide__textarea {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.lantern-slide__textarea :deep(.v-field) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.lantern-slide__textarea :deep(.v-field__input) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.lantern-slide__textarea :deep(textarea) {
  flex: 1;
  resize: none;
}

@media (max-width: 960px) {
  .lantern-slide__content.layout-imageLeft,
  .lantern-slide__content.layout-imageRight {
    grid-template-columns: 1fr;
    grid-template-rows: repeat(2, minmax(0, 1fr));
    grid-template-areas:
      'image'
      'description';
  }
}
</style>
