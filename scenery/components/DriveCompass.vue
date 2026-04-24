<template>
  <view class="viewer-drive-compass" :style="compassStyle">
    <view class="viewer-drive-compass__ticks">
      <view
        v-for="tick in ticks"
        :key="tick.key"
        class="viewer-drive-compass__tick"
        :class="{ 'is-major': tick.major }"
        :style="tick.style"
      ></view>
    </view>
    <view
      v-for="label in labels"
      :key="label.key"
      class="viewer-drive-compass__label-slot"
      :style="label.slotStyle"
    >
      <text class="viewer-drive-compass__label" :style="label.textStyle">{{ label.text }}</text>
    </view>
    <view class="viewer-drive-compass__pointer"></view>
  </view>
</template>

<script setup lang="ts">
export interface CompassTick {
  key: string;
  major: boolean;
  style: Record<string, string>;
}

export interface CompassLabel {
  key: string;
  text: string;
  slotStyle: Record<string, string>;
  textStyle: Record<string, string>;
}

defineProps<{
  compassStyle: Record<string, string>;
  ticks: CompassTick[];
  labels: CompassLabel[];
}>();
</script>

<style scoped>
.viewer-drive-compass {
  width: 84px;
  height: 84px;
  border-radius: 50%;
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(153, 193, 255, 0.24);
  background:
    radial-gradient(circle at 28% 24%, rgba(120, 208, 255, 0.26), transparent 34%),
    radial-gradient(circle at 68% 72%, rgba(255, 255, 255, 0.18), transparent 40%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.66), rgba(244, 249, 255, 0.42));
  box-shadow:
    inset 0 0 20px rgba(255, 255, 255, 0.34),
    inset 0 -12px 24px rgba(194, 220, 247, 0.12),
    0 14px 28px rgba(52, 87, 128, 0.14);
  backdrop-filter: blur(22px) saturate(1.12);
}

.viewer-drive-compass::before {
  content: '';
  position: absolute;
  inset: 9%;
  border-radius: 50%;
  border: 1px solid rgba(107, 152, 198, 0.14);
  background: radial-gradient(circle at center, rgba(255, 255, 255, 0.42), rgba(243, 249, 255, 0.18));
}

.viewer-drive-compass__ticks {
  position: absolute;
  inset: 0;
}

.viewer-drive-compass__tick {
  position: absolute;
  top: 7px;
  left: 50%;
  width: 2px;
  height: 7px;
  border-radius: 999px;
  background: rgba(82, 117, 151, 0.26);
  transform-origin: center 34px;
  z-index: 1;
}

.viewer-drive-compass__tick.is-major {
  height: 10px;
  background: rgba(94, 161, 255, 0.7);
}

.viewer-drive-compass__label-slot {
  position: absolute;
  inset: 0;
  z-index: 3;
}

.viewer-drive-compass__label {
  position: absolute;
  top: 7px;
  left: 50%;
  font-size: 0.64rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.08em;
  color: rgba(21, 50, 79, 0.84);
  text-shadow: none;
  transform-origin: center center;
  z-index: 3;
}

.viewer-drive-compass__pointer {
  position: absolute;
  inset: 0;
  transform: rotate(var(--vehicle-heading, 0deg));
  transform-origin: center center;
  z-index: 2;
}

.viewer-drive-compass__pointer::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 28px;
  width: 7px;
  height: 32px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(102, 178, 255, 0.94), rgba(71, 149, 255, 0.9));
  box-shadow: 0 0 16px rgba(84, 170, 255, 0.24);
  transform: translateX(-50%);
}

.viewer-drive-compass__pointer::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 21px;
  width: 0;
  height: 0;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-bottom: 13px solid rgba(102, 178, 255, 0.96);
  filter: drop-shadow(0 0 8px rgba(88, 170, 255, 0.22));
  transform: translateX(-50%);
}
</style>
