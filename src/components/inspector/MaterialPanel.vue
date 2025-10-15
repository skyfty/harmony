<script setup lang="ts">
const props = defineProps<{
  color: string
  opacity: number
}>()

const emit = defineEmits<{
  (event: 'update:color', value: string): void
  (event: 'update:opacity', value: number): void
}>()

function handleColorInput(event: Event) {
  emit('update:color', (event.target as HTMLInputElement).value)
}

function handleOpacity(value: number) {
  emit('update:opacity', value)
}
</script>

<template>
  <v-expansion-panel value="material">
    <v-expansion-panel-title>Material</v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="section-block material-row">
        <span class="row-label">Base Color</span>
        <input class="color-input" type="color" :value="props.color" @input="handleColorInput" />
      </div>
      <div class="section-block material-row">
        <span class="row-label">Opacity</span>
        <div class="row-controls">
          <v-slider
            :model-value="props.opacity"
            min="0"
            max="1"
            step="0.05"
            hide-details
            class="opacity-slider"
            @update:model-value="handleOpacity"
          />
          <div class="slider-value">{{ props.opacity.toFixed(2) }}</div>
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.section-block {
  margin-bottom: 0.4rem;
}

.section-block:last-of-type {
  margin-bottom: 0;
}

.material-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.row-label {
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  color: rgba(233, 236, 241, 0.86);
}

.row-controls {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.color-input {
  width: 48px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.opacity-slider {
  width: 140px;
}

.slider-value {
  width: 48px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: rgba(233, 236, 241, 0.72);
}
</style>
