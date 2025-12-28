<script setup lang="ts">
import type { PlaceholderOverlayState } from '@/types/scene-viewport-placeholder-overlay-state'

defineProps<{
  overlays: PlaceholderOverlayState[]
}>()

defineEmits<{
  (e: 'retry', nodeId: string): void
  (e: 'cancelDelete', nodeId: string): void
}>()

function handleThumbnailError(overlay: PlaceholderOverlayState) {
  overlay.thumbnail = null
}

const RING_RADIUS = 16
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function ringStrokeStyle(progress: number) {
  const clamped = Math.min(100, Math.max(0, progress))
  const offset = RING_CIRCUMFERENCE * (1 - clamped / 100)
  return {
    strokeDasharray: `${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`,
    strokeDashoffset: `${offset}`,
  }
}
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
    <div class="placeholder-overlay-thumb" :class="{ 'is-empty': !overlay.thumbnail }">
      <img
        v-if="overlay.thumbnail"
        :src="overlay.thumbnail"
        alt=""
        loading="lazy"
        draggable="false"
        @error="handleThumbnailError(overlay)"
      />

      <div v-if="!overlay.error && overlay.progress < 100" class="placeholder-overlay-thumb-center" aria-hidden="true">
        <div class="placeholder-overlay-ring-wrap">
          <svg class="placeholder-overlay-ring" viewBox="0 0 40 40">
            <circle class="placeholder-overlay-ring-track" cx="20" cy="20" r="16" />
            <circle
              class="placeholder-overlay-ring-value"
              cx="20"
              cy="20"
              r="16"
              :style="ringStrokeStyle(overlay.progress)"
            />
          </svg>
          <div class="placeholder-overlay-ring-label">{{ Math.round(overlay.progress) }}%</div>
        </div>
      </div>

      <div class="placeholder-overlay-thumb-actions">
        <button
          v-if="overlay.error"
          type="button"
          class="placeholder-overlay-icon-button"
          title="重试"
          aria-label="重试"
          @click="$emit('retry', overlay.id)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 5a7 7 0 1 1-6.32 4H3l3.5-3.5L10 9H7.68A5 5 0 1 0 12 7c1.1 0 2.14.36 2.98.98l1.42-1.42A6.97 6.97 0 0 0 12 5z"
            />
          </svg>
        </button>
        <button
          v-if="overlay.progress < 100"
          type="button"
          class="placeholder-overlay-icon-button danger"
          title="取消并删除"
          aria-label="取消并删除"
          @click="$emit('cancelDelete', overlay.id)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M9 3h6l1 2h5v2H3V5h5l1-2zm1 7h2v9h-2v-9zm4 0h2v9h-2v-9z"
            />
          </svg>
        </button>
      </div>
    </div>

    <div v-if="overlay.error" class="placeholder-overlay-info has-error">
      <div class="placeholder-overlay-error-row">
        <div class="placeholder-overlay-error-text" :title="overlay.error">{{ overlay.error }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.placeholder-overlay-card {
  position: absolute;
  transform: translate(-50%, -110%);
  width: 100px;
  color: #e9ecf1;
  transition: opacity 120ms ease;
  opacity: 1;
  pointer-events: auto;
}

.placeholder-overlay-thumb {
  position: relative;
  width: 96px;
  height: 96px;
  border-radius: 10px;
  overflow: hidden;
  background-color: rgba(13, 17, 23, 0.55);
  border: 1px solid rgba(77, 208, 225, 0.35);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px) saturate(140%);
  -webkit-backdrop-filter: blur(10px) saturate(140%);
}

.placeholder-overlay-thumb.is-empty {
  background-color: rgba(13, 17, 23, 0.4);
}

.placeholder-overlay-thumb > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  opacity: 0.78;
}

.placeholder-overlay-thumb-actions {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 140ms ease;
  background: rgba(0, 0, 0, 0.18);
  z-index: 2;
}

.placeholder-overlay-thumb:hover .placeholder-overlay-thumb-actions {
  opacity: 1;
  pointer-events: auto;
}

.placeholder-overlay-thumb-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 1;
}

.placeholder-overlay-ring-wrap {
  position: relative;
  width: 44px;
  height: 44px;
}

.placeholder-overlay-ring {
  width: 44px;
  height: 44px;
  display: block;
}

.placeholder-overlay-ring-track {
  fill: transparent;
  stroke: rgba(255, 255, 255, 0.16);
  stroke-width: 3;
}

.placeholder-overlay-ring-value {
  fill: transparent;
  stroke: rgba(0, 188, 212, 0.92);
  stroke-width: 3;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 20px 20px;
}

.placeholder-overlay-ring-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.92);
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
}

.placeholder-overlay-card.is-hidden {
  opacity: 0;
}

.placeholder-overlay-card.has-error {
  /* visual state handled by .placeholder-overlay-info */
}

.placeholder-overlay-info {
  margin-top: -10px;
  padding: 8px 10px;
  background-color: rgba(13, 17, 23, 0.72);
  border-radius: 10px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}

.placeholder-overlay-info.has-error {
  background-color: rgba(13, 17, 23, 0.72);
}


.placeholder-overlay-error-row {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.placeholder-overlay-error-text {
  font-size: 11px;
  color: #ff8a80;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.placeholder-overlay-icon-button {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(13, 17, 23, 0.65);
  color: rgba(233, 236, 241, 0.95);
  padding: 0;
  cursor: pointer;
}

.placeholder-overlay-icon-button:hover {
  background: rgba(13, 17, 23, 0.78);
}

.placeholder-overlay-icon-button:active {
  transform: translateY(1px);
}

.placeholder-overlay-icon-button.danger {
  border-color: rgba(244, 67, 54, 0.35);
  color: rgba(255, 138, 128, 0.95);
}
</style>
