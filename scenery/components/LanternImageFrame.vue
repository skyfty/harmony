<template>
  <!-- #ifdef H5 -->
  <view
    v-if="imageUrl"
    ref="rootRef"
    class="viewer-lantern-image-wrapper"
    :style="boxStyle"
    v-viewer="viewerOptions"
  >
    <image
      :src="imageUrl"
      mode="aspectFit"
      class="viewer-lantern-image"
      @load="$emit('load', $event)"
      @tap="$emit('tap')"
    />
  </view>
  <!-- #endif -->
  <!-- #ifndef H5 -->
  <view
    v-if="imageUrl"
    ref="rootRef"
    class="viewer-lantern-image-wrapper"
    :style="boxStyle"
  >
    <image
      :src="imageUrl"
      mode="aspectFit"
      class="viewer-lantern-image"
      @load="$emit('load', $event)"
      @tap="$emit('tap')"
    />
  </view>
  <!-- #endif -->
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { ComponentPublicInstance } from 'vue';

defineProps<{
  imageUrl: string | null;
  boxStyle: Record<string, string>;
  viewerOptions: Record<string, unknown>;
}>();

defineEmits<{
  load: [event: Event];
  tap: [];
}>();

const rootRef = ref<HTMLElement | ComponentPublicInstance | null>(null);

defineExpose({ rootRef });
</script>
