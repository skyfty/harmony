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

    <div class="placeholder-overlay-info" :class="{ 'has-error': !!overlay.error }">
      <div class="placeholder-overlay-name" :title="overlay.name">{{ overlay.name }}</div>

      <div v-if="overlay.error" class="placeholder-overlay-error-row">
        <div class="placeholder-overlay-error-text" :title="overlay.error">{{ overlay.error }}</div>
      </div>

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
  </div>
</template>

<style scoped>
.placeholder-overlay-card {
  position: absolute;
  transform: translate(-50%, -110%);
  width: 148px;
  color: #e9ecf1;
  transition: opacity 120ms ease;
  opacity: 1;
  pointer-events: auto;
}

.placeholder-overlay-thumb {
  position: relative;
  width: 144px;
  height: 72px;
  border-radius: 10px;
  overflow: hidden;
  background-color: rgba(13, 17, 23, 0.92);
  border: 1px solid rgba(77, 208, 225, 0.35);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
}

.placeholder-overlay-thumb.is-empty {
  background-color: rgba(13, 17, 23, 0.5);
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
}

.placeholder-overlay-thumb:hover .placeholder-overlay-thumb-actions {
  opacity: 1;
  pointer-events: auto;
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

.placeholder-overlay-name {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 0;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.placeholder-overlay-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.placeholder-overlay-progress-bar {
  position: relative;
  height: 4px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.14);
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
