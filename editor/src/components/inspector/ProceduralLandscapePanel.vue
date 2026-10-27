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
  resolveProceduralLandscapeBaseMapMode,
  type ProceduralLandscapeComponentProps,
  type ProceduralLandscapeRoadStrategy,
} from '@schema/proceduralLandscape/config'
import { SLOWROADS_SCENIC_ROAD_CONSTRAINTS } from '@schema/proceduralLandscape/officialScenicRoad'
import {
  getProceduralLandscapeStats,
  type ProceduralLandscapeRuntimeStats,
} from '@schema/proceduralLandscape/runtime'
import { getProceduralLandscapeDemOrthoResolver } from '@schema/proceduralLandscape/demOrthoResolver'
import {
  getLandscapeExclusionSnapshot,
  landscapeExclusionSignature,
} from '@schema/proceduralLandscape/exclusion'
import {
  ROAD_STYLE_PROFILES,
  ROAD_WIDTH_PRESETS,
  type RoadStyleId,
} from '@schema/proceduralLandscape/roadStyle'
import { getTerrainDemOrthoFileInfo } from '@/utils/demOrthoTextureLoader'

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
const currentExclusionSignature = ref('')
const currentExclusionZoneCount = ref(0)
let runtimeStatsTimer: number | null = null

function refreshRuntimeStats(): void {
  const circles = getLandscapeExclusionSnapshot()
  currentExclusionSignature.value = landscapeExclusionSignature(circles)
  currentExclusionZoneCount.value = circles.length
  const nodeId = selectedNodeId.value
  const next = nodeId ? getProceduralLandscapeStats(nodeId) : null
  // The runtime updates its stats object in place. Reassigning that same
  // reference is a no-op for Vue's ref setter, so copy it to force a render.
  runtimeStats.value = next ? { ...next, warnings: [...next.warnings] } : null
}

const exclusionStale = computed(() => (
  currentExclusionZoneCount.value > 0
  || Boolean(runtimeStats.value?.exclusionSignature)
)
  && currentExclusionSignature.value !== (runtimeStats.value?.exclusionSignature ?? '')
)

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

const propsValue = computed<ProceduralLandscapeComponentProps | null>(() => {
  const component = landscapeComponent.value
  if (!component) {
    return null
  }
  return clampProceduralLandscapeProps(component.props, selectedNodeId.value ?? '')
})

const isDemLandscape = computed(() => Boolean(propsValue.value?.dem.assetId))

const orthoTextureAvailable = computed(() => {
  const dem = propsValue.value?.dem
  if (!dem) {
    return false
  }
  if (!dem.assetId) {
    return true
  }
  const asset = sceneStore.getAsset(dem.assetId)
  return Boolean(
    getTerrainDemOrthoFileInfo(asset)
    || getProceduralLandscapeDemOrthoResolver()?.canResolve(dem.assetId),
  )
})

const effectiveBaseMapMode = computed(() => (
  propsValue.value ? resolveProceduralLandscapeBaseMapMode(propsValue.value) : 'replace'
))

const waterLevelMode = computed(() => propsValue.value?.water.levelMode ?? 'auto')
const waterStatusText = computed(() => {
  const current = propsValue.value
  if (!current?.water.enabled) {
    return ''
  }
  const stats = runtimeStats.value
  const level = stats && Number.isFinite(stats.waterLevel)
    ? `当前水位 ${stats.waterLevel.toFixed(1)}m`
    : ''
  const flooded = stats
    ? `覆盖低地 ${(Math.max(0, stats.waterFloodedFraction) * 100).toFixed(1)}%`
    : ''
  const layerState = stats
    ? stats.waterEnabled
      ? '水面已建立'
      : '水面层尚未建立'
    : ''
  if (current.water.levelMode === 'auto') {
    return [`自动选择约 3% 低地`, level, flooded, layerState].filter(Boolean).join(' · ')
  }
  if (stats && stats.waterFloodedFraction < 0.0005) {
    return '当前水线被地形遮住；请提高水线偏移或切换自动低地。'
  }
  return [level, flooded, layerState].filter(Boolean).join(' · ')
})

const demOrthoStatusText = computed(() => {
  const stats = runtimeStats.value
  if (!stats || !propsValue.value?.dem.assetId) {
    return ''
  }
  if (stats.demOrthoStatus === 'loading') {
    return '正射纹理加载中…'
  }
  if (stats.demOrthoStatus === 'ready') {
    const coverage = Math.max(0, Math.min(1, stats.demOrthoCoverage))
    const coverageHint = coverage < 0.999
      ? ` · 覆盖 ${Math.round(coverage * 100)}%（缺失区使用程序化地表）`
      : ''
    const sourceHint = stats.demOrthoSource === 'ortho-tif' ? ' · ortho.tif' : ''
    return `正射纹理已加载${sourceHint}${stats.demOrthoWidth > 0 ? ` · ${stats.demOrthoWidth}×${stats.demOrthoHeight}` : ''}${coverageHint}`
  }
  if (stats.demOrthoStatus === 'error') {
    return `正射纹理加载失败，已回退程序化地表：${stats.demOrthoError ?? '未知错误'}`
  }
  return ''
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
const roadActionMessage = ref('')
const guideRouteRegenerationDialogVisible = ref(false)
const routeStrategy = computed(() => propsValue.value?.road.routing.strategy ?? 'seeded')
const routeTermination = computed(() => propsValue.value?.road.routing.termination ?? 'boundary')
const roadStyle = computed<RoadStyleId>(() => propsValue.value?.road.style ?? 'normal')
const roadCurveStyleOptions: RoadStyleId[] = [
  'straight',
  'casual',
  'normal',
  'winding',
]
const scenicMaxGradePercent = Math.round(
  SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxGrade * 100,
)
const scenicMaxCrossPercent = Math.round(
  SLOWROADS_SCENIC_ROAD_CONSTRAINTS.maxCrossSlope * 100,
)
const roadPathEditing = computed(
  () => componentEnabled.value && activeBuildTool.value === 'landscapeRoad' && Boolean(landscapeComponent.value),
)
const roadHasGeneratedResult = computed(() => (runtimeStats.value?.roadNodeCount ?? 0) >= 2)
const roadStale = computed(() => {
  const generated = propsValue.value?.road.generatedRoute
  const current = propsValue.value?.road
  if (!current) {
    return false
  }
  if (!generated) {
    return current.waypoints.length > 0
  }
  if (
    generated.strategy !== current.routing.strategy
    || generated.termination !== current.routing.termination
    || generated.style !== current.style
    || generated.seed !== propsValue.value?.seed
    || generated.waypointTolerance !== current.waypointTolerance
    || generated.pathDeviation !== current.pathDeviation
    || generated.waypoints.length !== current.waypoints.length
  ) {
    return true
  }
  return generated.waypoints.some((point, index) => {
    const live = current.waypoints[index]
    return !live || Math.abs(point.x - live.x) > 1e-6 || Math.abs(point.z - live.z) > 1e-6
  })
})
const roadSkippedWaypointIndices = computed(
  () => new Set(runtimeStats.value?.roadSkippedWaypointIndices ?? []),
)
function isRoadWaypointSkipped(index: number): boolean {
  return index > 0 && roadSkippedWaypointIndices.value.has(index)
}
const roadStatusText = computed(() => {
  const stats = runtimeStats.value
  if (!stats || stats.roadNodeCount < 2 || stats.roadLength <= 0) {
    return ''
  }
  const strategy = stats.roadStrategy === 'shortest'
    ? '最短路径'
    : stats.roadPlannerMode === 'cached-centerline'
      ? '已固化平滑中线'
    : stats.roadPlannerMode === 'waypoint-spline'
      ? '平滑途经点曲线'
    : stats.roadPlannerMode === 'official-natural'
      ? '官方自然螺旋'
    : stats.roadPlannerMode === 'guided-global'
      ? '官方 Hills · 坡限引导'
      : '低地 Hills 选线'
  const curveStyle = stats.roadStyle
    ? ROAD_STYLE_PROFILES[stats.roadStyle].label
    : ROAD_STYLE_PROFILES[roadStyle.value].label
  const generatedTermination = propsValue.value?.road.generatedRoute?.termination
  const termination = generatedTermination === 'loop'
    ? '首尾相接'
    : generatedTermination === 'dead-end'
      ? '单路'
      : '到边界'
  const state = stats.roadClosed && stats.roadComplete
    ? '闭环完成'
    : stats.roadComplete && generatedTermination === 'dead-end'
      ? '单路完成'
      : stats.roadComplete && generatedTermination === 'boundary'
        ? '已完成到边界'
        : stats.roadComplete
          ? '已完成'
      : '未完成'
  const official = stats.roadStrategy === 'seeded' && stats.roadPlannerMode !== 'cached-centerline'
    ? ` · 海拔均值 P${Math.round(stats.roadAverageElevationPercentile * 100)} / 最高 P${Math.round(stats.roadMaxElevationPercentile * 100)} · 低地 ${Math.round(stats.roadLowlandCoverageFraction * 100)}% · 纵坡 ${Math.round(stats.roadMaxForwardGrade * 100)}% · 横坡 ${Math.round(stats.roadMaxCrossSlope * 100)}%${stats.roadPlannerMode === 'guided-global' ? '' : ` · 陡坡改线 ${stats.roadSteepReplacementSteps}`} · 曲率 ${stats.roadTurnDegreesPerKm.toFixed(1)}°/km`
    : ''
  const skipped = stats.roadWaypointsSkipped > 0
    ? ` · 跳过 ${stats.roadSkippedWaypointIndices.map((index) => `P${index + 1}`).join(', ')}`
    : ''
  const guide = stats.roadPlannerMode === 'guided-global'
    ? ` · 全局搜索 ${stats.roadGuideExpandedStates.toLocaleString()} 状态 · 骨架偏差 ${stats.roadMaxGuideDeviation.toFixed(1)}m`
    : ''
  const natural = stats.roadNaturalTargetLength > 0
    ? ` · 自然目标 ${Math.round(stats.roadNaturalTargetLength).toLocaleString()}m · ${stats.roadNaturalLaps.toFixed(1)} 圈`
    : ''
  return `${strategy} · ${curveStyle} · ${termination} · ${Math.round(stats.roadLength).toLocaleString()}m · ${stats.roadNodeCount.toLocaleString()} 节点 · 途径点 ${stats.roadWaypointsPassed}/${stats.roadWaypointCount}${skipped} · 最大偏差 ${stats.roadMaxWaypointError.toFixed(1)}m${natural}${official}${guide} · ${state}`
})
const roadFailureText = computed(() => {
  const reason = runtimeStats.value?.roadFailureReason
  if (reason === 'road-geometry-self-overlap' && runtimeStats.value) {
    const width = propsValue.value?.road.width ?? 0
    const requiredClearance = Math.max(7, width)
    const requiredTurnRadius = 20
    return `路线存在自重叠或过急弯道，该路线未提交。当前中心线间距 ${runtimeStats.value.roadMinCenterlineClearance.toFixed(1)}m（需 ≥ ${requiredClearance.toFixed(1)}m），最小转弯半径 ${runtimeStats.value.roadMinTurnRadius.toFixed(1)}m（需 ≥ ${requiredTurnRadius.toFixed(1)}m）。请增大绕行半径或调整途经点。`
  }
  if (
    !reason
    || reason === 'reached-guide-end'
    || (
      reason === 'reached-terrain-boundary'
      && propsValue.value?.road.generatedRoute?.termination === 'boundary'
      && runtimeStats.value?.roadComplete
    )
    || (
      reason === 'reached-route-end'
      && propsValue.value?.road.generatedRoute?.termination === 'dead-end'
      && runtimeStats.value?.roadComplete
    )
    || (
      reason === 'reached-route-start'
      && propsValue.value?.road.generatedRoute?.termination === 'loop'
      && runtimeStats.value?.roadComplete
    )
  ) {
    return ''
  }
  const labels: Record<string, string> = {
    blocked: '坡度或地形条件阻止了道路继续追踪',
    'reached-step-limit': '道路达到追踪节点安全上限，未延伸到预期终点',
    'reached-terrain-boundary': '道路未能按官方规则延伸到地形边界，请移动 P1 后重试',
    'start-outside-terrain': '起点不在地形范围内',
    'single-point-loop-too-small': '起点附近没有足够空间生成自然闭环，请移动途径点',
    'shortest-route-budget-exceeded': '最短路径搜索超预算，请减少范围或切换到自然观光',
    'shortest-route-not-found': '找不到满足坡度与边界条件的最短路径',
    'waypoint-missed': '生成中心线未能以规定容差经过全部途径点',
    'loop-not-closed': '闭环终点未能回到 P1',
    'loop-heading-discontinuity': '闭环处切线不连续，请调整途径点或切换选线策略',
    'loop-termination-distance': '闭环回程未到达 P1 容差范围',
    'loop-termination-grade': '闭环最后连接段超过纵坡限制',
    'no-waypoints': '请先添加至少一个途径点',
    'start-too-close-to-boundary': '起点距离地形边界过近，无法按官方规则向外延伸',
    'official-generator-restart': '官方选线连续触发回退，无法从当前 P1 稳定生成道路',
    'road-forward-grade-limit': `路线未满足 ${scenicMaxGradePercent}% 纵坡上限`,
    'road-cross-slope-limit': `路线未满足 ${scenicMaxCrossPercent}% 局部横坡上限`,
    'blocked-by-forward-grade': `道路前方没有满足 ${scenicMaxGradePercent}% 纵坡上限的方向`,
    'blocked-by-cross-slope': `道路前方没有满足 ${scenicMaxCrossPercent}% 局部横坡上限的方向`,
    'blocked-by-guide-corridor': '道路无法在自然弯曲范围内继续跟随可行骨架',
    'waypoint-unreachable': `存在无法在 ${scenicMaxGradePercent}% 坡度限制内到达的途径点`,
    'boundary-unreachable': '最后一个途径点之后无法在坡度限制内到达地形边界',
    'global-guide-budget-exceeded': '全局坡限搜索超过状态预算',
    'guided-guide-prepare-failed': '全局可行骨架无法平滑成连续道路',
    'guided-official-blocked': '官方 Hills 曲线无法在骨架走廊内满足坡度限制',
    'guide-empty': '全局选线骨架为空',
    'natural-config-missing': '自然延伸参数缺失，无法生成公路',
    'route-too-short': '单路模式至少需要一个终点途径点',
    'road-geometry-self-overlap': '路线存在自重叠或过急弯道，请增大绕行半径或调整途经点',
  }
  return labels[reason] ?? `道路生成失败：${reason}`
})
const roadBuildNoticeText = computed(() => {
  const stats = runtimeStats.value
  if (!stats) {
    return ''
  }
  const notices: string[] = []
  if (stats.roadSmoothingFallback) {
    const smoothingReasonLabels: Record<string, string> = {
      'smoothing-forward-grade-limit': '平滑段超出纵坡限制',
      'smoothing-cross-slope-limit': '平滑段超出横坡限制',
      'smoothing-waypoint-tolerance': '平滑段偏离途经点',
      'smoothing-outside-terrain': '平滑段超出地形范围',
      'smoothing-partial-fallback': '部分路段保留原始追踪线',
    }
    const detail = stats.roadSmoothingFallbackReason
      ? smoothingReasonLabels[stats.roadSmoothingFallbackReason]
      : null
    notices.push(`曲线平滑已降级，已保留地形可行路线${detail ? `（${detail}）` : ''}。`)
  }
  if (stats.roadDetourRadiusExpanded) {
    notices.push(
      `绕行半径 ${Math.round(stats.roadDetourRadius)}m 内没有可行路线，已使用约 ${Math.round(stats.roadMaxDetourDistance)}m 的绕行距离。`,
    )
  }
  if (stats.roadGeometryAutoRepaired) {
    notices.push(
      `已自动圆滑 ${stats.roadAutoRepairRoundedCorners} 个弯道，最大途经点偏移 ${stats.roadMaxAutoRepairWaypointOffset.toFixed(1)}m。`,
    )
  }
  return notices.join(' ')
})

watch(
  () => selectedNodeId.value,
  () => {
    roadActionMessage.value = ''
  },
)

const demSource = computed(() => propsValue.value?.dem ?? null)
const demSampleStepOptions = [
  { title: '自动（按质量档）', value: 'auto' },
  { title: '30m', value: 1 },
  { title: '60m', value: 2 },
  { title: '120m', value: 4 },
]
const demStatusLabel = computed(() => {
  const status = runtimeStats.value?.demStatus
  if (status === 'ready') return '已加载'
  if (status === 'loading') return '下载中'
  if (status === 'building') return '构建中'
  if (status === 'error') return '错误'
  return '待加载'
})
function handleDemSampleStepChange(value: string | number): void {
  const sampleStep = value === 'auto' ? 'auto' : Number(value) === 2 ? 2 : Number(value) === 4 ? 4 : 1
  patchGroup('dem', { sampleStep })
}
function handleToggleRoadPathEditing(): void {
  if (!componentEnabled.value || !landscapeComponent.value) {
    return
  }
  buildToolsStore.setActiveBuildTool(roadPathEditing.value ? null : 'landscapeRoad')
}

function handleRoadStrategy(value: ProceduralLandscapeRoadStrategy): void {
  patchGroup('road', {
    routing: {
      ...(propsValue.value?.road.routing ?? {}),
      strategy: value,
    },
  })
}

function handleRoadStyle(value: RoadStyleId): void {
  patchGroup('road', { style: value })
}

function handleRoadTermination(
  value: 'loop' | 'boundary' | 'dead-end',
): void {
  patchGroup('road', {
    routing: {
      ...(propsValue.value?.road.routing ?? {}),
      termination: value,
    },
  })
}

function handleGenerateRoad(): void {
  const nodeId = selectedNodeId.value
  if (nodeId && sceneStore.findProceduralLandscapeRoadGuideRoute(nodeId)) {
    guideRouteRegenerationDialogVisible.value = true
    return
  }
  generateRoadWithGuideRoutePolicy('preserve')
}

function generateRoadWithGuideRoutePolicy(
  guideRoutePolicy: 'preserve' | 'recreate',
): void {
  const nodeId = selectedNodeId.value
  if (!nodeId || !componentEnabled.value) {
    return
  }
  guideRouteRegenerationDialogVisible.value = false
  let result: ReturnType<typeof sceneStore.generateProceduralLandscapeRoad>
  try {
    result = sceneStore.generateProceduralLandscapeRoad(nodeId, { guideRoutePolicy })
  } catch (error) {
    console.error('Failed to generate procedural landscape road', error)
    roadActionMessage.value = `公路生成异常：${
      error instanceof Error ? error.message : String(error)
    }`
    return
  }
  if (!result.accepted) {
    const unreachablePoint = result.unreachableWaypointIndex == null
      ? null
      : `P${result.unreachableWaypointIndex + 1}`
    const labels: Record<string, string> = {
      'terrain-grid-not-ready': '地形网格尚未加载完成，请稍后重试。',
      blocked: '新路线被坡度或地形阻断，已保留上一版公路。',
      'start-outside-terrain': 'P1 不在地形范围内，已保留上一版公路。',
      'start-too-close-to-boundary': 'P1 距地形边界过近，已保留上一版公路。',
      'official-generator-restart': '官方选线连续回退，无法稳定生成；已保留上一版公路。',
      'road-forward-grade-limit': `新路线超过 ${scenicMaxGradePercent}% 纵坡上限，已保留上一版公路。`,
      'road-cross-slope-limit': `新路线超过 ${scenicMaxCrossPercent}% 局部横坡上限，已保留上一版公路。`,
      'blocked-by-forward-grade': `周边地形均超过 ${scenicMaxGradePercent}% 纵坡上限，已保留上一版公路。`,
      'blocked-by-cross-slope': `周边地形均超过 ${scenicMaxCrossPercent}% 局部横坡上限，已保留上一版公路。`,
      'waypoint-unreachable': unreachablePoint
        ? `${unreachablePoint} 无法在 ${scenicMaxGradePercent}% 坡度限制内到达，已保留上一版公路。`
        : `有途径点无法在 ${scenicMaxGradePercent}% 坡度限制内到达，已保留上一版公路。`,
      'boundary-unreachable': '最后途径点之后无法在坡度限制内到达边界，已保留上一版公路。',
      'global-guide-budget-exceeded': '全局坡限搜索超过预算，已保留上一版公路。',
      'guided-guide-prepare-failed': '全局骨架无法平滑成连续道路，已保留上一版公路。',
      'guided-official-blocked': '官方 Hills 曲线无法在可行骨架内满足坡度限制，已保留上一版公路。',
      'waypoint-missed': unreachablePoint
        ? `${unreachablePoint} 未被生成中心线经过，已保留上一版公路；请调整该点或增大途径容差。`
        : '有途径点未被生成中心线经过，已保留上一版公路。',
      'loop-not-closed': '闭环回程无法在坡度限制内连接 P1，已保留上一版公路。',
      'loop-heading-discontinuity': '闭环处转角过大，已保留上一版公路。',
      'loop-termination-distance': '闭环回程未到达 P1，已保留上一版公路。',
      'loop-termination-grade': '闭环最后连接段坡度过陡，已保留上一版公路。',
      'route-too-short': '单路模式至少需要一个终点途径点。',
      'road-geometry-self-overlap': '路线存在自重叠或过急弯道，已保留上一版公路；请增大绕行半径或调整途经点。',
    }
    roadActionMessage.value = labels[result.failureReason ?? '']
      ?? `公路生成失败（${result.failureReason ?? 'unknown'}），已保留上一版公路。`
    return
  }
  roadActionMessage.value = routeStrategy.value === 'seeded'
    ? roadWaypoints.value.length > 1
      ? '已提交途径点，正在生成平滑道路中线并校验几何。'
      : '已提交途径点，正在按官方 Hills 曲线生成公路。'
    : '已提交途径点快照，正在生成公路。'
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
  sceneStore.clearProceduralLandscapeRoad(nodeId)
  roadActionMessage.value = ''
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

// 统一途径点约束：自然观光可在相邻点之间绕行，最短路径按地形代价连通。
const roadPathBlock = computed<FieldBlock>(() => ({
  title: '途径约束',
  hint: routeTermination.value === 'loop'
    ? '按顺序经过全部途径点，并自动回到 P1；绕行半径用于相邻点之间的地形搜索，点击吸附仍为 50m。'
    : routeTermination.value === 'dead-end'
      ? '按顺序经过全部途径点，并在最后一个途径点结束；绕行半径用于相邻点地形搜索，点击吸附仍为 50m。'
    : routeStrategy.value === 'seeded'
      ? 'P1 是起点；无 P2 时按官方切线目标自然螺旋，有 P2…Pn 时先按顺序经过全部点，再沿用当前航向自然延伸并以 2–4 倍对角线为目标转到边界。点击吸附仍为 50m。'
      : '按顺序经过全部途径点，最后按 Slow Roads 规则延伸到地形边界；绕行半径是软约束，点击吸附仍为 50m。',
  rows: [[
    { key: 'waypointTolerance', label: '途径容差', suffix: 'm', step: 1 },
    { key: 'pathDeviation', label: '相邻点绕行半径', suffix: 'm', step: 10 },
  ]],
}))

// 官方路型预设（`roadStyle.ROAD_WIDTH_PRESETS`）。路型由路宽自动决定：
// < 2.25m 走单车道贴图（`roadSingle`，无划线），否则走宽路贴图 + 划线。
const roadWidthPresets = [
  { label: '单车道 1.8m', width: ROAD_WIDTH_PRESETS.narrow },
  { label: '常规 3.2m', width: ROAD_WIDTH_PRESETS.regular },
  { label: '宽路 4.0m', width: ROAD_WIDTH_PRESETS.wide },
] as const

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

const roadBlocks = computed<FieldBlock[]>(() => {
  if (routeStrategy.value === 'seeded') {
    return [
      roadPathBlock.value,
      ...roadGeometryBlocks.filter((block) => block.title !== '追踪'),
    ]
  }
  return [roadPathBlock.value, ...roadGeometryBlocks]
})

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
    withSwitch: true,
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
    blocks: [],
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

        <!-- DEM 地形数据源 -->
        <div v-if="demSource?.assetId" class="pl-section pl-dem-section">
          <div class="pl-section__title">
            <span class="pl-section__name">DEM 地形</span>
            <span class="pl-dem-status" :class="`is-${runtimeStats?.demStatus ?? 'idle'}`">{{ demStatusLabel }}</span>
          </div>
          <div class="pl-hint">
            {{ demSource.sourceZipName || demSource.assetId }}
            <template v-if="demSource.width && demSource.height">
              · {{ demSource.width }}×{{ demSource.height }}
            </template>
            <template v-if="demSource.cellSizeMeters"> · {{ demSource.cellSizeMeters.toFixed(1) }}m</template>
          </div>
          <div v-if="demSource.minElevation != null && demSource.maxElevation != null" class="pl-hint">
            高程 {{ demSource.minElevation.toFixed(1) }}–{{ demSource.maxElevation.toFixed(1) }}m
            <template v-if="demSource.crs"> · EPSG:{{ demSource.crs.epsg }}</template>
          </div>
          <v-select
            :model-value="demSource.sampleStep"
            label="地形网格"
            density="compact"
            variant="underlined"
            hide-details
            :items="demSampleStepOptions"
            item-title="title"
            item-value="value"
            :disabled="!componentEnabled"
            @update:model-value="handleDemSampleStepChange"
          />

        </div>

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
          <div v-if="currentExclusionZoneCount > 0 || runtimeStats?.exclusionZoneCount" class="pl-hint">
            已应用排除区 {{ runtimeStats?.exclusionZoneCount ?? 0 }} 个
            <template v-if="currentExclusionZoneCount !== (runtimeStats?.exclusionZoneCount ?? 0)">
              · 当前场景 {{ currentExclusionZoneCount }} 个
            </template>
          </div>
          <div v-if="exclusionStale" class="pl-hint pl-hint--stale">
            排除区位置或半径已变更，点击“重新生成”应用。
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
          <div class="pl-road-path__actions">
            <button
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': roadPathEditing }"
              :disabled="!componentEnabled"
              @click="handleToggleRoadPathEditing"
            >{{ roadPathEditing ? '结束编辑' : '编辑' }}</button>
            <v-btn
              size="small"
              color="primary"
              variant="flat"
              :disabled="!componentEnabled"
              @click="handleGenerateRoad"
            >{{ roadHasGeneratedResult ? '重新生成公路' : '生成公路' }}</v-btn>
            <button
              type="button"
              class="pl-choice"
              :disabled="!componentEnabled || !roadWaypoints.length"
              @click="handleClearRoadPath"
            >清除公路</button>
          </div>
          <div v-if="roadActionMessage" class="pl-hint">{{ roadActionMessage }}</div>
          <div v-if="roadStale" class="pl-hint pl-hint--stale">
            途经点或公路曲线已修改，点击“重新生成公路”应用。
          </div>
  
          <div class="pl-subtitle">选线策略</div>
          <div class="pl-choice-row">
            <button
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': routeStrategy === 'seeded' }"
              :disabled="!componentEnabled"
              @click="handleRoadStrategy('seeded')"
            >自然观光</button>
            <button
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': routeStrategy === 'shortest' }"
              :disabled="!componentEnabled"
              @click="handleRoadStrategy('shortest')"
            >最短路径</button>
          </div>
          <template v-if="routeStrategy === 'seeded'">
            <div class="pl-subtitle">公路曲线</div>
            <div class="pl-choice-row">
              <button
                v-for="style in roadCurveStyleOptions"
                :key="style"
                type="button"
                class="pl-choice"
                :class="{ 'pl-choice--active': roadStyle === style }"
                :disabled="!componentEnabled"
                @click="handleRoadStyle(style)"
              >{{ ROAD_STYLE_PROFILES[style].label }}</button>
            </div>
          </template>
          <div class="pl-subtitle">结束方式</div>
          <div class="pl-choice-row">
            <button
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': routeTermination === 'loop' }"
              :disabled="!componentEnabled"
              @click="handleRoadTermination('loop')"
            >首尾相接</button>
            <button
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': routeTermination === 'boundary' }"
              :disabled="!componentEnabled"
              @click="handleRoadTermination('boundary')"
            >延伸到边界</button>
            <button
              type="button"
              class="pl-choice"
              :class="{ 'pl-choice--active': routeTermination === 'dead-end' }"
              :disabled="!componentEnabled"
              @click="handleRoadTermination('dead-end')"
            >单路</button>
          </div>
          <div v-if="roadWaypoints.length" class="pl-road-path">
            <v-virtual-scroll
              :items="roadWaypoints"
              :item-height="34"
              max-height="180"
              class="pl-road-path__list"
            >
              <template #default="{ item, index }">
                <div
                  class="pl-road-path__item"
                  :class="{ 'pl-road-path__item--skipped': isRoadWaypointSkipped(index) }"
                >
                  <span class="pl-road-path__index">P{{ index + 1 }}</span>
                  <span class="pl-road-path__coords">{{ item.x.toFixed(1) }}, {{ item.z.toFixed(1) }}</span>
                  <span v-if="isRoadWaypointSkipped(index)" class="pl-road-path__skipped">跳过</span>
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
              </template>
            </v-virtual-scroll>
          </div>
          <div v-if="roadStatusText" class="pl-hint">{{ roadStatusText }}</div>
          <div v-if="roadBuildNoticeText" class="pl-hint pl-hint--stale">{{ roadBuildNoticeText }}</div>
          <div v-if="roadFailureText" class="pl-hint pl-hint--error">{{ roadFailureText }}</div>

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
          <template v-if="isDemLandscape">
            <div class="pl-choice-row">
              <button
                type="button"
                class="pl-choice"
                :class="{ 'pl-choice--active': effectiveBaseMapMode === 'replace' }"
                :disabled="!componentEnabled"
                @click="patchGroup('surface', { baseMapMode: 'replace' })"
              >仅程序化</button>
              <button
                type="button"
                class="pl-choice"
                :class="{ 'pl-choice--active': effectiveBaseMapMode === 'aerial' }"
                :disabled="!componentEnabled || !orthoTextureAvailable"
                :title="orthoTextureAvailable ? '从服务器加载 ortho.tif' : '当前 DEM 资源包未包含 ortho.tif'"
                @click="patchGroup('surface', { baseMapMode: 'aerial' })"
              >正射纹理</button>
            </div>
            <div v-if="!orthoTextureAvailable" class="pl-hint">
              当前 DEM 资源包未包含 ortho.tif，只能使用程序化地表。
            </div>
            <div v-else-if="demOrthoStatusText" class="pl-hint">
              {{ demOrthoStatusText }}
            </div>
          </template>
          <template v-else>
            <div class="pl-choice-row">
              <button
                type="button"
                class="pl-choice"
                :class="{ 'pl-choice--active': effectiveBaseMapMode === 'replace' }"
                :disabled="!componentEnabled"
                @click="patchGroup('surface', { baseMapMode: 'replace' })"
              >仅程序化</button>
              <button
                type="button"
                class="pl-choice"
                :class="{ 'pl-choice--active': effectiveBaseMapMode === 'aerial' }"
                :disabled="!componentEnabled"
                @click="patchGroup('surface', { baseMapMode: 'aerial' })"
              >仅航拍</button>
              <button
                type="button"
                class="pl-choice"
                :class="{ 'pl-choice--active': effectiveBaseMapMode === 'blend' }"
                :disabled="!componentEnabled"
                @click="patchGroup('surface', { baseMapMode: 'blend' })"
              >混合</button>
            </div>
            <v-slider
              v-if="effectiveBaseMapMode === 'blend'"
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
          </template>
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
          <template v-if="section.group === 'water'">
            <div class="pl-choice-row">
              <button
                type="button"
                class="pl-choice"
                :class="{ 'pl-choice--active': waterLevelMode === 'auto' }"
                :disabled="!componentEnabled"
                @click="patchGroup('water', { levelMode: 'auto' })"
              >自动低地</button>
              <button
                type="button"
                class="pl-choice"
                :class="{ 'pl-choice--active': waterLevelMode === 'manual' }"
                :disabled="!componentEnabled"
                @click="patchGroup('water', { levelMode: 'manual' })"
              >手动偏移</button>
            </div>
            <v-text-field
              v-if="waterLevelMode === 'manual'"
              :model-value="propsValue.water.levelOffset"
              label="水线偏移"
              suffix="m"
              placeholder="相对地形最低点"
              density="compact"
              variant="underlined"
              type="number"
              hide-details
              :step="0.5"
              :disabled="!componentEnabled"
              @update:model-value="(value) => patchGroup('water', { levelOffset: Number(value) || 0 })"
            />
            <div v-if="waterStatusText" class="pl-hint">{{ waterStatusText }}</div>
          </template>
          <template v-else>
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
  <v-dialog v-model="guideRouteRegenerationDialogVisible" max-width="540">
    <v-card title="重新生成公路与导览路线">
      <v-card-text>
        当前公路已有自动 Guide Route。请选择导览路线处理方式：
        <br>
        “保留并适配”会保留停靠点、缩略图、行为和延长段，并将路线连接到新公路端点；
        “重建路线”会清空这条自动路线的停靠点与延长段，分支节点会保留但解除来源关联。
      </v-card-text>
      <v-card-actions class="pl-regeneration-actions">
        <v-btn variant="text" @click="guideRouteRegenerationDialogVisible = false">取消</v-btn>
        <v-spacer />
        <v-btn color="warning" variant="tonal" @click="generateRoadWithGuideRoutePolicy('recreate')">
          重建路线
        </v-btn>
        <v-btn color="primary" variant="flat" @click="generateRoadWithGuideRoutePolicy('preserve')">
          保留并适配
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
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

.pl-hint--error {
  color: #ff8a80;
}

.pl-hint--stale {
  color: #ffd166;
}

.pl-dem-status {
  flex: none;
  font-size: 0.68rem;
  font-weight: 500;
  color: rgba(126, 200, 255, 0.9);
}

.pl-dem-status.is-error {
  color: #ff8a80;
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

.pl-road-origin {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
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

.pl-road-path__item--skipped {
  background: rgba(255, 138, 128, 0.1);
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

.pl-road-path__skipped {
  flex: none;
  font-size: 0.68rem;
  color: #ff8a80;
}
</style>
