<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import type { SceneExportLogEntry, SceneExportOptions, SceneExportProgressSummary } from '@/types/scene-export'


const props = defineProps<{
  modelValue: boolean
  defaultFileName: string
  initialOptions: SceneExportOptions
  exporting: boolean
  progress: number
  progressMessage: string
  errorMessage?: string | null
  logs: SceneExportLogEntry[]
  exportSummary: SceneExportProgressSummary
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', payload: SceneExportOptions): void
  (event: 'cancel'): void
}>()

const form = reactive<SceneExportOptions>(getInitialFormState())
const fileNameError = ref<string | null>(null)
const logListRef = ref<HTMLElement | null>(null)

const PHASE_LABELS: Record<SceneExportLogEntry['phase'], string> = {
  project: '工程',
  scene: '场景',
  node: '节点',
  asset: '资产',
  sidecar: '附属数据',
  manifest: '清单',
  archive: '压缩包',
  diagnostics: '诊断',
}

function getInitialFormState(): SceneExportOptions {
  const sanitizedName = sanitizeInputName(props.defaultFileName || 'scene')
  return {
    fileName: sanitizedName || 'scene',
    includeLights: props.initialOptions.includeLights,
    includeHiddenNodes: props.initialOptions.includeHiddenNodes,
    includeSkeletons: props.initialOptions.includeSkeletons,
    includeExtras: props.initialOptions.includeExtras,
    rotateCoordinateSystem: !!props.initialOptions.rotateCoordinateSystem,
    lazyLoadMeshes: props.initialOptions.lazyLoadMeshes ?? true,
    embedAssets: props.initialOptions.embedAssets ?? false,
    // Project export bundles are JSON-only.
    format: 'json',
  }
}

const dialogModel = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const progressValue = computed(() => {
  const clamped = Number.isFinite(props.progress) ? Math.min(Math.max(props.progress, 0), 100) : 0
  return clamped
})

const progressLabel = computed(() => {
  if (!props.exporting && !props.progressMessage) {
    return ''
  }
  return props.progressMessage || `Export progress ${Math.round(progressValue.value)}%`
})

const hasLogs = computed(() => Array.isArray(props.logs) && props.logs.length > 0)

const failedEntries = computed(() => props.logs.filter((entry: SceneExportLogEntry) => entry.status === 'failed' || entry.level === 'error'))

const latestErrorEntry = computed(() => {
  for (let index = props.logs.length - 1; index >= 0; index -= 1) {
    const entry = props.logs[index]
    if (entry && (entry.status === 'failed' || entry.level === 'error')) {
      return entry
    }
  }
  return null
})

const hasExportError = computed(() => Boolean(props.errorMessage) || failedEntries.value.length > 0)

const errorSummaryText = computed(() => {
  if (props.errorMessage) {
    return props.errorMessage
  }
  return latestErrorEntry.value?.message ?? ''
})

const summaryCards = computed(() => {
  const cards: Array<{ key: string; label: string; value: string }> = [
    { key: 'phase', label: '当前阶段', value: props.exportSummary?.phaseLabel || '工程' },
    { key: 'logs', label: '日志条目', value: String(props.exportSummary?.logs ?? 0) },
  ]

  const skippedEntries = props.logs.filter((entry: SceneExportLogEntry) => entry.status === 'skipped')
  if (skippedEntries.length) {
    cards.push({
      key: 'skipped',
      label: '已跳过配置资产',
      value: String(skippedEntries.length),
    })
  }

  if (props.exportSummary?.scenes) {
    cards.push({
      key: 'scenes',
      label: '场景',
      value: `${props.exportSummary.scenes.current}/${props.exportSummary.scenes.total}`,
    })
  }
  if (props.exportSummary?.nodes) {
    cards.push({
      key: 'nodes',
      label: '节点',
      value: `${props.exportSummary.nodes.current}/${props.exportSummary.nodes.total}`,
    })
  }
  if (props.exportSummary?.assets) {
    cards.push({
      key: 'assets',
      label: '资产',
      value: `${props.exportSummary.assets.current}/${props.exportSummary.assets.total}`,
    })
  }

  return cards
})

function formatPhaseLabel(phase: SceneExportLogEntry['phase']): string {
  return PHASE_LABELS[phase] ?? phase
}

function formatStatusLabel(status: SceneExportLogEntry['status']): string {
  switch (status) {
    case 'completed':
      return '完成'
    case 'failed':
      return '失败'
    case 'skipped':
      return '跳过'
    case 'pending':
      return '等待中'
    default:
      return '进行中'
  }
}

function resolveStatusColor(status: SceneExportLogEntry['status'], level: SceneExportLogEntry['level']): string {
  if (status === 'failed' || level === 'error') {
    return 'error'
  }
  if (status === 'skipped' || level === 'warning') {
    return 'warning'
  }
  if (status === 'completed') {
    return 'success'
  }
  return 'info'
}

function resolveStatusIcon(status: SceneExportLogEntry['status'], level: SceneExportLogEntry['level']): string {
  if (status === 'failed' || level === 'error') {
    return 'mdi-alert-circle'
  }
  if (status === 'skipped' || level === 'warning') {
    return 'mdi-skip-next-circle'
  }
  if (status === 'completed') {
    return 'mdi-check-circle'
  }
  if (status === 'pending') {
    return 'mdi-timer-sand'
  }
  return 'mdi-progress-clock'
}

function buildLogMeta(entry: SceneExportLogEntry): string[] {
  const parts = [formatPhaseLabel(entry.phase), formatStatusLabel(entry.status)]
  if (entry.sceneName) {
    parts.push(`场景 ${entry.sceneName}`)
  }
  if (entry.nodeName) {
    parts.push(`节点 ${entry.nodeName}`)
  }
  if (entry.assetName) {
    parts.push(`资产 ${entry.assetName}`)
  }
  if (entry.assetType) {
    parts.push(`类型 ${entry.assetType}`)
  }
  if (entry.assetSourceType) {
    parts.push(`来源 ${entry.assetSourceType}`)
  }
  if (Number.isFinite(entry.assetReferenceCount)) {
    parts.push(`引用 ${Math.max(0, Math.round(entry.assetReferenceCount ?? 0))}`)
  }
  if (Number.isFinite(entry.current) && Number.isFinite(entry.total)) {
    parts.push(`${entry.current}/${entry.total}`)
  }
  return parts
}

watch(
  () => props.modelValue,
  (open: boolean) => {
    if (open) {
      Object.assign(form, getInitialFormState())
      fileNameError.value = null
    }
  },
)

watch(
  () => props.logs.length,
  async () => {
    if (!props.exporting) {
      return
    }
    await nextTick()
    const element = logListRef.value
    if (!element) {
      return
    }
    element.scrollTop = element.scrollHeight
  },
)

watch(
  () => props.defaultFileName,
  (name: string) => {
    if (!props.modelValue || props.exporting) {
      return
    }
    const sanitized = sanitizeInputName(name)
    if (sanitized && form.fileName !== sanitized) {
      form.fileName = sanitized
    }
  },
)

function sanitizeInputName(input: string): string {
  const trimmed = (input ?? '').trim()
  if (!trimmed) {
    return ''
  }
  return trimmed.replace(/\.(glb|json)$/i, '')
}

function validate(): boolean {
  const trimmed = form.fileName.trim()
  if (!trimmed) {
    fileNameError.value = '请输入文件名'
    return false
  }
  if (!/^[\p{L}\p{N} _.-]+$/u.test(trimmed)) {
    fileNameError.value = '文件名只能包含中文、字母、数字、空格、下划线和连字符'
    return false
  }
  fileNameError.value = null
  return true
}

function handleCancel() {
  if (props.exporting) {
    return
  }
  emit('cancel')
  emit('update:modelValue', false)
}

function normalFileizeInputName(input: string): string {
  const trimmed = input.trim()
  if (/\.(json)$/i.test(trimmed)) {
    return trimmed
  }
  return `${trimmed}.json`
}

function handleConfirm() {
  if (props.exporting) {
    return
  }
  if (!validate()) {
    return
  }
  const payload: SceneExportOptions = {
    ...form,
    fileName:  normalFileizeInputName(form.fileName),
    format: 'json',
  }
  emit('confirm', payload)
}

</script>

<template>
  <v-dialog
    v-model="dialogModel"
    :persistent="exporting"
    content-class="export-dialog-overlay"
    scrim="rgba(4, 10, 18, 0.42)"
    scrollable
  >
    <v-card class="export-dialog-card">
      <v-toolbar density="compact" class="panel-toolbar" height="40px">
        <div class="toolbar-text">
        </div>
        <v-spacer />
        <v-btn class="toolbar-close" icon="mdi-close" size="small" variant="text" @click="handleCancel" />
      </v-toolbar>
      <v-card-text class="export-dialog-content">
        <section class="export-dialog-overview">
          <div class="overview-copy">
            <div class="overview-eyebrow">Project Package Export</div>
            <div class="overview-title">导出工作台</div>
            <div v-if="hasExportError" class="overview-status overview-status--error">
              <v-icon icon="mdi-alert-circle" size="18" color="error" />
              <span>导出过程中出现错误</span>
            </div>
          </div>

          <div class="summary-grid summary-grid--overview">
            <div v-for="card in summaryCards" :key="card.key" class="summary-card">
              <div class="summary-card__label">{{ card.label }}</div>
              <div class="summary-card__value">{{ card.value }}</div>
            </div>
          </div>
        </section>

        <div class="export-dialog-grid">
          <section class="export-dialog-main export-dialog-sidebar">
            <div class="file-input-row">
              <v-text-field
                v-model="form.fileName"
                label="File name"
                :disabled="exporting"
                :error="!!fileNameError"
                :error-messages="fileNameError ? [fileNameError] : []"
                density="comfortable"
                variant="outlined"
                @keydown.enter.prevent="handleConfirm"
              />
            </div>

            <div class="sidebar-section-title">导出选项</div>
            <div class="options-grid">
              <v-checkbox
                v-model="form.embedAssets"
                :disabled="exporting"
                label="Embed assets"
                density="compact"
                hide-details
              />
              <v-checkbox
                v-model="form.lazyLoadMeshes"
                :disabled="exporting"
                label="Lazy load meshes"
                density="compact"
                hide-details
              />
            </div>

            <transition name="fade">
              <div v-if="exporting || progressValue > 0 || hasLogs" class="progress-section" :class="{ 'progress-section--error': hasExportError }">
                <div class="progress-section__header">
                  <div>
                    <div class="progress-section__title">导出进度</div>
                    <div v-if="progressLabel" class="progress-label">{{ progressLabel }}</div>
                  </div>
                  <div class="progress-percent">{{ Math.round(progressValue) }}%</div>
                </div>
                <v-progress-linear
                  :model-value="progressValue"
                  height="8"
                  color="primary"
                  rounded
                />
                <div v-if="hasExportError" class="progress-error-summary">
                  <v-icon icon="mdi-alert-octagon" size="18" color="error" />
                  <div class="progress-error-summary__body">
                    <div class="progress-error-summary__title">导出失败</div>
                    <div class="progress-error-summary__text">{{ errorSummaryText }}</div>
                  </div>
                </div>
              </div>
            </transition>

            <transition name="fade">
              <v-alert
                v-if="errorMessage"
                class="mt-3"
                type="error"
                density="comfortable"
                border="start"
                variant="tonal"
              >
                {{ errorMessage }}
              </v-alert>
            </transition>

          </section>

          <aside class="export-log-panel">
            <div v-if="hasExportError" class="export-log-error-banner">
              <div class="export-log-error-banner__icon">
                <v-icon icon="mdi-alert-circle-outline" size="18" color="error" />
              </div>
              <div class="export-log-error-banner__body">
                <div class="export-log-error-banner__title">最近错误</div>
                <div class="export-log-error-banner__text">{{ errorSummaryText }}</div>
                <div v-if="latestErrorEntry?.detail" class="export-log-error-banner__detail">{{ latestErrorEntry.detail }}</div>
              </div>
            </div>

            <div ref="logListRef" class="export-log-list">
              <div v-if="!hasLogs" class="export-log-list__empty">
                导出开始后，这里会持续显示场景、节点、资产和压缩过程日志。
              </div>
              <div
                v-for="entry in props.logs"
                :key="entry.id"
                class="export-log-item"
                :class="[`export-log-item--${resolveStatusColor(entry.status, entry.level)}`]"
              >
                <div class="export-log-item__icon">
                  <v-icon :icon="resolveStatusIcon(entry.status, entry.level)" :color="resolveStatusColor(entry.status, entry.level)" size="18" />
                </div>
                <div class="export-log-item__body">
                  <div class="export-log-item__title">{{ entry.message }}</div>
                  <div class="export-log-item__meta">
                    <span v-for="(meta, index) in buildLogMeta(entry)" :key="`${entry.id}:${index}`">{{ meta }}</span>
                  </div>
                  <div v-if="entry.detail" class="export-log-item__detail">{{ entry.detail }}</div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </v-card-text>
      <v-divider />
      <v-card-actions class="dialog-actions">
        <v-spacer />
        <v-btn
          color="primary"
          variant="flat"
          :loading="exporting"
          :disabled="exporting"
          @click="handleConfirm"
        >
          Export
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.panel-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 10px 12px 0;
}

.toolbar-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toolbar-caption {
  font-size: 0.76rem;
  color: rgba(214, 228, 249, 0.58);
}

.toolbar-chip {
  margin-left: 12px;
}

.toolbar-close {
  color: rgba(233, 236, 241, 0.72);
}

.export-dialog-card {
  width: min(100vw - 28px, 1680px);
  height: min(100vh - 28px, 1040px);
  min-height: min(100vh - 28px, 1040px);
  color: #e7eefb;
  overflow: hidden;
  border-radius: 24px;
  border: 1px solid rgba(194, 219, 255, 0.1);
  background:
    radial-gradient(circle at top left, rgba(90, 147, 229, 0.2), transparent 28%),
    radial-gradient(circle at 85% 12%, rgba(45, 176, 141, 0.14), transparent 24%),
    radial-gradient(circle at bottom right, rgba(129, 93, 214, 0.12), transparent 26%),
    linear-gradient(180deg, rgba(24, 31, 43, 0.72), rgba(12, 17, 25, 0.78));
  backdrop-filter: blur(24px) saturate(120%);
  box-shadow: 0 32px 96px rgba(0, 0, 0, 0.48);
}

.export-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
  height: 100%;
  padding: 16px 18px 18px;
}

.export-dialog-overview {
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(0, 1.2fr);
  gap: 16px;
  padding: 18px 20px;
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(20, 28, 40, 0.5), rgba(14, 20, 30, 0.34));
  backdrop-filter: blur(18px);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.overview-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.overview-eyebrow {
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(168, 201, 246, 0.72);
}

.overview-title {
  margin-top: 6px;
  font-size: 1.5rem;
  font-weight: 700;
  color: #f7fbff;
}

.overview-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 8px 12px;
  width: fit-content;
  border-radius: 999px;
  font-size: 0.84rem;
  font-weight: 700;
}

.overview-status--error {
  background: rgba(146, 34, 34, 0.28);
  color: #ffd8d8;
  box-shadow: inset 0 0 0 1px rgba(255, 120, 120, 0.18);
}

.overview-subtitle {
  margin-top: 6px;
  max-width: 52ch;
  font-size: 0.9rem;
  line-height: 1.5;
  color: rgba(214, 228, 248, 0.72);
}

.export-dialog-grid {
  display: grid;
  grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
  gap: 18px;
  min-height: 0;
  flex: 1;
}

.export-dialog-main,
.export-log-panel {
  min-height: 0;
}

.export-dialog-main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(25, 33, 46, 0.52), rgba(14, 20, 30, 0.42));
  backdrop-filter: blur(16px);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.export-dialog-sidebar {
  justify-content: flex-start;
}

.file-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.sidebar-section-title {
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(184, 206, 239, 0.7);
}

.options-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px 12px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(145, 181, 234, 0.12);
  background: linear-gradient(180deg, rgba(37, 48, 68, 0.54), rgba(22, 29, 40, 0.44));
  backdrop-filter: blur(12px);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}

.summary-grid--overview {
  align-self: stretch;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
}

.summary-card {
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(147, 183, 232, 0.12);
  background: linear-gradient(180deg, rgba(41, 54, 76, 0.52), rgba(21, 28, 40, 0.42));
  backdrop-filter: blur(10px);
}

.summary-card__label {
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(201, 216, 241, 0.74);
}

.summary-card__value {
  margin-top: 6px;
  font-size: 1.2rem;
  font-weight: 700;
  color: #f5f9ff;
}

.progress-section {
  padding: 16px;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(34, 53, 84, 0.58), rgba(20, 33, 56, 0.44));
  border: 1px solid rgba(122, 168, 233, 0.18);
  backdrop-filter: blur(12px);
}

.progress-section--error {
  border-color: rgba(255, 107, 107, 0.28);
  background: linear-gradient(180deg, rgba(74, 32, 43, 0.56), rgba(41, 21, 31, 0.46));
}

.progress-section__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.progress-section__title {
  font-size: 0.94rem;
  font-weight: 700;
  color: #dce9ff;
}

.progress-label {
  margin-top: 4px;
  font-size: 0.86rem;
  color: rgba(217, 230, 248, 0.76);
}

.progress-percent {
  font-size: 1.3rem;
  font-weight: 700;
  color: #f2f7ff;
  font-variant-numeric: tabular-nums;
}

.progress-error-summary {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 10px;
  margin-top: 14px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(122, 28, 38, 0.26);
  box-shadow: inset 0 0 0 1px rgba(255, 133, 133, 0.14);
}

.progress-error-summary__title {
  font-size: 0.84rem;
  font-weight: 700;
  color: #ffdfe1;
}

.progress-error-summary__text {
  margin-top: 4px;
  font-size: 0.8rem;
  line-height: 1.5;
  color: rgba(255, 225, 228, 0.84);
}

.progress-supporting-text {
  margin-top: 12px;
  font-size: 0.8rem;
  line-height: 1.5;
  color: rgba(212, 227, 248, 0.68);
}

.export-log-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 18px;
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(16, 23, 34, 0.62), rgba(8, 12, 19, 0.56));
  color: #eef3fb;
  backdrop-filter: blur(18px);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.export-log-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.export-log-panel__title {
  font-size: 1rem;
  font-weight: 700;
}

.export-log-panel__subtitle {
  margin-top: 4px;
  font-size: 0.82rem;
  color: rgba(233, 240, 252, 0.68);
}

.export-log-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.export-log-error-banner {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 12px;
  margin-bottom: 12px;
  padding: 14px;
  border-radius: 14px;
  background: rgba(127, 29, 29, 0.24);
  border: 1px solid rgba(255, 125, 125, 0.16);
  backdrop-filter: blur(10px);
}

.export-log-error-banner__title {
  font-size: 0.85rem;
  font-weight: 700;
  color: #ffe3e3;
}

.export-log-error-banner__text {
  margin-top: 4px;
  font-size: 0.82rem;
  line-height: 1.5;
  color: rgba(255, 224, 224, 0.88);
}

.export-log-error-banner__detail {
  margin-top: 6px;
  font-size: 0.76rem;
  color: rgba(255, 204, 204, 0.72);
  word-break: break-word;
}

.export-log-list__empty {
  height: 100%;
  min-height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  border-radius: 14px;
  border: 1px dashed rgba(255, 255, 255, 0.14);
  color: rgba(233, 240, 252, 0.72);
}

.export-log-item {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 12px;
  padding: 12px 10px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(8px);
}

.export-log-item + .export-log-item {
  margin-top: 10px;
}

.export-log-item--success {
  background: rgba(42, 103, 67, 0.16);
}

.export-log-item--warning {
  background: rgba(133, 95, 26, 0.18);
}

.export-log-item--error {
  background: rgba(137, 42, 42, 0.2);
}

.export-log-item__icon {
  padding-top: 2px;
}

.export-log-item__body {
  min-width: 0;
}

.export-log-item__title {
  font-size: 0.92rem;
  font-weight: 600;
  color: #f6f9ff;
}

.export-log-item__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 6px;
  font-size: 0.76rem;
  color: rgba(225, 234, 247, 0.72);
}

.export-log-item__detail {
  margin-top: 6px;
  font-size: 0.78rem;
  color: rgba(196, 215, 244, 0.84);
  white-space: pre-wrap;
  word-break: break-word;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.dialog-actions {
  padding: 12px 16px 16px;
  background: rgba(10, 15, 22, 0.22);
}

.sidebar-footnote {
  margin-top: auto;
  font-size: 0.78rem;
  line-height: 1.5;
  color: rgba(198, 216, 242, 0.58);
}

.export-dialog-main :deep(.v-field) {
  background: rgba(13, 18, 26, 0.34);
  border-radius: 12px;
  backdrop-filter: blur(8px);
}

.export-dialog-main :deep(.v-field__outline) {
  --v-field-border-opacity: 0.22;
}

.export-dialog-main :deep(.v-field__input),
.export-dialog-main :deep(.v-label),
.export-dialog-main :deep(.v-selection-control),
.export-dialog-main :deep(.v-selection-control .v-label) {
  color: #e6eefc;
}

.export-dialog-main :deep(.v-selection-control .v-label) {
  opacity: 0.92;
}

.export-dialog-main :deep(.v-messages),
.export-dialog-main :deep(.v-input__details) {
  color: rgba(220, 231, 247, 0.72);
}

.export-dialog-card :deep(.v-divider) {
  border-color: rgba(255, 255, 255, 0.08);
}

:deep(.export-dialog-overlay) {
  width: min(100vw - 28px, 1680px);
  max-width: none;
  margin: 14px;
}

@media (max-width: 960px) {
  .export-dialog-card {
    width: calc(100vw - 16px);
    height: calc(100vh - 16px);
    min-height: calc(100vh - 16px);
    border-radius: 18px;
  }

  .export-dialog-overview {
    grid-template-columns: minmax(0, 1fr);
  }

  .export-dialog-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .export-log-list {
    min-height: 280px;
  }
}
</style>
