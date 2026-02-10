<template>
  <view class="page settings">

    <view class="card">
      <text class="card-title">安全与隐私</text>
      <view class="setting-item">
        <view class="info">
          <text class="label">双重验证</text>
          <text class="desc">使用手机验证码提升账号安全</text>
        </view>
        <switch color="#1f7aec" :checked="twoFactor" @change="onToggle('twoFactor', $event)" />
      </view>
      <view class="setting-item" @tap="resetPassword">
        <view class="info">
          <text class="label">修改密码</text>
          <text class="desc">建议每 90 天更新一次密码</text>
        </view>
        <text class="arrow">›</text>
      </view>
      <view class="setting-item" @tap="viewDevices">
        <view class="info">
          <text class="label">登录设备</text>
          <text class="desc">管理已授权的手机与电脑</text>
        </view>
        <text class="arrow">›</text>
      </view>
    </view>

    <view class="card">
      <text class="card-title">通知偏好</text>
      <view class="setting-item">
        <view class="info">
          <text class="label">邮件提醒</text>
          <text class="desc">接收订单、展览动态等邮件通知</text>
        </view>
        <switch color="#1f7aec" :checked="notifyEmail" @change="onToggle('notifyEmail', $event)" />
      </view>
      <view class="setting-item">
        <view class="info">
          <text class="label">短信通知</text>
          <text class="desc">关键消息通过短信同步到手机</text>
        </view>
        <switch color="#1f7aec" :checked="notifySms" @change="onToggle('notifySms', $event)" />
      </view>
      <view class="setting-item">
        <view class="info">
          <text class="label">作品自动同步</text>
          <text class="desc">完成渲染后自动同步至云端</text>
        </view>
        <switch color="#1f7aec" :checked="autoSync" @change="onToggle('autoSync', $event)" />
      </view>
    </view>

    <view class="card">
      <text class="card-title">关于平台</text>
      <view class="setting-item" @tap="openDocs">
        <view class="info">
          <text class="label">使用指南</text>
          <text class="desc">快速了解作品上传与展览搭建流程</text>
        </view>
        <text class="arrow">›</text>
      </view>
      <view class="setting-item" @tap="openPolicy">
        <view class="info">
          <text class="label">隐私政策</text>
          <text class="desc">了解我们如何存储与保护您的数据</text>
        </view>
        <text class="arrow">›</text>
      </view>
      <view class="setting-item" @tap="checkUpdates">
        <view class="info">
          <text class="label">版本更新</text>
          <text class="desc">当前版本 1.3.2</text>
        </view>
        <text class="arrow">›</text>
      </view>
    </view>

    <view class="footer">
      <button class="logout" @tap="logout">退出登录</button>
    </view>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue';

const twoFactor = ref(true);
const notifyEmail = ref(true);
const notifySms = ref(false);
const autoSync = ref(true);

type ToggleKey = 'twoFactor' | 'notifyEmail' | 'notifySms' | 'autoSync';

function editProfile() {
  uni.showToast({ title: '编辑资料功能开发中', icon: 'none' });
}

function resetPassword() {
  uni.showToast({ title: '将跳转至密码修改页面', icon: 'none' });
}

function viewDevices() {
  uni.showToast({ title: '设备管理功能即将上线', icon: 'none' });
}

function openDocs() {
  uni.showToast({ title: '正在打开使用指南', icon: 'none' });
}

function openPolicy() {
  uni.showToast({ title: '隐私政策已推送至邮箱', icon: 'none' });
}

function checkUpdates() {
  uni.showToast({ title: '当前已是最新版本', icon: 'none' });
}

function logout() {
  uni.showModal({
    title: '退出登录',
    content: '确认退出当前账户吗？',
    success: ({ confirm }) => {
      if (confirm) {
        uni.showToast({ title: '已退出登录', icon: 'none' });
      }
    },
  });
}

function onToggle(key: ToggleKey, event: any) {
  const value = Boolean(event.detail?.value);
  if (key === 'twoFactor') twoFactor.value = value;
  if (key === 'notifyEmail') notifyEmail.value = value;
  if (key === 'notifySms') notifySms.value = value;
  if (key === 'autoSync') autoSync.value = value;
}
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 40px;
  padding-top: 84px;
  min-height: 100vh;
  background: #f5f7fb;
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-sizing: border-box;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.title {
  font-size: 22px;
  font-weight: 600;
  color: #1f1f1f;
}

.subtitle {
  font-size: 13px;
  color: #8a94a6;
}

.profile-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 18px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 12px 28px rgba(31, 122, 236, 0.08);
}

.avatar {
  width: 60px;
  height: 60px;
  border-radius: 20px;
  background: linear-gradient(135deg, #8fbaff, #c7dfff);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 26px;
  font-weight: 600;
}

.profile-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.name {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.email {
  font-size: 13px;
  color: #6b778d;
}

.edit-btn {
  padding: 8px 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 13px;
}

.card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 12px 28px rgba(31, 122, 236, 0.08);
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.setting-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.setting-item + .setting-item {
  padding-top: 12px;
  border-top: 1px solid rgba(31, 122, 236, 0.08);
}

.info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 14px;
  font-weight: 500;
  color: #1f1f1f;
}

.desc {
  font-size: 12px;
  color: #8a94a6;
  line-height: 18px;
}

.arrow {
  font-size: 20px;
  color: rgba(31, 31, 31, 0.35);
}

.footer {
  margin-top: 12px;
}

.logout {
  width: 100%;
  padding: 14px 0;
  border-radius: 16px;
  background: linear-gradient(135deg, #ff6f61, #ff9270);
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  box-shadow: 0 12px 24px rgba(255, 140, 120, 0.28);
}
</style>
