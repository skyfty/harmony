<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader title="订单详情">
      <template #right>
        <view class="header-action" @tap="openCreatePage">+</view>
      </template>
    </PageHeader>

    <view class="content">
      <view v-if="loading" class="card">
        <text class="card-title">加载中...</text>
      </view>

      <template v-else-if="order">
        <view v-if="order.service.status === 'expiring' || order.service.status === 'expired'" class="alert-banner" :class="`alert-banner--${order.service.status}`">
          <text class="alert-title">{{ order.service.status === 'expired' ? '服务已结束' : '服务即将到期' }}</text>
          <text class="alert-desc">
            {{ order.service.status === 'expired' ? '请尽快续费以恢复服务与运营支持。' : `当前服务剩余 ${order.service.daysRemaining || 0} 天，建议尽快续费。` }}
          </text>
          <button class="alert-btn" @tap="openRenewPage">立即续费</button>
        </view>

        <view class="hero-card">
          <text class="hero-title">{{ order.scenicName }}</text>
          <text class="hero-order">{{ order.orderNumber }}</text>
          <view class="hero-badges">
            <text class="badge">{{ stageText(order.topStage) }}</text>
            <text class="badge badge--service" :class="`badge--${order.service.status}`">{{ serviceStatusText(order.service.status) }}</text>
          </view>
        </view>

        <view class="card">
          <text class="card-title">服务周期</text>
          <view class="metric-grid">
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

        <view class="card">
          <text class="card-title">交付信息</text>
          <view class="detail-list">
            <view class="detail-row">
              <text class="detail-label">交付场景</text>
              <text class="detail-value">{{ order.delivery.sceneSpotTitle || '待绑定' }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">分享路径</text>
              <text class="detail-value detail-value--multi">{{ order.share.miniProgramPath || '上线后显示' }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">商务电话</text>
              <text class="detail-value">{{ order.contactPhoneForBusiness || '暂无' }}</text>
            </view>
          </view>
        </view>

        <view class="card">
          <text class="card-title">订单基础信息</text>
          <view class="detail-list">
            <view class="detail-row">
              <text class="detail-label">联系电话</text>
              <text class="detail-value">{{ order.contactPhone }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">景点类型</text>
              <text class="detail-value">{{ order.sceneSpotCategoryName || '未填写' }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">景点面积</text>
              <text class="detail-value">{{ order.scenicArea ?? '-' }}</text>
            </view>
            <view class="detail-row">
              <text class="detail-label">地址</text>
              <text class="detail-value detail-value--multi">{{ order.addressText }}</text>
            </view>
          </view>
        </view>

        <view class="card">
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

        <view class="card">
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

        <view class="card">
          <text class="card-title">运营数据</text>
          <view v-if="analyticsLoading" class="empty-inline">加载运营数据中...</view>
          <view v-else-if="!order.analyticsAvailable" class="empty-inline">订单进入运营并绑定交付场景后可查看运营数据</view>
          <template v-else-if="analytics">
            <view class="metric-grid">
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

            <view class="subsection">
              <text class="subsection-title">访问趋势</text>
              <view v-for="item in analytics.visitTrend" :key="item.date" class="trend-row">
                <text class="trend-date">{{ item.date }}</text>
                <text class="trend-value">PV {{ item.pv }}</text>
                <text class="trend-value">UV {{ item.uv }}</text>
                <text class="trend-value">新增 {{ item.newUsers }}</text>
              </view>
            </view>

            <view class="subsection">
              <text class="subsection-title">打卡点统计</text>
              <view v-for="item in analytics.checkpointStats" :key="`${item.nodeId}-${item.nodeName}`" class="trend-row">
                <text class="trend-date">{{ item.nodeName }}</text>
                <text class="trend-value">打卡 {{ item.punchCount }}</text>
                <text class="trend-value">人数 {{ item.userCount }}</text>
              </view>
            </view>
          </template>
        </view>
      </template>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue';
import PageHeader from '@/components/PageHeader.vue';
import { getBusinessOrderAnalytics, getBusinessOrderDetail } from '@/api/mini';
import type { BusinessOrder, BusinessOrderAnalytics, BusinessServiceStatus, BusinessTopStage } from '@/types/business';

const loading = ref(true);
const analyticsLoading = ref(false);
const order = ref<BusinessOrder | null>(null);
const analytics = ref<BusinessOrderAnalytics | null>(null);
const orderId = ref('');

onLoad((options) => {
  orderId.value = typeof options?.id === 'string' ? options.id : '';
});

onShow(() => {
  void loadDetail();
});

async function loadDetail() {
  if (!orderId.value) {
    return;
  }
  loading.value = true;
  try {
    const response = await getBusinessOrderDetail(orderId.value);
    order.value = response;
    await loadAnalytics();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '订单加载失败';
    void uni.showToast({ title: message, icon: 'none' });
  } finally {
    loading.value = false;
  }
}

async function loadAnalytics() {
  if (!order.value?.analyticsAvailable) {
    analytics.value = null;
    return;
  }
  analyticsLoading.value = true;
  try {
    analytics.value = await getBusinessOrderAnalytics(orderId.value);
  } catch {
    analytics.value = null;
  } finally {
    analyticsLoading.value = false;
  }
}

function openCreatePage() {
  void uni.navigateTo({ url: '/pages/business/create/index' });
}

function openRenewPage() {
  void uni.navigateTo({ url: `/pages/business/renew/index?id=${encodeURIComponent(orderId.value)}` });
}

function stageText(stage: BusinessTopStage) {
  if (stage === 'signing') return '签约中';
  if (stage === 'production') return '制作中';
  if (stage === 'publish') return '待运营';
  if (stage === 'operation') return '运营中';
  return '待确认';
}

function serviceStatusText(status: BusinessServiceStatus) {
  if (status === 'active') return '服务中';
  if (status === 'expiring') return '即将到期';
  if (status === 'expired') return '已到期';
  return '待生效';
}

function paymentStatusText(status: BusinessOrder['renewalHistory'][number]['paymentStatus']) {
  if (status === 'processing') return '支付中';
  if (status === 'succeeded') return '已支付';
  if (status === 'failed') return '支付失败';
  if (status === 'refunded') return '已退款';
  if (status === 'closed') return '已关闭';
  return '未支付';
}

function daysRemainingText(item: BusinessOrder) {
  if (item.service.daysRemaining == null) return '待生效';
  if (item.service.daysRemaining <= 0) return '已到期';
  return `${item.service.daysRemaining} 天`;
}

function progressText(status: 'pending' | 'active' | 'completed') {
  if (status === 'completed') return '已完成';
  if (status === 'active') return '进行中';
  return '待开始';
}

function formatDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}.${month}.${day}`;
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

.header-action {
  width: 30px;
  height: 30px;
  border-radius: 15px;
  background: linear-gradient(135deg, #ff9f43, #ff6b00);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 600;
}

.hero-card,
.card,
.alert-banner {
  border-radius: 24px;
  box-shadow: 0 18px 40px rgba(16, 35, 57, 0.08);
}

.hero-card {
  padding: 22px 20px;
  background: linear-gradient(135deg, #10284a, #2c4f80);
  color: #fff;
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

.metric-grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
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
  color: #13243b;
  font-size: 15px;
  font-weight: 600;
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

.detail-row:last-child {
  border-bottom: 0;
}

.detail-label {
  color: #8d99ae;
  font-size: 12px;
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

.subsection {
  margin-top: 18px;
}

.trend-row {
  margin-top: 10px;
  padding: 12px 14px;
  border-radius: 16px;
  background: #f5f7fb;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.trend-date {
  min-width: 92px;
  color: #152740;
  font-size: 13px;
  font-weight: 600;
}

.trend-value {
  color: #6f7f94;
  font-size: 12px;
}

.primary-btn {
  background: linear-gradient(135deg, #ff9f43, #ff6b00);
  color: #fff;
  border-radius: 999px;
}
</style>
