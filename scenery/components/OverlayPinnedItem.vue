<template>
  <view :class="overlayClass" :style="overlayStyle">
    <slot />
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  baseClass: string;
  vehicleClass: string;
  referenceKind: 'camera' | 'vehicle';
  xPercent: number;
  yPercent: number;
  scale: number;
  opacity: number;
}>();

const overlayClass = computed(() => [
  props.baseClass,
  { [props.vehicleClass]: props.referenceKind === 'vehicle' },
]);

const overlayStyle = computed(() => ({
  left: `${props.xPercent}%`,
  top: `${props.yPercent}%`,
  transform: `translate(-50%, -100%) scale(${props.scale})`,
  opacity: String(props.opacity),
}));
</script>
