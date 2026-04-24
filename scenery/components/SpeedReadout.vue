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
  padding: 7px 12px;
  border-radius: 18px;
  border: 1px solid rgba(153, 193, 255, 0.24);
  background:
    radial-gradient(circle at 24% 18%, rgba(120, 208, 255, 0.24), transparent 42%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.68), rgba(244, 249, 255, 0.48)),
    linear-gradient(135deg, rgba(255, 255, 255, 0.2), rgba(210, 232, 255, 0.1));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.34),
    inset 0 -10px 22px rgba(194, 220, 247, 0.14),
    0 14px 28px rgba(52, 87, 128, 0.12);
  backdrop-filter: blur(22px) saturate(1.12);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  color: #15324f;
  font-weight: 700;
  text-shadow: none;
  overflow: hidden;
  position: relative;
}

.viewer-drive-speed-readout::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.24), transparent 44%);
  pointer-events: none;
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
  opacity: 0.68;
  width: 100%;
  text-align: center;
  align-self: center;
}
</style>
