<template>
  <view
    v-if="visible"
    class="viewer-behavior-overlay"
    @tap.self="cancel"
  >
    <view class="viewer-behavior-dialog">
      <text class="viewer-behavior-title">{{ title }}</text>
      <scroll-view v-if="message" scroll-y class="viewer-behavior-message">
        <text>{{ message }}</text>
      </scroll-view>
      <view class="viewer-behavior-actions">
        <button
          v-if="showCancel"
          class="viewer-behavior-button cancel"
          @tap="cancel"
        >
          {{ cancelText }}
        </button>
        <button
          v-if="showConfirm"
          class="viewer-behavior-button"
          @tap="confirm"
        >
          {{ confirmText }}
        </button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
  title: string;
  message: string;
  showCancel: boolean;
  cancelText: string;
  showConfirm: boolean;
  confirmText: string;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'confirm'): void;
}>();

const cancel = () => emit('cancel');
const confirm = () => emit('confirm');
</script>

<style lang="scss" scoped>
.viewer-behavior-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.35);
  z-index: 2000; /* above loading/error overlays */
}

.viewer-behavior-dialog {
  min-width: 240px;
  max-width: 80vw;
  padding: 14px 16px;
  border-radius: 12px;
  background-color: rgba(18, 18, 32, 0.96);
  color: #f5f7ff;
  text-align: center;
  box-shadow: 0 12px 40px rgba(0,0,0,0.45);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.viewer-behavior-title {
  display: block;
  margin-bottom: 6px;
  font-size: 16px;
  font-weight: 600;
}

.viewer-behavior-message {
  max-height: 180px;
  font-size: 14px;
  opacity: 0.9;
  text-align: left;
}

.viewer-behavior-message text {
  display: block;
  line-height: 1.5;
}

.viewer-behavior-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.viewer-behavior-button {
  padding: 8px 14px;
  border: none;
  border-radius: 18px;
  background-image: linear-gradient(135deg, #1f7aec, #5d9bff);
  color: #ffffff;
  font-size: 14px;
  min-width: 96px;
}

.viewer-behavior-button.cancel {
  background-image: none;
  background-color: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
}
</style>
