<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import { useBuildToolsStore } from '@/stores/buildToolsStore'
import {
  PROCEDURAL_LANDSCAPE_COMPONENT_TYPE,
  createProceduralLandscapeComponentState,
} from '@schema/components'
import {
  clampProceduralLandscapeProps,
  type ProceduralLandscapeComponentProps,
} from '@schema/proceduralLandscape/config'
import {
  getProceduralLandscapeStats,
  type ProceduralLandscapeRuntimeStats,
} from '@schema/proceduralLandscape/runtime'

const sceneStore = useSceneStore()
const buildToolsStore = useBuildToolsStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)
const { activeBuildTool } = storeToRefs(buildToolsStore)

const landscapeComponent = computed(
  () => selectedNode.value?.components?.[PROCEDURAL_LANDSCAPE_COMPONENT_TYPE] as
    | SceneNodeComponentState<ProceduralLandscapeComponentProps>
    | undefined,
)

const componentEnabled = computed(() => landscapeComponent.value?.enabled !== false)

const propsValue = computed<ProceduralLandscapeComponentProps | null>(() => {
  const component = landscapeComponent.value
  if (!component) {
    return null
  }
  return clampProceduralLandscapeProps(component.props, selectedNodeId.value ?? '')
})

function patch(patchValue: Partial<Record<string, unknown>>): void {
  const component = landscapeComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patchValue)
}

function patchGroup(group: keyof ProceduralLandscapeComponentProps, values: Record<string, unknown>): void {
  const current = propsValue.value
  if (!current) {
    return
  }
  patch({ [group]: { ...(current[group] as unknown as Record<string, unknown>), ...values } })
}

function handleToggleComponent(): void {
  const component = landscapeComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent(): void {
  const component = landscapeComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function handleResetProps(): void {
  const node = selectedNode.value
  if (!node) {
    return
  }
  const defaults = createProceduralLandscapeComponentState(node)
  patch(defaults.props as unknown as Partial<Record<string, unknown>>)
}

function handleRandomizeSeed(): void {
  patch({ seed: Math.floor(Math.random() * 0xffffffff) >>> 0 })
}

function handleRegenerate(): void {
  const current = propsValue.value
  if (!current) {
    return
  }
  patch({ generationRevision: (current.generationRevision ?? 0) + 1 })
}

const roadWaypoints = computed(() => propsValue.value?.road.waypoints ?? [])
const roadPathEditing = computed(
  () => componentEnabled.value && activeBuildTool.value === 'landscapeRoad' && Boolean(landscapeComponent.value),
)

function handleToggleRoadPathEditing(): void {
  if (!componentEnabled.value || !landscapeComponent.value) {
    return
  }
  buildToolsStore.setActiveBuildTool(roadPathEditing.value ? null : 'landscapeRoad')
}

function handleRemoveRoadWaypoint(index: number): void {
  const nodeId = selectedNodeId.value
  const current = propsValue.value?.road.waypoints ?? []
  if (!nodeId || index < 0 || index >= current.length) {
    return
  }
  sceneStore.updateProceduralLandscapeRoadWaypoints(
    nodeId,
    current.filter((_, entryIndex) => entryIndex !== index),
  )
}

function handleClearRoadPath(): void {
  const nodeId = selectedNodeId.value
  if (!nodeId) {
    return
  }
  sceneStore.updateProceduralLandscapeRoadWaypoints(nodeId, [])
}

interface NumericField {
  key: string
  label: string
  step?: number
  nullable?: boolean
}

const samplingFields: NumericField[] = [
  { key: 'sampleCellSize', label: '采样格网 (m)', step: 0.5 },
  { key: 'maxSampleGridSize', label: '最大采样数/轴', step: 128 },
]

const roadFields: NumericField[] = [
  { key: 'width', label: '路面宽度 (m)', step: 0.5 },
  { key: 'shoulderWidth', label: '路肩宽度 (m)', step: 0.1 },
  { key: 'stepLength', label: '追踪步长 (m)', step: 1 },
  { key: 'feelDistance', label: '探测距离 (m)', step: 1 },
  { key: 'feelAngleDeg', label: '探测角度 (°)', step: 1 },
  { key: 'maxSlope', label: '最大坡度', step: 0.05 },
  { key: 'maxTurnDeg', label: '每步最大转角 (°)', step: 0.5 },
  { key: 'maxLength', label: '最大长度 (m，空=到边界)', step: 16, nullable: true },
  { key: 'flattenBand', label: '视觉压平带宽 (m)', step: 0.5 },
  { key: 'flattenStrength', label: '视觉压平强度', step: 0.05 },
  { key: 'startX', label: '起点 X（空=居中）', step: 1, nullable: true },
  { key: 'startZ', label: '起点 Z（空=居中）', step: 1, nullable: true },
  { key: 'headingDeg', label: '初始朝向 (°，空=按种子)', step: 5, nullable: true },
  { key: 'waypointTolerance', label: '途经容差 (m)', step: 2 },
]

const forestFields: NumericField[] = [
  { key: 'coverage', label: '森林覆盖率', step: 0.05 },
  { key: 'scale', label: '密度噪声尺度 (m)', step: 20 },
  { key: 'seedOffset', label: '种子偏移', step: 1 },
  { key: 'density', label: '树木密度倍率', step: 0.05 },
  { key: 'maxSlope', label: '最大坡度阈值', step: 0.02 },
  { key: 'roadClearance', label: '距路净空 (m)', step: 0.5 },
  { key: 'minScale', label: '树木最小高度 (m)', step: 0.5 },
  { key: 'maxScale', label: '树木最大高度 (m)', step: 0.5 },
  { key: 'nearDistance', label: '近树卡距离 (m，空=按档位)', step: 10, nullable: true },
  { key: 'nearTreeRadius', label: '近树 3D 半径 (m，0=关)', step: 5 },
  { key: 'minHeight', label: '最低高度 (m，空=不限)', step: 1, nullable: true },
]

const grassFields: NumericField[] = [
  { key: 'corridorWidth', label: '道路走廊宽度 (m)', step: 1 },
  { key: 'cameraRadius', label: '摄像机补足半径 (m)', step: 4 },
  { key: 'density', label: '草密度倍率', step: 0.05 },
  { key: 'sinkNearRoad', label: '靠路下沉 (m)', step: 0.1 },
  { key: 'flowerDensity', label: '花草密度倍率', step: 0.05 },
  { key: 'tallGrassDensity', label: '高草密度倍率', step: 0.05 },
]

const bushFields: NumericField[] = [
  { key: 'density', label: '灌木密度倍率', step: 0.05 },
]

const surfaceFields: NumericField[] = [
  { key: 'blendStrength', label: '混合强度', step: 0.05 },
  { key: 'uvScale', label: '世界 UV 尺度 (m)', step: 1 },
  { key: 'rockSlopeThreshold', label: '岩石坡度阈值', step: 0.02 },
  { key: 'viewDistanceScale', label: '雾尺度倍率（空=按地形自动）', step: 0.5, nullable: true },
]

const barrierFields: NumericField[] = [
  { key: 'density', label: '护栏密度', step: 0.05 },
  { key: 'spacing', label: '同侧间隔 (m)', step: 1 },
  { key: 'dropThreshold', label: '落差阈值 (m)', step: 0.1 },
]

const waterFields: NumericField[] = [
  { key: 'levelOffset', label: '水线偏移 (m，相对地形最低点)', step: 0.5 },
]

const windFields: NumericField[] = [
  { key: 'strength', label: '风强度', step: 0.1 },
]

const qualityOptions = [
  { label: '自动（按运行端）', value: 'auto' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
]

function fieldValue(group: keyof ProceduralLandscapeComponentProps, key: string): number | null {
  const current = propsValue.value
  if (!current) {
    return null
  }
  const value = (current[group] as unknown as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function handleNumberInput(group: keyof ProceduralLandscapeComponentProps, field: NumericField, raw: string | number | null): void {
  const text = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw)
  if (!text.length) {
    if (field.nullable) {
      patchGroup(group, { [field.key]: null })
    }
    return
  }
  const numeric = Number(text)
  if (!Number.isFinite(numeric)) {
    return
  }
  patchGroup(group, { [field.key]: numeric })
}

function handleQualityChange(value: string | null): void {
  if (value === 'auto' || value === 'low' || value === 'medium' || value === 'high') {
    patch({ quality: value })
  }
}

function handleColorInput(key: 'grassTint' | 'forestTint' | 'roadTint' | 'gravelTint', value: string): void {
  patchGroup('surface', { [key]: value })
}

const stats = ref<ProceduralLandscapeRuntimeStats | null>(null)
let statsTimer: ReturnType<typeof setInterval> | null = null

function refreshStats(): void {
  const nodeId = selectedNodeId.value
  stats.value = nodeId ? getProceduralLandscapeStats(nodeId) : null
}

onMounted(() => {
  refreshStats()
  statsTimer = setInterval(refreshStats, 500)
})

onBeforeUnmount(() => {
  if (statsTimer != null) {
    clearInterval(statsTimer)
    statsTimer = null
  }
})

watch(selectedNodeId, refreshStats)

const statsRows = computed(() => {
  const value = stats.value
  if (!value) {
    return []
  }
  const memoryMb = (value.memoryBytes / (1024 * 1024)).toFixed(1)
  const rows: Array<{ label: string; value: string }> = [
    { label: '阶段', value: phaseLabel(value.phase) },
    { label: '季节', value: `${value.season}${value.seasonAssetsReady ? '' : '（加载中）'}` },
    { label: '素材档位', value: value.assetVariant === '2048' ? '@2048' : '完整' },
    { label: '素材下载', value: `${(value.assetDownloadedBytes / (1024 * 1024)).toFixed(1)} MB` },
    { label: '近树 3D', value: String(value.nearTreeInstances) },
    { label: '护栏', value: String(value.barrierInstances) },
    { label: '水面', value: value.waterEnabled ? '开' : '关' },
    { label: '雾尺度倍率', value: `${value.viewDistanceScale.toFixed(2)}x` },
    { label: '质量档', value: value.quality },
    { label: '树实例', value: String(value.treeInstances) },
    { label: '草实例', value: String(value.grassInstances) },
    { label: '灌木实例', value: String(value.bushInstances) },
    {
      label: '分块数',
      value: `${value.batchCount}（树 ${value.treeChunkCount} / 路 ${value.roadChunkCount} / 相机草 ${value.cameraGrassChunkCount}）`,
    },
    { label: '采样网格', value: value.gridCols ? `${value.gridCols} x ${value.gridRows} @ ${value.gridCellSize.toFixed(2)}m` : '-' },
    { label: '平均边长', value: value.averageEdgeLength ? `${value.averageEdgeLength.toFixed(2)}m` : '-' },
    { label: '内存估算', value: `${memoryMb} MB` },
    { label: '道路长度', value: value.roadLength ? `${Math.round(value.roadLength)}m（${value.roadNodeCount} 节点）` : '未生成' },
    { label: '道路状态', value: value.roadFailureReason ? value.roadFailureReason : value.roadComplete ? '完成' : '-' },
  ]
  if (value.phase === 'sampling') {
    rows.unshift({ label: '采样进度', value: `${Math.round(value.progress * 100)}%` })
  }
  return rows
})

function phaseLabel(phase: ProceduralLandscapeRuntimeStats['phase']): string {
  switch (phase) {
    case 'sampling':
      return '采样地形'
    case 'generating':
      return '生成中'
    case 'streaming':
      return '流式生成'
    case 'error':
      return '错误'
    case 'disabled':
      return '已禁用'
    default:
      return '空闲'
  }
}
</script>

<template>
  <v-expansion-panel :value="PROCEDURAL_LANDSCAPE_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="pl-panel__header">
        <span class="pl-panel__title">Procedural Landscape</span>
        <v-spacer />
        <v-menu v-if="landscapeComponent" location="bottom end" origin="auto" transition="fade-transition">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon variant="text" size="small" class="component-menu-btn" @click.stop>
              <v-icon size="18">mdi-dots-vertical</v-icon>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item @click.stop="handleToggleComponent">
              <v-list-item-title>{{ componentEnabled ? 'Disable' : 'Enable' }}</v-list-item-title>
            </v-list-item>
            <v-list-item @click.stop="handleResetProps">
              <v-list-item-title>Reset to defaults</v-list-item-title>
            </v-list-item>
            <v-divider inset />
            <v-list-item @click.stop="handleRemoveComponent">
              <v-list-item-title>Remove</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div v-if="propsValue" class="pl-panel">
        <div class="pl-section">
          <div class="pl-section__title">生成</div>
          <div class="pl-row">
            <v-text-field
              :model-value="propsValue.seed"
              label="种子"
              density="compact"
              variant="underlined"
              type="number"
              hide-details
              :disabled="!componentEnabled"
              @update:model-value="(value) => patch({ seed: Math.max(0, Math.round(Number(value) || 0)) })"
            />
            <v-btn size="small" variant="text" :disabled="!componentEnabled" @click="handleRandomizeSeed">随机</v-btn>
            <v-btn size="small" variant="tonal" :disabled="!componentEnabled" @click="handleRegenerate">重新生成</v-btn>
          </div>
          <div class="pl-row">
            <v-select
              :model-value="propsValue.quality"
              label="质量档"
              density="compact"
              variant="underlined"
              hide-details
              :items="qualityOptions"
              item-title="label"
              item-value="value"
              :disabled="!componentEnabled"
              @update:model-value="handleQualityChange"
            />
          </div>
          <div class="pl-grid">
            <v-text-field
              v-for="field in samplingFields"
              :key="field.key"
              :model-value="fieldValue('sampling', field.key)"
              :label="field.label"
              density="compact"
              variant="underlined"
              type="number"
              hide-details
              :step="field.step"
              :disabled="!componentEnabled"
              @update:model-value="(value) => handleNumberInput('sampling', field, value)"
            />
          </div>
        </div>

        <div class="pl-section">
          <div class="pl-section__title">
            公路
            <v-switch
              :model-value="propsValue.road.enabled"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('road', { enabled: value !== false })"
            />
          </div>
          <div class="pl-road-path">
            <div class="pl-road-path__actions">
              <button
                type="button"
                class="pl-choice"
                :class="{ 'pl-choice--active': roadPathEditing }"
                :disabled="!componentEnabled"
                @click="handleToggleRoadPathEditing"
              >{{ roadPathEditing ? '结束绘制' : '绘制路径' }}</button>
              <button
                type="button"
                class="pl-choice"
                :disabled="!componentEnabled || !roadWaypoints.length"
                @click="handleClearRoadPath"
              >清除路径</button>
              <span class="pl-road-path__count">路径点 {{ roadWaypoints.length }}</span>
            </div>
            <div v-if="roadWaypoints.length" class="pl-road-path__list">
              <div
                v-for="(waypoint, index) in roadWaypoints"
                :key="`${selectedNode?.id ?? 'road'}:${index}`"
                class="pl-road-path__item"
              >
                <span class="pl-road-path__index">P{{ index + 1 }}</span>
                <span class="pl-road-path__coords">{{ waypoint.x.toFixed(1) }}, {{ waypoint.z.toFixed(1) }}</span>
                <v-btn
                  icon
                  variant="text"
                  density="compact"
                  :disabled="!componentEnabled"
                  @click="handleRemoveRoadWaypoint(index)"
                >
                  <v-icon size="16">mdi-delete</v-icon>
                </v-btn>
              </div>
            </div>
          </div>
          <div class="pl-grid">
            <v-text-field
              v-for="field in roadFields"
              :key="field.key"
              :model-value="fieldValue('road', field.key)"
              :label="field.label"
              density="compact"
              variant="underlined"
              type="number"
              hide-details
              :step="field.step"
              :disabled="!componentEnabled"
              @update:model-value="(value) => handleNumberInput('road', field, value)"
            />
          </div>
        </div>

        <div class="pl-section">
          <div class="pl-section__title">森林 / 树木</div>
          <div class="pl-grid">
            <v-text-field
              v-for="field in forestFields"
              :key="field.key"
              :model-value="fieldValue('forest', field.key)"
              :label="field.label"
              density="compact"
              variant="underlined"
              type="number"
              hide-details
              :step="field.step"
              :disabled="!componentEnabled"
              @update:model-value="(value) => handleNumberInput('forest', field, value)"
            />
          </div>
        </div>

        <div class="pl-section">
          <div class="pl-section__title">
            草
            <v-switch
              :model-value="propsValue.grass.enabled"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('grass', { enabled: value !== false })"
            />
          </div>
          <div class="pl-grid">
            <v-text-field
              v-for="field in grassFields"
              :key="field.key"
              :model-value="fieldValue('grass', field.key)"
              :label="field.label"
              density="compact"
              variant="underlined"
              type="number"
              hide-details
              :step="field.step"
              :disabled="!componentEnabled"
              @update:model-value="(value) => handleNumberInput('grass', field, value)"
            />
          </div>
        </div>

        <div class="pl-section">
          <div class="pl-section__title">
            灌木
            <v-switch
              :model-value="propsValue.bushes.enabled"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('bushes', { enabled: value !== false })"
            />
          </div>
          <div class="pl-grid">
            <v-text-field
              v-for="field in bushFields"
              :key="field.key"
              :model-value="fieldValue('bushes', field.key)"
              :label="field.label"
              density="compact"
              variant="underlined"
              type="number"
              hide-details
              :step="field.step"
              :disabled="!componentEnabled"
              @update:model-value="(value) => handleNumberInput('bushes', field, value)"
            />
          </div>
        </div>

        <div class="pl-section">
          <div class="pl-section__title">
            树冠色斑
            <v-switch
              :model-value="propsValue.canopy.enabled"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('canopy', { enabled: value !== false })"
            />
          </div>
        </div>

        <div class="pl-section">
          <div class="pl-section__title">
            水面
            <v-switch
              :model-value="propsValue.water.enabled"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('water', { enabled: value !== false })"
            />
          </div>
          <div class="pl-grid">
            <v-text-field
              v-for="field in waterFields"
              :key="field.key"
              :model-value="fieldValue('water', field.key)"
              :label="field.label"
              density="compact"
              variant="underlined"
              type="number"
              hide-details
              :step="field.step"
              :disabled="!componentEnabled"
              @update:model-value="(value) => handleNumberInput('water', field, value)"
            />
          </div>
        </div>

        <div class="pl-section">
          <div class="pl-section__title">
            护栏
            <v-switch
              :model-value="propsValue.barrier.enabled"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('barrier', { enabled: value !== false })"
            />
          </div>
          <div class="pl-grid">
            <v-text-field
              v-for="field in barrierFields"
              :key="field.key"
              :model-value="fieldValue('barrier', field.key)"
              :label="field.label"
              density="compact"
              variant="underlined"
              type="number"
              hide-details
              :step="field.step"
              :disabled="!componentEnabled"
              @update:model-value="(value) => handleNumberInput('barrier', field, value)"
            />
          </div>
        </div>

        <div class="pl-section">
          <div class="pl-section__title">
            风摆
            <v-switch
              :model-value="propsValue.wind.enabled"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('wind', { enabled: value !== false })"
            />
          </div>
          <div class="pl-grid">
            <v-text-field
              v-for="field in windFields"
              :key="field.key"
              :model-value="fieldValue('wind', field.key)"
              :label="field.label"
              density="compact"
              variant="underlined"
              type="number"
              hide-details
              :step="field.step"
              :disabled="!componentEnabled"
              @update:model-value="(value) => handleNumberInput('wind', field, value)"
            />
          </div>
        </div>

        <div class="pl-section">
          <div class="pl-section__title">
            地表混合
            <v-switch
              :model-value="propsValue.surface.enabled"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('surface', { enabled: value !== false })"
            />
            <v-switch
              :model-value="propsValue.surface.textures"
              label="地表贴图"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('surface', { textures: value !== false })"
            />
          </div>
          <div class="pl-grid">
            <v-text-field
              v-for="field in surfaceFields"
              :key="field.key"
              :model-value="fieldValue('surface', field.key)"
              :label="field.label"
              density="compact"
              variant="underlined"
              type="number"
              hide-details
              :step="field.step"
              :disabled="!componentEnabled"
              @update:model-value="(value) => handleNumberInput('surface', field, value)"
            />
          </div>
          <div class="pl-row pl-row--colors">
            <label class="pl-color">
              <span>草地色</span>
              <input
                type="color"
                :value="propsValue.surface.grassTint"
                :disabled="!componentEnabled"
                @input="(event) => handleColorInput('grassTint', (event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="pl-color">
              <span>树冠色</span>
              <input
                type="color"
                :value="propsValue.surface.forestTint"
                :disabled="!componentEnabled"
                @input="(event) => handleColorInput('forestTint', (event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="pl-color">
              <span>路面色</span>
              <input
                type="color"
                :value="propsValue.surface.roadTint"
                :disabled="!componentEnabled"
                @input="(event) => handleColorInput('roadTint', (event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="pl-color">
              <span>碎石色</span>
              <input
                type="color"
                :value="propsValue.surface.gravelTint"
                :disabled="!componentEnabled"
                @input="(event) => handleColorInput('gravelTint', (event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </div>

        <div class="pl-section">
          <div class="pl-section__title">素材（在线资产包）</div>
          <div class="pl-toggle-row">
            <span class="pl-toggle-row__label">基色模式</span>
            <button
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': propsValue.surface.baseMapMode !== 'blend' }"
              :disabled="!componentEnabled"
              @click="patchGroup('surface', { baseMapMode: 'replace' })"
            >官方覆盖</button>
            <button
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': propsValue.surface.baseMapMode === 'blend' }"
              :disabled="!componentEnabled"
              @click="patchGroup('surface', { baseMapMode: 'blend' })"
            >叠加航拍底图</button>
          </div>
          <v-slider
            v-if="propsValue.surface.baseMapMode === 'blend'"
            :model-value="propsValue.surface.baseMapBlend"
            :min="0"
            :max="1"
            :step="0.05"
            density="compact"
            hide-details
            color="primary"
            :disabled="!componentEnabled"
            label="底图混合强度"
            @update:model-value="(value) => patchGroup('surface', { baseMapBlend: Number(value) })"
          />
        </div>

        <div class="pl-section">
          <div class="pl-section__title">调试</div>
          <v-switch
            :model-value="propsValue.debug.showRoadPath"
            label="显示道路路径"
            density="compact"
            hide-details
            color="primary"
            :disabled="!componentEnabled"
            @update:model-value="(value) => patchGroup('debug', { showRoadPath: value === true })"
          />
          <v-switch
            :model-value="propsValue.debug.showChunks"
            label="显示分块范围"
            density="compact"
            hide-details
            color="primary"
            :disabled="!componentEnabled"
            @update:model-value="(value) => patchGroup('debug', { showChunks: value === true })"
          />
        </div>

      </div>

    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.pl-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.pl-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.pl-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.pl-section {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.pl-section__title {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: rgba(233, 236, 241, 0.88);
}

.pl-section__hint {
  font-size: 0.72rem;
  color: rgba(233, 236, 241, 0.6);
}

.pl-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.pl-row :deep(.v-text-field) {
  flex: 1;
}

.pl-row--colors {
  flex-wrap: wrap;
}

.pl-color {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.76rem;
  color: rgba(233, 236, 241, 0.75);
}

.pl-color input[type='color'] {
  width: 28px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.pl-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.2rem 0.6rem;
}

.pl-slot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.3rem 0.4rem;
  border: 1px dashed rgba(148, 163, 184, 0.35);
  border-radius: 6px;
}

.pl-slot.is-active {
  border-color: rgba(96, 165, 250, 0.9);
  background: rgba(59, 130, 246, 0.12);
}

.pl-slot.is-disabled {
  opacity: 0.55;
}

.pl-slot__label {
  font-size: 0.76rem;
  color: rgba(233, 236, 241, 0.8);
}

.pl-slot__assets {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.pl-slot__thumb {
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid rgba(148, 163, 184, 0.4);
  border-radius: 4px;
  background-color: rgba(69, 90, 100, 0.9);
  background-size: cover;
  background-position: center;
  cursor: pointer;
}

.pl-slot__thumb--add {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(30, 41, 59, 0.6);
  color: rgba(233, 236, 241, 0.8);
}

.pl-stats {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.pl-toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
}

.pl-toggle-row__label {
  font-size: 0.78rem;
  color: rgba(159, 181, 199, 0.9);
}

.pl-choice {
  border: 1px solid rgba(126, 148, 168, 0.45);
  background: transparent;
  color: rgba(214, 226, 236, 0.9);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 0.76rem;
  cursor: pointer;
}

.pl-choice--active {
  border-color: rgba(88, 160, 232, 0.9);
  background: rgba(88, 160, 232, 0.18);
  color: #ffffff;
}

.pl-road-path {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin-bottom: 0.35rem;
}

.pl-road-path__actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.pl-road-path__count {
  font-size: 0.76rem;
  color: rgba(233, 236, 241, 0.75);
}

.pl-road-path__list {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  max-height: 150px;
  overflow-y: auto;
}

.pl-road-path__item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0 0.1rem;
  border-radius: 4px;
}

.pl-road-path__index {
  font-size: 0.72rem;
  color: rgba(255, 179, 0, 0.95);
  min-width: 24px;
}

.pl-road-path__coords {
  flex: 1;
  font-size: 0.72rem;
  color: rgba(233, 236, 241, 0.7);
}

.pl-stats__row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.76rem;
}

.pl-stats__label {
  color: rgba(233, 236, 241, 0.65);
}

.pl-stats__value {
  color: rgba(233, 236, 241, 0.92);
  text-align: right;
}

.pl-warnings {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.3rem;
}

.pl-warnings__item {
  font-size: 0.72rem;
  color: rgb(251, 191, 36);
}
</style>
