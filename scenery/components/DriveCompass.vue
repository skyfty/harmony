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
