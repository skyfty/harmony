<template>
  <view class="page exhibition">
    <view class="header">
      <text class="title">创建新展览</text>
      <text class="subtitle">根据场景配置展览空间</text>
    </view>

    <view class="preview-card">
      <view class="preview-info">
        <text class="preview-title">3D 展览预览</text>
        <text class="preview-desc">拖拽作品至展厅完成排布</text>
      </view>
      <view class="preview-canvas">
        <view class="preview-light"></view>
        <view class="preview-floor"></view>
      </view>
      <view class="preview-meta">
        <text>环境光：柔和</text>
        <text>背景乐：轻</text>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">作品列表</text>
        <text class="section-action">批量操作</text>
      </view>
      <scroll-view scroll-x class="works-scroll">
        <view class="work-card" v-for="work in works" :key="work.id">
          <view class="work-thumb" :style="{ background: work.gradient }"></view>
          <text class="work-name">{{ work.name }}</text>
        </view>
      </scroll-view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">展览设置</text>
        <text class="section-action">全部</text>
      </view>
      <view class="settings-grid">
        <view class="setting-item" v-for="item in settingList" :key="item.label">
          <view class="setting-icon" :class="item.type"></view>
          <view class="setting-text">
            <text class="setting-label">{{ item.label }}</text>
            <text class="setting-value">{{ item.value }}</text>
          </view>
          <text class="setting-link">调整</text>
        </view>
      </view>
    </view>

    <BottomNav active="exhibition" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import BottomNav from '@/components/BottomNav.vue';

type NavKey = 'home' | 'upload' | 'exhibition' | 'profile' | 'settings';

const works = [
  { id: 'w1', name: '光影叙事', gradient: 'linear-gradient(135deg, #8fbaff, #d7e8ff)' },
  { id: 'w2', name: '数字浮岛', gradient: 'linear-gradient(135deg, #9df3df, #c8fff0)' },
  { id: 'w3', name: '雕刻空间', gradient: 'linear-gradient(135deg, #ffdcb5, #ffe7ca)' },
  { id: 'w4', name: '虚拟装置', gradient: 'linear-gradient(135deg, #e5ddff, #f5f1ff)' },
  { id: 'w5', name: '多维结构', gradient: 'linear-gradient(135deg, #ffd6ec, #ffeaf5)' },
];

const settingList = [
  { label: '环境光照', value: '中等亮度', type: 'light' },
  { label: '背景音乐', value: '轻松氛围', type: 'music' },
  { label: '导航模式', value: '自由漫游', type: 'navigation' },
  { label: '展板主题', value: '渐变蓝紫', type: 'theme' },
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
  if (!route || target === 'exhibition') {
    return;
  }
  uni.redirectTo({ url: route });
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

.preview-card {
  background: linear-gradient(145deg, #90b6ff, #cfe1ff);
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.15);
  color: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.preview-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preview-title {
  font-size: 18px;
  font-weight: 600;
}

.preview-desc {
  font-size: 13px;
  opacity: 0.95;
}

.preview-canvas {
  position: relative;
  height: 140px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.2);
  overflow: hidden;
}

.preview-light {
  position: absolute;
  width: 180px;
  height: 180px;
  top: -40px;
  right: -50px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.7), transparent 70%);
}

.preview-floor {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 18px;
  height: 48px;
  background: rgba(255, 255, 255, 0.35);
  border-radius: 16px 16px 12px 12px;
}

.preview-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  opacity: 0.9;
}

.section {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.section-action {
  font-size: 14px;
  color: #1f7aec;
}

.works-scroll {
  display: flex;
  flex-direction: row;
  gap: 16px;
}

.work-card {
  width: 120px;
  margin-right: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.work-thumb {
  width: 100%;
  height: 80px;
  border-radius: 18px;
  box-shadow: 0 10px 20px rgba(31, 122, 236, 0.12);
}

.work-name {
  font-size: 13px;
  color: #4b566b;
}

.settings-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setting-item {
  display: flex;
  align-items: center;
  gap: 14px;
}

.setting-icon {
  width: 48px;
  height: 48px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(98, 166, 255, 0.2), rgba(31, 122, 236, 0.35));
  position: relative;
}

.setting-icon::before {
  content: '';
  position: absolute;
  inset: 16px;
  background: #ffffff;
  border-radius: 10px;
}

.setting-icon.light::before {
  box-shadow: 0 0 0 2px rgba(98, 166, 255, 0.3);
}

.setting-icon.music::before {
  transform: rotate(-10deg);
  clip-path: polygon(0 0, 60% 0, 60% 65%, 100% 65%, 100% 78%, 48% 78%, 48% 20%, 0 20%);
}

.setting-icon.navigation::before {
  clip-path: polygon(50% 0, 90% 50%, 65% 50%, 65% 100%, 35% 100%, 35% 50%, 10% 50%);
}

.setting-icon.theme::before {
  background: linear-gradient(135deg, #8cb6ff, #b0d6ff);
}

.setting-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setting-label {
  font-size: 14px;
  color: #1f1f1f;
}

.setting-value {
  font-size: 12px;
  color: #8a94a6;
}

.setting-link {
  font-size: 13px;
  color: #1f7aec;
}
</style>
