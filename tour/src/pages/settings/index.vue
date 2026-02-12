<template>
  <view class="page">
    <view class="header"><text class="title">系统设置</text></view>
    <view class="content">
      <view class="card">
        <text class="section">通知偏好</text>
        <view class="row">
          <text class="label">消息提醒</text>
          <switch :checked="state.notify" @change="(e:any)=>toggle('notify', !!e.detail.value)" />
        </view>
        <view class="row">
          <text class="label">自动下载资源</text>
          <switch :checked="state.autoDownload" @change="(e:any)=>toggle('autoDownload', !!e.detail.value)" />
        </view>
      </view>

      <view class="card">
        <text class="section">关于</text>
        <view class="row" @tap="show('使用指南（mock）')"><text class="label">使用指南</text><text class="arrow">›</text></view>
        <view class="row" @tap="show('隐私政策（mock）')"><text class="label">隐私政策</text><text class="arrow">›</text></view>
        <view class="row" @tap="show('已是最新版本（mock）')"><text class="label">版本更新</text><text class="arrow">›</text></view>
      </view>

      <button class="logout" @tap="logout">退出登录</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { readStorageJson, writeStorageJson } from '@/utils/storage';

const KEY = 'tour:settings:v1';

const state = reactive(readStorageJson(KEY, { notify: true, autoDownload: false }));

function persist() {
  writeStorageJson(KEY, state);
}

function toggle<K extends keyof typeof state>(key: K, value: (typeof state)[K]) {
  state[key] = value;
  persist();
}

function show(message: string) {
  uni.showToast({ title: message, icon: 'none' });
}

function logout() {
  uni.showToast({ title: '已退出（mock）', icon: 'none' });
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
}

.header {
  padding: 16px;
}

.title {
  font-size: 16px;
  font-weight: 700;
  color: #1a1f2e;
}

.content {
  padding: 0 16px 18px;
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
