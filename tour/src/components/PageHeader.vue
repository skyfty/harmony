<template>
  <view
    class="page-header"
    :style="{ paddingTop: topInset + 'px' }"
  >
    <view class="page-header__navbar" :style="{ height: navBarHeight + 'px' }">
      <view
        v-if="showBack"
        class="page-header__back"
        @tap="handleBack"
      >
        <text class="page-header__back-icon">
          ‹
        </text>
      </view>
      <view
        v-else
        class="page-header__back-placeholder"
      />

      <text class="page-header__title">
        {{ title }}
      </text>

      <view class="page-header__right">
        <slot name="right" />
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { applyLightNavigationBar, getTopSafeAreaMetrics } from '@/utils/safeArea';

withDefaults(
  defineProps<{
    title?: string;
    showBack?: boolean;
  }>(),
  {
    title: '',
    showBack: true,
  },
);

const topInset = ref(0);
const navBarHeight = ref(44);

function syncLayoutMetrics() {
  const metrics = getTopSafeAreaMetrics();
  topInset.value = metrics.topInset;
  navBarHeight.value = metrics.navBarHeight;
}

syncLayoutMetrics();

onMounted(() => {
  syncLayoutMetrics();
  applyLightNavigationBar();
});

onShow(() => {
  syncLayoutMetrics();
  applyLightNavigationBar();
});

function handleBack() {
  uni.navigateBack({
    fail: () => {
      void uni.redirectTo({ url: '/pages/home/index' });
    },
  });
}
</script>

<style scoped lang="scss">
.page-header {
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  position: relative;
  z-index: 100;
}

.page-header__navbar {
  display: flex;
  align-items: center;
  padding: 0 12px;
}

.page-header__back {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
}

.page-header__back-icon {
  font-size: 22px;
  color: #1a1f2e;
  line-height: 1;
  margin-top: -2px;
}

.page-header__back-placeholder {
  width: 32px;
  flex-shrink: 0;
}

.page-header__title {
  flex: 1;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: #1a1f2e;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-header__right {
  min-width: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
</style>
