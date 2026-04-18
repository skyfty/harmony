<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { message } from 'ant-design-vue'

import { getAnalyticsDomainSummaryApi, type AnalyticsDomainKey, type AnalyticsDomainSummaryResponse, type AnalyticsRecentItem } from '#/api'

interface Props {
  accent?: string
  description?: string
  domain: AnalyticsDomainKey
  title: string
}

const props = withDefaults(defineProps<Props>(), {
  accent: '#2563eb',
  description: '',
})

const router = useRouter()
const loading = ref(false)
const summaryData = ref<AnalyticsDomainSummaryResponse | null>(null)
const rangePreset = ref<'30d' | '7d' | '90d'>('30d')
const granularity = ref<'day' | 'week' | 'month'>('day')

const rangeMap = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
} as const

function resolveRange() {
  const days = rangeMap[rangePreset.value]
  const end = new Date()
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000)
  return {
    end: end.toISOString(),
    start: start.toISOString(),
  }
}

async function loadData() {
  loading.value = true
  try {
    const range = resolveRange()
    summaryData.value = await getAnalyticsDomainSummaryApi(props.domain, {
      end: range.end,
      granularity: granularity.value,
      limit: 10,
      start: range.start,
    })
  } catch (error) {
    message.error((error as Error)?.message || '加载统计数据失败')
  } finally {
    loading.value = false
  }
}

function goBack() {
  router.push('/analytics')
}

const summaryItems = computed(() => summaryData.value?.summary ?? [])
const trendItems = computed(() => summaryData.value?.trend ?? [])
const breakdownItems = computed(() => summaryData.value?.breakdown ?? [])
const recentItems = computed(() => summaryData.value?.recent ?? [])

const recentColumns = computed(() => {
  switch (props.domain) {
    case 'orders':
      return [
        { dataIndex: 'title', key: 'title', title: '订单号' },
        { dataIndex: 'subtitle', key: 'subtitle', title: '支付状态' },
        { dataIndex: 'value', key: 'value', title: '金额' },
        { dataIndex: 'status', key: 'status', title: '退款状态' },
        { dataIndex: 'createdAt', key: 'createdAt', title: '创建时间' },
      ]
    case 'punch':
      return [
        { dataIndex: 'title', key: 'title', title: '景点' },
        { dataIndex: 'subtitle', key: 'subtitle', title: '节点' },
        { dataIndex: 'value', key: 'value', title: '车辆' },
        { dataIndex: 'status', key: 'status', title: '来源' },
        { dataIndex: 'createdAt', key: 'createdAt', title: '创建时间' },
      ]
    case 'travel':
      return [
        { dataIndex: 'title', key: 'title', title: '景点' },
        { dataIndex: 'subtitle', key: 'subtitle', title: '车辆' },
        { dataIndex: 'value', key: 'value', title: '时长(秒)' },
        { dataIndex: 'status', key: 'status', title: '状态' },
        { dataIndex: 'createdAt', key: 'createdAt', title: '创建时间' },
      ]
    case 'users':
      return [
        { dataIndex: 'title', key: 'title', title: '昵称' },
        { dataIndex: 'subtitle', key: 'subtitle', title: '账号/邮箱' },
        { dataIndex: 'value', key: 'value', title: '签约状态' },
        { dataIndex: 'status', key: 'status', title: '账号状态' },
        { dataIndex: 'createdAt', key: 'createdAt', title: '创建时间' },
      ]
    case 'vehicles':
    default:
      return [
        { dataIndex: 'title', key: 'title', title: '车辆名称' },
        { dataIndex: 'subtitle', key: 'subtitle', title: '标识符' },
        { dataIndex: 'value', key: 'value', title: '状态' },
        { dataIndex: 'status', key: 'status', title: '默认' },
        { dataIndex: 'createdAt', key: 'createdAt', title: '创建时间' },
      ]
  }
})

function formatCellValue(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return '-'
  }
  return String(value)
}

function openRecentItem(row: AnalyticsRecentItem) {
  switch (props.domain) {
    case 'orders':
      router.push({ name: 'OrderDetail', params: { id: row.id } })
      return
    case 'punch':
      router.push({ name: 'PunchRecordDetail', params: { id: row.id } })
      return
    case 'travel':
      router.push({ name: 'TravelRecordDetail', params: { id: row.id } })
      return
    case 'users':
      router.push({ name: 'UserDetail', params: { id: row.id } })
      return
    default:
      return
  }
}

watch([rangePreset, granularity], () => {
  loadData()
})

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="p-5">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold text-slate-900">{{ title }}</h1>
        <p v-if="description" class="mt-1 text-sm text-slate-500">{{ description }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <a-select v-model:value="rangePreset" :options="[
          { label: '近 7 天', value: '7d' },
          { label: '近 30 天', value: '30d' },
          { label: '近 90 天', value: '90d' },
        ]" style="width: 130px" />
        <a-select v-model:value="granularity" :options="[
          { label: '按天', value: 'day' },
          { label: '按周', value: 'week' },
          { label: '按月', value: 'month' },
        ]" style="width: 130px" />
        <a-button :loading="loading" type="primary" @click="loadData">刷新</a-button>
        <a-button @click="goBack">返回分析首页</a-button>
      </div>
    </div>

    <a-row :gutter="16">
      <a-col v-for="item in summaryItems" :key="item.name" :span="24" :md="12" :xl="4">
        <a-card class="mb-4 shadow-sm" :bordered="false">
          <div class="text-xs uppercase tracking-wide text-slate-400">{{ item.name }}</div>
          <div class="mt-2 text-3xl font-semibold" :style="{ color: props.accent }">{{ item.value }}</div>
        </a-card>
      </a-col>
    </a-row>

    <a-row :gutter="16">
      <a-col :span="24" :lg="12">
        <a-card :bordered="false" class="mb-4" title="趋势概览">
          <a-empty v-if="!trendItems.length" description="暂无趋势数据" />
          <a-table
            v-else
            :columns="[
              { dataIndex: 'date', key: 'date', title: '日期' },
              { dataIndex: 'value', key: 'value', title: '数量' },
              { dataIndex: 'secondaryValue', key: 'secondaryValue', title: '辅助指标' },
            ]"
            :data-source="trendItems"
            :pagination="false"
            :row-key="(record: any) => record.date"
            size="small"
          />
        </a-card>
      </a-col>
      <a-col :span="24" :lg="12">
        <a-card :bordered="false" class="mb-4" title="分布概览">
          <a-empty v-if="!breakdownItems.length" description="暂无分布数据" />
          <a-table
            v-else
            :columns="[
              { dataIndex: 'name', key: 'name', title: '名称' },
              { dataIndex: 'value', key: 'value', title: '数量' },
            ]"
            :data-source="breakdownItems"
            :pagination="false"
            :row-key="(record: any) => record.name"
            size="small"
          />
        </a-card>
      </a-col>
    </a-row>

    <a-card :bordered="false" class="mb-4" title="最近记录">
      <a-empty v-if="!recentItems.length" description="暂无最近记录" />
      <a-table
        v-else
        :columns="recentColumns"
        :data-source="recentItems"
        :pagination="false"
        :row-key="(record: any) => record.id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <span v-if="column.dataIndex === 'title'">
            <a-button type="link" @click="openRecentItem(record)">{{ formatCellValue(record.title) }}</a-button>
          </span>
          <span v-else>
            {{ formatCellValue(record[column.dataIndex]) }}
          </span>
        </template>
      </a-table>
    </a-card>
  </div>
</template>
