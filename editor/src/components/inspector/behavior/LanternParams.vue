<script setup lang="ts">
import { computed } from 'vue'
import type { LanternBehaviorParams, LanternSlideDefinition, LanternSlideLayout } from '@harmony/schema'

const props = defineProps<{
  modelValue: LanternBehaviorParams | undefined
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: LanternBehaviorParams): void
}>()

let slideCounter = 0

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

function updateSlideTitle(index: number, value: string | number) {
  const next = slides.value.slice()
  if (!next[index]) {
    return
  }
  const title = typeof value === 'string' ? value.trim() : String(value)
  next[index] = {
    ...next[index],
    title,
  }
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
          <span class="lantern-slide__badge">Slide {{ index + 1 }}</span>
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
        <div class="lantern-slide__fields">
          <v-text-field
            :model-value="slide.title"
            label="Title"
            density="compact"
            variant="underlined"
            hide-details
            @update:model-value="updateSlideTitle(index, $event)"
          />
          <v-textarea
            :model-value="slide.description"
            label="Description"
            auto-grow
            rows="2"
            density="compact"
            variant="underlined"
            hide-details
            @update:model-value="updateSlideDescription(index, $event)"
          />
          <v-select
            :model-value="slide.layout"
            :items="layoutOptions"
            item-title="label"
            item-value="value"
            label="Layout"
            density="compact"
            variant="underlined"
            hide-details
            @update:model-value="updateSlideLayout(index, $event)"
          />
          <v-text-field
            :model-value="slide.imageAssetId ?? ''"
            label="Image Asset ID"
            placeholder="Optional"
            density="compact"
            variant="underlined"
            hide-details
            @update:model-value="updateSlideAsset(index, $event)"
          />
          <div v-if="slide.imageAssetId" class="lantern-slide__asset-hint">
            Using asset: {{ slide.imageAssetId }}
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
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(20, 24, 32, 0.6);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.lantern-slide__toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.lantern-slide__badge {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.78);
}

.lantern-slide__actions {
  display: flex;
  gap: 0.2rem;
}

.lantern-slide__fields {
  display: grid;
  gap: 0.6rem;
}

.lantern-slide__asset-hint {
  font-size: 0.78rem;
  color: rgba(233, 236, 241, 0.55);
}

@media (min-width: 720px) {
  .lantern-slide__fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .lantern-slide__fields > :nth-child(2) {
    grid-column: span 2;
  }

  .lantern-slide__fields > :nth-child(4),
  .lantern-slide__fields > :nth-child(5) {
    grid-column: span 2;
  }
}
</style>
