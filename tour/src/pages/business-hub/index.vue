<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <view class="page">
    <MiniAuthRecovery />
    <view class="ambient" aria-hidden="true">
      <view class="ambient__glow ambient__glow--one" />
      <view class="ambient__glow ambient__glow--two" />
      <view class="ambient__mesh" />
    </view>

    <PageHeader title="商业协作台">
      <template #right>
        <text class="header-action" @tap="reload">刷新</text>
      </template>
    </PageHeader>

    <view class="content">
      <view class="hero">
        <text class="hero__eyebrow">BUSINESS HUB</text>
        <text class="hero__title">项目、任务、提醒、素材统一看板</text>
      </view>

      <view v-if="loading" class="state-card">
        <text class="state-card__title">加载中...</text>
      </view>

      <template v-else>
        <view v-if="!bootstrap?.hasBoundPhone" class="state-card state-card--warn">
          <text class="state-card__title">请先绑定手机号</text>
          <text class="state-card__desc">商业项目通过手机号归属，你绑定后才能看到对应的项目、任务和续费信息。</text>
          <button class="state-card__action" @tap="openProfile">去绑定手机号</button>
        </view>

        <template v-else>
          <view class="stats-grid">
            <view class="stat-card">
              <text class="stat-card__value">{{ dashboard.totalProjects }}</text>
              <text class="stat-card__label">项目总数</text>
            </view>
            <view class="stat-card">
              <text class="stat-card__value">{{ dashboard.activeProjects }}</text>
              <text class="stat-card__label">活跃项目</text>
            </view>
            <view class="stat-card">
              <text class="stat-card__value">{{ dashboard.todoTasks }}</text>
              <text class="stat-card__label">待办任务</text>
            </view>
            <view class="stat-card">
              <text class="stat-card__value">{{ dashboard.openReminders }}</text>
              <text class="stat-card__label">待处理提醒</text>
            </view>
          </view>

          <view v-if="latestProject" class="highlight-card" @tap="openDetail(latestProject.id)">
            <view class="highlight-card__top">
              <view>
                <text class="highlight-card__title">{{ latestProject.title }}</text>
                <text class="highlight-card__sub">{{ latestProject.projectNumber }}</text>
              </view>
              <view class="badge-group">
                <text class="badge">{{ stageText(latestProject.stage) }}</text>
                <text class="badge badge--soft" :class="`badge--${latestProject.serviceStatus}`">{{ serviceStatusText(latestProject.serviceStatus) }}</text>
              </view>
            </view>
            <text class="highlight-card__desc">{{ latestProject.summary || '暂无项目摘要' }}</text>
            <view class="mini-meta">
              <text>客户：{{ latestProject.customerName }}</text>
              <text>任务：{{ latestProject.todoTaskCount }}/{{ latestProject.taskCount }}</text>
              <text>提醒：{{ latestProject.openReminderCount }}</text>
            </view>
          </view>

          <view v-if="projects.length" class="section">
            <view class="section__head">
              <text class="section__title">项目列表</text>
              <text class="section__subtitle">{{ projects.length }} 个</text>
            </view>

            <view
              v-for="item in projects"
              :key="item.id"
              class="project-card"
              @tap="openDetail(item.id)"
            >
              <view class="project-card__top">
                <view class="project-card__title-wrap">
                  <text class="project-card__title">{{ item.title }}</text>
                  <text class="project-card__no">{{ item.projectNumber }}</text>
                </view>
                <view class="project-card__badges">
                  <text class="chip">{{ stageText(item.stage) }}</text>
                  <text class="chip chip--soft" :class="`chip--${item.serviceStatus}`">{{ serviceStatusText(item.serviceStatus) }}</text>
                </view>
              </view>

              <text class="project-card__summary">{{ item.summary || '暂无摘要' }}</text>

              <view class="project-card__grid">
                <view class="project-card__meta">
                  <text class="project-card__label">客户</text>
                  <text class="project-card__value">{{ item.customerName }}</text>
                </view>
                <view class="project-card__meta">
                  <text class="project-card__label">交付场景</text>
                  <text class="project-card__value">{{ item.deliverySceneSpotTitle || '待绑定' }}</text>
                </view>
                <view class="project-card__meta">
                  <text class="project-card__label">待办任务</text>
                  <text class="project-card__value">{{ item.todoTaskCount }}</text>
                </view>
                <view class="project-card__meta">
                  <text class="project-card__label">提醒/审批</text>
                  <text class="project-card__value">{{ item.openReminderCount }} / {{ item.pendingApprovalCount }}</text>
                </view>
              </view>

              <view class="project-card__footer">
                <text class="project-card__hint">{{ footerHint(item) }}</text>
                <button
                  v-if="canRenew(item)"
                  class="project-card__action"
                  @tap.stop="openRenew(item.id)"
                >
                  续费
                </button>
              </view>
            </view>
          </view>

          <view v-else class="empty-card">
            <text class="empty-card__title">暂时没有匹配的商业项目</text>
            <text class="empty-card__desc">如果你确认已经有项目，请先检查手机号是否绑定正确，或者联系管理员为你关联新的商业项目。</text>
            <button class="empty-card__action" @tap="reload">重新加载</button>
          </view>
        </template>
      </template>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue'
import PageHeader from '@/components/PageHeader.vue'
import { getBusinessHubBootstrap } from '@/api/mini'
import type { BusinessHubBootstrapData, BusinessHubProjectListItem } from '@/types/business-hub'

const loading = ref(true)
const bootstrap = ref<BusinessHubBootstrapData | null>(null)

const dashboard = computed(() => bootstrap.value?.dashboard ?? {
  totalProjects: 0,
  activeProjects: 0,
  expiringProjects: 0,
  expiredProjects: 0,
  todoTasks: 0,
  openReminders: 0,
  pendingApprovals: 0,
  totalRenewals: 0,
})

const projects = computed(() => bootstrap.value?.projects ?? [])
const latestProject = computed(() => bootstrap.value?.latestProject ?? null)

onShow(() => {
  void reload()
})

async function reload() {
  loading.value = true
  try {
    bootstrap.value = await getBusinessHubBootstrap()
  } catch {
    void uni.showToast({ title: '商业协作台加载失败', icon: 'none' })
  } finally {
    loading.value = false
  }
}

function openProfile() {
  void uni.navigateTo({ url: '/pages/profile/index' })
}

function openDetail(id: string) {
  void uni.navigateTo({ url: `/pages/business-hub/detail/index?id=${encodeURIComponent(id)}` })
}

function openRenew(id: string) {
  void uni.navigateTo({ url: `/pages/business-hub/renew/index?id=${encodeURIComponent(id)}` })
}

function canRenew(item: BusinessHubProjectListItem) {
  return item.stage === 'operation' && (item.serviceStatus === 'expiring' || item.serviceStatus === 'expired' || item.serviceStatus === 'active')
}

function footerHint(item: BusinessHubProjectListItem) {
  if (item.serviceStatus === 'expired') {
    return '服务已到期，建议尽快续费'
  }
  if (item.serviceStatus === 'expiring') {
    return '服务即将到期，建议提前处理'
  }
  if (item.todoTaskCount > 0) {
    return '当前有待办任务需要推进'
  }
  return '点击查看项目详情'
}

function stageText(stage: BusinessHubProjectListItem['stage']) {
  if (stage === 'signing') return '签约中'
  if (stage === 'production') return '制作中'
  if (stage === 'publish') return '待运营'
  if (stage === 'operation') return '运营中'
  if (stage === 'quote') return '报价中'
  return '线索中'
}

function serviceStatusText(status: BusinessHubProjectListItem['serviceStatus']) {
  if (status === 'active') return '服务中'
  if (status === 'expiring') return '即将到期'
  if (status === 'expired') return '已到期'
  return '待生效'
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, rgba(255, 167, 77, 0.18), transparent 26%),
    radial-gradient(circle at top right, rgba(85, 139, 255, 0.16), transparent 24%),
    linear-gradient(180deg, #0e1a2d 0%, #13233d 16%, #f5f7fb 16%, #f8fafc 100%);
}

.ambient {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.ambient__glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(8px);
}

.ambient__glow--one {
  top: 28px;
  left: -48px;
  width: 160px;
  height: 160px;
  background: radial-gradient(circle, rgba(255, 164, 72, 0.24), transparent 70%);
}

.ambient__glow--two {
  top: 84px;
  right: -54px;
  width: 200px;
  height: 200px;
  background: radial-gradient(circle, rgba(91, 145, 255, 0.18), transparent 70%);
}

.ambient__mesh {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(transparent 95%, rgba(255, 255, 255, 0.04) 96%, transparent 97%) 0 0 / 100% 28px,
    linear-gradient(90deg, transparent 95%, rgba(255, 255, 255, 0.04) 96%, transparent 97%) 0 0 / 28px 100%;
  opacity: 0.45;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.88), transparent 70%);
}

.content {
  position: relative;
  z-index: 1;
  padding: 14px 16px 24px;
}

.header-action {
  color: #d9e4f5;
  font-size: 13px;
}

.hero {
  padding: 20px 18px 18px;
  border-radius: 24px;
  background: linear-gradient(135deg, rgba(18, 36, 59, 0.96), rgba(29, 61, 102, 0.92));
  color: #fff;
  box-shadow: 0 18px 36px rgba(11, 22, 39, 0.18);
}

.hero__eyebrow {
  font-size: 11px;
  letter-spacing: 2px;
  color: rgba(255, 255, 255, 0.62);
}

.hero__title {
  margin-top: 10px;
  display: block;
  font-size: 20px;
  font-weight: 700;
}

.hero__desc {
  margin-top: 8px;
  display: block;
  font-size: 13px;
  line-height: 1.75;
  color: rgba(255, 255, 255, 0.78);
}

.stats-grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.stat-card,
.highlight-card,
.project-card,
.state-card,
.empty-card {
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 16px 34px rgba(15, 35, 58, 0.08);
}

.stat-card {
  padding: 16px 14px;
}

.stat-card__value {
  display: block;
  color: #12233b;
  font-size: 24px;
  font-weight: 700;
}

.stat-card__label {
  margin-top: 4px;
  display: block;
  color: #7a8798;
  font-size: 12px;
}

.highlight-card {
  margin-top: 14px;
  padding: 18px;
}

.highlight-card__top,
.project-card__top,
.project-card__footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.highlight-card__title,
.project-card__title {
  display: block;
  color: #12233b;
  font-size: 18px;
  font-weight: 700;
}

.highlight-card__sub,
.project-card__no {
  display: block;
  margin-top: 5px;
  color: #8a97a8;
  font-size: 12px;
}

.highlight-card__desc,
.project-card__summary,
.empty-card__desc,
.state-card__desc {
  margin-top: 10px;
  display: block;
  color: #526275;
  font-size: 13px;
  line-height: 1.7;
}

.mini-meta {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  color: #708196;
  font-size: 12px;
}

.section {
  margin-top: 18px;
}

.section__head {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section__title {
  color: #12233b;
  font-size: 16px;
  font-weight: 700;
}

.section__subtitle {
  color: #8390a3;
  font-size: 12px;
}

.project-card {
  margin-bottom: 12px;
  padding: 18px;
}

.project-card__badges,
.badge-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.chip,
.badge {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
}

.chip {
  background: #edf3f8;
  color: #4d6277;
}

.chip--soft,
.badge--soft {
  background: #f6f8fb;
}

.chip--active,
.badge--active {
  background: rgba(17, 120, 100, 0.12);
  color: #117864;
}

.chip--expiring,
.badge--expiring {
  background: rgba(243, 156, 18, 0.14);
  color: #d97706;
}

.chip--expired,
.badge--expired {
  background: rgba(192, 57, 43, 0.12);
  color: #c0392b;
}

.chip--pending,
.badge--pending {
  background: rgba(141, 153, 174, 0.14);
  color: #5f6c7f;
}

.project-card__grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 10px;
  padding-top: 12px;
  border-top: 1px solid #edf1f5;
}

.project-card__meta {
  display: flex;
  flex-direction: column;
}

.project-card__label {
  color: #8e99aa;
  font-size: 11px;
}

.project-card__value {
  margin-top: 4px;
  color: #152740;
  font-size: 13px;
  font-weight: 600;
}

.project-card__footer {
  margin-top: 14px;
  align-items: center;
}

.project-card__hint {
  color: #6c7b8c;
  font-size: 12px;
}

.project-card__action,
.state-card__action,
.empty-card__action {
  min-width: 78px;
  height: 34px;
  line-height: 34px;
  border-radius: 999px;
  padding: 0 14px;
  background: linear-gradient(135deg, #12243b, #264a74);
  color: #fff;
  font-size: 12px;
}

.state-card,
.empty-card {
  margin-top: 14px;
  padding: 22px 18px;
  text-align: center;
}

.state-card--warn {
  background: linear-gradient(135deg, rgba(255, 190, 82, 0.14), rgba(255, 157, 0, 0.08));
}

.state-card__title,
.empty-card__title {
  color: #12233b;
  font-size: 16px;
  font-weight: 700;
}

.state-card__action,
.empty-card__action {
  margin-top: 16px;
}
</style>
