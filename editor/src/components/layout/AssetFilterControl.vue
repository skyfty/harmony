<template>
  <v-overlay
    v-model="overlayOpen"
    :scrim="false"
    :close-on-content-click="false"
    location-strategy="connected"
    location="bottom end"
    origin="top end"
    scroll-strategy="reposition"
    :offset="[0, 8]"
    transition="scale-transition"
  >
    <template #activator="{ props: activatorProps }">
      <v-btn
        class="tag-filter-trigger"
        v-bind="activatorProps"
        variant="text"
        density="compact"
        :color="hasActiveFilters ? 'primary' : undefined"
        :icon="hasActiveFilters ? 'mdi-filter-variant' : 'mdi-filter-outline'"
        :title="hasActiveFilters ? 'Filters applied' : 'Filter assets'"
      />
    </template>
    <v-sheet
      ref="popoverRef"
      class="asset-filter-popover"
      elevation="8"
      tabindex="-1"
      @keydown.esc.stop="overlayOpen = false"
    >
      <div class="asset-filter-popover__header">
        <span class="asset-filter-popover__title">Filter assets</span>
        <v-btn
          v-if="hasActiveFilters"
          variant="text"
          size="small"
          density="comfortable"
          @click="emit('clear-all')"
        >
          Clear filters
        </v-btn>
      </div>
      <div class="asset-filter-popover__body">
        <div class="asset-filter-popover__column">
          <div class="asset-filter-popover__column-content">
            <button
              type="button"
              class="asset-filter-option"
              :class="{ 'is-active': selectedSeries === null }"
              @click="emit('select-series', null)"
            >
              All series
            </button>
            <template v-if="hasSeriesOptions">
              <button
                v-for="option in props.seriesOptions"
                :key="option.value"
                type="button"
                class="asset-filter-option"
                :class="{ 'is-active': selectedSeries === option.value }"
                @click="emit('select-series', option.value)"
              >
                {{ option.label }}
              </button>
            </template>
            <div v-else class="asset-filter-popover__empty">No series</div>
          </div>
        </div>
        <div class="asset-filter-popover__column">
          <div class="asset-filter-popover__column-content">
            <button
              type="button"
              class="asset-filter-option"
              :class="{ 'is-active': !hasSizeFilters }"
              @click="emit('clear-size-filters')"
            >
              All sizes
            </button>
            <template v-if="hasSizeOptions">
              <button
                v-for="option in props.sizeCategoryOptions"
                :key="option.value"
                type="button"
                class="asset-filter-option"
                :class="{ 'is-active': selectedSizeCategories.includes(option.value) }"
                @click="emit('toggle-size-category', option.value)"
              >
                {{ option.label }}
              </button>
            </template>
            <div v-else class="asset-filter-popover__empty">No size categories</div>
          </div>
        </div>
        <div class="asset-filter-popover__column asset-filter-popover__column--tags">
   
          <div class="asset-filter-popover__column-content asset-filter-popover__column-content--tags">
            <button
              type="button"
              class="asset-filter-option"
              :class="{ 'is-active': !hasActiveTagFilters }"
              @click="emit('clear-tag-filters')"
            >
              All tags
            </button>
            <template v-if="hasTagOptions">
              <template v-if="props.filteredTagOptions.length">
                <button
                  v-for="option in props.filteredTagOptions"
                  :key="option.value"
                  type="button"
                  class="asset-filter-option"
                  :class="{ 'is-active': props.tagFilterValues.includes(option.value) }"
                  @click="emit('toggle-tag', option.value)"
                >
                  {{ option.label }}
                </button>
              </template>
              <div v-else class="asset-filter-popover__empty">No matching tags</div>
            </template>
            <div v-else class="asset-filter-popover__empty">No available tags</div>
          </div>
        </div>
      </div>
    </v-sheet>
  </v-overlay>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type {
  SeriesFilterOption,
  SizeCategoryFilterOption,
  TagFilterOption,
} from '@/types/asset-filter'

const props = defineProps<{
  modelValue: boolean
  hasActiveFilters: boolean
  seriesOptions: SeriesFilterOption[]
  selectedSeries: string | null
  sizeCategoryOptions: SizeCategoryFilterOption[]
  selectedSizeCategories: string[]
  tagFilterValues: string[]
  combinedTagOptions: TagFilterOption[]
  filteredTagOptions: TagFilterOption[]
  hasActiveTagFilters: boolean
  tagFilterSearch: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'select-series', value: string | null): void
  (e: 'toggle-size-category', value: string): void
  (e: 'clear-size-filters'): void
  (e: 'toggle-tag', value: string): void
  (e: 'clear-tag-filters'): void
  (e: 'clear-all'): void
  (e: 'update:tag-filter-search', value: string): void
}>()

const overlayOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const hasActiveFilters = computed(() => props.hasActiveFilters)
const selectedSeries = computed(() => props.selectedSeries)
const selectedSizeCategories = computed(() => props.selectedSizeCategories)
const hasSizeFilters = computed(() => props.selectedSizeCategories.length > 0)
const hasActiveTagFilters = computed(() => props.hasActiveTagFilters)

const hasSeriesOptions = computed(() => props.seriesOptions.length > 0)
const hasSizeOptions = computed(() => props.sizeCategoryOptions.length > 0)
const hasTagOptions = computed(() => props.combinedTagOptions.length > 0)

const popoverRef = ref<HTMLElement | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      void nextTick(() => {
        popoverRef.value?.focus()
      })
    }
  },
)
</script>

<style scoped>
.tag-filter-trigger {
  color: rgba(233, 236, 241, 0.7);
  transition: color 120ms ease;
}

.asset-filter-popover {
  width: 900px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 96px);
  background: rgba(12, 18, 26, 0.96);
  border-radius: 12px;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e9ecf1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.asset-filter-popover__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.asset-filter-popover__title {
  font-weight: 600;
  font-size: 0.95rem;
}

.asset-filter-popover__body {
  display: flex;
  align-items: stretch;
  gap: 20px;
  flex: 1;
}

.asset-filter-popover__column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  flex: 1 1 0;
}

.asset-filter-popover__column:first-child {
  flex: 1.1 1 0;
}

.asset-filter-popover__column:nth-child(2) {
  flex: 0.9 1 0;
}

.asset-filter-popover__column-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.82);
}

.asset-filter-popover__search {
  display: flex;
}

.asset-filter-popover__search :deep(.v-field) {
  background: rgba(233, 236, 241, 0.08);
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.asset-filter-popover__search :deep(.v-field__input) {
  color: #e9ecf1;
}

.asset-filter-popover__column-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 100%;
  overflow-y: auto;
  padding-right: 4px;
}

.asset-filter-option {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 0.85rem;
  line-height: 1.4;
  background: rgba(233, 236, 241, 0.08);
  color: #e9ecf1;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
  text-align: left;
  width: 100%;
}

.asset-filter-option:hover {
  background: rgba(233, 236, 241, 0.14);
}

.asset-filter-option:focus-visible {
  outline: 2px solid rgba(77, 208, 225, 0.8);
  outline-offset: 2px;
}

.asset-filter-option.is-active {
  background: rgba(77, 208, 225, 0.28);
  border-color: rgba(77, 208, 225, 0.6);
  color: #e0f7fa;
  box-shadow: 0 0 0 1px rgba(77, 208, 225, 0.35);
}

.asset-filter-popover__empty {
  font-size: 0.85rem;
  color: rgba(233, 236, 241, 0.65);
  text-align: center;
  padding: 12px 0;
}
</style>
