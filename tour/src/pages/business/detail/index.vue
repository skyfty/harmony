<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader title="订单详情">
      <template #right>
        <BusinessHeaderAction @tap="openCreatePage" />
      </template>
    </PageHeader>

    <view class="content">
      <view v-if="loading" class="card">
        <text class="card-title">加载中...</text>
      </view>

      <template v-else-if="order">
        <view
          v-if="order.service.status === 'expiring' || order.service.status === 'expired'"
          class="alert-banner"
          :class="`alert-banner--${order.service.status}`"
        >
          <text class="alert-title">{{ order.service.status === 'expired' ? '服务已结束' : '服务即将到期' }}</text>
          <text class="alert-desc">
            {{ order.service.status === 'expired' ? '请尽快续费以恢复服务与运营支持。' : `当前服务剩余 ${order.service.daysRemaining || 0} 天，建议尽快续费。` }}
          </text>
          <button class="alert-btn" @tap="openRenewPage">立即续费</button>
        </view>

        <view class="hero-card">
          <view class="hero-card__glow hero-card__glow--one" />
          <view class="hero-card__glow hero-card__glow--two" />
          <view class="hero-card__glow hero-card__glow--three" />
          <view class="hero-card__line" />
          <text class="hero-title">{{ order.scenicName }}</text>
          <text class="hero-order">{{ order.orderNumber }}</text>
          <view class="hero-badges">
            <text class="badge">{{ stageText(order.topStage) }}</text>
            <text class="badge badge--service" :class="`badge--${order.service.status}`">{{ serviceStatusText(order.service.status) }}</text>
          </view>
        </view>

        <view class="card">
          <text class="card-title">服务周期</text>
          <view class="metric-grid metric-grid--panel">
            <view class="metric-item">
              <text class="metric-label">开始时间</text>
              <text class="metric-value">{{ formatDateTime(order.service.startAt) || '待开启' }}</text>
            </view>
            <view class="metric-item">
              <text class="metric-label">结束时间</text>
              <text class="metric-value">{{ formatDateTime(order.service.endAt) || '待设置' }}</text>
            </view>
            <view class="metric-item">
              <text class="metric-label">剩余天数</text>
              <text class="metric-value">{{ daysRemainingText(order) }}</text>
            </view>
            <view class="metric-item">
              <text class="metric-label">续费次数</text>
              <text class="metric-value">{{ order.renewalCount }}</text>
            </view>
          </view>
          <button v-if="order.topStage === 'operation'" class="primary-btn metric-btn" @tap="openRenewPage">发起续费</button>
        </view>

        <view v-if="isOperationStage" class="card">
          <text class="card-title">交付信息</text>
          <view class="detail-list">
            <view class="detail-row">
              <text class="detail-label">交付场景</text>
              <text class="detail-value">{{ order.delivery.sceneSpotTitle || '待绑定' }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">商务电话</text>
              <text class="detail-value">{{ order.contactPhoneForBusiness || '暂无' }}</text>
            </view>
          </view>
        </view>

        <view v-if="isOperationStage" class="card">
          <view class="section-head">
            <view>
              <text class="card-title">分享素材</text>
            </view>
          </view>

          <view class="share-qrcode-panel">
            <view class="detail-row detail-row--compact">
              <text class="detail-label">分享路径</text>
              <view class="share-row">
                <text class="share-row__hint">{{ sharePathHintText }}</text>
                <button
                  class="share-row__btn"
                  :class="{ 'share-row__btn--disabled': !sharePath }"
                  :disabled="!sharePath || sharePathCopying"
                  @tap="copySharePath"
                >
                  {{ sharePathCopying ? '复制中...' : '复制路径' }}
                </button>
              </view>
            </view>

            <view class="detail-row detail-row--compact share-qrcode-panel__label-row">
              <text class="detail-label">二维码名称</text>
              <text class="detail-value">{{ shareQrTitle }}</text>
            </view>

            <view v-if="shareQrLoading" class="share-qrcode-panel__state">二维码生成中...</view>
            <view v-else-if="shareQrError" class="share-qrcode-panel__state share-qrcode-panel__state--error">
              {{ shareQrError }}
            </view>
            <template v-else-if="shareQrImage">
              <image
                class="share-qrcode-panel__image"
                :src="shareQrImage"
                mode="aspectFit"
                show-menu-by-longpress
                @tap="previewShareQrCode"
              />
              <text class="share-qrcode-panel__footer">点击可预览，长按可直接分享或保存到相册</text>
            </template>
            <view v-else class="share-qrcode-panel__state">暂无可用二维码</view>
          </view>
        </view>

        <view class="card">
          <text class="card-title">订单基础信息</text>
          <view class="detail-list">
            <view class="detail-row detail-row--two-col">
              <view class="detail-cell">
                <text class="detail-label">景点类型</text>
                <text class="detail-value">{{ order.sceneSpotCategoryName || '未填写' }}</text>
              </view>
              <view class="detail-cell">
                <text class="detail-label">景点面积</text>
                <text class="detail-value">{{ order.scenicArea ?? '-' }}</text>
              </view>
            </view>
            <view class="detail-row detail-row--two-col">
              <view class="detail-cell">
                <text class="detail-label">联系电话</text>
                <text class="detail-value">{{ order.contactPhone }}</text>
              </view>
              <view class="detail-cell">
                <text class="detail-label">地址</text>
                <text class="detail-value detail-value--multi">{{ order.addressText }}</text>
              </view>
            </view>
          </view>
        </view>

        <view v-if="order.topStage !== 'operation'" class="card">
          <text class="card-title">交付进度</text>
          <view class="timeline">
            <view v-for="item in order.productionProgress" :key="item.code" class="timeline-item">
              <view class="timeline-dot" :class="`timeline-dot--${item.status}`" />
              <view class="timeline-content">
                <text class="timeline-title">{{ item.label }}</text>
                <text class="timeline-meta">{{ progressText(item.status) }}</text>
                <text v-if="item.activatedAt" class="timeline-meta">{{ formatDateTime(item.activatedAt) }}</text>
                <text v-if="item.remark" class="timeline-meta">{{ item.remark }}</text>
              </view>
            </view>
          </view>
        </view>

        <view v-if="isOperationStage" class="card">
          <text class="card-title">续费记录</text>
          <view v-if="!order.renewalHistory.length" class="empty-inline">暂无续费记录</view>
          <view v-else>
            <view v-for="item in order.renewalHistory" :key="item.id" class="renew-card">
              <view class="renew-card__top">
                <text class="renew-card__title">{{ item.orderNumber }}</text>
                <text class="renew-badge" :class="`renew-badge--${item.approvedAt ? 'approved' : item.paymentStatus === 'failed' ? 'failed' : 'pending'}`">
                  {{ item.approvedAt ? '已生效' : item.paymentStatus === 'failed' ? '支付失败' : '待生效' }}
                </text>
              </view>
              <text class="renew-card__meta">{{ formatDateTime(item.serviceStartAt) || '-' }} 至 {{ formatDateTime(item.serviceEndAt) || '-' }}</text>
              <text class="renew-card__meta">时长 {{ item.durationDays }} 天 · 金额 {{ item.price }} · {{ paymentStatusText(item.paymentStatus) }}</text>
            </view>
          </view>
        </view>

        <view v-if="isOperationStage" class="card">
          <view class="section-head">
            <view>
              <text class="card-title">运营数据</text>
            </view>
          </view>

          <view v-if="analyticsLoading" class="empty-inline">加载运营数据中...</view>
          <view v-else-if="!order.analyticsAvailable" class="empty-inline">订单进入运营并绑定交付场景后可查看运营数据</view>
          <template v-else-if="analytics">
            <view class="metric-grid metric-grid--panel">
              <view class="metric-item">
                <text class="metric-label">累计用户数</text>
                <text class="metric-value">{{ analytics.overview.totalUv }}</text>
              </view>
              <view class="metric-item">
                <text class="metric-label">日访问人数</text>
                <text class="metric-value">{{ analytics.overview.todayUv }}</text>
              </view>
              <view class="metric-item">
                <text class="metric-label">日新增用户</text>
                <text class="metric-value">{{ analytics.overview.todayNewUsers }}</text>
              </view>
              <view class="metric-item">
                <text class="metric-label">打卡总数</text>
                <text class="metric-value">{{ analytics.overview.totalPunchCount }}</text>
              </view>
            </view>

            <view class="chart-card">
              <view class="chart-head">
                <view>
                  <text class="subsection-title">访问趋势</text>
                </view>
              </view>

              <view class="chart-controls">
                <scroll-view class="chart-controls__scroll" scroll-x :show-scrollbar="false">
                  <view class="chart-controls__row">
                    <text
                      v-for="item in trendRangeOptions"
                      :key="item.value"
                      class="chip chip--small"
                      :class="{ 'chip--active': trendRangeDays === item.value }"
                      @tap="setTrendRange(item.value)"
                    >
                      {{ item.label }}
                    </text>
                  </view>
                </scroll-view>
                <scroll-view class="chart-controls__scroll" scroll-x :show-scrollbar="false">
                  <view class="chart-controls__row">
                    <text
                      class="chip"
                      :class="{ 'chip--active': trendGranularity === 'day' }"
                      @tap="setTrendGranularity('day')"
                    >
                      按日
                    </text>
                    <text
                      class="chip"
                      :class="{ 'chip--active': trendGranularity === 'month' }"
                      @tap="setTrendGranularity('month')"
                    >
                      按月
                    </text>
                    <text
                      v-for="item in trendMetricOptions"
                      :key="item.value"
                      class="chip chip--small"
                      :class="{ 'chip--active': trendMetric === item.value }"
                      @tap="setTrendMetric(item.value)"
                    >
                      {{ item.label }}
                    </text>
                  </view>
                </scroll-view>
              </view>

              <view v-if="trendChartData.categories.length" class="chart-wrap">
                <qiun-data-charts
                  :type="trendChartType"
                  :chart-data="trendChartData"
                  :opts="trendChartOpts"
                  :canvas2d="true"
                  :animation="true"
                  background="transparent"
                />
              </view>
              <view v-else class="empty-inline">暂无趋势数据</view>
            </view>

            <view class="chart-card">
              <view class="chart-head">
                <view>
                  <text class="subsection-title">访问分类统计</text>
                </view>
                <view class="chip-group">
                  <text
                    class="chip"
                    :class="{ 'chip--active': breakdownDimension === 'checkpoint' }"
                    @tap="setBreakdownDimension('checkpoint')"
                  >
                    打卡点
                  </text>
                  <text
                    class="chip"
                    :class="{ 'chip--active': breakdownDimension === 'category' }"
                    @tap="setBreakdownDimension('category')"
                  >
                    按分类
                  </text>
                </view>
              </view>

              <view v-if="breakdownChartData.categories.length" class="chart-wrap chart-wrap--bar">
                <qiun-data-charts
                  type="bar"
                  :chart-data="breakdownChartData"
                  :opts="breakdownChartOpts"
                  :canvas2d="true"
                  :animation="true"
                  background="transparent"
                />
              </view>
              <view v-else class="empty-inline">暂无分类统计</view>

              <view v-if="breakdownRows.length" class="rank-list">
                <view class="rank-list__head">
                  <text>Top 排行</text>
                  <text>{{ breakdownDimension === 'checkpoint' ? '打卡点' : '分类' }}</text>
                </view>
                <view v-for="item in breakdownRows" :key="item.name" class="rank-item">
                  <view class="rank-item__main">
                    <text class="rank-item__name">{{ item.name }}</text>
                    <text class="rank-item__meta">访问 {{ item.punchCount }} · 人数 {{ item.userCount }}</text>
                  </view>
                  <view class="rank-item__bar">
                    <view class="rank-item__fill" :style="{ width: `${item.ratio}%` }" />
                  </view>
                </view>
              </view>
            </view>
          </template>
        </view>
      </template>
    </view>

    <canvas
      canvas-id="business-share-qrcode"
      class="share-qrcode-canvas"
    />
  </view>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, ref, watch } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import QRCode from 'qrcode'
import BusinessHeaderAction from '@/components/BusinessHeaderAction.vue'
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue'
import PageHeader from '@/components/PageHeader.vue'
import QiunDataCharts from '@/components/qiun-data-charts/qiun-data-charts.vue'
import { getBusinessOrderAnalytics, getBusinessOrderDetail } from '@/api/mini'
import type {
  BusinessAnalyticsDimension,
  BusinessAnalyticsGranularity,
  BusinessAnalyticsMetric,
  BusinessOrder,
  BusinessOrderAnalytics,
  BusinessServiceStatus,
  BusinessTopStage,
} from '@/types/business'

const loading = ref(true)
const analyticsLoading = ref(false)
const order = ref<BusinessOrder | null>(null)
const analytics = ref<BusinessOrderAnalytics | null>(null)
const orderId = ref('')
const trendRangeDays = ref<7 | 30 | 90>(7)
const trendGranularity = ref<BusinessAnalyticsGranularity>('day')
const trendMetric = ref<BusinessAnalyticsMetric>('uv')
const breakdownDimension = ref<BusinessAnalyticsDimension>('checkpoint')
const sharePathCopying = ref(false)
const shareQrLoading = ref(false)
const shareQrSaving = ref(false)
const shareQrImage = ref('')
const shareQrError = ref('')
const currentInstance = getCurrentInstance()
const shareQrCanvasId = 'business-share-qrcode'
let latestShareQrRequest: symbol | null = null

const trendRangeOptions: Array<{ label: string; value: 7 | 30 | 90 }> = [
  { label: '7天', value: 7 },
  { label: '30天', value: 30 },
  { label: '90天', value: 90 },
]

const trendMetricOptions: Array<{ label: string; value: BusinessAnalyticsMetric }> = [
  { label: 'UV', value: 'uv' },
  { label: 'PV', value: 'pv' },
  { label: '新增用户', value: 'newUsers' },
  { label: '打卡数', value: 'punchCount' },
]

let analyticsRequestToken = 0

const trendChartType = computed(() => (trendGranularity.value === 'month' ? 'column' : 'line'))
const trendChartData = computed(() => {
  const chart = analytics.value?.charts?.trend
  const categories = chart?.categories ?? analytics.value?.visitTrend.map((item) => item.date) ?? []
  const displayCategories = buildReadableTrendCategories(categories, trendGranularity.value, trendRangeDays.value)
  if (chart) {
    return {
      categories: displayCategories,
      series: chart.series.map((series) => ({
        name: series.name,
        data: series.data,
      })),
    }
  }
  return {
    categories: displayCategories,
    series: [
      {
        name: metricLabel(trendMetric.value),
        data: analytics.value?.visitTrend.map((item) => metricValueFromTrend(item, trendMetric.value)) ?? [],
      },
    ],
  }
})
const breakdownChartData = computed(() => analytics.value?.charts?.breakdown ?? { categories: [], series: [] })
const breakdownRows = computed(() => {
  const chart = breakdownChartData.value
  const primarySeries = chart.series[0]?.data ?? []
  const secondarySeries = chart.series[1]?.data ?? []
  const rows = chart.categories.map((name, index) => {
    const punchCount = Number(primarySeries[index] ?? 0)
    const userCount = Number(secondarySeries[index] ?? 0)
    return {
      name,
      punchCount,
      userCount,
      ratio: 0,
    }
  })
  const sortedRows = rows
    .sort((left, right) => right.punchCount - left.punchCount)
    .slice(0, 8)
  const maxValue = sortedRows[0]?.punchCount || 0
  return sortedRows.map((item) => ({
    ...item,
    ratio: maxValue > 0 ? Math.max(8, Math.round((item.punchCount / maxValue) * 100)) : 0,
  }))
})
const trendSummaryText = computed(() => {
  const granularityLabel = trendGranularity.value === 'month' ? '按月' : '按日'
  return `${granularityLabel} · ${metricLabel(trendMetric.value)} · 最近 ${trendRangeDays.value} 天`
})
const isOperationStage = computed(() => order.value?.topStage === 'operation')
const sharePath = computed(() => order.value?.share.miniProgramPath?.trim() ?? '')
const shareQrLink = computed(() => order.value?.share.wechatRuleLink?.trim() ?? '')
const shareQrTitle = computed(() => '微信小程序二维码')
const sharePathHintText = computed(() => (sharePath.value ? '复制后可手动粘贴使用' : '暂无可复制路径'))
const shareQrHintText = computed(() => {
  if (shareQrLink.value) {
    return '图片内容与微信小程序二维码规则链接一致'
  }
  return '暂无可生成二维码的规则链接'
})

const trendChartOpts = computed(() => ({
  color: colorPaletteForMetric(trendMetric.value),
  padding: [14, 8, 18, 0],
  legend: { show: false },
  dataLabel: false,
  enableScroll: trendGranularity.value === 'day',
  xAxis: {
    disableGrid: true,
    itemCount: trendGranularity.value === 'day' ? 3 : 4,
    labelCount: trendGranularity.value === 'day' ? 3 : 4,
    fontSize: 9,
    rotateLabel: false,
  },
  yAxis: {
    gridType: 'dash',
    dashLength: 4,
    data: [{ min: 0, fontSize: 8, color: '#8a97a8' }],
    splitNumber: 3,
  },
  extra: {
    area: {
      type: 'curve',
      opacity: 0.18,
      addLine: true,
      width: 2,
      gradient: true,
      activeType: 'hollow',
    },
    line: {
      type: 'curve',
      width: 1.8,
      activeType: 'hollow',
    },
    column: {
      type: 'group',
      width: 24,
      activeBgColor: '#000000',
      activeBgOpacity: 0.08,
    },
  },
}))
const breakdownChartOpts = computed(() => ({
  color: ['#1890FF', '#26A69A'],
  padding: [18, 8, 18, 0],
  legend: { show: true, position: 'top', lineHeight: 20 },
  dataLabel: false,
  xAxis: {
    boundaryGap: 'justify',
    disableGrid: false,
    axisLine: false,
  },
  yAxis: {
    data: [{ min: 0, fontSize: 8, color: '#8a97a8' }],
    splitNumber: 3,
  },
  extra: {
    bar: {
      type: 'group',
      width: 18,
      meterBorde: 1,
      meterFillColor: '#FFFFFF',
      activeBgColor: '#000000',
      activeBgOpacity: 0.08,
    },
  },
}))

onLoad((options) => {
  orderId.value = typeof options?.id === 'string' ? options.id : ''
})

onShow(() => {
  void loadDetail()
})

watch(shareQrLink, (link) => {
  void updateShareQrImage(link)
}, { immediate: true })

watch([trendRangeDays, trendGranularity, trendMetric, breakdownDimension], () => {
  if (order.value?.analyticsAvailable) {
    void loadAnalytics()
  }
})

async function loadDetail() {
  if (!orderId.value) {
    return
  }
  loading.value = true
  try {
    const response = await getBusinessOrderDetail(orderId.value)
    order.value = response
    await loadAnalytics()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '订单加载失败'
    void uni.showToast({ title: message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

async function loadAnalytics() {
  if (!order.value?.analyticsAvailable) {
    analytics.value = null
    return
  }
  const token = ++analyticsRequestToken
  analyticsLoading.value = true
  try {
    const { start, end } = buildTrendDateRange(trendRangeDays.value, trendGranularity.value)
    const response = await getBusinessOrderAnalytics(orderId.value, {
      granularity: trendGranularity.value,
      metric: trendMetric.value,
      dimension: breakdownDimension.value,
      limit: 8,
      start,
      end,
    })
    if (token === analyticsRequestToken) {
      analytics.value = response
    }
  } catch {
    if (token === analyticsRequestToken) {
      analytics.value = null
    }
  } finally {
    if (token === analyticsRequestToken) {
      analyticsLoading.value = false
    }
  }
}

async function updateShareQrImage(link: string) {
  const trimmedLink = link.trim()
  const requestToken = Symbol('shareQr')
  latestShareQrRequest = requestToken

  if (!trimmedLink) {
    shareQrLoading.value = false
    shareQrSaving.value = false
    shareQrError.value = ''
    shareQrImage.value = ''
    return
  }

  shareQrLoading.value = true
  shareQrSaving.value = false
  shareQrError.value = ''
  shareQrImage.value = ''

  try {
    await nextTick()
    const image = await renderShareQrImage(trimmedLink)
    if (latestShareQrRequest === requestToken) {
      shareQrImage.value = image
    }
  } catch (error: unknown) {
    if (latestShareQrRequest === requestToken) {
      shareQrError.value = getErrorMessage(error, '二维码生成失败')
    }
  } finally {
    if (latestShareQrRequest === requestToken) {
      shareQrLoading.value = false
    }
  }
}

function setTrendGranularity(value: BusinessAnalyticsGranularity) {
  trendGranularity.value = value
}

function setTrendRange(value: 7 | 30 | 90) {
  trendRangeDays.value = value
}

function setTrendMetric(value: BusinessAnalyticsMetric) {
  trendMetric.value = value
}

function setBreakdownDimension(value: BusinessAnalyticsDimension) {
  breakdownDimension.value = value
}

function openCreatePage() {
  void uni.navigateTo({ url: '/pages/business/create/index' })
}

function openRenewPage() {
  void uni.navigateTo({ url: `/pages/business/renew/index?id=${encodeURIComponent(orderId.value)}` })
}

async function copySharePath() {
  if (!sharePath.value || sharePathCopying.value) {
    if (!sharePath.value) {
      void uni.showToast({ title: '暂无可复制路径', icon: 'none' })
    }
    return
  }

  sharePathCopying.value = true
  try {
    await new Promise<void>((resolve, reject) => {
      uni.setClipboardData({
        data: sharePath.value,
        success: () => resolve(),
        fail: (error: unknown) => reject(error),
      })
    })
    void uni.showToast({ title: '路径已复制', icon: 'none' })
  } catch (error: unknown) {
    void uni.showToast({ title: getErrorMessage(error, '复制失败'), icon: 'none' })
  } finally {
    sharePathCopying.value = false
  }
}

async function saveShareQrCode() {
  if (!shareQrImage.value || shareQrSaving.value) {
    if (!shareQrImage.value) {
      void uni.showToast({ title: '暂无可保存二维码', icon: 'none' })
    }
    return
  }

  shareQrSaving.value = true
  try {
    await saveImageToAlbum(shareQrImage.value)
    void uni.showToast({ title: '已保存到相册', icon: 'none' })
  } catch (error: unknown) {
    const message = getErrorMessage(error, '保存失败')
    if (shouldPromptPhotoPermission(message)) {
      void uni.showModal({
        title: '需要相册权限',
        content: '请在授权设置中允许访问相册后重试。',
        confirmText: '去设置',
        success: (result) => {
          if (result.confirm && typeof uni.openSetting === 'function') {
            uni.openSetting({})
          }
        },
      })
    } else {
      void uni.showToast({ title: message, icon: 'none' })
    }
  } finally {
    shareQrSaving.value = false
  }
}

function previewShareQrCode() {
  if (!shareQrImage.value) {
    return
  }
  uni.previewImage({
    urls: [shareQrImage.value],
    current: shareQrImage.value,
  })
}

function stageText(stage: BusinessTopStage) {
  if (stage === 'signing') return '签约中'
  if (stage === 'production') return '制作中'
  if (stage === 'publish') return '待运营'
  if (stage === 'operation') return '运营中'
  return '待确认'
}

function serviceStatusText(status: BusinessServiceStatus) {
  if (status === 'active') return '服务中'
  if (status === 'expiring') return '即将到期'
  if (status === 'expired') return '已到期'
  return '待生效'
}

function paymentStatusText(status: BusinessOrder['renewalHistory'][number]['paymentStatus']) {
  if (status === 'processing') return '支付中'
  if (status === 'succeeded') return '已支付'
  if (status === 'failed') return '支付失败'
  if (status === 'refunded') return '已退款'
  if (status === 'closed') return '已关闭'
  return '未支付'
}

function daysRemainingText(item: BusinessOrder) {
  if (item.service.daysRemaining == null) return '待生效'
  if (item.service.daysRemaining <= 0) return '已到期'
  return `${item.service.daysRemaining} 天`
}

function progressText(status: 'pending' | 'active' | 'completed') {
  if (status === 'completed') return '已完成'
  if (status === 'active') return '进行中'
  return '待开始'
}

function formatDateTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}.${month}.${day}`
}

function formatChartCategory(value: string, granularity: BusinessAnalyticsGranularity) {
  if (granularity === 'month') {
    const [year, month] = value.split('-')
    return year && month ? `${year.slice(2)}-${month}` : value
  }
  const parts = value.split('-')
  if (parts.length === 3) {
    return `${parts[1]}/${parts[2]}`
  }
  return value
}

function buildTrendDateRange(rangeDays: 7 | 30 | 90, granularity: BusinessAnalyticsGranularity) {
  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - (rangeDays - 1))
  if (granularity === 'month') {
    startDate.setDate(1)
  }
  startDate.setHours(0, 0, 0, 0)
  endDate.setHours(23, 59, 59, 999)
  return {
    start: formatShanghaiDateTime(startDate, false),
    end: formatShanghaiDateTime(endDate, true),
  }
}

function buildReadableTrendCategories(categories: string[], granularity: BusinessAnalyticsGranularity, rangeDays: 7 | 30 | 90) {
  if (categories.length <= 8) {
    return categories.map((item) => formatChartCategory(item, granularity))
  }
  const sparseCount = rangeDays === 7 ? 3 : rangeDays === 30 ? 4 : 5
  const bucket = Math.max(1, Math.ceil(categories.length / sparseCount))
  return categories.map((item, index) => {
    const isEdge = index === 0 || index === categories.length - 1
    const isMiddle = index > 0 && index < categories.length - 1 && index % bucket === 0
    return isEdge || isMiddle ? formatChartCategory(item, granularity) : ''
  })
}

function metricLabel(metric: BusinessAnalyticsMetric) {
  if (metric === 'pv') return '访问次数'
  if (metric === 'newUsers') return '新增用户'
  if (metric === 'punchCount') return '打卡次数'
  return '访问人数'
}

function metricValueFromTrend(item: BusinessOrderAnalytics['visitTrend'][number], metric: BusinessAnalyticsMetric) {
  if (metric === 'pv') return Number(item.pv ?? 0)
  if (metric === 'newUsers') return Number(item.newUsers ?? 0)
  if (metric === 'punchCount') return Number((item as BusinessOrderAnalytics['visitTrend'][number] & { punchCount?: number }).punchCount ?? 0)
  return Number(item.uv ?? 0)
}

function colorPaletteForMetric(metric: BusinessAnalyticsMetric) {
  if (metric === 'pv') return ['#6C63FF']
  if (metric === 'newUsers') return ['#F59E0B']
  if (metric === 'punchCount') return ['#16A34A']
  return ['#1890FF']
}

function formatShanghaiDateTime(date: Date, endOfDay: boolean) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const time = endOfDay ? '23:59:59.999' : '00:00:00.000'
  return `${year}-${month}-${day}T${time}+08:00`
}

async function renderShareQrImage(link: string): Promise<string> {
  const proxy = currentInstance?.proxy
  if (!proxy) {
    throw new Error('页面实例不可用')
  }

  const qrData = QRCode.create(link, {
    errorCorrectionLevel: 'M',
    margin: 1,
  })
  const canvasSize = 320
  const outerPadding = 18
  const moduleCount = qrData.modules.size
  const moduleSize = Math.max(4, Math.floor((canvasSize - outerPadding * 2) / moduleCount))
  const actualSize = moduleSize * moduleCount
  const offset = Math.floor((canvasSize - actualSize) / 2)
  const context = uni.createCanvasContext(shareQrCanvasId, proxy)

  context.setFillStyle('#FFFFFF')
  context.fillRect(0, 0, canvasSize, canvasSize)
  context.setFillStyle('#111827')

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (qrData.modules.get(row, col)) {
        context.fillRect(offset + col * moduleSize, offset + row * moduleSize, moduleSize, moduleSize)
      }
    }
  }

  return await new Promise<string>((resolve, reject) => {
    context.draw(false, () => {
      uni.canvasToTempFilePath({
        canvasId: shareQrCanvasId,
        width: canvasSize,
        height: canvasSize,
        destWidth: canvasSize * 2,
        destHeight: canvasSize * 2,
        fileType: 'png',
        success: (result) => {
          resolve(result.tempFilePath)
        },
        fail: (error: unknown) => {
          reject(error)
        },
      }, proxy)
    })
  })
}

async function saveImageToAlbum(filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: (error: unknown) => reject(error),
    })
  })
}

function shouldPromptPhotoPermission(message: string): boolean {
  const text = message.toLowerCase()
  return text.includes('auth deny')
    || text.includes('permission')
    || text.includes('scope.writephotosalbum')
    || text.includes('deny')
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return fallback
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(255, 159, 67, 0.16), transparent 26%),
    linear-gradient(180deg, #13243b 0%, #13243b 14%, #f4f6f8 14%, #f7f8fa 100%);
}

.content {
  padding: 16px;
}

.hero-card,
.card,
.alert-banner {
  border-radius: 24px;
  box-shadow: 0 18px 40px rgba(16, 35, 57, 0.08);
}

.hero-card {
  position: relative;
  overflow: hidden;
  padding: 22px 20px;
  background:
    radial-gradient(circle at top right, rgba(255, 166, 77, 0.22), transparent 28%),
    radial-gradient(circle at left bottom, rgba(92, 143, 255, 0.18), transparent 34%),
    linear-gradient(135deg, #10284a 0%, #19365e 48%, #2c4f80 100%);
  color: #fff;
}

.hero-card::after {
  content: '';
  position: absolute;
  inset: -30% -20%;
  background:
    linear-gradient(120deg, transparent 35%, rgba(255, 255, 255, 0.06) 50%, transparent 65%),
    radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.12), transparent 18%);
  opacity: 0.9;
  animation: floatTexture 14s linear infinite;
  pointer-events: none;
}

.hero-card__glow {
  position: absolute;
  border-radius: 999px;
  filter: blur(2px);
  pointer-events: none;
}

.hero-card__glow--one {
  top: -24px;
  right: -18px;
  width: 120px;
  height: 120px;
  background: radial-gradient(circle, rgba(255, 196, 79, 0.32) 0%, rgba(255, 196, 79, 0) 72%);
  animation: glowPulse 6s ease-in-out infinite;
}

.hero-card__glow--two {
  left: -24px;
  bottom: -30px;
  width: 150px;
  height: 150px;
  background: radial-gradient(circle, rgba(84, 179, 255, 0.22) 0%, rgba(84, 179, 255, 0) 72%);
  animation: glowPulse 8s ease-in-out infinite reverse;
}

.hero-card__glow--three {
  top: 34%;
  right: 18%;
  width: 84px;
  height: 84px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0) 70%);
  animation: driftBubble 10s ease-in-out infinite;
}

.hero-card__line {
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, transparent 28%, rgba(255, 255, 255, 0.12) 46%, transparent 62%);
  transform: translateX(-40%);
  animation: shineSweep 10s ease-in-out infinite;
  pointer-events: none;
}

.hero-card > :not(.hero-card__glow):not(.hero-card__line) {
  position: relative;
  z-index: 1;
}

.hero-title {
  font-size: 22px;
  font-weight: 700;
}

.hero-order {
  margin-top: 6px;
  display: block;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.74);
}

.hero-badges {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.badge {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  font-size: 12px;
}

.badge--service.badge--active {
  background: rgba(17, 120, 100, 0.9);
}

.badge--service.badge--expiring {
  background: rgba(243, 156, 18, 0.92);
}

.badge--service.badge--expired {
  background: rgba(192, 57, 43, 0.92);
}

.badge--service.badge--pending {
  background: rgba(141, 153, 174, 0.9);
}

@keyframes glowPulse {
  0%, 100% {
    opacity: 0.55;
    transform: scale(0.92);
  }
  50% {
    opacity: 0.9;
    transform: scale(1.05);
  }
}

@keyframes shineSweep {
  0% {
    transform: translateX(-55%) skewX(-12deg);
    opacity: 0;
  }
  22% {
    opacity: 0.55;
  }
  50% {
    transform: translateX(35%) skewX(-12deg);
    opacity: 0.18;
  }
  100% {
    transform: translateX(75%) skewX(-12deg);
    opacity: 0;
  }
}

@keyframes floatTexture {
  0% {
    transform: translate3d(-2%, -2%, 0) rotate(0deg);
  }
  50% {
    transform: translate3d(2%, 2%, 0) rotate(8deg);
  }
  100% {
    transform: translate3d(-2%, -2%, 0) rotate(0deg);
  }
}

@keyframes driftBubble {
  0%, 100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-8px) scale(1.06);
  }
}

.alert-banner {
  margin-bottom: 14px;
  padding: 18px;
}

.alert-banner--expiring {
  background: linear-gradient(135deg, rgba(255, 196, 79, 0.22), rgba(255, 151, 0, 0.12));
}

.alert-banner--expired {
  background: linear-gradient(135deg, rgba(192, 57, 43, 0.14), rgba(140, 29, 24, 0.08));
}

.alert-title {
  color: #13243b;
  font-size: 16px;
  font-weight: 700;
}

.alert-desc {
  margin-top: 6px;
  display: block;
  color: #526274;
  font-size: 13px;
  line-height: 1.6;
}

.alert-btn {
  margin-top: 12px;
  min-height: 38px;
  line-height: 38px;
  padding: 0 18px;
  border-radius: 999px;
  background: #13243b;
  color: #fff;
  font-size: 13px;
}

.card {
  margin-top: 14px;
  padding: 18px;
  background: #fff;
}

.card-title,
.subsection-title {
  color: #13243b;
  font-size: 16px;
  font-weight: 700;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.section-desc {
  margin-top: 4px;
  display: block;
  color: #8d99ae;
  font-size: 12px;
  line-height: 1.5;
}

.metric-grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.metric-grid--panel .metric-item {
  position: relative;
  padding-top: 22px;
  border: 1px solid #e7edf4;
  background: #fbfcfe;
}

.metric-grid--panel .metric-label {
  position: absolute;
  top: -8px;
  left: 14px;
  z-index: 1;
  padding: 0 6px;
  background: #fff;
  color: #8190a4;
  font-size: 11px;
  line-height: 16px;
}

.metric-item {
  padding: 14px;
  border-radius: 18px;
  background: #f5f7fb;
}

.metric-label {
  color: #8190a4;
  font-size: 11px;
}

.metric-value {
  margin-top: 6px;
  text-align: center;
  color: #13243b;
  font-size: 17px;
  font-weight: 700;
}

.metric-btn {
  margin-top: 14px;
}

.detail-list {
  margin-top: 12px;
}

.detail-row {
  padding: 12px 0;
  border-bottom: 1px solid #edf1f5;
}

.detail-row--two-col {
  display: flex;
  gap: 12px;
}

.detail-row--compact {
  padding-top: 0;
}

.share-qrcode-panel__label-row {
  margin-top: 12px;
}

.detail-row:last-child {
  border-bottom: 0;
}

.detail-label {
  color: #8d99ae;
  font-size: 12px;
}

.detail-cell {
  flex: 1;
  min-width: 0;
}

.detail-value {
  margin-top: 4px;
  display: block;
  color: #152740;
  font-size: 13px;
  line-height: 1.6;
}

.detail-value--multi {
  word-break: break-all;
}

.share-row {
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.share-row__hint {
  flex: 1;
  color: #152740;
  font-size: 13px;
  line-height: 1.6;
}

.share-row__btn {
  min-width: 92px;
  height: 34px;
  line-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, #13243b, #24486f);
  color: #fff;
  font-size: 12px;
}

.share-row__btn--disabled {
  background: #d8e0ea;
  color: #8d99ae;
}

.share-qrcode-panel {
  margin-top: 14px;
  padding: 16px;
  border-radius: 20px;
  background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
  border: 1px solid #e8eff6;
}

.share-qrcode-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.share-qrcode-panel__title {
  color: #13243b;
  font-size: 15px;
  font-weight: 700;
}

.share-qrcode-panel__desc {
  margin-top: 4px;
  display: block;
  color: #7f8a9b;
  font-size: 12px;
  line-height: 1.5;
}

.share-qrcode-panel__action {
  min-width: 92px;
  height: 34px;
  line-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, #ff9f43, #ff6b00);
  color: #fff;
  font-size: 12px;
}

.share-qrcode-panel__action--disabled {
  background: #d8e0ea;
  color: #8d99ae;
}

.share-qrcode-panel__state {
  margin-top: 16px;
  padding: 20px 14px;
  border-radius: 16px;
  background: #f5f7fb;
  color: #6f7f94;
  font-size: 13px;
  text-align: center;
}

.share-qrcode-panel__state--error {
  color: #c0392b;
  background: rgba(192, 57, 43, 0.08);
}

.share-qrcode-panel__image {
  margin: 18px auto 0;
  width: 240px;
  height: 240px;
  display: block;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 12px 30px rgba(16, 35, 57, 0.12);
}

.share-qrcode-panel__footer {
  margin-top: 10px;
  display: block;
  color: #7f8a9b;
  font-size: 12px;
  text-align: center;
}

.share-qrcode-canvas {
  position: absolute;
  left: -9999px;
  top: -9999px;
  width: 320px;
  height: 320px;
}

.timeline {
  margin-top: 12px;
}

.timeline-item {
  display: flex;
  gap: 10px;
  padding: 8px 0;
}

.timeline-dot {
  width: 10px;
  height: 10px;
  border-radius: 5px;
  margin-top: 6px;
  background: #c7d0db;
  flex-shrink: 0;
}

.timeline-dot--completed {
  background: #117864;
}

.timeline-dot--active {
  background: #ff9f43;
}

.timeline-content {
  display: flex;
  flex-direction: column;
}

.timeline-title {
  color: #13243b;
  font-size: 14px;
  font-weight: 600;
}

.timeline-meta {
  margin-top: 4px;
  color: #7f8a9b;
  font-size: 12px;
}

.empty-inline {
  margin-top: 14px;
  color: #8694a7;
  font-size: 13px;
}

.renew-card {
  margin-top: 12px;
  padding: 14px;
  border-radius: 18px;
  background: #f5f7fb;
}

.renew-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.renew-card__title {
  color: #13243b;
  font-size: 14px;
  font-weight: 600;
}

.renew-card__meta {
  margin-top: 6px;
  display: block;
  color: #6f7f94;
  font-size: 12px;
}

.renew-badge {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
}

.renew-badge--approved {
  background: rgba(17, 120, 100, 0.12);
  color: #117864;
}

.renew-badge--pending {
  background: rgba(243, 156, 18, 0.14);
  color: #d97706;
}

.renew-badge--failed {
  background: rgba(192, 57, 43, 0.12);
  color: #c0392b;
}

.chart-card {
  margin-top: 18px;
  padding: 16px 14px 18px;
  border-radius: 20px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
  border: 1px solid #eef3f8;
}

.chart-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.chip-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chip {
  padding: 7px 12px;
  border-radius: 999px;
  background: #edf3f8;
  color: #53657a;
  font-size: 12px;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  line-height: 1;
}

.chip--small {
  padding: 6px 10px;
}

.chip--active {
  background: linear-gradient(135deg, #13243b, #24486f);
  color: #fff;
  box-shadow: 0 10px 24px rgba(19, 36, 59, 0.18);
}

.chart-wrap {
  margin-top: 10px;
  min-height: 260px;
}

.chart-controls {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chart-controls__scroll {
  white-space: nowrap;
}

.chart-controls__row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  min-width: 100%;
  padding-bottom: 2px;
}

.chart-wrap--bar {
  min-height: 300px;
}

.rank-list {
  margin-top: 16px;
}

.rank-list__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #6f7f94;
  font-size: 12px;
  margin-bottom: 8px;
}

.rank-item {
  padding: 10px 0;
}

.rank-item__main {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.rank-item__name {
  color: #13243b;
  font-size: 13px;
  font-weight: 600;
}

.rank-item__meta {
  color: #7f8a9b;
  font-size: 12px;
}

.rank-item__bar {
  margin-top: 8px;
  height: 6px;
  background: #e9eef5;
  border-radius: 999px;
  overflow: hidden;
}

.rank-item__fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #1890ff, #62b0ff);
}

.primary-btn {
  background: linear-gradient(135deg, #ff9f43, #ff6b00);
  color: #fff;
  border-radius: 999px;
}
</style>
