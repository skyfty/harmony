<template>
  <view v-if="visible" class="recovery-overlay">
    <view class="recovery-card">
      <text class="title">授权以完成登录</text>
      <text class="desc">需要获取你的微信昵称与头像以完成账号注册与同步。</text>
      <button @click="handleAuthorize" class="auth-button">授权并登录</button>
      <button @click="handleCancel" class="cancel-button">稍后再说</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { isRecoveryVisible, resolveRecovery } from '@/stores/miniAuthRecovery'

const visible = computed(() => isRecoveryVisible().value)

async function handleAuthorize() {
  try {
    // This must be triggered by a user TAP gesture to succeed in WeChat
    // and will prompt the user to allow profile access.
    // @ts-ignore -- uni types in this environment
    const res = await new Promise<any>((resolve, reject) => {
      ;(uni as any).getUserProfile({
        desc: '用于完成账号注册与头像同步',
        success: (r: any) => resolve(r),
        fail: (e: any) => reject(e),
      })
    })
    const displayName = res?.userInfo?.nickName
    const avatarUrl = res?.userInfo?.avatarUrl
    resolveRecovery({ success: true, displayName, avatarUrl })
  } catch (err) {
    // user denied or error
    resolveRecovery({ success: false })
  }
}

function handleCancel() {
  resolveRecovery({ success: false })
}
</script>

<style scoped>
.recovery-overlay {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.recovery-card {
  background: #fff;
  padding: 20px;
  border-radius: 8px;
  width: 85%;
}
.title { font-weight: 700; margin-bottom: 8px; }
.desc { color: #666; margin-bottom: 16px }
.auth-button { background: #06b48a; color: #fff; padding: 10px 12px; border-radius: 6px; }
.cancel-button { margin-top: 8px; color: #666; }
</style>
