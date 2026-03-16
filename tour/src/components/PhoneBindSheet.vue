<template>
  <view v-if="modelValue" class="phone-bind-sheet">
    <view class="phone-bind-sheet__mask" @tap="close" />
    <view class="phone-bind-sheet__panel">
      <text class="phone-bind-sheet__title">请先绑定手机号</text>
      <text class="phone-bind-sheet__desc">下单和支付前需要先绑定手机号，请先完成微信手机号授权。</text>
      <button
        class="phone-bind-sheet__confirm"
        :disabled="loading"
        open-type="getPhoneNumber"
        @getphonenumber="handleGetPhoneNumber"
      >{{ loading ? '绑定中...' : '一键绑定手机号' }}</button>
      <button class="phone-bind-sheet__cancel" :disabled="loading" @tap="close">暂不绑定</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { bindWechatPhone } from '@/api/mini';

defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'bound'): void;
}>();

const loading = ref(false);

function close() {
  if (loading.value) {
    return;
  }
  emit('update:modelValue', false);
}

async function handleGetPhoneNumber(event: { detail?: { code?: string } }) {
  const code = String(event?.detail?.code || '').trim();
  if (!code) {
    uni.showToast({ title: '未获取到手机号授权', icon: 'none' });
    return;
  }

  loading.value = true;
  try {
    await bindWechatPhone(code);
    emit('bound');
    emit('update:modelValue', false);
  } catch {
    uni.showToast({ title: '手机号绑定失败', icon: 'none' });
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped lang="scss">
.phone-bind-sheet {
  position: fixed;
  inset: 0;
  z-index: 1200;
}

.phone-bind-sheet__mask {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.48);
}

.phone-bind-sheet__panel {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  background: #ffffff;
  border-radius: 18px;
  padding: 18px 16px 14px;
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.18);
}

.phone-bind-sheet__title {
  display: block;
  color: #1a1f2e;
  font-size: 16px;
  font-weight: 700;
  line-height: 22px;
}

.phone-bind-sheet__desc {
  display: block;
  margin-top: 6px;
  color: #5f6b82;
  font-size: 13px;
  line-height: 18px;
}

.phone-bind-sheet__confirm {
  margin-top: 14px;
  border-radius: 999px;
  height: 42px;
  line-height: 42px;
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
  background: linear-gradient(135deg, #1f7aec, #43a2ff);
}

.phone-bind-sheet__cancel {
  margin-top: 8px;
  border-radius: 999px;
  height: 38px;
  line-height: 38px;
  font-size: 13px;
  color: #5f6b82;
  background: #eef2f7;
}
</style>
