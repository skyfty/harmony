<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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
import {
  ROAD_SINGLE_TRACK_THRESHOLD,
  ROAD_WIDTH_PRESETS,
  isSingleTrackRoad,
} from '@schema/proceduralLandscape/roadStyle'
import { WATER_FLOOD_VISIBLE_FRACTION } from '@schema/proceduralLandscape/waterStats'

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

/**
 * 运行统计（只读）：远景林实例/半径、水面水位与淹没比例、雾尺度倍率。
 * 远景林覆盖近景流式半径之外的可见地形，水位诊断用来判断水面是否被地形完全遮住。
 */
const runtimeStats = ref<ProceduralLandscapeRuntimeStats | null>(null)
let runtimeStatsTimer: number | null = null

function refreshRuntimeStats(): void {
  const nodeId = selectedNodeId.value
  runtimeStats.value = nodeId ? getProceduralLandscapeStats(nodeId) : null
}

onMounted(() => {
  refreshRuntimeStats()
  runtimeStatsTimer = window.setInterval(refreshRuntimeStats, 500)
})

onBeforeUnmount(() => {
  if (runtimeStatsTimer != null) {
    window.clearInterval(runtimeStatsTimer)
    runtimeStatsTimer = null
  }
})

const waterBuriedHint = computed(() => {
  const stats = runtimeStats.value
  if (!stats || !stats.waterEnabled || stats.waterFloodedFraction >= WATER_FLOOD_VISIBLE_FRACTION) {
    return ''
  }
  return '水面被地形完全遮挡（水线 = 地形最低点 + 水线偏移）：把「水线偏移」提高到低地水位才能看到湖面。'
})

const propsValue = computed<ProceduralLandscapeComponentProps | null>(() => {
  const component = landscapeComponent.value
  if (!component) {
    return null
  }
  return clampProceduralLandscapeProps(component.props, selectedNodeId.value ?? '')
})

type LandscapeGroup = keyof ProceduralLandscapeComponentProps

function patch(patchValue: Partial<Record<string, unknown>>): void {
  const component = landscapeComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, patchValue)
}

function patchGroup(group: LandscapeGroup, values: Record<string, unknown>): void {
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
/** ≥2 个路径点才会生成道路，道路起点即路径首点。 */
const roadWaypointMode = computed(() => roadWaypoints.value.length >= 2)
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

/**
 * 单个数值输入控件。标签只保留参数名，单位走 suffix，
 * 「空=xxx」这类语义走 placeholder（仅在该字段为空时显示）。
 */
interface NumericField {
  key: string
  label: string
  step?: number
  nullable?: boolean
  suffix?: string
  placeholder?: string
}

/** 一行 1～2 个字段；只有 1 个字段时占满整行，避免半空行。 */
type FieldRow = ReadonlyArray<NumericField>

/** 字段分组：可选子标题 + 若干行。 */
interface FieldBlock {
  title?: string
  /** 子标题下方的一行说明。 */
  hint?: string
  rows: FieldRow[]
}

/** 数据驱动区块：标题 + 可选启用开关 + 字段分组。 */
interface FieldSection {
  group: LandscapeGroup
  title: string
  withSwitch?: boolean
  blocks: FieldBlock[]
}

const qualityOptions = [
  { label: '自动（按运行端）', value: 'auto' },
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
]

// 生成区块：种子行与质量档是手写标记，采样参数走下面的分组数据。
const samplingBlocks: FieldBlock[] = [
  {
    rows: [
      [
        { key: 'sampleCellSize', label: '采样格网', suffix: 'm', step: 0.5 },
        { key: 'maxSampleGridSize', label: '每轴最大采样', step: 128 },
      ],
    ],
  },
]

// 公路区块的「路径」工具与路径点列表是手写标记，会插在这些分组之前。
// 道路起点与朝向完全由手绘路径决定，这里只保留跟随参数。
const roadPathBlock = computed<FieldBlock>(() => ({
  title: '路径',
  hint: roadWaypointMode.value ? undefined : '至少 2 个路径点才会生成道路',
  rows: [[{ key: 'waypointTolerance', label: '途经容差', suffix: 'm', step: 2 }]],
}))

// 官方路型预设（`roadStyle.ROAD_WIDTH_PRESETS`）。路型由路宽自动决定：
// < 2.25m 走单车道贴图（`roadSingle`，无划线），否则走宽路贴图 + 划线。
const roadWidthPresets = [
  { label: '单车道 1.8m', width: ROAD_WIDTH_PRESETS.narrow },
  { label: '常规 3.2m', width: ROAD_WIDTH_PRESETS.regular },
  { label: '宽路 4.0m', width: ROAD_WIDTH_PRESETS.wide },
] as const

const roadSingleTrack = computed(() => {
  const width = propsValue.value?.road.width
  return typeof width === 'number' && isSingleTrackRoad(width)
})

const roadStyleHint = computed(() => (
  roadSingleTrack.value
    ? `单车道材质（无划线，路宽 < ${ROAD_SINGLE_TRACK_THRESHOLD}m）`
    : '宽路材质 + 划线'
))

function isRoadWidthPresetActive(width: number): boolean {
  const current = propsValue.value?.road.width
  return typeof current === 'number' && Math.abs(current - width) < 1e-6
}

function handleRoadWidthPreset(width: number): void {
  patchGroup('road', { width })
}

const roadGeometryBlocks: FieldBlock[] = [
  {
    title: '几何',
    rows: [
      [
        { key: 'width', label: '路面宽度', suffix: 'm', step: 0.5 },
        { key: 'shoulderWidth', label: '路肩宽度', suffix: 'm', step: 0.1 },
      ],
    ],
  },
  {
    title: '追踪',
    rows: [
      [
        { key: 'stepLength', label: '追踪步长', suffix: 'm', step: 1 },
        { key: 'feelDistance', label: '探测距离', suffix: 'm', step: 1 },
      ],
      [
        { key: 'feelAngleDeg', label: '探测角度', suffix: '°', step: 1 },
        { key: 'maxTurnDeg', label: '最大转角', suffix: '°', step: 0.5 },
      ],
      [
        { key: 'maxSlope', label: '最大坡度', step: 0.05 },
        { key: 'maxLength', label: '最大长度', suffix: 'm', placeholder: '到边界', step: 16, nullable: true },
      ],
    ],
  },
  {
    title: '贴合',
    rows: [
      [
        { key: 'flattenBand', label: '压平带宽', suffix: 'm', step: 0.5 },
        { key: 'flattenStrength', label: '压平强度', step: 0.05 },
      ],
    ],
  },
]

const roadBlocks = computed<FieldBlock[]>(() => [roadPathBlock.value, ...roadGeometryBlocks])

// 地表区块：颜色与基色模式是手写标记，混合参数走下面的分组数据。
const surfaceBlocks: FieldBlock[] = [
  {
    title: '混合',
    rows: [
      [
        { key: 'blendStrength', label: '混合强度', step: 0.05 },
        { key: 'uvScale', label: 'UV 尺度', suffix: 'm', step: 1 },
      ],
      [
        { key: 'rockSlopeThreshold', label: '岩石坡度', step: 0.02 },
        { key: 'viewDistanceScale', label: '雾尺度', suffix: '×', placeholder: '自动', step: 0.5, nullable: true },
      ],
    ],
  },
]

/**
 * 路侧墙体（官方 WallController）四个分项：干砌石墙 / 木栏 / 硬护栏 / 混凝土海墙。
 * 旧版「护栏」组（下坡落差近似）已废弃，其 enabled / density 在 config 里映射到
 * 本组（`walls.drystone.density` 等）。
 */
const wallKinds = [
  { key: 'drystone', label: '干砌石墙' },
  { key: 'fence', label: '木栏' },
  { key: 'barrier', label: '硬护栏' },
  { key: 'seaWall', label: '混凝土海墙' },
] as const

type WallKind = (typeof wallKinds)[number]['key']

/** 「地表」之后的区块，全部由描述数据渲染。 */
const featureSections: FieldSection[] = [
  {
    group: 'forest',
    title: '森林 / 树木',
    blocks: [
      {
        title: '分布',
        rows: [
          [
            { key: 'coverage', label: '森林覆盖率', step: 0.05 },
            { key: 'scale', label: '噪声尺度', suffix: 'm', step: 20 },
          ],
          [
            { key: 'density', label: '树木密度', suffix: '×', step: 0.05 },
            { key: 'seedOffset', label: '种子偏移', step: 1 },
          ],
          [
            { key: 'maxSlope', label: '最大坡度', step: 0.02 },
            { key: 'roadClearance', label: '距路净空', suffix: 'm', step: 0.5 },
          ],
          [{ key: 'minHeight', label: '最低高度', suffix: 'm', placeholder: '不限', step: 1, nullable: true }],
        ],
      },
      {
        title: '树木尺度',
        rows: [
          [
            { key: 'minScale', label: '最小高度', suffix: 'm', step: 0.5 },
            { key: 'maxScale', label: '最大高度', suffix: 'm', step: 0.5 },
          ],
        ],
      },
      {
        title: '近景',
        rows: [
          [
            { key: 'nearDistance', label: '近树卡距离', suffix: 'm', placeholder: '按档位', step: 10, nullable: true },
            { key: 'nearTreeRadius', label: '近树 3D 半径', suffix: 'm', placeholder: '0 = 关闭', step: 5 },
          ],
        ],
      },
    ],
  },
  {
    group: 'grass',
    title: '草',
    withSwitch: true,
    blocks: [
      {
        rows: [
          [
            { key: 'corridorWidth', label: '走廊宽度', suffix: 'm', step: 1 },
            { key: 'cameraRadius', label: '相机补足半径', suffix: 'm', step: 4 },
          ],
          [
            { key: 'density', label: '草密度', suffix: '×', step: 0.05 },
            { key: 'sinkNearRoad', label: '靠路下沉', suffix: 'm', step: 0.1 },
          ],
          [
            { key: 'flowerDensity', label: '花草密度', suffix: '×', step: 0.05 },
            { key: 'tallGrassDensity', label: '高草密度', suffix: '×', step: 0.05 },
          ],
        ],
      },
    ],
  },
  {
    group: 'bushes',
    title: '灌木',
    withSwitch: true,
    blocks: [
      {
        rows: [[{ key: 'density', label: '灌木密度', suffix: '×', step: 0.05 }]],
      },
    ],
  },
  {
    group: 'canopy',
    title: '树冠色斑',
    withSwitch: true,
    blocks: [],
  },
  {
    group: 'water',
    title: '水面',
    withSwitch: true,
    blocks: [
      {
        rows: [[{ key: 'levelOffset', label: '水线偏移', suffix: 'm', placeholder: '相对地形最低点', step: 0.5 }]],
      },
    ],
  },
  {
    group: 'wind',
    title: '风摆',
    withSwitch: true,
    blocks: [
      {
        rows: [[{ key: 'strength', label: '风强度', step: 0.1 }]],
      },
    ],
  },
]

function fieldValue(group: LandscapeGroup, key: string): number | null {
  const current = propsValue.value
  if (!current) {
    return null
  }
  const value = (current[group] as unknown as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sectionEnabled(group: LandscapeGroup): boolean {
  const current = propsValue.value
  if (!current) {
    return false
  }
  const value = (current[group] as unknown as Record<string, unknown>).enabled
  return value !== false
}

/** 墙体分项开关与密度的读写（`props.walls[kind]` 是嵌套对象）。 */
function wallEnabled(kind: WallKind): boolean {
  const current = propsValue.value
  if (!current) {
    return false
  }
  const entry = (current.walls as unknown as Record<string, { enabled?: boolean }>)[kind]
  return entry?.enabled !== false
}

function patchWall(kind: WallKind, values: Record<string, unknown>): void {
  const current = propsValue.value
  if (!current) {
    return
  }
  const walls = current.walls as unknown as Record<string, Record<string, unknown>>
  patch({ walls: { ...walls, [kind]: { ...walls[kind], ...values } } })
}

function wallDensity(): number | null {
  const current = propsValue.value
  if (!current) {
    return null
  }
  return current.walls.drystone.density
}

function handleNumberInput(group: LandscapeGroup, field: NumericField, raw: string | number | null): void {
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

   

        <!-- 生成 -->
        <div class="pl-section">
          <div class="pl-section__title">
            <span class="pl-section__name">生成</span>
          </div>
          <div class="pl-row">
            <v-text-field
              class="pl-seed"
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
          <template v-for="(block, blockIndex) in samplingBlocks" :key="`sampling-${blockIndex}`">
            <div v-if="block.title" class="pl-subtitle">{{ block.title }}</div>
            <div
              v-for="(row, rowIndex) in block.rows"
              :key="`sampling-${blockIndex}-${rowIndex}`"
              class="pl-field-row"
              :class="{ 'pl-field-row--single': row.length === 1 }"
            >
              <v-text-field
                v-for="field in row"
                :key="field.key"
                :model-value="fieldValue('sampling', field.key)"
                :label="field.label"
                :suffix="field.suffix"
                :placeholder="field.placeholder"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :step="field.step"
                :disabled="!componentEnabled"
                @update:model-value="(value) => handleNumberInput('sampling', field, value)"
              />
            </div>
          </template>
        </div>

        <!-- 公路 -->
        <div class="pl-section">
          <div class="pl-section__title">
            <span class="pl-section__name">公路</span>
            <v-switch
              class="pl-compact-switch"
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
          <div class="pl-road-style">
            <div class="pl-subtitle">路型</div>
            <div class="pl-choice-row">
              <button
                v-for="preset in roadWidthPresets"
                :key="preset.label"
                type="button"
                class="pl-choice"
                :class="{ 'pl-choice--active': isRoadWidthPresetActive(preset.width) }"
                :disabled="!componentEnabled"
                @click="handleRoadWidthPreset(preset.width)"
              >{{ preset.label }}</button>
            </div>
            <div class="pl-hint">{{ roadStyleHint }}</div>
          </div>
          <template v-for="(block, blockIndex) in roadBlocks" :key="`road-${blockIndex}`">
            <div v-if="block.title" class="pl-subtitle">{{ block.title }}</div>
            <div v-if="block.hint" class="pl-hint">{{ block.hint }}</div>
            <div
              v-for="(row, rowIndex) in block.rows"
              :key="`road-${blockIndex}-${rowIndex}`"
              class="pl-field-row"
              :class="{ 'pl-field-row--single': row.length === 1 }"
            >
              <v-text-field
                v-for="field in row"
                :key="field.key"
                :model-value="fieldValue('road', field.key)"
                :label="field.label"
                :suffix="field.suffix"
                :placeholder="field.placeholder"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :step="field.step"
                :disabled="!componentEnabled"
                @update:model-value="(value) => handleNumberInput('road', field, value)"
              />
            </div>
          </template>
        </div>

        <!-- 紧邻道路的区块（路侧墙体，官方 WallController 四类） -->
        <div class="pl-section">
          <div class="pl-section__title">
            <span class="pl-section__name">墙体</span>
          </div>
          <div v-for="kind in wallKinds" :key="kind.key" class="pl-toggle-row">
            <span class="pl-toggle-row__label">{{ kind.label }}</span>
            <v-switch
              class="pl-compact-switch"
              :model-value="wallEnabled(kind.key)"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchWall(kind.key, { enabled: value !== false })"
            />
          </div>
          <div class="pl-field-row pl-field-row--single">
            <v-text-field
              :model-value="wallDensity()"
              label="石墙密度"
              density="compact"
              variant="underlined"
              type="number"
              hide-details
              :step="0.05"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchWall('drystone', { density: Math.min(1, Math.max(0, Number(value) || 0)) })"
            />
          </div>
        </div>

        <!-- 地表（含原「素材」区块） -->
        <div class="pl-section">
          <div class="pl-section__title">
            <span class="pl-section__name">地表</span>
            <v-switch
              class="pl-compact-switch"
              :model-value="propsValue.surface.enabled"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('surface', { enabled: value !== false })"
            />
          </div>
          <div class="pl-toggle-row">
            <span class="pl-toggle-row__label">地表贴图</span>
            <v-switch
              class="pl-compact-switch"
              :model-value="propsValue.surface.textures"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('surface', { textures: value !== false })"
            />
          </div>
          <template v-for="(block, blockIndex) in surfaceBlocks" :key="`surface-${blockIndex}`">
            <div v-if="block.title" class="pl-subtitle">{{ block.title }}</div>
            <div
              v-for="(row, rowIndex) in block.rows"
              :key="`surface-${blockIndex}-${rowIndex}`"
              class="pl-field-row"
              :class="{ 'pl-field-row--single': row.length === 1 }"
            >
              <v-text-field
                v-for="field in row"
                :key="field.key"
                :model-value="fieldValue('surface', field.key)"
                :label="field.label"
                :suffix="field.suffix"
                :placeholder="field.placeholder"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :step="field.step"
                :disabled="!componentEnabled"
                @update:model-value="(value) => handleNumberInput('surface', field, value)"
              />
            </div>
          </template>
          <div class="pl-subtitle">颜色</div>
          <div class="pl-color-grid">
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
          <div class="pl-subtitle">基色模式</div>
          <div class="pl-choice-row">
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

        <!-- 植被与其他要素 -->
        <div v-for="section in featureSections" :key="section.group" class="pl-section">
          <div class="pl-section__title">
            <span class="pl-section__name">{{ section.title }}</span>
            <v-switch
              v-if="section.withSwitch"
              class="pl-compact-switch"
              :model-value="sectionEnabled(section.group)"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup(section.group, { enabled: value !== false })"
            />
          </div>
          <template v-for="(block, blockIndex) in section.blocks" :key="`${section.group}-${blockIndex}`">
            <div v-if="block.title" class="pl-subtitle">{{ block.title }}</div>
            <div
              v-for="(row, rowIndex) in block.rows"
              :key="`${section.group}-row-${rowIndex}`"
              class="pl-field-row"
              :class="{ 'pl-field-row--single': row.length === 1 }"
            >
              <v-text-field
                v-for="field in row"
                :key="field.key"
                :model-value="fieldValue(section.group, field.key)"
                :label="field.label"
                :suffix="field.suffix"
                :placeholder="field.placeholder"
                density="compact"
                variant="underlined"
                type="number"
                hide-details
                :step="field.step"
                :disabled="!componentEnabled"
                @update:model-value="(value) => handleNumberInput(section.group, field, value)"
              />
            </div>
          </template>
        </div>

        <!-- 调试 -->
        <div class="pl-section">
          <div class="pl-section__title">
            <span class="pl-section__name">调试</span>
          </div>
          <div class="pl-toggle-row">
            <span class="pl-toggle-row__label">显示道路路径</span>
            <v-switch
              class="pl-compact-switch"
              :model-value="propsValue.debug.showRoadPath"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('debug', { showRoadPath: value === true })"
            />
          </div>
          <div class="pl-toggle-row">
            <span class="pl-toggle-row__label">显示分块范围</span>
            <v-switch
              class="pl-compact-switch"
              :model-value="propsValue.debug.showChunks"
              density="compact"
              hide-details
              color="primary"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('debug', { showChunks: value === true })"
            />
          </div>
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
  gap: 0.5rem;
}

/* 区块：细分隔线 + 统一标题行（标题左、开关右） */
.pl-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pl-section + .pl-section {
  margin-top: 0.3rem;
  padding-top: 0.6rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.pl-section__title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 24px;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(233, 236, 241, 0.88);
}

.pl-section__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pl-subtitle {
  margin-top: 0.35rem;
  margin-bottom: -0.1rem;
  font-size: 0.7rem;
  letter-spacing: 0.02em;
  color: rgba(233, 236, 241, 0.55);
}

.pl-hint {
  font-size: 0.7rem;
  line-height: 1.35;
  color: rgba(233, 236, 241, 0.62);
}

/* 运行统计（只读）：紧凑多行键值，不做成输入控件 */
.pl-stats {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.72rem;
  line-height: 1.35;
  color: rgba(233, 236, 241, 0.72);
}

.pl-stats__phase {
  font-size: 0.7rem;
  color: rgba(126, 200, 255, 0.9);
}

/* 标题行/开关行里的紧凑开关：压掉 v-switch 默认 40px 控件高度与右侧留白 */
.pl-compact-switch {
  --v-input-control-height: 24px;
  flex: none;
  margin-inline-end: 4px;
}

.pl-field-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 0.5rem 0.6rem;
}

.pl-field-row--single {
  grid-template-columns: minmax(0, 1fr);
}

.pl-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.pl-seed {
  flex: 1 1 96px;
  min-width: 0;
}

.pl-toggle-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 24px;
}

.pl-toggle-row__label {
  font-size: 0.78rem;
  color: rgba(193, 206, 218, 0.85);
}

.pl-toggle-row .pl-compact-switch {
  margin-inline-start: auto;
}

.pl-color-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem 0.6rem;
}

.pl-color {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.pl-color input[type='color']:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pl-choice-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.pl-choice {
  border: 1px solid rgba(126, 148, 168, 0.45);
  background: transparent;
  color: rgba(214, 226, 236, 0.9);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 0.76rem;
  cursor: pointer;
  white-space: nowrap;
  flex: none;
}

.pl-choice--active {
  border-color: rgba(88, 160, 232, 0.9);
  background: rgba(88, 160, 232, 0.18);
  color: #ffffff;
}

.pl-choice:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  flex-wrap: wrap;
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
</style>
