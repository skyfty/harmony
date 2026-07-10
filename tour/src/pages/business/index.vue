<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <view class="page">
    <view class="page-ambient" aria-hidden="true">
      <view class="page-ambient__glow page-ambient__glow--one" />
      <view class="page-ambient__glow page-ambient__glow--two" />
      <view class="page-ambient__glow page-ambient__glow--three" />
      <view class="page-ambient__mesh" />
      <view class="page-ambient__stripe" />
    </view>
    <MiniAuthRecovery />
    <PageHeader title="商业订单中心">
      <template #right>
        <BusinessHeaderAction @tap="openCreatePage" />
      </template>
    </PageHeader>

    <view class="content">
 
      <view v-if="loading" class="state-card">
        <text class="state-title">加载中...</text>
      </view>

      <template v-else>
        <view v-if="orders.length === 0" class="empty-card">
          <text class="empty-title">还没有商业订单</text>
          <text class="empty-desc">创建第一个商业场景订单后，你可以持续查看交付进度、上线链接和运营数据。</text>
          <button class="primary-btn" @tap="openCreatePage">新建订单</button>
        </view>

        <view v-else class="section">
          <view class="section-head">
            <text class="section-title">我的服务</text>
            <text class="section-subtitle">{{ orders.length }} 个服务链</text>
          </view>

          <view
            v-for="item in orders"
            :key="item.id"
            class="order-card"
            @tap="openDetail(item.id)"
          >
            <view class="order-card__top">
              <view>
                <text class="order-card__title">{{ item.scenicName }}</text>
                <text class="order-card__no">{{ item.orderNumber }}</text>
              </view>
              <view class="status-group">
                <text class="stage-badge">{{ stageText(item.topStage) }}</text>
                <text class="service-badge" :class="`service-badge--${item.service.status}`">
                  {{ serviceStatusText(item.service.status) }}
                </text>
              </view>
            </view>

            <view class="meta-grid">
              <view class="meta-item">
                <text class="meta-label">服务时间</text>
                <text class="meta-value">{{ formatServiceWindow(item) }}</text>
              </view>
              <view class="meta-item">
                <text class="meta-label">交付场景</text>
                <text class="meta-value">{{ item.delivery.sceneSpotTitle || '待绑定' }}</text>
              </view>
              <view class="meta-item">
                <text class="meta-label">剩余天数</text>
                <text class="meta-value" :class="{ 'meta-value--warn': item.service.status === 'expiring', 'meta-value--danger': item.service.status === 'expired' }">
                  {{ daysRemainingText(item) }}
                </text>
              </view>
              <view class="meta-item">
                <text class="meta-label">续费次数</text>
                <text class="meta-value">{{ item.renewalCount }}</text>
              </view>
            </view>

            <view class="order-card__footer">
              <text class="footer-tip">{{ footerTip(item) }}</text>
              <text class="footer-link">查看详情</text>
            </view>
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import BusinessHeaderAction from '@/components/BusinessHeaderAction.vue';
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue';
import PageHeader from '@/components/PageHeader.vue';
import { listBusinessOrders } from '@/api/mini';
import type { BusinessOrder, BusinessServiceStatus, BusinessTopStage } from '@/types/business';

const loading = ref(true);
const orders = ref<BusinessOrder[]>([]);
let redirectedSingleOrderId = '';

onShow(() => {
  void loadOrders();
});

async function loadOrders() {
  loading.value = true;
  try {
    const response = await listBusinessOrders();
    orders.value = response || [];
    if (orders.value.length === 1) {
      const singleId = orders.value[0]?.id || '';
      if (singleId && redirectedSingleOrderId !== singleId) {
        redirectedSingleOrderId = singleId;
        void uni.redirectTo({ url: `/pages/business/detail/index?id=${encodeURIComponent(singleId)}` });
        return;
      }
    }
    redirectedSingleOrderId = '';
  } catch {
    void uni.showToast({ title: '商业订单加载失败', icon: 'none' });
  } finally {
    loading.value = false;
  }
}

function openDetail(id: string) {
  void uni.navigateTo({ url: `/pages/business/detail/index?id=${encodeURIComponent(id)}` });
}

function openCreatePage() {
  void uni.navigateTo({ url: '/pages/business/create/index' });
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

function formatServiceWindow(order: BusinessOrder) {
  if (!order.service.startAt || !order.service.endAt) return '待设置';
  return `${formatDate(order.service.startAt)} - ${formatDate(order.service.endAt)}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}.${month}.${day}`;
}

function daysRemainingText(order: BusinessOrder) {
  if (order.service.daysRemaining == null) return '待生效';
  if (order.service.daysRemaining <= 0) return '已到期';
  return `${order.service.daysRemaining} 天`;
}

function footerTip(order: BusinessOrder) {
  if (order.service.status === 'expired') return '服务已结束，可发起续费恢复';
  if (order.service.status === 'expiring') return '服务临近结束，建议尽快续费';
  if (order.topStage !== 'operation') return '当前仍在交付流程中';
  return '可查看运营数据与分享链接';
}
</script>

<style scoped lang="scss">
.page {
  position: relative;
  min-height: 100vh;
  background:
    radial-gradient(circle at 12% 8%, rgba(255, 176, 88, 0.22), transparent 24%),
    radial-gradient(circle at 88% 12%, rgba(93, 145, 255, 0.16), transparent 22%),
    radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.08), transparent 18%),
    linear-gradient(180deg, #0a1220 0%, #101c31 18%, #172948 28%, #eef1f5 28%, #f4f6f9 100%);
  overflow: hidden;
}

.page-ambient {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.page-ambient__glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(14px);
  opacity: 0.9;
}

.page-ambient__glow--one {
  top: 18px;
  left: -36px;
  width: 160px;
  height: 160px;
  background: radial-gradient(circle, rgba(255, 164, 72, 0.34) 0%, rgba(255, 164, 72, 0) 68%);
}

.page-ambient__glow--two {
  top: 46px;
  right: -48px;
  width: 190px;
  height: 190px;
  background: radial-gradient(circle, rgba(91, 145, 255, 0.24) 0%, rgba(91, 145, 255, 0) 70%);
}

.page-ambient__glow--three {
  top: 220px;
  left: 18%;
  width: 280px;
  height: 280px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 72%);
}

.page-ambient__mesh {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(transparent 95%, rgba(255, 255, 255, 0.045) 96%, transparent 97%) 0 0 / 100% 28px,
    linear-gradient(90deg, transparent 95%, rgba(255, 255, 255, 0.04) 96%, transparent 97%) 0 0 / 28px 100%;
  opacity: 0.45;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.55) 30%, transparent 78%);
}

.page-ambient__stripe {
  position: absolute;
  top: 92px;
  left: -8%;
  width: 116%;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.12) 18%, rgba(255, 255, 255, 0.24) 50%, rgba(255, 255, 255, 0.12) 82%, transparent 100%);
  opacity: 0.8;
}

.content {
  position: relative;
  z-index: 1;
  padding: 16px 16px 28px;
}

.hero-card,
.empty-card,
.state-card,
.order-card {
  border-radius: 24px;
  box-sizing: border-box;
}

.hero-card {
  padding: 22px 20px;
  background:
    linear-gradient(135deg, rgba(248, 183, 84, 0.24), rgba(255, 121, 63, 0.16)),
    rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #fff;
  box-shadow: 0 22px 44px rgba(4, 11, 24, 0.25);
}

.hero-eyebrow {
  font-size: 11px;
  letter-spacing: 2px;
  opacity: 0.72;
}

.hero-title {
  margin-top: 10px;
  font-size: 24px;
  font-weight: 700;
}

.hero-desc {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.76);
}

.section {
  margin-top: 18px;
}

.section-head {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  color: #f3f3f3;
  font-size: 18px;
  font-weight: 700;
}

.section-subtitle {
  color: #7d8899;
  font-size: 12px;
}

.empty-card,
.state-card,
.order-card {
  background: #fff;
  box-shadow:
    0 16px 36px rgba(15, 35, 58, 0.08),
    0 2px 0 rgba(255, 255, 255, 0.75) inset;
}

.empty-card {
  margin-top: 18px;
  padding: 28px 20px;
  text-align: center;
}

.empty-title {
  color: #14233a;
  font-size: 18px;
  font-weight: 700;
}

.empty-desc {
  margin-top: 10px;
  display: block;
  color: #6e7d91;
  font-size: 13px;
  line-height: 1.7;
}

.primary-btn {
  margin-top: 18px;
  background: linear-gradient(135deg, #0f2748, #294c7c);
  color: #fff;
  border-radius: 999px;
  font-size: 14px;
}

.order-card {
  padding: 18px;
  margin-bottom: 14px;
  position: relative;
  overflow: hidden;
}

.order-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #ff9f43 0%, #5b91ff 55%, #ff6b00 100%);
}

.order-card__top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.order-card__title {
  display: block;
  color: #12233b;
  font-size: 18px;
  font-weight: 700;
}

.order-card__no {
  display: block;
  margin-top: 6px;
  color: #8996a9;
  font-size: 12px;
}

.status-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.stage-badge,
.service-badge {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.stage-badge {
  background: linear-gradient(135deg, rgba(20, 35, 58, 0.08), rgba(91, 145, 255, 0.12));
  color: #17314f;
  border: 1px solid rgba(23, 49, 79, 0.08);
}

.service-badge {
  color: #fff;
}

.service-badge--pending {
  background: #8d99ae;
}

.service-badge--active {
  background: #117864;
}

.service-badge--expiring {
  background: #f39c12;
}

.service-badge--expired {
  background: #c0392b;
}

.meta-grid {
  margin-top: 16px;
  padding: 14px 0;
  border-top: 1px solid #e9eef5;
  border-bottom: 1px solid #e9eef5;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 10px;
}

.meta-item {
  display: flex;
  flex-direction: column;
}

.meta-label {
  color: #93a0b4;
  font-size: 11px;
}

.meta-value {
  margin-top: 4px;
  color: #17263d;
  font-size: 13px;
  line-height: 1.5;
}

.meta-value--warn {
  color: #d97706;
  font-weight: 600;
}

.meta-value--danger {
  color: #c0392b;
  font-weight: 600;
}

.order-card__footer {
  margin-top: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.footer-tip {
  color: #607086;
  font-size: 12px;
}

.footer-link {
  color: #12345a;
  font-size: 12px;
  font-weight: 600;
}
</style>
