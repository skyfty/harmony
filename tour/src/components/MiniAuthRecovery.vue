<template>
  <view v-if="visible && isActiveHost" class="recovery-overlay">
    <view class="recovery-card">
      <text class="title">{{ resolvedTitle }}</text>
      <text class="desc">{{ resolvedDescription }}</text>

      <view class="avatar-panel">
        <view class="avatar-preview">
          <image v-if="avatarPreview" class="avatar-image" :src="avatarPreview" mode="aspectFill" />
          <text v-else class="avatar-text">{{ displayInitial }}</text>
        </view>
        <button
          v-if="isWechatMiniProgram"
          class="avatar-button"
          open-type="chooseAvatar"
          @chooseavatar="handleChooseAvatar"
        >选择微信头像</button>
        <button v-else class="avatar-button" @tap="handleFallbackAvatar">选择头像</button>
      </view>

      <view class="field">
        <text class="field-label">微信昵称</text>
        <input
          v-model="displayName"
          class="field-input"
          type="nickname"
          maxlength="30"
          placeholder="请输入昵称"
          @blur="handleNicknameBlur"
        />
      </view>

      <view class="actions">
        <button class="primary-button" @tap="handleSubmit">{{ resolvedConfirmText }}</button>
        <button class="secondary-button" @tap="handleSkip">{{ resolvedSkipText }}</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  miniAuthRecoveryDialogController,
} from '@/services/miniAuth/recoveryDialogController'
import { normalizeMiniProfileText } from '@/utils/miniProfile'

const MINI_AUTH_COMPONENT_LOG_PREFIX = '[mini-auth-component]'

function logMiniAuthComponent(message: string, details?: unknown): void {
  if (details === undefined) {
    console.info(`${MINI_AUTH_COMPONENT_LOG_PREFIX} ${message}`)
    return
  }
  console.info(`${MINI_AUTH_COMPONENT_LOG_PREFIX} ${message}`, details)
}

const isWechatMiniProgram = typeof wx !== 'undefined'
const hostId = miniAuthRecoveryDialogController.registerHost()
const dialogState = ref(miniAuthRecoveryDialogController.getSnapshot())
const stopSync = miniAuthRecoveryDialogController.subscribe((nextState) => {
  logMiniAuthComponent('controller pushed state', {
    visible: nextState.visible,
    title: nextState.options.title || '(empty)',
  })
  dialogState.value = nextState
})
const visible = computed(() => dialogState.value.visible)
const isActiveHost = computed(() => dialogState.value.activeHostId === hostId)
const options = computed(() => dialogState.value.options)
const displayName = ref('')
const avatarPreview = ref('')
const avatarFilePath = ref('')

const resolvedTitle = computed(() => options.value.title || '完善微信资料')
const resolvedDescription = computed(() => options.value.description || '请提供微信头像和昵称，用于完成登录注册与账号资料同步。')
const resolvedConfirmText = computed(() => options.value.confirmText || '同步资料')
const resolvedSkipText = computed(() => options.value.skipText || '暂时匿名使用')
const displayInitial = computed(() => {
  const normalized = normalizeMiniProfileText(displayName.value)
  return normalized ? normalized.slice(0, 1) : '匿'
})

watch(
  visible,
  (nextVisible) => {
    logMiniAuthComponent('visible changed', {
      visible: nextVisible,
      isActiveHost: isActiveHost.value,
      hostId,
      title: options.value.title || '(empty)',
      initialDisplayName: options.value.initialDisplayName || '(empty)',
    })
    if (!nextVisible) {
      displayName.value = ''
      avatarPreview.value = ''
      avatarFilePath.value = ''
      return
    }

    displayName.value = options.value.initialDisplayName || ''
    avatarPreview.value = ''
    avatarFilePath.value = ''
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  logMiniAuthComponent('component before unmount')
  miniAuthRecoveryDialogController.unregisterHost(hostId)
  stopSync()
})

function handleChooseAvatar(event: { detail?: { avatarUrl?: string } }) {
  const selected = String(event?.detail?.avatarUrl || '').trim()
  if (!selected) {
    return
  }

  avatarPreview.value = selected
  avatarFilePath.value = selected
}

function handleFallbackAvatar() {
  if (typeof uni.chooseImage !== 'function') {
    return
  }

  uni.chooseImage({
    count: 1,
    success: (res) => {
      const selected = Array.isArray(res.tempFilePaths) ? String(res.tempFilePaths[0] || '').trim() : ''
      if (!selected) {
        return
      }
      avatarPreview.value = selected
      avatarFilePath.value = selected
    },
  })
}

function handleNicknameBlur(event: { detail?: { value?: string } }) {
  const nextValue = normalizeMiniProfileText(event?.detail?.value)
  displayName.value = nextValue || ''
}

function handleSubmit() {
  logMiniAuthComponent('submit tapped', {
    displayName: displayName.value || '(empty)',
    hasAvatarFilePath: Boolean(avatarFilePath.value),
  })
  miniAuthRecoveryDialogController.resolve({
    action: 'submit',
    displayName: normalizeMiniProfileText(displayName.value),
    avatarFilePath: avatarFilePath.value || undefined,
  })
}

function handleSkip() {
  logMiniAuthComponent('skip tapped')
  miniAuthRecoveryDialogController.resolve({ action: 'skip' })
}
</script>

<style scoped>
.recovery-overlay {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
  background: rgba(6, 24, 44, 0.46);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
}

.recovery-card {
  width: 100%;
  max-width: 640rpx;
  background: linear-gradient(180deg, #ffffff 0%, #f5fbff 100%);
  border-radius: 24px;
  padding: 28px 24px;
  box-sizing: border-box;
}

.title {
  display: block;
  color: #11263c;
  font-size: 18px;
  font-weight: 700;
}

.desc {
  display: block;
  margin-top: 10px;
  color: #607086;
  font-size: 13px;
  line-height: 1.6;
}

.avatar-panel {
  margin-top: 18px;
  padding: 18px 16px;
  border-radius: 18px;
  background: rgba(31, 122, 236, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.avatar-preview {
  width: 72px;
  height: 72px;
  border-radius: 36px;
  overflow: hidden;
  background: linear-gradient(145deg, rgba(63, 151, 255, 0.4), rgba(126, 198, 255, 0.2));
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.avatar-image {
  width: 72px;
  height: 72px;
}

.avatar-text {
  color: #ffffff;
  font-size: 28px;
  font-weight: 700;
}

.avatar-button {
  margin: 0;
  flex: 1;
  height: 40px;
  line-height: 40px;
  border-radius: 999px;
  border: 1px solid rgba(31, 122, 236, 0.24);
  background: #ffffff;
  color: #1f7aec;
  font-size: 13px;
}

.field {
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 18px;
  background: #ffffff;
}

.field-label {
  display: block;
  color: #607086;
  font-size: 12px;
}

.field-input {
  margin-top: 8px;
  color: #11263c;
  font-size: 15px;
}

.actions {
  margin-top: 18px;
}

.primary-button {
  background: #1f7aec;
  color: #ffffff;
  border-radius: 999px;
  height: 44px;
  line-height: 44px;
  font-size: 15px;
  font-weight: 700;
}

.secondary-button {
  margin-top: 10px;
  background: rgba(31, 122, 236, 0.08);
  color: #607086;
  border-radius: 999px;
  height: 40px;
  line-height: 40px;
  font-size: 13px;
}
</style>

