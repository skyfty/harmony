<script setup lang="ts">
import { computed } from 'vue'
import type { LoadingOverlayDetailItem } from '@/stores/uiStore'

const props = withDefaults(
  defineProps<{
    visible: boolean
    mode?: 'indeterminate' | 'determinate'
    progress?: number
    title?: string
    message?: string
    closable?: boolean
    cancelable?: boolean
    cancelText?: string
    detailsTitle?: string
    details?: LoadingOverlayDetailItem[]
    detailsExpanded?: boolean
  }>(),
  {
    mode: 'indeterminate',
    progress: 0,
    title: '正在加载',
    message: '请稍候…',
    closable: false,
    cancelable: false,
    cancelText: '取消',
    detailsTitle: '详情',
    details: () => [],
    detailsExpanded: false,
  },
)

const emit = defineEmits<{
  close: []
  cancel: []
}>()

const safeProgress = computed(() => {
  if (props.mode !== 'determinate') return 0
  const value = Number.isFinite(props.progress) ? props.progress! : 0
  return Math.min(Math.max(value, 0), 100)
})

const percentLabel = computed(() => `${Math.round(safeProgress.value)}%`)
const hasDetails = computed(() => Array.isArray(props.details) && props.details.length > 0)

function handleClose() {
  if (!props.closable) return
  emit('close')
}

function handleCancel() {
  if (!props.cancelable) return
  emit('cancel')
}
</script>

<template>
  <Teleport to="body">
    <transition name="overlay-fade">
      <div v-if="visible" class="loading-overlay" role="alert" aria-live="assertive">
        <div class="overlay-backdrop" />
        <div class="overlay-card">
          <header class="overlay-header">
            <div>
              <h2 class="overlay-title">{{ title }}</h2>
              <p class="overlay-message">{{ message }}</p>
            </div>
            <v-btn
              v-if="closable"
              icon="mdi-close"
              variant="text"
              color="on-surface"
              @click="handleClose"
            />
          </header>

          <section class="overlay-content">
            <div v-if="mode === 'indeterminate'" class="progress-indicator">
              <v-progress-circular indeterminate size="72" width="6" color="primary" />
            </div>

            <div v-else class="progress-determinate">
              <div class="progress-label">{{ percentLabel }}</div>
              <v-progress-linear
                :model-value="safeProgress"
                color="primary"
                height="10"
                rounded
                striped
              />
            </div>

            <div v-if="cancelable" class="overlay-actions">
              <v-btn
                variant="tonal"
                color="error"
                @click="handleCancel"
              >
                {{ cancelText }}
              </v-btn>
            </div>

            <details v-if="hasDetails" class="overlay-details" :open="detailsExpanded">
              <summary class="overlay-details__summary">
                {{ detailsTitle }} ({{ details.length }})
              </summary>
              <div class="overlay-details__list">
                <div v-for="item in details" :key="`${item.label}:${item.description}`" class="overlay-details__item">
                  <div class="overlay-details__label">{{ item.label }}</div>
                  <div class="overlay-details__description">{{ item.description }}</div>
                </div>
              </div>
            </details>
          </section>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.loading-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.overlay-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(10, 12, 16, 0.8);
  backdrop-filter: blur(8px);
}

.overlay-card {
  position: relative;
  /* 固定宽度以避免内容（如进度数字）变化时导致弹窗宽度抖动 */
  width: 420px;
  max-width: 90vw; /* 在窄屏时允许收缩 */
  border-radius: 16px;
  padding: 28px 32px;
  background: linear-gradient(145deg, rgba(36, 43, 56, 0.95), rgba(20, 23, 31, 0.98));
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  color: white;
}

.overlay-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.overlay-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.overlay-message {
  margin: 4px 0 0;
  font-size: 0.95rem;
  opacity: 0.75;
}

.overlay-content {
  margin-top: 28px;
}

.progress-indicator {
  display: flex;
  justify-content: center;
}

.progress-determinate {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.progress-label {
  font-size: 2.25rem;
  font-weight: 600;
  text-align: center;
  letter-spacing: 0.05em;
  /* 使用等宽数字以减少从 9/99 到 100 等变化引起的宽度抖动 */
  font-variant-numeric: tabular-nums;
}

.overlay-actions {
  margin-top: 18px;
  display: flex;
  justify-content: center;
}

.overlay-details {
  margin-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  padding-top: 16px;
}

.overlay-details__summary {
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  list-style: none;
}

.overlay-details__summary::-webkit-details-marker {
  display: none;
}

.overlay-details__list {
  max-height: min(36vh, 280px);
  overflow: auto;
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 4px;
}

.overlay-details__item {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
}

.overlay-details__label {
  font-size: 0.9rem;
  font-weight: 600;
  word-break: break-word;
}

.overlay-details__description {
  margin-top: 4px;
  font-size: 0.85rem;
  line-height: 1.5;
  opacity: 0.8;
  word-break: break-word;
}

.overlay-fade-enter-active,
.overlay-fade-leave-active {
  transition: opacity 180ms ease;
}

.overlay-fade-enter-from,
.overlay-fade-leave-to {
  opacity: 0;
}
</style>
