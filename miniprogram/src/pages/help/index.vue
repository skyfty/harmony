<template>
  <view class="page help">
    <view class="header">
      <text class="back-btn" @tap="goBack">‹</text>
      <text class="title">帮助中心</text>
      <view class="placeholder"></view>
    </view>

    <view class="content">
      <view class="coming-soon">
        <text class="emoji">📖</text>
        <text class="message">帮助中心正在建设中</text>
        <text class="submessage">敬请期待</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
function goBack() {
  uni.navigateBack();
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f7fb;
  display: flex;
  flex-direction: column;
  padding-top: 84px;
}

.header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.back-btn {
  font-size: 32px;
  color: #1f7aec;
  line-height: 1;
  padding: 0 8px;
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: #1a1f2e;
}

.placeholder {
  width: 48px;
}

.content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}

.coming-soon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.emoji {
  font-size: 64px;
}

.message {
  font-size: 18px;
  font-weight: 500;
  color: #1a1f2e;
}

.submessage {
  font-size: 14px;
  color: #8a94a6;
}
</style>
