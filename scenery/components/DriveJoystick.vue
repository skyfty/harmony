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
    radial-gradient(circle at 50% 50%, rgba(120, 208, 255, 0.16), transparent 62%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.84), rgba(239, 245, 255, 0.62));
  border: 2px solid rgba(153, 193, 255, 0.22);
  box-shadow:
    inset 0 0 22px rgba(255, 255, 255, 0.22),
    0 0 28px rgba(52, 87, 128, 0.12);
  backdrop-filter: blur(12px) saturate(1.06);
}

.viewer-drive-joystick__base {
  position: absolute;
  inset: 16px;
  border-radius: 50%;
  background: rgba(185, 213, 242, 0.24);
  box-shadow: inset 0 0 18px rgba(255, 255, 255, 0.36);
}

.viewer-drive-joystick__stick {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.4), transparent 58%),
    linear-gradient(180deg, rgba(102, 178, 255, 0.94), rgba(71, 149, 255, 0.9));
  border: 2px solid rgba(107, 152, 198, 0.24);
  box-shadow:
    inset 0 0 14px rgba(255, 255, 255, 0.18),
    0 8px 18px rgba(72, 114, 158, 0.18);
  transform: translate(-50%, -50%);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.viewer-drive-joystick__visual.is-active .viewer-drive-joystick__stick {
  box-shadow:
    inset 0 0 18px rgba(255, 255, 255, 0.22),
    0 10px 22px rgba(72, 114, 158, 0.2);
}
</style>
