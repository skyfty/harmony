<template>
  <view v-if="visible" class="consent-overlay">
    <view class="consent-card">
      <text class="consent-badge">隐私保护提示</text>
      <text class="consent-title">请阅读并同意后继续使用</text>
      <text class="consent-desc">
        当你尝试使用微信头像、手机号、昵称等隐私能力时，我们会先弹出这份提示。你可以先查看《用户服务协议》和《隐私政策》，同意后继续当前操作。
      </text>

      <view v-if="loading" class="loading-box">
        <text class="loading-text">正在加载协议内容...</text>
      </view>

      <view v-else class="policy-card">
        <view class="policy-row" @tap="openPolicy('user-service-agreement')">
          <text class="policy-label">{{ agreementTitle }}</text>
          <text class="policy-arrow">›</text>
        </view>
        <view class="policy-row" @tap="openPolicy('privacy-policy')">
          <text class="policy-label">{{ privacyTitle }}</text>
          <text class="policy-arrow">›</text>
        </view>
      </view>

      <view v-if="errorMessage" class="error-box">
        <text class="error-text">{{ errorMessage }}</text>
      </view>

      <view class="actions">
        <button class="primary" :disabled="loading || accepting" @tap="acceptAndContinue">同意并继续</button>
        <button class="secondary" :disabled="loading || accepting" @tap="disagreeAndClose">不同意</button>
        <button class="ghost" :disabled="loading || accepting" @tap="openPolicy('privacy-policy')">查看隐私政策</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { MiniPolicyDocument } from '@/api/mini/policies'
import { getMiniPlatformAdapter } from '@/platform/adapter'
import { acceptMiniPrivacyConsent, hasMiniPrivacyConsent, loadMiniPrivacyConsentSummary } from '@/services/miniPrivacyConsent'

type PrivacyResolve = (granted?: boolean) => void

const visible = ref(false)
const loading = ref(true)
const accepting = ref(false)
const errorMessage = ref('')
const agreementTitle = ref('用户服务协议')
const privacyTitle = ref('隐私政策')
const currentPolicies = ref<{
  userServiceAgreement: MiniPolicyDocument
  privacyPolicy: MiniPolicyDocument
} | null>(null)

let privacyResolve: PrivacyResolve | null = null

async function refresh() {
  loading.value = true
  errorMessage.value = ''
  try {
    const summary = await loadMiniPrivacyConsentSummary()
    agreementTitle.value = summary.policies?.userServiceAgreement.title || '用户服务协议'
    privacyTitle.value = summary.policies?.privacyPolicy.title || '隐私政策'
    currentPolicies.value = summary.policies
      ? {
          userServiceAgreement: summary.policies.userServiceAgreement,
          privacyPolicy: summary.policies.privacyPolicy,
        }
      : null
  } catch (error) {
    const fallback = error instanceof Error ? error.message : '协议加载失败，请稍后重试'
    errorMessage.value = fallback
    currentPolicies.value = null
  } finally {
    loading.value = false
  }
}

function closeOverlay(granted: boolean) {
  visible.value = false
  accepting.value = false
  const resolve = privacyResolve
  privacyResolve = null
  if (resolve) {
    try {
      resolve(granted)
    } catch {
      // ignore listener errors
    }
  }
}

async function acceptAndContinue() {
  if (loading.value || accepting.value) {
    uni.showToast({ title: '协议加载中，请稍后', icon: 'none' })
    return
  }
  if (!currentPolicies.value) {
    await refresh()
    if (!currentPolicies.value) {
      uni.showToast({ title: '协议加载失败，请稍后重试', icon: 'none' })
      return
    }
  }
  accepting.value = true
  try {
    acceptMiniPrivacyConsent(currentPolicies.value)
    closeOverlay(true)
  } catch (error) {
    accepting.value = false
    const fallback = error instanceof Error ? error.message : '同意失败，请重试'
    uni.showToast({ title: fallback, icon: 'none' })
  }
}

function disagreeAndClose() {
  closeOverlay(false)
}

function openPolicy(kind: 'privacy-policy' | 'user-service-agreement') {
  uni.navigateTo({ url: `/pages/policy/index?kind=${kind}` })
}

function handleNeedPrivacyAuthorization(resolve: PrivacyResolve, _eventInfo?: unknown) {
  if (hasMiniPrivacyConsent()) {
    try {
      resolve(true)
    } catch {
      // ignore listener errors
    }
    return
  }
  privacyResolve = resolve
  visible.value = true
  void refresh()
}

onMounted(() => {
  void refresh()
  getMiniPlatformAdapter().registerPrivacyAuthorizationListener?.(handleNeedPrivacyAuthorization)
})

onBeforeUnmount(() => {
  if (privacyResolve) {
    closeOverlay(false)
  }
})
</script>

<style scoped lang="scss">
.consent-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(6, 24, 44, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
}

.consent-card {
  width: 100%;
  max-width: 640rpx;
  background: linear-gradient(180deg, #ffffff 0%, #f5fbff 100%);
  border-radius: 24px;
  padding: 24px 22px 20px;
  box-sizing: border-box;
  box-shadow: 0 24px 56px rgba(5, 18, 34, 0.24);
}

.consent-badge {
  display: inline-flex;
  font-size: 11px;
  color: #1f7aec;
  background: rgba(31, 122, 236, 0.1);
  padding: 4px 10px;
  border-radius: 999px;
}

.consent-title {
  display: block;
  margin-top: 12px;
  font-size: 20px;
  font-weight: 800;
  color: #0f1f31;
}

.consent-desc {
  display: block;
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.8;
  color: #526173;
}

.loading-box,
.error-box,
.policy-card {
  margin-top: 16px;
  border-radius: 18px;
  background: rgba(31, 122, 236, 0.06);
  overflow: hidden;
}

.loading-box {
  padding: 16px;
}

.loading-text,
.error-text {
  display: block;
  font-size: 13px;
  line-height: 1.7;
  color: #607086;
}

.error-box {
  margin-top: 12px;
  padding: 12px 14px;
  background: rgba(255, 90, 90, 0.08);
}

.error-text {
  color: #b42318;
}

.policy-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(31, 122, 236, 0.08);
}

.policy-row:last-child {
  border-bottom: none;
}

.policy-label {
  font-size: 14px;
  color: #11263c;
  font-weight: 700;
}

.policy-arrow {
  font-size: 18px;
  color: #8ca0b7;
}

.actions {
  display: grid;
  gap: 10px;
  margin-top: 18px;
}

.primary,
.secondary {
  height: 44px;
  line-height: 44px;
  border-radius: 999px;
  font-size: 14px;
  font-weight: 700;
}

.primary {
  background: #1f7aec;
  color: #ffffff;
}

.secondary {
  background: rgba(31, 122, 236, 0.08);
  color: #1f7aec;
}

.ghost {
  height: 40px;
  line-height: 40px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  background: transparent;
  color: #526173;
}

.primary[disabled],
.secondary[disabled],
.ghost[disabled] {
  opacity: 0.62;
}
</style>
