<template>
  <view
    class="viewer-drive-joystick__visual"
    :class="{ 'is-active': isActive }"
    aria-hidden="true"
  >
    <view class="viewer-drive-joystick__base"></view>
    <view class="viewer-drive-joystick__stick" :style="knobStyle"></view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  isActive: boolean;
  knobStyle: Record<string, string>;
}>();
</script>

<style scoped>
.viewer-drive-joystick__visual {
  position: absolute;
  inset: 0;
  border-radius: 50%;
}

.viewer-drive-joystick__visual::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 50%, rgba(77, 113, 255, 0.12), transparent 62%),
    rgba(18, 28, 64, 0.45);
  border: 2px solid rgba(124, 156, 255, 0.3);
  box-shadow:
    inset 0 0 22px rgba(10, 18, 48, 0.85),
    0 0 28px rgba(32, 80, 220, 0.32);
  backdrop-filter: blur(6px);
}

.viewer-drive-joystick__base {
  position: absolute;
  inset: 16px;
  border-radius: 50%;
  background: rgba(50, 72, 148, 0.18);
  box-shadow: inset 0 0 18px rgba(12, 18, 42, 0.8);
}

.viewer-drive-joystick__stick {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.2), transparent 58%),
    rgba(78, 118, 230, 0.75);
  border: 2px solid rgba(150, 188, 255, 0.4);
  box-shadow:
    inset 0 0 14px rgba(18, 26, 58, 0.8),
    0 8px 18px rgba(10, 12, 28, 0.45);
  transform: translate(-50%, -50%);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.viewer-drive-joystick__visual.is-active .viewer-drive-joystick__stick {
  box-shadow:
    inset 0 0 18px rgba(18, 26, 58, 0.95),
    0 10px 22px rgba(18, 22, 44, 0.6);
}
</style>
