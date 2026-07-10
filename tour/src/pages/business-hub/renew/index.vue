<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader title="续费申请" />

    <view class="content">
      <view v-if="loading" class="card">
        <text class="card__title">加载中...</text>
      </view>

      <template v-else-if="project && preview">
        <view class="hero-card">
          <text class="hero-card__title">{{ project.title }}</text>
          <text class="hero-card__desc">{{ project.projectNumber }}</text>
        </view>

        <view class="card">
          <text class="card__title">续费预览</text>
          <view class="grid">
            <view class="grid__item">
              <text class="grid__label">当前到期</text>
              <text class="grid__value">{{ formatDate(preview.currentServiceEndAt) || '立即生效' }}</text>
            </view>
            <view class="grid__item">
              <text class="grid__label">续费开始</text>
              <text class="grid__value">{{ formatDate(preview.nextServiceStartAt) }}</text>
            </view>
            <view class="grid__item">
              <text class="grid__label">续费结束</text>
              <text class="grid__value">{{ formatDate(preview.nextServiceEndAt) }}</text>
            </view>
            <view class="grid__item">
              <text class="grid__label">续费时长</text>
              <text class="grid__value">{{ preview.durationDays }} 天</text>
            </view>
          </view>
        </view>

        <view class="card">
          <text class="card__title">费用信息</text>
          <view class="money-panel">
            <text class="money-panel__label">本次金额</text>
            <text class="money-panel__value">¥ {{ preview.amount }}</text>
            <text class="money-panel__hint">提交后会生成一条新的续费记录，管理员审批后顺延服务时间。</text>
          </view>
        </view>

        <view class="card">
          <text class="card__title">申请备注</text>
          <textarea
            v-model="remark"
            class="textarea"
            placeholder="可以填写续费说明、希望顺延的需求、备注等"
            :maxlength="200"
          />
        </view>

        <button class="primary-btn" :disabled="submitting" @tap="submit">{{ submitting ? '提交中...' : '提交续费申请' }}</button>
      </template>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue'
import PageHeader from '@/components/PageHeader.vue'
import { createBusinessHubRenewal, getBusinessHubProjectDetail, getBusinessHubRenewalPreview } from '@/api/mini'
import type { BusinessHubProject, BusinessHubRenewalPreview } from '@/types/business-hub'
import { requestMiniProgramPayment } from '@/utils/checkout'

const loading = ref(true)
const submitting = ref(false)
const projectId = ref('')
const project = ref<BusinessHubProject | null>(null)
const preview = ref<BusinessHubRenewalPreview | null>(null)
const remark = ref('')

onLoad((options) => {
  projectId.value = typeof options?.id === 'string' ? options.id : ''
})

onShow(() => {
  void loadData()
})

async function loadData() {
  if (!projectId.value) {
    return
  }
  loading.value = true
  try {
    const [projectDetail, renewalPreview] = await Promise.all([
      getBusinessHubProjectDetail(projectId.value),
      getBusinessHubRenewalPreview(projectId.value),
    ])
    project.value = projectDetail
    preview.value = renewalPreview
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '续费信息加载失败'
    void uni.showToast({ title: message, icon: 'none' })
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!projectId.value || submitting.value) {
    return
  }
  submitting.value = true
  void uni.showLoading({ title: '提交中...' })
  try {
    const result = await createBusinessHubRenewal(projectId.value, {
      remark: remark.value.trim() || null,
      durationDays: preview.value?.durationDays,
      price: preview.value?.amount,
    })
    if (result.payParams) {
      await requestMiniProgramPayment(result.payParams)
    }
    void uni.showToast({ title: '续费申请已提交', icon: 'success' })
    setTimeout(() => {
      void uni.redirectTo({ url: `/pages/business-hub/detail/index?id=${encodeURIComponent(projectId.value)}` })
    }, 500)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '续费提交失败'
    void uni.showToast({ title: message, icon: 'none' })
  } finally {
    submitting.value = false
    void uni.hideLoading()
  }
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
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background:
    radial-gradient(circle at top right, rgba(255, 159, 67, 0.18), transparent 26%),
    linear-gradient(180deg, #13233d 0%, #13233d 12%, #f4f6f9 12%, #f8fafc 100%);
}

.content {
  padding: 14px 16px 20px;
}

.hero-card,
.card {
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 16px 34px rgba(15, 35, 58, 0.08);
}

.hero-card {
  padding: 20px 18px;
  background: linear-gradient(135deg, #102849, #2c4f80);
}

.hero-card__title {
  color: #fff;
  font-size: 20px;
  font-weight: 700;
}

.hero-card__desc {
  margin-top: 6px;
  display: block;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
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

.grid {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.grid__item {
  padding: 14px;
  border-radius: 16px;
  background: #f6f8fb;
}

.grid__label {
  color: #8a97a8;
  font-size: 11px;
}

.grid__value {
  margin-top: 6px;
  display: block;
  color: #12233b;
  font-size: 14px;
  font-weight: 700;
}

.money-panel {
  margin-top: 14px;
  padding: 16px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(255, 159, 67, 0.14), rgba(255, 107, 0, 0.06));
}

.money-panel__label {
  color: #8d5a13;
  font-size: 12px;
}

.money-panel__value {
  margin-top: 10px;
  display: block;
  color: #12233b;
  font-size: 28px;
  font-weight: 700;
}

.money-panel__hint {
  margin-top: 8px;
  display: block;
  color: #667587;
  font-size: 12px;
  line-height: 1.6;
}

.textarea {
  margin-top: 12px;
  width: 100%;
  min-height: 120px;
  padding: 14px;
  border-radius: 16px;
  box-sizing: border-box;
  background: #f6f8fb;
  color: #12233b;
  font-size: 13px;
}

.primary-btn {
  margin: 18px 16px 24px;
  background: linear-gradient(135deg, #ff9f43, #ff6b00);
  color: #fff;
  border-radius: 999px;
  font-size: 14px;
}
</style>
