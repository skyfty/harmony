<template>
  <view class="page" :style="{ paddingTop: topInset + 'px' }">
    <view class="header">
      <view class="profile">
        <view class="avatar">
          <image v-if="profile.avatarUrl" class="avatar-img" :src="profile.avatarUrl" mode="aspectFill" />
          <text v-else class="avatar-text">{{ initials }}</text>
        </view>
        <view class="info">
          <text class="name">{{ profile.displayName }}</text>
          <text class="badge">会员</text>
        </view>
        <button class="edit" @tap="openProfileEdit">编辑个人资料</button>
      </view>
    </view>

    <view class="content">
      <view class="card">
        <view class="row" @tap="nav('/pages/orders/index')">
          <text class="label">订单中心</text>
          <text class="arrow">›</text>
        </view>
        <view class="row phone-row">
          <text class="label">手机号</text>
          <view class="phone-cell">
            <text class="phone-value">{{ maskedPhone }}</text>
            <button
              v-if="!profile.hasBoundPhone"
              class="phone-action"
              open-type="getPhoneNumber"
              @getphonenumber="handleGetPhoneNumber"
            >绑定</button>
          </view>
        </view>
      </view>

      <view class="card">
        <view class="row">
          <text class="label">消息提醒</text>
          <switch :checked="settings.notify" @change="(e:any)=>toggle('notify', !!e.detail.value)" />
        </view>
        <view class="row">
          <text class="label">自动下载资源</text>
          <switch :checked="settings.autoDownload" @change="(e:any)=>toggle('autoDownload', !!e.detail.value)" />
        </view>
      </view>

      <view class="card">
        <view class="row" @tap="show('使用指南（mock）')"><text class="label">使用指南</text><text class="arrow">›</text></view>
        <view class="row" @tap="show('隐私政策（mock）')"><text class="label">隐私政策</text><text class="arrow">›</text></view>
        <view class="row" @tap="show('已是最新版本（mock）')"><text class="label">版本更新</text><text class="arrow">›</text></view>
      </view>

      <button class="logout" @tap="logout">退出登录</button>
    </view>

    <BottomNav active="profile" @navigate="handleNavigate" />
  </view>
</template>

<script setup lang="ts">
import { computed, ref, reactive } from 'vue';
import { onShow } from '@dcloudio/uni-app';

import BottomNav from '@/components/BottomNav.vue';
import { bindWechatPhone, getProfile } from '@/api/mini';
import { resetMiniAuthSession } from '@/api/mini/session';
import type { UserProfile } from '@/types/profile';
import { redirectToNav, type NavKey } from '@/utils/navKey';
import { applyLightNavigationBar, getTopSafeAreaMetrics } from '@/utils/safeArea';
import { readStorageJson, writeStorageJson } from '@/utils/storage';

const KEY = 'tour:settings:v1';

const topInset = ref(getTopSafeAreaMetrics().contentTopInset);

const profile = ref<UserProfile>({
  id: '',
  displayName: '游客',
  hasBoundPhone: false,
  gender: 'other',
  birthDate: '',
});

const defaultProfile: UserProfile = {
  id: '',
  displayName: '游客',
  hasBoundPhone: false,
  gender: 'other',
  birthDate: '',
};

const settings = reactive(readStorageJson(KEY, { notify: true, autoDownload: false }));

onShow(() => {
  topInset.value = getTopSafeAreaMetrics().contentTopInset;
  applyLightNavigationBar();
  void reloadProfile();
});

async function reloadProfile() {
  try {
    profile.value = await getProfile();
  } catch {
    uni.showToast({ title: '加载失败', icon: 'none' });
  }
}

function persist() {
  writeStorageJson(KEY, settings);
}

function toggle<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
  settings[key] = value;
  persist();
}

const initials = computed(() => {
  const name = profile.value.displayName || '游客';
  return name.slice(0, 1);
});

const maskedPhone = computed(() => {
  const phone = String(profile.value.phone || '').trim();
  if (!phone) {
    return '未绑定';
  }
  if (phone.length < 7) {
    return phone;
  }
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
});

function openProfileEdit() {
  uni.navigateTo({ url: '/pages/profile/edit' });
}

function nav(url: string) {
  uni.navigateTo({ url });
}

function show(message: string) {
  uni.showToast({ title: message, icon: 'none' });
}

function logout() {
  resetMiniAuthSession();
  profile.value = { ...defaultProfile };
  uni.showToast({ title: '已退出登录', icon: 'none' });
}

async function handleGetPhoneNumber(event: { detail?: { code?: string; errMsg?: string } }) {
  const code = String(event?.detail?.code || '').trim();
  if (!code) {
    uni.showToast({ title: '未获取到手机号授权', icon: 'none' });
    return;
  }

  try {
    profile.value = await bindWechatPhone(code);
    uni.showToast({ title: '手机号已绑定', icon: 'none' });
  } catch {
    uni.showToast({ title: '手机号绑定失败', icon: 'none' });
  }
}

function handleNavigate(key: NavKey) {
  redirectToNav(key);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
  padding-bottom: 85px;
  padding-bottom: calc(85px + constant(safe-area-inset-bottom));
  padding-bottom: calc(85px + env(safe-area-inset-bottom));
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

.card {
  background: #ffffff;
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
  margin-bottom: 12px;
}

.section {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: #1a1f2e;
  margin-bottom: 8px;
}

.label {
  font-size: 13px;
  color: #1a1f2e;
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

.phone-row {
  align-items: center;
}

.phone-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.phone-value {
  font-size: 13px;
  color: #1a1f2e;
}

.phone-action {
  margin: 0;
  min-width: 68px;
  height: 28px;
  line-height: 28px;
  border-radius: 999px;
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  font-size: 12px;
  padding: 0 12px;
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
