<script setup lang="ts">
import type { PlaceholderOverlayState } from '@/types/scene-viewport-placeholder-overlay-state'

defineProps<{
  overlays: PlaceholderOverlayState[]
}>()
</script>

<template>
  <div
    v-for="overlay in overlays"
    :key="overlay.id"
    class="placeholder-overlay-card"
    :class="{
      'is-hidden': !overlay.visible,
      'has-error': !!overlay.error,
    }"
    :style="{ left: `${overlay.x}px`, top: `${overlay.y}px` }"
  >
    <div class="placeholder-overlay-name">{{ overlay.name }}</div>
    <div v-if="overlay.error" class="placeholder-overlay-error">{{ overlay.error }}</div>
    <div v-else class="placeholder-overlay-progress">
      <div class="placeholder-overlay-progress-bar">
        <div
          class="placeholder-overlay-progress-value"
          :style="{ width: `${Math.min(100, Math.max(0, overlay.progress))}%` }"
        ></div>
      </div>
      <div class="placeholder-overlay-percent">{{ Math.round(overlay.progress) }}%</div>
    </div>
  </div>
</template>

<style scoped>
.placeholder-overlay-card {
  position: absolute;
  transform: translate(-50%, -110%);
  background-color: rgba(13, 17, 23, 0.92);
  border: 1px solid rgba(77, 208, 225, 0.4);
  border-radius: 8px;
  padding: 8px 12px;
  min-width: 140px;
  color: #e9ecf1;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
  transition: opacity 120ms ease;
  opacity: 1;
}

.placeholder-overlay-card.is-hidden {
  opacity: 0;
}

.placeholder-overlay-card.has-error {
  border-color: rgba(244, 67, 54, 0.8);
}

.placeholder-overlay-name {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}

.placeholder-overlay-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.placeholder-overlay-progress-bar {
  position: relative;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.15);
}

.placeholder-overlay-progress-value {
  position: absolute;
  inset: 0;
  width: 0;
  background: linear-gradient(90deg, rgba(0, 188, 212, 0.9), rgba(0, 131, 143, 0.9));
}

.placeholder-overlay-percent {
  text-align: right;
  font-size: 11px;
  color: #4dd0e1;
  font-weight: 500;
}

.placeholder-overlay-error {
  font-size: 11px;
  color: #ff8a80;
  max-width: 180px;
}
</style>
