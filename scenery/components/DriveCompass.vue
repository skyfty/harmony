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
  border: 1px solid rgba(255, 255, 255, 0.16);
  background:
    radial-gradient(circle at 30% 28%, rgba(255, 255, 255, 0.2), transparent 34%),
    linear-gradient(145deg, rgba(13, 20, 42, 0.52), rgba(6, 10, 24, 0.22));
  box-shadow:
    inset 0 0 18px rgba(0, 0, 0, 0.26),
    0 16px 30px rgba(3, 6, 18, 0.3);
  backdrop-filter: blur(14px);
}

.viewer-drive-compass::before {
  content: '';
  position: absolute;
  inset: 9%;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: radial-gradient(circle at center, rgba(14, 22, 48, 0.24), rgba(4, 7, 18, 0.08));
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
  background: rgba(227, 242, 255, 0.34);
  transform-origin: center 34px;
  z-index: 1;
}

.viewer-drive-compass__tick.is-major {
  height: 10px;
  background: rgba(133, 221, 255, 0.68);
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
  color: rgba(240, 248, 255, 0.92);
  text-shadow: 0 0 8px rgba(0, 0, 0, 0.45);
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
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(130, 231, 255, 0.94), rgba(56, 181, 255, 0.88));
  box-shadow: 0 0 16px rgba(84, 221, 255, 0.4);
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
  border-bottom: 13px solid rgba(150, 237, 255, 0.96);
  filter: drop-shadow(0 0 8px rgba(88, 225, 255, 0.32));
  transform: translateX(-50%);
}
</style>
