<template>
  <view class="viewer-drive-speed-readout" :aria-hidden="ariaHidden || undefined">
    <text class="viewer-drive-speed-readout__value">{{ speed }}</text>
    <text class="viewer-drive-speed-readout__unit">km/h</text>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  speed: number;
  ariaHidden?: boolean;
}>();
</script>

<style scoped>
.viewer-drive-speed-readout {
  min-width: 56px;
  padding: 6px 10px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: linear-gradient(145deg, rgba(10, 16, 34, 0.5), rgba(7, 12, 28, 0.24));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 14px 28px rgba(3, 6, 18, 0.28);
  backdrop-filter: blur(12px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  color: #f7fbff;
  font-weight: 700;
  text-shadow: 0 0 8px rgba(0, 0, 0, 0.6);
}

.viewer-drive-speed-readout__value {
  font-size: 1.1rem;
  line-height: 1;
  width: 100%;
  text-align: center;
}

.viewer-drive-speed-readout__unit {
  font-size: 0.5rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.78;
  width: 100%;
  text-align: center;
  align-self: center;
}
</style>
