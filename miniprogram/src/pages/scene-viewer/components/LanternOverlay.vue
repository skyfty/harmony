<template>
  <view
    v-if="visible"
    class="viewer-lantern-overlay"
    @tap="handleOverlayTap"
  >
    <view
      class="viewer-lantern-dialog"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
      @touchcancel="handleTouchCancel"
    >
      <button class="viewer-lantern-close" aria-label="关闭幻灯片" @tap="cancel">
        <text class="viewer-lantern-close-icon">{{ closeIcon }}</text>
      </button>
      <!-- #ifdef H5 -->
      <view
        v-if="currentSlideImage"
        class="viewer-lantern-image-wrapper"
        :style="imageBoxStyle"
        v-viewer="viewerOptions"
      >
        <image
          :src="currentSlideImage"
          mode="aspectFit"
          class="viewer-lantern-image"
          @load="handleImageLoad"
          @tap="openImageFullscreen"
        />
      </view>
      <!-- #endif -->
      <!-- #ifndef H5 -->
      <view
        v-if="currentSlideImage"
        class="viewer-lantern-image-wrapper"
        :style="imageBoxStyle"
      >
        <image
          :src="currentSlideImage"
          mode="aspectFit"
          class="viewer-lantern-image"
          @load="handleImageLoad"
          @tap="openImageFullscreen"
        />
      </view>
      <!-- #endif -->
      <view class="viewer-lantern-body">
        <text class="viewer-lantern-title">{{ currentTitle }}</text>
        <scroll-view scroll-y class="viewer-lantern-text">
          <text>{{ currentText }}</text>
        </scroll-view>
        <view class="viewer-lantern-indicator">
          <text class="viewer-lantern-counter">{{ currentIndex + 1 }} / {{ totalSlides }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';

defineProps<{
  visible: boolean;
  currentSlideImage: string;
  imageBoxStyle: any;
  viewerOptions: any;
  currentTitle: string;
  currentText: string;
  currentIndex: number;
  totalSlides: number;
  closeIcon: string;
}>();

const emit = defineEmits<{
  (e: 'cancel'): void;
  (e: 'overlayTap'): void;
  (e: 'imageLoad', event: any): void;
  (e: 'openFullscreen'): void;
  (e: 'touchstart', event: any): void;
  (e: 'touchmove', event: any): void;
  (e: 'touchend', event: any): void;
  (e: 'touchcancel', event: any): void;
}>();

const cancel = () => emit('cancel');
const handleOverlayTap = () => emit('overlayTap');
const handleImageLoad = (event: any) => emit('imageLoad', event);
const openImageFullscreen = () => emit('openFullscreen');
const handleTouchStart = (event: any) => emit('touchstart', event);
const handleTouchMove = (event: any) => emit('touchmove', event);
const handleTouchEnd = (event: any) => emit('touchend', event);
const handleTouchCancel = (event: any) => emit('touchcancel', event);
</script>

<style lang="scss" scoped>
.viewer-lantern-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(6, 8, 12, 0.62);
  z-index: 2100;
  padding: 16px;
}

.viewer-lantern-dialog {
  position: relative;
  width: auto;
  max-width: min(620px, 92vw);
  max-height: 90vh;
  border-radius: 16px;
  background: rgba(12, 16, 28, 0.96);
  color: #f5f7ff;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.45);
  touch-action: pan-y;
}

.viewer-lantern-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.24);
  background-color: rgba(15, 18, 30, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.viewer-lantern-close:active {
  opacity: 0.8;
}

.viewer-lantern-close-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
  color: #FFFFFF;
}

.viewer-lantern-image-wrapper {
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
  flex-shrink: 0;
}

.viewer-lantern-image {
  width: 100%;
  height: 100%;
  display: block;
}

.viewer-lantern-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 auto;
}

.viewer-lantern-title {
  font-size: 18px;
  font-weight: 600;
}

.viewer-lantern-text {
  max-height: 32vh;
  padding-right: 4px;
  flex: 1 1 auto;
}

.viewer-lantern-text text {
  display: block;
  font-size: 14px;
  line-height: 1.5;
  opacity: 0.92;
}

.viewer-lantern-indicator {
  display: flex;
  justify-content: center;
  padding-top: 2px;
}

.viewer-lantern-counter {
  font-size: 12px;
  opacity: 0.72;
  letter-spacing: 0.5px;
}
</style>
