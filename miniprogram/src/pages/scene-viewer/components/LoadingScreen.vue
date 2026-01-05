<template>
  <view v-if="overlayActive" class="viewer-overlay">
    <view class="viewer-overlay__content viewer-overlay__card">
      <text v-if="overlayTitle" class="viewer-overlay__title">{{ overlayTitle }}</text>
      <view class="viewer-progress">
        <view class="viewer-progress__bar">
          <view
            class="viewer-progress__bar-fill"
            :style="{ width: overlayPercent + '%' }"
          />
        </view>
        <view class="viewer-progress__stats">
          <text class="viewer-progress__percent">{{ overlayPercent }}%</text>
          <text v-if="overlayBytesLabel" class="viewer-progress__bytes">{{ overlayBytesLabel }}</text>
        </view>
      </view>
    </view>
  </view>
  <view v-if="error" class="viewer-overlay error">
    <text>{{ error }}</text>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  overlayActive: boolean;
  overlayTitle: string;
  overlayPercent: number;
  overlayBytesLabel: string;
  error: string | null;
}>();
</script>

<style lang="scss" scoped>
.viewer-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(29, 30, 34, 0.4);
  color: #ffffff;
  font-size: 14px;
  text-align: center;
  padding: 12px;
}

.viewer-overlay__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 80%;
  max-width: 320px;
}

.viewer-overlay__card {
  width: 100%;
  background: rgba(20, 22, 34, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  padding: 24px 22px;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(14px);
}

.viewer-overlay__title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.4px;
}

.viewer-progress {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.viewer-progress__bar {
  position: relative;
  width: 100%;
  height: 12px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.12);
}

.viewer-progress__bar-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  border-radius: inherit;
  transition: width 0.35s ease;
  background-image: linear-gradient(90deg, rgba(94, 161, 255, 0.25) 0%, rgba(94, 161, 255, 0.75) 45%, rgba(188, 120, 255, 0.86) 100%);
  background-size: 200% 100%;
  animation: viewer-progress-fill 1.8s linear infinite;
}

@keyframes viewer-progress-fill {
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: -200% 50%;
  }
}

.viewer-progress__stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}

.viewer-progress__percent {
  font-weight: 600;
  letter-spacing: 0.5px;
}

.viewer-progress__bytes {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
}

.viewer-overlay.error {
  background-color: rgba(208, 0, 0, 0.6);
}
</style>
