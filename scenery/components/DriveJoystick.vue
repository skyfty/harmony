<template>
  <view
    ref="rootRef"
    class="viewer-drive-joystick"
    :class="{ 'is-active': isActive }"
    role="slider"
    aria-label="驾驶摇杆"
    aria-valuemin="-100"
    aria-valuemax="100"
    :aria-valuenow="Math.round(throttle * 100)"
    @touchstart.stop.prevent="$emit('joystickTouchStart', $event)"
    @touchmove.stop.prevent="$emit('joystickTouchMove', $event)"
    @touchend.stop.prevent="$emit('joystickTouchEnd', $event)"
    @touchcancel.stop.prevent="$emit('joystickTouchEnd', $event)"
  >
    <view class="viewer-drive-joystick__base"></view>
    <view class="viewer-drive-joystick__stick" :style="knobStyle"></view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { ComponentPublicInstance } from 'vue';

defineProps<{
  isActive: boolean;
  throttle: number;
  knobStyle: Record<string, string>;
}>();

defineEmits<{
  joystickTouchStart: [event: TouchEvent];
  joystickTouchMove: [event: TouchEvent];
  joystickTouchEnd: [event: TouchEvent];
}>();

const rootRef = ref<ComponentPublicInstance | HTMLElement | null>(null);

defineExpose({ rootRef });
</script>
