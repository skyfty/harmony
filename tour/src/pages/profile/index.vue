<template>
  <view class="page">
    <view class="header">
      <view class="profile">
        <view class="avatar">
          <image v-if="profile.avatarUrl" class="avatar-img" :src="profile.avatarUrl" mode="aspectFill" />
          <text v-else class="avatar-text">{{ initials }}</text>
        </view>
        <view class="info">
          <text class="name">{{ profile.nickname }}</text>
          <text class="badge">会员</text>
        </view>
        <button class="edit" @tap="openProfileEdit">编辑个人资料</button>
      </view>
    </view>

    <view class="content">
      <view class="menu">
        <view class="row" @tap="nav('/pages/orders/index')">
          <text class="row-text">订单中心</text>
          <text class="arrow">›</text>
        </view>
        <view class="row" @tap="nav('/pages/address/index')">
          <text class="row-text">地址管理</text>
          <text class="arrow">›</text>
        </view>
        <view class="row" @tap="nav('/pages/feedback/index')">
          <text class="row-text">用户建议</text>
          <text class="arrow">›</text>
        </view>
        <view class="row" @tap="nav('/pages/settings/index')">
          <text class="row-text">系统设置</text>
          <text class="arrow">›</text>
        </view>
      </view>
    </view>

    <BottomNav active="profile" @navigate="handleNavigate" />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import BottomNav from '@/components/BottomNav.vue';
import { getProfile } from '@/mocks/profile';
import { redirectToNav, type NavKey } from '@/utils/navKey';

const profile = ref(getProfile());

onShow(() => {
  profile.value = getProfile();
});

const initials = computed(() => {
  const name = profile.value.nickname || '游客';
  return name.slice(0, 1);
});

function openProfileEdit() {
  uni.navigateTo({ url: '/pages/profile/edit' });
}

function nav(url: string) {
  uni.navigateTo({ url });
}

function handleNavigate(key: NavKey) {
  redirectToNav(key);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
  padding-bottom: 70px;
}

.header {
  padding: 16px;
}

.profile {
  background: #ffffff;
  border-radius: 18px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
  display: flex;
  align-items: center;
  gap: 12px;
}

.avatar {
  width: 54px;
  height: 54px;
  border-radius: 27px;
  overflow: hidden;
  background: linear-gradient(145deg, rgba(63, 151, 255, 0.35), rgba(126, 198, 255, 0.2));
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-img {
  width: 54px;
  height: 54px;
}

.avatar-text {
  color: #ffffff;
  font-weight: 700;
  font-size: 20px;
}

.info {
  flex: 1;
}

.name {
  display: block;
  font-size: 16px;
  font-weight: 700;
  color: #1a1f2e;
}

.badge {
  display: inline-block;
  margin-top: 6px;
  font-size: 11px;
  color: #ffb340;
  background: rgba(255, 179, 64, 0.14);
  padding: 2px 8px;
  border-radius: 999px;
}

.edit {
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  border-radius: 999px;
  font-size: 12px;
  padding: 0 12px;
  height: 30px;
  line-height: 30px;
}

.content {
  padding: 0 16px 18px;
}

.menu {
  background: #ffffff;
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px;
  border-bottom: 1px solid #f2f4f7;
}

.row:last-child {
  border-bottom: none;
}

.row-text {
  font-size: 14px;
  color: #1a1f2e;
}

.arrow {
  color: #a8b0c1;
  font-size: 18px;
}
</style>
