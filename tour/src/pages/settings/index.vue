<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader title="系统设置" />
      <view class="content">
        <view class="card">
          <text class="section">系统设置已移动</text>
          <view class="row"><text class="label">设置项已整合至个人中心页面</text></view>
        </view>
        <button class="logout" @tap="goProfile">前往个人中心</button>
      </view>
  </view>
</template>

<script setup lang="ts">
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue';
import PageHeader from '@/components/PageHeader.vue';

function goProfile() {
  uni.navigateTo({ url: '/pages/profile/index' });
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
}

.content {
  padding: 12px 16px 24px;
  display: grid;
  gap: 12px;
}

.card {
  background: #ffffff;
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.section {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: #1a1f2e;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid #f2f4f7;
}

.row:last-child {
  border-bottom: none;
}

.label {
  font-size: 13px;
  color: #1a1f2e;
}

.arrow {
  color: #a8b0c1;
  font-size: 18px;
}

.logout {
  width: 100%;
  background: #ffffff;
  color: #ff3b57;
  border-radius: 14px;
  height: 44px;
  line-height: 44px;
  font-size: 15px;
  font-weight: 700;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.06);
}
</style>
