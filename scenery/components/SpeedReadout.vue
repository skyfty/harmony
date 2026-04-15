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
