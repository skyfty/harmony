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
  type AnalyticsMetricItem,
} from '#/api'

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
  const domains = overviewData.value?.domains
  if (!domains) {
    return []
  }
  return Object.values(domains).map((item) => ({
    accent: {
      orders: '#b45309',
      punch: '#0f766e',
      travel: '#7c3aed',
      users: '#dc2626',
      vehicles: '#1d4ed8',
    }[item.key],
    item,
    route: domainRoutes[item.key],
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

const trendChartData = computed(() => {
  return (overviewData.value?.trend ?? []).map((item) => ({
    date: item.date,
    pv: item.pv,
    uv: item.uv,
  }))
})

const loginTrendChartData = computed(() => {
  return (overviewData.value?.loginTrend ?? []).map((item) => ({
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
  spotOptions.value = result.items.map((item) => ({
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

watch(routeSpotId, async (spotId) => {
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
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <a-select
          v-model:value="selectedSpotId"
          :options="spotOptions"
          allow-clear
          placeholder="选择景点（为空则全局）"
          style="width: 260px"
          @change="handleSpotChange"
        />
        <a-button :loading="loading" type="primary" @click="handleReload">刷新</a-button>
        <a-button v-if="isSpotDetail" @click="backToGlobal">返回全局分析</a-button>
      </div>
      <div class="text-sm text-gray-500">
        平均停留时长：{{ Math.round((overviewData?.overview.avgDwellMs || 0) / 1000) }} 秒
      </div>
    </div>

    <a-row :gutter="16">
      <a-col v-for="card in domainCards" :key="card.item.key" :span="24" :md="12" :xl="8">
        <a-card
          class="mb-4 cursor-pointer overflow-hidden border-0 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
          :body-style="{ padding: '18px' }"
          :bordered="false"
          @click="navigateToDomain(card.route || '/analytics')"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-sm font-medium text-slate-500">{{ card.item.title }}</div>
              <div class="mt-2 text-3xl font-semibold text-slate-900">
                {{ card.item.summary?.[0]?.value ?? 0 }}
              </div>
              <div class="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                <span v-for="metric in card.item.summary.slice(1, 4)" :key="metric.name" class="rounded-full bg-slate-100 px-2 py-1">
                  {{ metric.name }}：{{ metric.value }}
                </span>
              </div>
            </div>
            <a-tag :color="card.accent">详情页</a-tag>
          </div>
        </a-card>
      </a-col>
    </a-row>

    <AnalysisOverview :items="overviewItems" />

    <AnalysisChartsTabs :tabs="chartTabs" class="mt-5">
      <template #trends>
        <AnalyticsTrends :data="trendChartData" />
      </template>
      <template #visits>
        <AnalyticsVisits :data="loginTrendChartData" />
      </template>
    </AnalysisChartsTabs>

    <div class="mt-5 w-full md:flex">
      <AnalysisChartCard class="mt-5 md:mr-4 md:mt-0 md:w-1/3" title="访问设备分布">
        <AnalyticsVisitsData :data="overviewData?.deviceDistribution || []" />
      </AnalysisChartCard>
      <AnalysisChartCard class="mt-5 md:mr-4 md:mt-0 md:w-1/3" title="访问来源">
        <AnalyticsVisitsSource :data="overviewData?.sourceDistribution || []" />
      </AnalysisChartCard>
      <AnalysisChartCard class="mt-5 md:mt-0 md:w-1/3" title="用户画像 / 行为路径">
        <AnalyticsVisitsSales :data="profileOrBehaviorData" />
      </AnalysisChartCard>
    </div>

    <a-card class="mt-5" title="景点访问排行 (PV/UV)">
      <a-empty v-if="!topSpots.length" description="暂无景点访问数据" />
      <a-table
        v-else
        :columns="[
          { title: '景点', dataIndex: 'name', key: 'name' },
          { title: 'PV', dataIndex: 'pv', key: 'pv' },
          { title: 'UV', dataIndex: 'uv', key: 'uv' },
        ]"
        :data-source="topSpots"
        :custom-row="(record: any) => ({
          onClick: () => navigateToSpot(record.spotId),
          style: { cursor: 'pointer' },
        })"
        :pagination="false"
        :row-key="(record: any) => record.spotId"
        size="small"
      />
    </a-card>
  </div>
</template>
