<script setup lang="ts">
import { computed } from 'vue'
import type {
  RuntimeResourceBudgetProfileId,
  RuntimeResourceBudgetReport,
  RuntimeResourceBudgetCategory,
  RuntimeTargetPlatform,
} from '@schema/core'

const props = defineProps<{
  report: RuntimeResourceBudgetReport | null
  profileId: RuntimeResourceBudgetProfileId
  targetPlatform: RuntimeTargetPlatform
  compact?: boolean
  showControls?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:profileId', value: RuntimeResourceBudgetProfileId): void
  (event: 'update:targetPlatform', value: RuntimeTargetPlatform): void
}>()

const profileOptions: Array<{ title: string; value: RuntimeResourceBudgetProfileId }> = [
  { title: '低端机', value: 'low' },
  { title: '中高端机', value: 'mid-high' },
  { title: '高端机', value: 'high' },
]

const platformOptions: Array<{ title: string; value: RuntimeTargetPlatform }> = [
  { title: 'iOS + Android', value: 'both' },
  { title: 'iOS', value: 'ios' },
  { title: 'Android', value: 'android' },
]

const categoryLabels: Record<RuntimeResourceBudgetCategory, string> = {
  textures: '纹理',
  geometry: '几何',
  renderTargets: '渲染目标',
  assetBuffers: '资产缓冲',
  runtimeBase: '运行时基础',
  effectsGround: '效果/地面',
}

const levelMeta = computed(() => {
  const level = props.report?.level ?? 'ok'
  if (level === 'critical') {
    return { label: '严重告警', color: 'error' }
  }
  if (level === 'warning') {
    return { label: '告警', color: 'warning' }
  }
  return { label: '正常', color: 'success' }
})

const categoryRows = computed(() => {
  const categories = props.report?.categories ?? []
  return categories.map((category) => ({
    ...category,
    label: categoryLabels[category.category] ?? category.category,
    percent: Math.max(0, Math.min(100, Math.round(category.ratio * 100))),
  }))
})

const totalPercent = computed(() => {
  const ratio = props.report?.totalRatio ?? 0
  return Math.max(0, Math.min(100, Math.round(ratio * 100)))
})

function formatBytes(value: number | null | undefined): string {
  const bytes = Number.isFinite(value) ? Math.max(0, Number(value)) : 0
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  const digits = index === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2
  return `${size.toFixed(digits)} ${units[index]}`
}

function formatAssetName(name: string | null): string {
  return name?.trim() || '未命名资源'
}

function handleProfileChange(value: unknown): void {
  emit('update:profileId', value as RuntimeResourceBudgetProfileId)
}

function handlePlatformChange(value: unknown): void {
  emit('update:targetPlatform', value as RuntimeTargetPlatform)
}
</script>

<template>
  <div class="runtime-budget-panel" :class="{ 'runtime-budget-panel--compact': compact }">
    <div v-if="showControls !== false" class="runtime-budget-panel__toolbar">
      <v-select
        :model-value="profileId"
        :items="profileOptions"
        item-title="title"
        item-value="value"
        label="预算档位"
        density="compact"
        hide-details
        class="runtime-budget-panel__select"
        @update:model-value="handleProfileChange($event)"
      />
      <v-select
        :model-value="targetPlatform"
        :items="platformOptions"
        item-title="title"
        item-value="value"
        label="目标平台"
        density="compact"
        hide-details
        class="runtime-budget-panel__select"
        @update:model-value="handlePlatformChange($event)"
      />
    </div>

    <template v-if="report">
      <div class="runtime-budget-panel__summary">
        <div>
          <span class="runtime-budget-panel__label">场景估算</span>
          <span class="runtime-budget-panel__value">{{ formatBytes(report.totalBytes) }}</span>
          <span class="runtime-budget-panel__budget">/ {{ formatBytes(report.totalBudgetBytes) }}</span>
        </div>
        <v-chip :color="levelMeta.color" size="small" variant="tonal">
          {{ levelMeta.label }}
        </v-chip>
      </div>

      <v-progress-linear
        :model-value="totalPercent"
        :color="levelMeta.color"
        height="8"
        rounded
        class="runtime-budget-panel__total-progress"
      />

      <div class="runtime-budget-panel__thresholds">
        警告 {{ formatBytes(report.warningBytes) }} · 严重 {{ formatBytes(report.criticalBytes) }}
      </div>

      <div class="runtime-budget-panel__categories">
        <div
          v-for="row in categoryRows"
          :key="row.category"
          class="runtime-budget-panel__category"
        >
          <div class="runtime-budget-panel__category-header">
            <span>{{ row.label }}</span>
            <span>{{ formatBytes(row.bytes) }} / {{ formatBytes(row.budgetBytes) }}</span>
          </div>
          <v-progress-linear
            :model-value="row.percent"
            :color="row.level === 'critical' ? 'error' : row.level === 'warning' ? 'warning' : 'success'"
            height="5"
            rounded
          />
        </div>
      </div>

      <div v-if="report.topConsumers.length" class="runtime-budget-panel__top">
        <div class="runtime-budget-panel__section-title">资源占用 Top</div>
        <div
          v-for="consumer in report.topConsumers.slice(0, 5)"
          :key="`${consumer.category}:${consumer.assetId ?? 'none'}:${consumer.bytes}`"
          class="runtime-budget-panel__consumer"
        >
          <span class="runtime-budget-panel__consumer-name">{{ formatAssetName(consumer.name) }}</span>
          <span class="runtime-budget-panel__consumer-category">{{ categoryLabels[consumer.category] }}</span>
          <span class="runtime-budget-panel__consumer-bytes">{{ formatBytes(consumer.bytes) }}</span>
        </div>
      </div>
    </template>

    <div v-else class="runtime-budget-panel__empty">
      当前场景暂未生成预算估算。
    </div>
  </div>
</template>

<style scoped>
.runtime-budget-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 260px;
  max-width: 420px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(5, 12, 24, 0.88);
  color: #e9ecf1;
}

.runtime-budget-panel--compact {
  min-width: 240px;
  max-width: 320px;
}

.runtime-budget-panel__toolbar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.runtime-budget-panel__select {
  min-width: 0;
}

.runtime-budget-panel__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.runtime-budget-panel__label,
.runtime-budget-panel__section-title {
  color: rgba(214, 228, 249, 0.66);
  font-size: 0.76rem;
}

.runtime-budget-panel__value {
  margin-left: 8px;
  color: #fff;
  font-weight: 650;
}

.runtime-budget-panel__budget,
.runtime-budget-panel__thresholds {
  color: rgba(214, 228, 249, 0.54);
  font-size: 0.76rem;
}

.runtime-budget-panel__thresholds {
  margin-top: -2px;
}

.runtime-budget-panel__categories {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.runtime-budget-panel__category-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  color: rgba(224, 234, 250, 0.78);
  font-size: 0.78rem;
}

.runtime-budget-panel__top {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.runtime-budget-panel__section-title {
  margin-top: 2px;
}

.runtime-budget-panel__consumer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  font-size: 0.76rem;
}

.runtime-budget-panel__consumer-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runtime-budget-panel__consumer-category {
  color: rgba(214, 228, 249, 0.54);
}

.runtime-budget-panel__consumer-bytes {
  color: #d9efff;
}

.runtime-budget-panel__empty {
  color: rgba(214, 228, 249, 0.54);
  font-size: 0.8rem;
}
</style>
