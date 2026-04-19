<script lang="ts" setup>
import type { AnalysisOverviewItem } from '@vben/common-ui'
import type { TabOption } from '@vben/types'

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { AnalysisChartCard, AnalysisChartsTabs, AnalysisOverview } from '@vben/common-ui'
import { SvgBellIcon, SvgCakeIcon, SvgCardIcon, SvgDownloadIcon } from '@vben/icons'
import { message } from 'ant-design-vue'

import {
  getAnalyticsDashboardApi,
  listSceneSpotsApi,
  type AnalyticsDashboardResponse,
  type AnalyticsDomainSummary,
  type AnalyticsMetricItem,
  type AnalyticsSpotItem,
  type AnalyticsTrendItem,
  type LoginTrendItem,
} from '#/api'
import type { SceneSpotItem } from '#/api/core/scene-spots'

import AnalyticsTrends from './analytics-trends.vue'
import AnalyticsVisitsData from './analytics-visits-data.vue'
import AnalyticsVisitsSales from './analytics-visits-sales.vue'
import AnalyticsVisitsSource from './analytics-visits-source.vue'
import AnalyticsVisits from './analytics-visits.vue'

const loading = ref(false)
const selectedSpotId = ref<string>('')
const overviewData = ref<AnalyticsDashboardResponse | null>(null)
const spotOptions = ref<Array<{ label: string; value: string }>>([])
const route = useRoute()
const router = useRouter()

const routeSpotId = computed(() => (typeof route.params.spotId === 'string' ? route.params.spotId : ''))
const isSpotDetail = computed(() => Boolean(routeSpotId.value))

const domainRoutes: Record<string, string> = {
  orders: '/analytics/orders',
  punch: '/analytics/punch',
  travel: '/analytics/travel',
  users: '/analytics/users',
  vehicles: '/analytics/vehicles',
}

const domainCards = computed(() => {
  const domains: AnalyticsDashboardResponse['domains'] | undefined = overviewData.value?.domains
  if (!domains) {
    return []
  }
  return Object.values(domains).map((item: AnalyticsDomainSummary) => ({
    accent: {
      orders: '#b45309',
      punch: '#0f766e',
      travel: '#7c3aed',
      users: '#dc2626',
      vehicles: '#1d4ed8',
    }[item.key],
    item,
    primaryMetric: item.summary?.[0] ?? null,
    route: domainRoutes[item.key],
    secondaryMetrics: item.summary.slice(1, 4),
  }))
})

const overviewItems = computed<AnalysisOverviewItem[]>(() => {
  const summary = overviewData.value?.overview
  return [
    {
      icon: SvgCardIcon,
      title: '访问 PV',
      totalTitle: '总访问 PV',
      totalValue: summary?.pv ?? 0,
      value: summary?.pv ?? 0,
    },
    {
      icon: SvgCakeIcon,
      title: '访问 UV',
      totalTitle: '总访问 UV',
      totalValue: summary?.uv ?? 0,
      value: summary?.uv ?? 0,
    },
    {
      icon: SvgDownloadIcon,
      title: '登录成功',
      totalTitle: '登录成功次数',
      totalValue: summary?.loginSuccess ?? 0,
      value: summary?.loginSuccess ?? 0,
    },
    {
      icon: SvgBellIcon,
      title: '登录失败',
      totalTitle: '登录失败次数',
      totalValue: summary?.loginFail ?? 0,
      value: summary?.loginFail ?? 0,
    },
  ]
})

const profileOrBehaviorData = computed<AnalyticsMetricItem[]>(() => {
  const profile = overviewData.value?.profile
  if (!profile) {
    return []
  }
  if (profile.interests.length) {
    return profile.interests
  }
  if (profile.age.length) {
    return profile.age
  }
  return overviewData.value?.behaviorPaths ?? []
})

const topSpots = computed(() => overviewData.value?.topSpots ?? [])

const selectedSpotLabel = computed(() => {
  if (!selectedSpotId.value) {
    return '全局分析视角'
  }
  return spotOptions.value.find((item: { label: string; value: string }) => item.value === selectedSpotId.value)?.label ?? '当前景点'
})

const dwellSeconds = computed(() => {
  return Math.round((overviewData.value?.overview.avgDwellMs ?? 0) / 1000)
})

const heroMetrics = computed(() => {
  return [
    {
      label: '当前视角',
      value: selectedSpotLabel.value,
    },
    {
      label: '业务域数量',
      value: `${domainCards.value.length}`,
    },
    {
      label: '平均停留',
      value: `${dwellSeconds.value} 秒`,
    },
  ]
})

const sourceHeadline = computed(() => overviewData.value?.sourceDistribution?.[0]?.name ?? '暂无来源数据')
const deviceHeadline = computed(() => overviewData.value?.deviceDistribution?.[0]?.name ?? '暂无设备数据')
const profileHeadline = computed(() => profileOrBehaviorData.value[0]?.name ?? '暂无画像数据')

const rankingColumns = [
  { title: '排名', dataIndex: 'rank', key: 'rank', width: 72 },
  { title: '景点', dataIndex: 'name', key: 'name' },
  { title: 'PV', dataIndex: 'pv', key: 'pv', width: 88 },
  { title: 'UV', dataIndex: 'uv', key: 'uv', width: 88 },
]

const rankedTopSpots = computed(() => {
  return topSpots.value.map((item: AnalyticsSpotItem, index: number) => ({
    ...item,
    rank: index + 1,
  }))
})

const trendChartData = computed(() => {
  return (overviewData.value?.trend ?? []).map((item: AnalyticsTrendItem) => ({
    date: item.date,
    pv: item.pv,
    uv: item.uv,
  }))
})

const loginTrendChartData = computed(() => {
  return (overviewData.value?.loginTrend ?? []).map((item: LoginTrendItem) => ({
    date: item.date,
    fail: item.fail ?? 0,
    success: item.success ?? 0,
  }))
})

const chartTabs: TabOption[] = [
  { label: '流量趋势', value: 'trends' },
  { label: '月访问量', value: 'visits' },
]

async function loadSpotOptions() {
  const result = await listSceneSpotsApi({ page: 1, pageSize: 2000 })
  const items = result.items as SceneSpotItem[]
  spotOptions.value = items.map((item) => ({
    label: item.title,
    value: item.id,
  }))
}

async function loadAnalytics() {
  loading.value = true
  try {
    overviewData.value = await getAnalyticsDashboardApi({
      granularity: 'day',
      spotId: selectedSpotId.value || undefined,
    })
  } catch (error) {
    message.error((error as Error)?.message || '加载分析数据失败')
  } finally {
    loading.value = false
  }
}

async function handleReload() {
  await loadAnalytics()
}

async function handleSpotChange(value?: string) {
  const nextSpotId = value || ''
  selectedSpotId.value = nextSpotId
  if (nextSpotId) {
    await router.replace(`/analytics/spot/${nextSpotId}`)
  } else {
    await router.replace('/analytics')
  }
}

async function backToGlobal() {
  selectedSpotId.value = ''
  await router.replace('/analytics')
}

async function navigateToSpot(spotId: string) {
  if (!spotId) {
    return
  }
  await router.push(`/analytics/spot/${spotId}`)
}

async function navigateToDomain(path: string) {
  await router.push(path)
}

watch(routeSpotId, async (spotId: string) => {
  const normalized = spotId || ''
  if (selectedSpotId.value !== normalized) {
    selectedSpotId.value = normalized
  }
  await loadAnalytics()
})

onMounted(async () => {
  await loadSpotOptions()
  selectedSpotId.value = routeSpotId.value
  await loadAnalytics()
})
</script>

<template>
  <div class="p-5">
    <a-card
      :bordered="false"
      class="overflow-hidden border-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 shadow-sm"
      :body-style="{ padding: '0' }"
    >
      <div class="relative overflow-hidden px-6 py-6 text-white lg:px-8 lg:py-7">
        <div class="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.3),transparent_58%)] lg:block" />
        <div class="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div class="max-w-3xl">
            <div class="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs tracking-[0.24em] text-white/70">
              ANALYTICS OVERVIEW
            </div>
            <h1 class="mt-4 text-3xl font-semibold tracking-tight text-white lg:text-4xl">
              {{ isSpotDetail ? `${selectedSpotLabel} 经营洞察` : '全站运营分析总览' }}
            </h1>
            <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-300 lg:text-base">
              聚合访问、登录、来源与景点热度，让首页先回答“现在发生了什么”，再指向需要继续追踪的业务域。
            </p>
            <div class="mt-6 grid gap-3 sm:grid-cols-3">
              <div
                v-for="metric in heroMetrics"
                :key="metric.label"
                class="rounded-2xl border border-white/10 bg-white/10 px-4 py-4 backdrop-blur"
              >
                <div class="text-xs uppercase tracking-[0.2em] text-slate-400">{{ metric.label }}</div>
                <div class="mt-3 text-lg font-semibold text-white">{{ metric.value }}</div>
              </div>
            </div>
          </div>

          <div class="w-full max-w-xl rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
            <div class="flex flex-col gap-4">
              <div>
                <div class="text-sm font-medium text-white">分析范围</div>
                <div class="mt-1 text-xs text-slate-300">切换全局或单景点视角，面板内容会同步刷新。</div>
              </div>
              <div class="flex flex-col gap-3 lg:flex-row">
                <a-select
                  v-model:value="selectedSpotId"
                  :options="spotOptions"
                  allow-clear
                  placeholder="选择景点（为空则全局）"
                  style="width: 100%"
                  @change="handleSpotChange"
                />
                <div class="flex gap-3">
                  <a-button :loading="loading" type="primary" @click="handleReload">刷新数据</a-button>
                  <a-button v-if="isSpotDetail" @click="backToGlobal">回到全局</a-button>
                </div>
              </div>
              <div class="flex flex-wrap gap-2 text-xs text-slate-300">
                <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  PV {{ overviewData?.overview.pv ?? 0 }}
                </span>
                <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  UV {{ overviewData?.overview.uv ?? 0 }}
                </span>
                <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  登录成功 {{ overviewData?.overview.loginSuccess ?? 0 }}
                </span>
                <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  登录失败 {{ overviewData?.overview.loginFail ?? 0 }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </a-card>

    <div class="mt-6">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div class="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">Core Metrics</div>
          <h2 class="mt-1 text-xl font-semibold text-slate-900">核心指标快照</h2>
        </div>
        <div class="text-sm text-slate-500">统一观察访问量、登录表现与停留质量。</div>
      </div>
      <AnalysisOverview :items="overviewItems" />
    </div>

    <div class="mt-6">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div class="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">Domain Entrances</div>
          <h2 class="mt-1 text-xl font-semibold text-slate-900">业务入口与重点摘要</h2>
        </div>
        <div class="text-sm text-slate-500">把高频业务域前置成可点击的观察入口。</div>
      </div>

      <a-row :gutter="[16, 16]">
        <a-col v-for="card in domainCards" :key="card.item.key" :span="24" :lg="12">
          <a-card
            :bordered="false"
            class="h-full cursor-pointer overflow-hidden border-0 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg"
            :body-style="{ padding: '24px' }"
            @click="navigateToDomain(card.route || '/analytics')"
          >
            <div class="flex h-full flex-col justify-between gap-6">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <div class="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">{{ card.item.title }}</div>
                  <div class="mt-3 flex flex-wrap items-end gap-3">
                    <div class="text-4xl font-semibold text-slate-900">
                      {{ card.primaryMetric?.value ?? 0 }}
                    </div>
                    <div class="pb-1 text-sm text-slate-500">{{ card.primaryMetric?.name ?? '核心指标' }}</div>
                  </div>
                </div>
                <div
                  class="rounded-full px-3 py-1 text-xs font-medium"
                  :style="{
                    backgroundColor: `${card.accent}14`,
                    color: card.accent,
                  }"
                >
                  查看详情
                </div>
              </div>

              <div class="grid gap-3 sm:grid-cols-3">
                <div
                  v-for="metric in card.secondaryMetrics"
                  :key="metric.name"
                  class="rounded-2xl bg-slate-50 px-4 py-3"
                >
                  <div class="text-xs text-slate-400">{{ metric.name }}</div>
                  <div class="mt-2 text-lg font-semibold text-slate-900">{{ metric.value }}</div>
                </div>
              </div>
            </div>
          </a-card>
        </a-col>
      </a-row>
    </div>

    <a-row :gutter="[16, 16]" class="mt-6">
      <a-col :span="24" :xl="16">
        <div class="rounded-3xl bg-white p-5 shadow-sm lg:p-6">
          <div class="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div class="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">Primary Insight</div>
              <h2 class="mt-1 text-xl font-semibold text-slate-900">趋势与登录表现</h2>
              <p class="mt-2 text-sm text-slate-500">优先查看趋势变化，再决定是否进入更细的业务详情页。</p>
            </div>
            <div class="rounded-full bg-slate-100 px-3 py-2 text-sm text-slate-600">
              平均停留时长 {{ dwellSeconds }} 秒
            </div>
          </div>

          <AnalysisChartsTabs :tabs="chartTabs">
            <template #trends>
              <AnalyticsTrends :data="trendChartData" />
            </template>
            <template #visits>
              <AnalyticsVisits :data="loginTrendChartData" />
            </template>
          </AnalysisChartsTabs>
        </div>
      </a-col>

      <a-col :span="24" :xl="8">
        <a-card :bordered="false" class="h-full border-0 shadow-sm" :body-style="{ padding: '24px' }">
          <div class="flex h-full flex-col">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">Hot Spots</div>
                <h2 class="mt-1 text-xl font-semibold text-slate-900">景点访问排行</h2>
              </div>
              <div class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">
                TOP {{ rankedTopSpots.length }}
              </div>
            </div>

            <div class="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div class="rounded-2xl bg-slate-50 px-4 py-3">
                <div class="text-xs text-slate-400">最热视频景点</div>
                <div class="mt-2 text-base font-semibold text-slate-900">
                  {{ rankedTopSpots[0]?.name ?? '暂无数据' }}
                </div>
              </div>
              <div class="rounded-2xl bg-slate-50 px-4 py-3">
                <div class="text-xs text-slate-400">最高 PV</div>
                <div class="mt-2 text-base font-semibold text-slate-900">
                  {{ rankedTopSpots[0]?.pv ?? 0 }}
                </div>
              </div>
              <div class="rounded-2xl bg-slate-50 px-4 py-3">
                <div class="text-xs text-slate-400">最高 UV</div>
                <div class="mt-2 text-base font-semibold text-slate-900">
                  {{ rankedTopSpots[0]?.uv ?? 0 }}
                </div>
              </div>
            </div>

            <div class="mt-5 flex-1">
              <a-empty v-if="!rankedTopSpots.length" description="暂无景点访问数据" />
              <a-table
                v-else
                :columns="rankingColumns"
                :data-source="rankedTopSpots"
                :custom-row="(record: any) => ({
                  onClick: () => navigateToSpot(record.spotId),
                  style: { cursor: 'pointer' },
                })"
                :pagination="false"
                :row-key="(record: any) => record.spotId"
                size="small"
              />
            </div>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <div class="mt-6">
      <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div class="text-xs font-medium uppercase tracking-[0.24em] text-slate-400">Secondary Insight</div>
          <h2 class="mt-1 text-xl font-semibold text-slate-900">结构分布与用户特征</h2>
        </div>
        <div class="text-sm text-slate-500">用次级视图解释“趋势为什么发生”。</div>
      </div>

      <a-row :gutter="[16, 16]">
        <a-col :span="24" :md="12" :xl="8">
          <AnalysisChartCard class="h-full" title="访问设备分布">
            <div class="mb-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              当前最活跃设备类型：<span class="font-semibold text-slate-900">{{ deviceHeadline }}</span>
            </div>
            <AnalyticsVisitsData :data="overviewData?.deviceDistribution || []" />
          </AnalysisChartCard>
        </a-col>
        <a-col :span="24" :md="12" :xl="8">
          <AnalysisChartCard class="h-full" title="访问来源">
            <div class="mb-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              当前主导来源：<span class="font-semibold text-slate-900">{{ sourceHeadline }}</span>
            </div>
            <AnalyticsVisitsSource :data="overviewData?.sourceDistribution || []" />
          </AnalysisChartCard>
        </a-col>
        <a-col :span="24" :md="24" :xl="8">
          <AnalysisChartCard class="h-full" title="用户画像 / 行为路径">
            <div class="mb-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              当前首要特征：<span class="font-semibold text-slate-900">{{ profileHeadline }}</span>
            </div>
            <AnalyticsVisitsSales :data="profileOrBehaviorData" />
          </AnalysisChartCard>
        </a-col>
      </a-row>
    </div>
  </div>
</template>
