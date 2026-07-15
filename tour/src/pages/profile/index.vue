<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader title="">
      <template #left>
        <button class="business-entry" @tap="openBusinessPage">我是商业管理员</button>
      </template>
    </PageHeader>
    <view class="header">
      <view class="profile" @tap="openProfileEdit">
        <view class="avatar">
          <image v-if="profile.avatarUrl" class="avatar-img" :src="profile.avatarUrl" mode="aspectFill" />
          <text v-else class="avatar-text">{{ initials }}</text>
        </view>
        <view class="info">
          <text class="name">{{ profile.displayName }}</text>
        </view>
      </view>
    </view>

    <view class="content">
      <view v-if="isProfileIncomplete" class="tips-card">
        <text class="tips-title">{{ isAnonymousDisplay ? '当前为匿名使用' : '当前资料未完善' }}</text>
        <text class="tips-desc">{{ isAnonymousDisplay ? '你已跳过微信头像昵称授权，可稍后手动获取并自动同步到账号。' : '补充微信头像和昵称后，个人资料会自动更新到服务端。' }}</text>
        <button class="tips-action" @tap="retryProfileAuth">{{ isAnonymousDisplay ? '获取微信头像昵称' : '完善微信资料' }}</button>
      </view>

      <view class="card">
        <view class="row" @tap="nav('/pages/orders/index')">
          <text class="label">订单中心</text>
          <text class="arrow">›</text>
        </view>
        <view class="row phone-row">
          <text class="label">手机号</text>
          <view class="phone-cell">
            <button
              v-if="phoneEnabled"
              class="phone-action"
              open-type="getPhoneNumber"
              @getphonenumber="handleGetPhoneNumber"
            >{{ maskedPhone }}</button>
            <text v-else class="phone-action">当前平台暂不支持手机号授权</text>
            
          </view>
        </view>
      </view>

      <view class="card">
        <view class="row" @tap="openPolicy('user-service-agreement')"><text class="label">用户服务协议</text><text class="arrow">›</text></view>
        <view class="row" @tap="openPolicy('privacy-policy')"><text class="label">隐私政策</text><text class="arrow">›</text></view>
      </view>

      <button class="logout" @tap="logout">退出登录</button>
    </view>

    <BottomNav active="profile" @navigate="handleNavigate" />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';

import BottomNav from '@/components/BottomNav.vue';
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue';
import PageHeader from '@/components/PageHeader.vue';
import { bindMiniPhone, ensureMiniAuth, getProfile } from '@/api/mini';
import { requestProfileAndSync } from '@/utils/miniAuthHelper';
import { resetMiniAuthSession } from '@/api/mini/session';
import type { UserProfile } from '@/types/profile';
import { redirectToNav, type NavKey } from '@/utils/navKey';
import { applyLightNavigationBar } from '@/utils/safeArea';
import { isMiniProfileIncomplete } from '@/utils/miniProfile';
import { ensureMiniCapability } from '@/platform/runtime';

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
const phoneEnabled = ref(false);

onShow(() => {
  applyLightNavigationBar();
  void ensureMiniCapability('phone').then((enabled) => { phoneEnabled.value = enabled; }).catch(() => { phoneEnabled.value = false; });
  void reloadProfile();
});

async function retryProfileAuth() {
  try {
    const ok = await requestProfileAndSync()
    if (ok) {
      void uni.showToast({ title: '同步成功', icon: 'success' })
      void reloadProfile()
    } else {
      void uni.showToast({ title: '未授权或操作取消', icon: 'none' })
    }
  } catch {
    void uni.showToast({ title: '操作失败', icon: 'none' })
  }
}

async function reloadProfile() {
  try {
    profile.value = await getProfile();

  } catch {
    uni.showToast({ title: '加载失败', icon: 'none' });
  }
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

const isProfileIncomplete = computed(() => {
  return isMiniProfileIncomplete(profile.value);
});

const isAnonymousDisplay = computed(() => Boolean(profile.value.isAnonymousDisplay));

function openProfileEdit() {
  uni.navigateTo({ url: '/pages/profile/edit' });
}

async function openBusinessPage() {
  try {
    await ensureMiniAuth();
    uni.navigateTo({ url: '/pages/business/index' });
  } catch {
    uni.showToast({ title: '请先登录微信后再进入商业订单', icon: 'none' });
  }
}

function nav(url: string) {
  uni.navigateTo({ url });
}

function openPolicy(kind: 'user-service-agreement' | 'privacy-policy') {
  uni.navigateTo({ url: `/pages/policy/index?kind=${kind}` });
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
    profile.value = await bindMiniPhone(code);
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
  padding: 8px 16px 12px;
}

.business-entry {
  margin: 0;
  padding: 0 12px;
  height: 30px;
  line-height: 30px;
  border-radius: 0;
  background: transparent;
  border: none;
  color: #194185;
  font-size: 14px;
  white-space: nowrap;
}

.business-entry::after {
  border: none;
}

.profile {
  background: #ffffff;
  border-radius: 18px;
  padding: 12px 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
  display: flex;
  align-items: center;
  gap: 10px;
}

.profile:active {
  opacity: 0.92;
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

.content {
  padding: 0 16px 18px;
}

.tips-card {
  background: rgba(255, 179, 64, 0.12);
  border: 1px solid rgba(255, 179, 64, 0.42);
  border-radius: 14px;
  padding: 12px;
  margin-bottom: 12px;
}

.tips-title {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: #5a3a00;
}

.tips-desc {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #7a5514;
}

.tips-action {
  margin-top: 10px;
  height: 32px;
  line-height: 32px;
  border-radius: 999px;
  background: #ffb340;
  color: #ffffff;
  font-size: 12px;
  padding: 0 14px;
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
  border: none;
  background: transparent;
  color: #1f7aec;
  font-size: 14px;
  padding: 0 12px;
}

.phone-action::after {
  border: none;
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
