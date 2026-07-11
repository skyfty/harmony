<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader title="项目详情">
      <template #right>
        <text class="header-action" @tap="reload">刷新</text>
      </template>
    </PageHeader>

    <view class="content">
      <view v-if="loading" class="state-card">
        <text class="state-card__title">加载中...</text>
      </view>

      <template v-else-if="project">
        <view class="hero-card">
          <text class="hero-card__eyebrow">BUSINESS PROJECT</text>
          <text class="hero-card__title">{{ project.title }}</text>
          <text class="hero-card__sub">{{ project.projectNumber }}</text>
          <view class="badge-row">
            <text class="badge">{{ stageText(project.stage) }}</text>
            <text class="badge badge--soft" :class="`badge--${project.serviceStatus}`">{{ serviceStatusText(project.serviceStatus) }}</text>
            <text class="badge badge--soft" :class="`badge--${project.contractStatus === 'signed' ? 'active' : 'pending'}`">{{ project.contractStatus === 'signed' ? '已签约' : '待签约' }}</text>
          </view>
        </view>

        <view v-if="showRenewTip" class="banner" :class="`banner--${project.serviceStatus}`">
          <text class="banner__title">{{ project.serviceStatus === 'expired' ? '服务已到期' : '服务即将到期' }}</text>
          <text class="banner__desc">{{ project.serviceStatus === 'expired' ? '建议尽快发起续费，避免服务中断。' : '建议提前发起续费，保证服务不断档。' }}</text>
          <button class="banner__action" @tap="openRenew">发起续费</button>
        </view>

        <view class="grid">
          <view class="metric-card">
            <text class="metric-card__label">客户</text>
            <text class="metric-card__value">{{ project.customerName }}</text>
          </view>
          <view class="metric-card">
            <text class="metric-card__label">手机号</text>
            <text class="metric-card__value">{{ maskedPhone(project.customerPhone) }}</text>
          </view>
          <view class="metric-card">
            <text class="metric-card__label">服务周期</text>
            <text class="metric-card__value">{{ serviceWindowText }}</text>
          </view>
          <view class="metric-card">
            <text class="metric-card__label">剩余天数</text>
            <text class="metric-card__value">{{ daysRemainingText }}</text>
          </view>
        </view>

        <view class="card">
          <text class="card__title">项目摘要</text>
          <text class="card__desc">{{ project.summary || '暂无摘要' }}</text>
          <text v-if="project.notes" class="card__notes">{{ project.notes }}</text>
        </view>

        <view class="card">
          <text class="card__title">交付信息</text>
          <view class="detail-row">
            <text class="detail-row__label">交付场景</text>
            <text class="detail-row__value">{{ project.delivery.sceneSpotTitle || '待绑定' }}</text>
          </view>
          <view class="detail-row">
            <text class="detail-row__label">绑定时间</text>
            <text class="detail-row__value">{{ formatDate(project.delivery.boundAt) || '未绑定' }}</text>
          </view>
          <view class="detail-row">
            <text class="detail-row__label">来源渠道</text>
            <text class="detail-row__value">{{ project.sourceChannel || '未填写' }}</text>
          </view>
        </view>

        <view class="card">
          <view class="section-head">
            <text class="card__title">交付任务</text>
            <text class="section-head__meta">{{ project.todoTaskCount }}/{{ project.taskCount }}</text>
          </view>
          <view v-if="!project.tasks.length" class="empty-inline">暂无任务</view>
          <view v-else>
            <view v-for="task in project.tasks" :key="task.id" class="list-item">
              <view class="list-item__main">
                <text class="list-item__title">{{ task.title }}</text>
                <text class="list-item__meta">{{ taskLabel(task.status) }} · {{ priorityLabel(task.priority) }}</text>
                <text v-if="task.remark" class="list-item__meta">{{ task.remark }}</text>
                <view class="action-row">
                  <button
                    v-if="task.status === 'todo'"
                    class="action-btn"
                    @tap.stop="setTaskStatus(task, 'doing')"
                  >
                    开始
                  </button>
                  <button
                    v-if="task.status === 'todo' || task.status === 'doing'"
                    class="action-btn action-btn--ghost"
                    @tap.stop="setTaskStatus(task, 'blocked')"
                  >
                    阻塞
                  </button>
                  <button
                    v-if="task.status === 'doing'"
                    class="action-btn"
                    @tap.stop="setTaskStatus(task, 'done')"
                  >
                    完成
                  </button>
                  <button
                    v-if="task.status === 'blocked'"
                    class="action-btn"
                    @tap.stop="setTaskStatus(task, 'doing')"
                  >
                    恢复
                  </button>
                  <button
                    v-if="task.status === 'done'"
                    class="action-btn action-btn--ghost"
                    @tap.stop="setTaskStatus(task, 'todo')"
                  >
                    重开
                  </button>
                </view>
              </view>
              <text class="list-item__tag" :class="`list-item__tag--${task.status}`">{{ taskLabel(task.status) }}</text>
            </view>
          </view>
        </view>

        <view class="card">
          <text class="card__title">提醒中心</text>
          <view v-if="!project.reminders.length" class="empty-inline">暂无提醒</view>
          <view v-else>
            <view v-for="reminder in project.reminders" :key="reminder.id" class="list-item">
              <view class="list-item__main">
                <text class="list-item__title">{{ reminder.title }}</text>
                <text class="list-item__meta">{{ reminder.kind }} · {{ reminder.status === 'closed' ? '已关闭' : '待处理' }}</text>
                <text v-if="reminder.message" class="list-item__meta">{{ reminder.message }}</text>
                <view v-if="reminder.status !== 'closed'" class="action-row">
                  <button class="action-btn" @tap.stop="closeReminder(reminder)">关闭提醒</button>
                </view>
              </view>
              <text class="list-item__tag" :class="`list-item__tag--${reminder.status}`">{{ reminder.status === 'closed' ? '已关闭' : '待处理' }}</text>
            </view>
          </view>
        </view>

        <view class="card">
          <text class="card__title">分享素材</text>
          <view v-if="!project.materials.length" class="empty-inline">暂无素材</view>
          <view v-else>
            <view v-for="material in project.materials" :key="material.id" class="list-item">
              <view class="list-item__main">
                <text class="list-item__title">{{ material.title }}</text>
                <text class="list-item__meta">{{ material.kind }}</text>
                <text v-if="material.content" class="list-item__meta">{{ material.content }}</text>
                <text v-if="material.url" class="list-item__meta">{{ material.url }}</text>
                <text v-if="material.fileUrl" class="list-item__meta">{{ material.fileUrl }}</text>
                <view class="action-row">
                  <button class="action-btn" @tap.stop="copyMaterial(material)">复制</button>
                </view>
              </view>
            </view>
          </view>
        </view>

        <view class="card">
          <text class="card__title">审批中心</text>
          <view v-if="!project.approvals.length" class="empty-inline">暂无审批</view>
          <view v-else>
            <view v-for="approval in project.approvals" :key="approval.id" class="list-item">
              <view class="list-item__main">
                <text class="list-item__title">{{ approval.title }}</text>
                <text class="list-item__meta">{{ approval.kind }} · {{ approval.status === 'approved' ? '已通过' : approval.status === 'rejected' ? '已驳回' : '待审批' }}</text>
                <text v-if="approval.remark" class="list-item__meta">{{ approval.remark }}</text>
                <view v-if="approval.status === 'pending'" class="action-row">
                  <button class="action-btn" @tap.stop="decideApproval(approval, 'approved')">通过</button>
                  <button class="action-btn action-btn--ghost" @tap.stop="decideApproval(approval, 'rejected')">驳回</button>
                </view>
              </view>
              <text class="list-item__tag" :class="`list-item__tag--${approval.status}`">{{ approval.status === 'approved' ? '已通过' : approval.status === 'rejected' ? '已驳回' : '待审批' }}</text>
            </view>
          </view>
        </view>

        <view class="card">
          <text class="card__title">续费记录</text>
          <view v-if="!project.renewals.length" class="empty-inline">暂无续费记录</view>
          <view v-else>
            <view v-for="renewal in project.renewals" :key="renewal.id" class="list-item">
              <view class="list-item__main">
                <text class="list-item__title">{{ renewal.renewalNumber }}</text>
                <text class="list-item__meta">{{ formatDate(renewal.serviceStartAt) }} - {{ formatDate(renewal.serviceEndAt) }}</text>
                <text class="list-item__meta">金额 ¥{{ renewal.price }} · {{ renewal.durationDays }} 天</text>
              </view>
              <text class="list-item__tag" :class="`list-item__tag--${renewal.status}`">{{ renewal.status === 'approved' ? '已生效' : renewal.status === 'rejected' ? '已驳回' : '待生效' }}</text>
            </view>
          </view>
        </view>

        <view class="card">
          <text class="card__title">活动日志</text>
          <view v-if="!project.activityLogs.length" class="empty-inline">暂无日志</view>
          <view v-else>
            <view v-for="item in project.activityLogs" :key="item.id" class="log-item">
              <text class="log-item__title">{{ item.content }}</text>
              <text class="log-item__meta">{{ formatDateTime(item.createdAt) }}</text>
            </view>
          </view>
        </view>
      </template>
    </view>

    <view v-if="project" class="footer-bar">
      <button class="footer-bar__btn footer-bar__btn--ghost" @tap="reload">刷新</button>
      <button v-if="showRenewTip" class="footer-bar__btn" @tap="openRenew">立即续费</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue'
import PageHeader from '@/components/PageHeader.vue'
import {
  closeBusinessHubReminder,
  decideBusinessHubApproval,
  getBusinessHubProjectDetail,
  updateBusinessHubTaskStatus,
} from '@/api/mini'
import type { BusinessHubApproval, BusinessHubMaterial, BusinessHubProject, BusinessHubReminder, BusinessHubTask } from '@/types/business-hub'

const loading = ref(true)
const projectId = ref('')
const project = ref<BusinessHubProject | null>(null)

onLoad((options) => {
  projectId.value = typeof options?.id === 'string' ? options.id : ''
})

onShow(() => {
  void reload()
})

const serviceWindowText = computed(() => {
  if (!project.value?.serviceStartAt || !project.value?.serviceEndAt) {
    return '待设置'
  }
  return `${formatDate(project.value.serviceStartAt)} - ${formatDate(project.value.serviceEndAt)}`
})

const daysRemainingText = computed(() => {
  if (!project.value) return '-'
  if (project.value.serviceStatus === 'expired') return '已到期'
  if (project.value.serviceStatus === 'pending') return '待生效'
  if (!project.value.serviceEndAt) return '待设置'
  const endAt = new Date(project.value.serviceEndAt)
  if (Number.isNaN(endAt.getTime())) return '-'
  const diffDays = Math.ceil((endAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  return diffDays <= 0 ? '已到期' : `${diffDays} 天`
})

const showRenewTip = computed(() => Boolean(project.value && project.value.stage === 'operation' && (project.value.serviceStatus === 'expiring' || project.value.serviceStatus === 'expired')))

async function reload() {
  if (!projectId.value) {
    return
  }
  loading.value = true
  try {
    project.value = await getBusinessHubProjectDetail(projectId.value)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '项目加载失败'
    void uni.showToast({ title: message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

function openRenew() {
  if (!projectId.value) return
  void uni.navigateTo({ url: `/pages/business-hub/renew/index?id=${encodeURIComponent(projectId.value)}` })
}

function maskedPhone(phone: string) {
  const value = String(phone || '').trim()
  if (!value) return '-'
  if (value.length < 7) return value
  return `${value.slice(0, 3)}****${value.slice(-4)}`
}

function stageText(stage: BusinessHubProject['stage']) {
  if (stage === 'signing') return '签约中'
  if (stage === 'production') return '制作中'
  if (stage === 'publish') return '待运营'
  if (stage === 'operation') return '运营中'
  if (stage === 'quote') return '报价中'
  return '线索中'
}

function serviceStatusText(status: BusinessHubProject['serviceStatus']) {
  if (status === 'active') return '服务中'
  if (status === 'expiring') return '即将到期'
  if (status === 'expired') return '已到期'
  return '待生效'
}

function taskLabel(status: BusinessHubTask['status']) {
  if (status === 'doing') return '进行中'
  if (status === 'done') return '已完成'
  if (status === 'blocked') return '已阻塞'
  return '待开始'
}

function priorityLabel(priority: BusinessHubTask['priority']) {
  if (priority === 'high') return '高优先级'
  if (priority === 'low') return '低优先级'
  return '中优先级'
}

function formatDate(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}.${month}.${day}`
}

function formatDateTime(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}.${month}.${day} ${hour}:${minute}`
}

async function setTaskStatus(task: BusinessHubTask, status: BusinessHubTask['status']) {
  await runProjectAction(async () => {
    await updateBusinessHubTaskStatus(task.id, {
      status,
      remark: status === 'blocked' ? '由小程序端标记为阻塞' : undefined,
    })
  })
}

async function closeReminder(reminder: BusinessHubReminder) {
  await runProjectAction(async () => {
    await closeBusinessHubReminder(reminder.id)
  })
}

function buildCopyText(material: BusinessHubMaterial) {
  return [
    material.title,
    material.content ? `文案：${material.content}` : '',
    material.url ? `链接：${material.url}` : '',
    material.fileUrl ? `文件：${material.fileUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function copyMaterial(material: BusinessHubMaterial) {
  const text = buildCopyText(material)
  if (!text) {
    void uni.showToast({ title: '暂无可复制内容', icon: 'none' })
    return
  }
  await runProjectAction(async () => {
    await new Promise<void>((resolve, reject) => {
      uni.setClipboardData({
        data: text,
        success: () => resolve(),
        fail: (error: unknown) => reject(error),
      })
    })
  }, false)
  void uni.showToast({ title: '已复制到剪贴板', icon: 'none' })
}

async function decideApproval(approval: BusinessHubApproval, status: 'approved' | 'rejected') {
  const confirmed = await confirmAction(status === 'approved' ? '确认通过该审批？' : '确认驳回该审批？')
  if (!confirmed) {
    return
  }
  await runProjectAction(async () => {
    await decideBusinessHubApproval(approval.id, {
      status,
      remark: status === 'approved' ? '由小程序端通过' : '由小程序端驳回',
    })
  })
}

async function runProjectAction(action: () => Promise<void>, showToastAfterSuccess = true) {
  if (!projectId.value) {
    return
  }
  void uni.showLoading({ title: '处理中...' })
  try {
    await action()
    await reload()
    if (showToastAfterSuccess) {
      void uni.showToast({ title: '操作成功', icon: 'success' })
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '操作失败'
    void uni.showToast({ title: message, icon: 'none' })
  } finally {
    void uni.hideLoading()
  }
}

function confirmAction(content: string): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title: '确认操作',
      content,
      confirmText: '继续',
      cancelText: '取消',
      success: (result) => {
        resolve(Boolean(result.confirm))
      },
      fail: () => resolve(false),
    })
  })
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background:
    radial-gradient(circle at top right, rgba(91, 145, 255, 0.16), transparent 24%),
    linear-gradient(180deg, #13233d 0%, #13233d 12%, #f4f6f9 12%, #f8fafc 100%);
  padding-bottom: 92px;
}

.content {
  padding: 14px 16px 18px;
}

.header-action {
  color: #d9e4f5;
  font-size: 13px;
}

.hero-card,
.card,
.banner,
.state-card {
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 16px 34px rgba(15, 35, 58, 0.08);
}

.hero-card {
  padding: 20px 18px;
  background: linear-gradient(135deg, #102849, #2c4f80);
  color: #fff;
}

.hero-card__eyebrow {
  font-size: 11px;
  letter-spacing: 2px;
  color: rgba(255, 255, 255, 0.62);
}

.hero-card__title {
  margin-top: 10px;
  display: block;
  font-size: 21px;
  font-weight: 700;
}

.hero-card__sub {
  margin-top: 6px;
  display: block;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
}

.badge-row {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.badge {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  font-size: 11px;
}

.badge--soft {
  background: #f5f7fb;
  color: #53657a;
}

.banner {
  margin-top: 14px;
  padding: 16px;
}

.banner--expiring {
  background: linear-gradient(135deg, rgba(255, 190, 82, 0.18), rgba(255, 159, 67, 0.08));
}

.banner--expired {
  background: linear-gradient(135deg, rgba(192, 57, 43, 0.12), rgba(192, 57, 43, 0.06));
}

.banner__title {
  color: #12233b;
  font-size: 15px;
  font-weight: 700;
}

.banner__desc {
  margin-top: 6px;
  display: block;
  color: #5d6b7d;
  font-size: 12px;
  line-height: 1.6;
}

.banner__action {
  margin-top: 12px;
  min-width: 92px;
  height: 34px;
  line-height: 34px;
  border-radius: 999px;
  background: #12243b;
  color: #fff;
  font-size: 12px;
}

.grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.metric-card {
  padding: 14px;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 12px 24px rgba(16, 35, 58, 0.06);
}

.metric-card__label {
  color: #8a97a8;
  font-size: 11px;
}

.metric-card__value {
  margin-top: 6px;
  display: block;
  color: #12233b;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.45;
}

.card {
  margin-top: 14px;
  padding: 16px;
}

.card__title {
  color: #12233b;
  font-size: 16px;
  font-weight: 700;
}

.card__desc,
.card__notes {
  margin-top: 8px;
  display: block;
  color: #526274;
  font-size: 13px;
  line-height: 1.75;
}

.card__notes {
  padding: 12px;
  border-radius: 16px;
  background: #f6f8fb;
}

.detail-row {
  padding: 12px 0;
  border-bottom: 1px solid #edf1f5;
}

.detail-row:last-child {
  border-bottom: 0;
}

.detail-row__label {
  color: #8a97a8;
  font-size: 12px;
}

.detail-row__value {
  margin-top: 4px;
  display: block;
  color: #12233b;
  font-size: 13px;
  line-height: 1.6;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.section-head__meta {
  color: #8a97a8;
  font-size: 12px;
}

.list-item {
  padding: 12px 0;
  border-bottom: 1px solid #edf1f5;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.list-item:last-child {
  border-bottom: 0;
}

.list-item__main {
  flex: 1;
  min-width: 0;
}

.list-item__title {
  display: block;
  color: #12233b;
  font-size: 14px;
  font-weight: 600;
}

.list-item__meta {
  margin-top: 4px;
  display: block;
  color: #7a8798;
  font-size: 12px;
  line-height: 1.6;
}

.action-row {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.action-btn {
  min-width: 66px;
  height: 30px;
  line-height: 30px;
  border-radius: 999px;
  padding: 0 12px;
  background: linear-gradient(135deg, #12243b, #264a74);
  color: #fff;
  font-size: 11px;
}

.action-btn--ghost {
  background: #edf3f8;
  color: #4d6277;
}

.list-item__tag {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;
  background: #edf3f8;
  color: #53657a;
}

.list-item__tag--done,
.list-item__tag--approved,
.list-item__tag--closed {
  background: rgba(17, 120, 100, 0.12);
  color: #117864;
}

.list-item__tag--doing,
.list-item__tag--pending {
  background: rgba(243, 156, 18, 0.14);
  color: #d97706;
}

.list-item__tag--blocked,
.list-item__tag--rejected {
  background: rgba(192, 57, 43, 0.12);
  color: #c0392b;
}

.empty-inline {
  margin-top: 12px;
  color: #7a8798;
  font-size: 13px;
}

.log-item {
  padding: 10px 0;
  border-bottom: 1px solid #edf1f5;
}

.log-item:last-child {
  border-bottom: 0;
}

.log-item__title {
  display: block;
  color: #12233b;
  font-size: 13px;
  line-height: 1.6;
}

.log-item__meta {
  margin-top: 4px;
  display: block;
  color: #8a97a8;
  font-size: 11px;
}

.footer-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  display: flex;
  gap: 10px;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.8), #f8fafc);
  backdrop-filter: blur(12px);
  box-shadow: 0 -12px 28px rgba(15, 35, 58, 0.08);
}

.footer-bar__btn {
  flex: 1;
  height: 42px;
  line-height: 42px;
  border-radius: 999px;
  background: linear-gradient(135deg, #12243b, #264a74);
  color: #fff;
  font-size: 13px;
}

.footer-bar__btn--ghost {
  background: #fff;
  color: #12243b;
  border: 1px solid #dce5ef;
}

.state-card {
  margin-top: 14px;
  padding: 22px 18px;
  text-align: center;
}

.state-card__title {
  color: #12233b;
  font-size: 16px;
  font-weight: 700;
}
</style>
