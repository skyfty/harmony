<template>
  <view class="page upload">
    <view class="header">
      <text class="title">上传 3D 作品</text>
      <text class="subtitle">拖拽或选择文件，支持 OBJ / GLTF / FBX</text>
    </view>

    <view class="uploader">
      <view class="drop-zone">
        <view class="cloud-icon"></view>
        <text class="drop-title">拖放 3D 文件到此</text>
        <text class="drop-desc">或点击选择文件</text>
        <button class="primary" @tap="selectFile" :disabled="loading">{{ loading ? '处理中…' : '选择文件' }}</button>
      </view>
      <view class="format-hint">
        <text>支持格式：OBJ、GLTF、FBX</text>
      </view>
    </view>

    <view class="tools-card">
      <text class="tools-title">编辑工具</text>
      <view class="tools-grid">
        <view class="tool-item" v-for="tool in tools" :key="tool.label">
          <view class="tool-icon" :class="tool.type"></view>
          <text class="tool-label">{{ tool.label }}</text>
        </view>
      </view>
    </view>

    <view class="history-card">
      <view class="history-header">
        <text class="history-title">上传记录</text>
        <text class="history-action">管理</text>
      </view>
      <view class="history-list">
        <view class="history-item" v-for="item in uploadHistory" :key="item.id">
          <view class="history-preview" :style="{ background: item.gradient }"></view>
          <view class="history-info">
            <text class="history-name">{{ item.name }}</text>
            <text class="history-meta">{{ item.size }} · {{ item.time }}</text>
          </view>
          <text class="history-status">{{ item.status }}</text>
        </view>
      </view>
    </view>

    <BottomNav active="upload" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import BottomNav from '@/components/BottomNav.vue';

type NavKey = 'home' | 'upload' | 'exhibition' | 'profile' | 'settings';

const loading = ref(false);

const tools = [
  { label: '变形', type: 'deform' },
  { label: '编辑', type: 'edit' },
  { label: '抠图', type: 'cutout' },
  { label: '渲染', type: 'render' },
];

const uploadHistory = [
  { id: 'a', name: '未来雕塑.obj', size: '24.8MB', time: '2 分钟前', status: '转换完成', gradient: 'linear-gradient(135deg, #c1d8ff, #a0c5ff)' },
  { id: 'b', name: '光影空间.gltf', size: '18.3MB', time: '15 分钟前', status: '待发布', gradient: 'linear-gradient(135deg, #b7f5ec, #90e0d9)' },
];

const routes: Record<NavKey, string> = {
  home: '/pages/home/index',
  upload: '/pages/upload/index',
  exhibition: '/pages/exhibition/index',
  profile: '/pages/profile/index',
  settings: '/pages/settings/index',
};

function handleNavigate(target: NavKey) {
  const route = routes[target];
  if (!route || target === 'upload') {
    return;
  }
  uni.redirectTo({ url: route });
}

function selectFile() {
  if (loading.value) {
    return;
  }
  loading.value = true;
  setTimeout(() => {
    loading.value = false;
    uni.showToast({ title: '上传成功', icon: 'success' });
  }, 1200);
}
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 96px;
  min-height: 100vh;
  background: #f5f7fb;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
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
  font-size: 14px;
  color: #8a94a6;
}

.uploader {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.drop-zone {
  border: 2px dashed rgba(31, 122, 236, 0.4);
  border-radius: 18px;
  padding: 28px 16px;
  background: linear-gradient(135deg, rgba(145, 189, 255, 0.14), rgba(209, 227, 255, 0.26));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  color: #1f7aec;
}

.cloud-icon {
  width: 56px;
  height: 40px;
  position: relative;
  margin-bottom: 6px;
}

.cloud-icon::before,
.cloud-icon::after {
  content: '';
  position: absolute;
  background: rgba(31, 122, 236, 0.25);
  border-radius: 50%;
}

.cloud-icon::before {
  width: 36px;
  height: 36px;
  left: 10px;
  top: 6px;
}

.cloud-icon::after {
  width: 20px;
  height: 20px;
  left: 0;
  top: 16px;
  box-shadow: 36px -8px 0 rgba(31, 122, 236, 0.25);
}

.drop-title {
  font-size: 16px;
  font-weight: 600;
}

.drop-desc {
  font-size: 13px;
  color: rgba(31, 122, 236, 0.8);
}

.primary {
  padding: 10px 28px;
  border: none;
  border-radius: 18px;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 14px;
  margin-top: 6px;
  box-shadow: 0 8px 20px rgba(31, 122, 236, 0.3);
}

.primary[disabled] {
  opacity: 0.6;
}

.format-hint {
  font-size: 12px;
  color: #8a94a6;
  text-align: center;
}

.tools-card,
.history-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
}

.tools-title,
.history-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.tools-grid {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.tool-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.tool-icon {
  width: 48px;
  height: 48px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(98, 166, 255, 0.2), rgba(31, 122, 236, 0.35));
  position: relative;
}

.tool-icon::after {
  content: '';
  position: absolute;
  inset: 14px;
  background: #ffffff;
  border-radius: 12px;
}

.tool-icon.deform::after {
  transform: rotate(45deg);
}

.tool-icon.edit::after {
  background: linear-gradient(135deg, #ffffff 40%, #1f7aec 41%, #1f7aec 60%, #ffffff 61%);
}

.tool-icon.cutout::after {
  border: 3px dashed #62a6ff;
  background: transparent;
}

.tool-icon.render::after {
  background: radial-gradient(circle at center, #ffffff 0%, #ffffff 45%, #62a6ff 46%, #62a6ff 60%, transparent 61%);
}

.tool-label {
  font-size: 13px;
  color: #4b566b;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.history-action {
  font-size: 14px;
  color: #1f7aec;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.history-preview {
  width: 56px;
  height: 56px;
  border-radius: 16px;
}

.history-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-name {
  font-size: 14px;
  color: #263248;
  font-weight: 600;
}

.history-meta {
  font-size: 12px;
  color: #8a94a6;
}

.history-status {
  font-size: 12px;
  color: #1f7aec;
}
</style>
