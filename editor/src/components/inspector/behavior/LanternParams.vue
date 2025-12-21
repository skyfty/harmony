<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { LanternBehaviorParams, LanternSlideDefinition, LanternSlideLayout } from '@harmony/schema'
import type { ProjectAsset } from '@/types/project-asset'
import { useSceneStore } from '@/stores/sceneStore'
import { useAssetCacheStore } from '@/stores/assetCacheStore'
import { ASSET_DRAG_MIME } from '@/components/editor/constants'

const props = defineProps<{
  modelValue: LanternBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: LanternBehaviorParams): void
}>()

let slideCounter = 0

const sceneStore = useSceneStore()
const assetCacheStore = useAssetCacheStore()
const draggingSlideIndex = ref<number | null>(null)
const descriptionDragIndex = ref<number | null>(null)

type DescriptionPreviewState = {
  text: string
  loading: boolean
  error: string | null
}

const descriptionPreviewState = reactive<Record<string, DescriptionPreviewState>>({})
const descriptionPreviewPromises = new Map<string, Promise<void>>()

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
  const descriptionAssetRaw = (input as { descriptionAssetId?: unknown })?.descriptionAssetId
  const descriptionAssetId = typeof descriptionAssetRaw === 'string' && descriptionAssetRaw.trim().length
    ? descriptionAssetRaw.trim()
    : null
  const imageAssetId = typeof input?.imageAssetId === 'string' && input.imageAssetId.trim().length
    ? input.imageAssetId.trim()
    : null
  return {
    id,
    title,
    description,
    descriptionAssetId,
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
    descriptionAssetId: null,
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
  const [removed] = next.splice(index, 1)
  emitSlides(next)
  const removedAssetId = removed?.descriptionAssetId?.trim()
  if (removedAssetId) {
    delete descriptionPreviewState[removedAssetId]
  }
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
  const previousAssetId = next[index].descriptionAssetId?.trim() ?? null
  next[index] = {
    ...next[index],
    description: description.trim(),
    descriptionAssetId: null,
  }
  emitSlides(next)
  if (previousAssetId) {
    delete descriptionPreviewState[previousAssetId]
  }
}

function updateSlideDescriptionAsset(index: number, value: string | null | undefined) {
  const next = slides.value.slice()
  if (!next[index]) {
    return
  }
  const previousAssetId = next[index].descriptionAssetId?.trim() ?? null
  const assetId = typeof value === 'string' && value.trim().length ? value.trim() : null
  next[index] = {
    ...next[index],
    descriptionAssetId: assetId,
    description: assetId ? '' : next[index].description,
  }
  emitSlides(next)
  if (previousAssetId && previousAssetId !== assetId) {
    delete descriptionPreviewState[previousAssetId]
  }
  if (assetId) {
    void ensureDescriptionPreview(assetId)
  }
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

function ensureTextAsset(assetId: string): ProjectAsset | null {
  const asset = sceneStore.getAsset(assetId)
  if (!asset || asset.type !== 'file') {
    return null
  }
  return asset
}

function isTextAssetDrag(event: DragEvent): boolean {
  const payload = parseDragPayload(event)
  if (!payload) {
    return false
  }
  return !!ensureTextAsset(payload.assetId)
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

function handleDescriptionDragEnter(index: number, event: DragEvent) {
  if (!isTextAssetDrag(event)) {
    return
  }
  event.preventDefault()
  descriptionDragIndex.value = index
}

function handleDescriptionDragOver(index: number, event: DragEvent) {
  if (!isTextAssetDrag(event)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  descriptionDragIndex.value = index
}

function handleDescriptionDragLeave(index: number, event: DragEvent) {
  if (!isTextAssetDrag(event)) {
    return
  }
  const target = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as Node | null
  if (target && related && target.contains(related)) {
    return
  }
  if (descriptionDragIndex.value === index) {
    descriptionDragIndex.value = null
  }
}

function handleDescriptionDrop(index: number, event: DragEvent) {
  if (!isTextAssetDrag(event)) {
    return
  }
  const payload = parseDragPayload(event)
  if (!payload) {
    return
  }
  const asset = ensureTextAsset(payload.assetId)
  if (!asset) {
    console.warn('Dragged asset is not a compatible text resource')
    return
  }
  event.preventDefault()
  event.stopPropagation()
  descriptionDragIndex.value = null
  void assetCacheStore.downloaProjectAsset(asset).catch((error: unknown) => {
    console.warn('Failed to cache text asset for lantern slide', error)
  })
  updateSlideDescriptionAsset(index, asset.id)
}

function clearSlideDescriptionAsset(index: number) {
  updateSlideDescriptionAsset(index, null)
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

function getDescriptionPreview(assetId: string): DescriptionPreviewState {
  const trimmed = assetId.trim()
  if (!trimmed.length) {
    return { text: '', loading: false, error: null }
  }
  if (!descriptionPreviewState[trimmed]) {
    descriptionPreviewState[trimmed] = {
      text: '',
      loading: false,
      error: null,
    }
  }
  return descriptionPreviewState[trimmed]
}

async function ensureDescriptionPreview(assetId: string): Promise<void> {
  const trimmed = assetId.trim()
  if (!trimmed.length || descriptionPreviewPromises.has(trimmed)) {
    return descriptionPreviewPromises.get(trimmed) ?? Promise.resolve()
  }
  const promise = (async () => {
    const state = getDescriptionPreview(trimmed)
    const asset = ensureTextAsset(trimmed)
    if (!asset) {
      state.text = ''
      state.loading = false
      state.error = '无法找到对应的文本资源'
      return
    }
    state.loading = true
    state.error = null
    try {
      if (!assetCacheStore.hasCache(asset.id)) {
        await assetCacheStore.downloaProjectAsset(asset)
      } else {
        assetCacheStore.touch(asset.id)
      }
      const file = assetCacheStore.createFileFromCache(asset.id)
      if (!file) {
        throw new Error('无法读取文本资源内容')
      }
      const text = await file.text()
      state.text = text
      state.loading = false
      state.error = null
    } catch (error) {
      state.loading = false
      state.error = (error as Error).message ?? '资源加载失败'
    } finally {
      descriptionPreviewPromises.delete(trimmed)
    }
  })()
  descriptionPreviewPromises.set(trimmed, promise)
  await promise
}

function resolveSlideDescriptionDisplay(slide: LanternSlideDefinition): string {
  const assetId = slide.descriptionAssetId?.trim()
  if (assetId) {
    return getDescriptionPreview(assetId).text
  }
  return slide.description ?? ''
}

function resolveDescriptionSourceLabel(slide: LanternSlideDefinition): string {
  const assetId = slide.descriptionAssetId?.trim()
  if (assetId) {
    const asset = sceneStore.getAsset(assetId)
    return asset?.name ?? assetId
  }
  const text = slide.description?.trim() ?? ''
  if (text.length) {
    return 'Custom text'
  }
  return 'No description'
}

type DescriptionStatus = { text: string; kind: 'info' | 'error' | 'loading' }

function resolveDescriptionStatus(slide: LanternSlideDefinition): DescriptionStatus | null {
  const assetId = slide.descriptionAssetId?.trim()
  if (!assetId) {
    return null
  }
  const preview = getDescriptionPreview(assetId)
  if (preview.loading) {
    return { text: 'Loading text asset…', kind: 'loading' }
  }
  if (preview.error) {
    return { text: preview.error, kind: 'error' }
  }
  return { text: 'Description is linked to a resource asset.', kind: 'info' }
}

function handleDescriptionInput(index: number, value: string) {
  updateSlideDescription(index, value)
}

watch(
  () => slides.value,
  (entries) => {
    const activeAssetIds = new Set<string>()
    entries.forEach((slide) => {
      const assetId = slide.descriptionAssetId?.trim()
      if (assetId) {
        activeAssetIds.add(assetId)
        void ensureDescriptionPreview(assetId)
      }
    })
    Object.keys(descriptionPreviewState).forEach((key) => {
      if (!activeAssetIds.has(key)) {
        delete descriptionPreviewState[key]
      }
    })
    Array.from(descriptionPreviewPromises.keys()).forEach((key) => {
      if (!activeAssetIds.has(key)) {
        descriptionPreviewPromises.delete(key)
      }
    })
  },
  { immediate: true, deep: true },
)
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
                      <v-select
            :model-value="slide.layout"
            :items="layoutOptions"
            item-title="label"
            item-value="value"
            label=""
            density="compact"
            variant="underlined"
            hide-details
            @update:model-value="updateSlideLayout(index, $event as LanternSlideLayout)"
          />
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
          <div
            class="lantern-slide__description"
            :class="{
              'is-active-drop': descriptionDragIndex === index,
              'has-asset': !!slide.descriptionAssetId,
            }"
            @dragenter="handleDescriptionDragEnter(index, $event)"
            @dragover="handleDescriptionDragOver(index, $event)"
            @dragleave="handleDescriptionDragLeave(index, $event)"
            @drop="handleDescriptionDrop(index, $event)"
          >
            <div class="lantern-slide__description-toolbar">
              <span class="lantern-slide__description-label">Description</span>
              <div class="lantern-slide__description-actions">
                <template v-if="slide.descriptionAssetId">
                  <v-chip size="x-small" variant="tonal" class="lantern-slide__description-chip">
                    <v-icon size="14">mdi-file-document-outline</v-icon>
                    <span>{{ resolveDescriptionSourceLabel(slide) }}</span>
                  </v-chip>
                  <v-btn
                    icon="mdi-close"
                    size="x-small"
                    variant="text"
                    color="rgba(233, 236, 241, 0.85)"
                    title="Clear description resource"
                    @click.stop="clearSlideDescriptionAsset(index)"
                  />
                </template>
                <template v-else>
                  <span class="lantern-slide__description-source">{{ resolveDescriptionSourceLabel(slide) }}</span>
                </template>
              </div>
            </div>
            <v-textarea
              class="lantern-slide__textarea"
              :model-value="resolveSlideDescriptionDisplay(slide)"
              density="compact"
              variant="outlined"
              hide-details
              :auto-grow="false"
              rows="4"
              style="height: 100%"
              :readonly="!!slide.descriptionAssetId"
              :placeholder="slide.descriptionAssetId ? 'Description content is linked to a resource' : 'Type description or drop a text asset'"
              @update:model-value="handleDescriptionInput(index, $event as string)"
            />
            <div
              v-if="slide.descriptionAssetId"
              class="lantern-slide__description-status"
              :class="`lantern-slide__description-status--${resolveDescriptionStatus(slide)?.kind ?? 'info'}`"
            >
              {{ resolveDescriptionStatus(slide)?.text }}
            </div>
            <div
              v-else-if="!(slide.description?.trim?.() ?? '').length"
              class="lantern-slide__description-hint"
            >
              Drag a text asset from Resources onto this area to link it.
            </div>
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
  max-height: clamp(230px, 52vh, 420px);
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-gutter: stable both-edges;
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
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.lantern-slide__layout :deep(.v-field) {
  width: 100%;
  min-width: 0;
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
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  border: 1px dashed rgba(233, 236, 241, 0.16);
  background: rgba(12, 16, 22, 0.55);
  height: clamp(220px, 32vh, 300px);
  min-height: 200px;
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
  gap: 8px;
  border-radius: 8px;
  background: rgba(8, 12, 18, 0.5);
  border: 1px solid rgba(233, 236, 241, 0.08);
  overflow: hidden;
  transition: border-color 120ms ease, box-shadow 120ms ease;
  padding: 8px;
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
  padding: 0.75rem;
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
  font-size: 0.8rem;
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
  gap: 6px;
  border-radius: 8px;
  background: rgba(8, 12, 18, 0.5);
  border: 1px solid rgba(233, 236, 241, 0.08);
  padding: 8px;
  min-height: 0;
}

.lantern-slide__description.is-active-drop {
  border-color: rgba(132, 202, 255, 0.75);
  box-shadow: 0 0 0 2px rgba(132, 202, 255, 0.35);
}

.lantern-slide__description-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.4rem;
}

.lantern-slide__description-label {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(233, 236, 241, 0.72);
}

.lantern-slide__description-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.lantern-slide__description-chip {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 180px;
  overflow: hidden;
}

.lantern-slide__description-chip :deep(.v-chip__content) {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.lantern-slide__description-source {
  font-size: 0.78rem;
  color: rgba(233, 236, 241, 0.65);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.lantern-slide__layout .lantern-slide__field-label {
  margin-bottom: 2px;
}

.lantern-slide__textarea {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.lantern-slide__textarea :deep(.v-input) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.lantern-slide__textarea :deep(.v-input__control) {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.lantern-slide__textarea :deep(.v-field) {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.lantern-slide__textarea :deep(.v-field__input) {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.lantern-slide__textarea :deep(textarea) {
  flex: 1;
  resize: none;
  height: 100%;
  min-height: 0;
}

.lantern-slide__description-status {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.68);
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.lantern-slide__description-status--loading {
  color: rgba(132, 202, 255, 0.85);
}

.lantern-slide__description-status--error {
  color: #ff867c;
}

.lantern-slide__description-hint {
  font-size: 0.75rem;
  color: rgba(233, 236, 241, 0.55);
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
