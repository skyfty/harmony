<template>
  <view class="page profile">
    <view class="header">
      <text class="title">设计师主页</text>
      <view class="header-actions">
        <view class="icon-button search"></view>
        <view class="icon-button more"></view>
      </view>
    </view>

    <view class="profile-card">
      <view class="avatar">
        <text class="avatar-initial">S</text>
      </view>
      <view class="profile-info">
        <text class="profile-name">设计师姓名</text>
        <text class="profile-meta">32 作品 · 8 展览 · 1.2K 收藏</text>
      </view>
      <button class="manage-btn">管理</button>
    </view>

    <view class="stats-card">
      <view class="stat-item" v-for="item in stats" :key="item.label">
        <text class="stat-value">{{ item.value }}</text>
        <text class="stat-label">{{ item.label }}</text>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">我的作品</text>
        <text class="section-action" @tap="goWorksList">更多</text>
      </view>
      <view class="works-grid">
        <view class="work-card" v-for="work in works" :key="work.id">
          <view class="work-thumb" :style="{ background: work.gradient }"></view>
          <view class="work-info">
            <text class="work-name">{{ work.name }}</text>
            <text class="work-meta">{{ work.meta }}</text>
            <view class="work-stats">
              <view class="stat-item">
                <text class="stat-icon">★</text>
                <text class="stat-value">{{ work.rating }}</text>
              </view>
              <view class="stat-item">
                <text class="stat-icon">❤</text>
                <text class="stat-value">{{ work.likes }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">待办事项</text>
        <text class="section-action">全部</text>
      </view>
      <view class="todo-list">
        <view class="todo-item" v-for="todo in todos" :key="todo.id">
          <view class="todo-bullet" :style="{ background: todo.color }"></view>
          <view class="todo-info">
            <text class="todo-title">{{ todo.title }}</text>
            <text class="todo-desc">{{ todo.desc }}</text>
          </view>
          <text class="todo-status">{{ todo.status }}</text>
        </view>
      </view>
    </view>

    <BottomNav active="profile" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import BottomNav from '@/components/BottomNav.vue';

type NavKey = 'home' | 'upload' | 'exhibition' | 'profile' | 'settings';

const stats = [
  { label: '本月曝光', value: '12.3K' },
  { label: '新增收藏', value: '286' },
  { label: '分享次数', value: '54' },
];

const works = [
  { id: 'w1', name: '沉浸式雕塑', meta: '曝光 2.1K', rating: '4.8', likes: 236, gradient: 'linear-gradient(135deg, #ffe0f2, #ffd0ec)' },
  { id: 'w2', name: '未来展厅', meta: '曝光 1.8K', rating: '4.6', likes: 198, gradient: 'linear-gradient(135deg, #dff5ff, #c6ebff)' },
  { id: 'w3', name: '光影序曲', meta: '曝光 1.6K', rating: '4.9', likes: 321, gradient: 'linear-gradient(135deg, #fff0ce, #ffe2a8)' },
  { id: 'w4', name: '环境剧场', meta: '曝光 1.1K', rating: '4.7', likes: 178, gradient: 'linear-gradient(135deg, #e7e4ff, #f1eeff)' },
];

const todos = [
  { id: 't1', title: '完善展览简介', desc: '为最新展览补充介绍文字与封面', status: '待完成', color: '#8bb8ff' },
  { id: 't2', title: '优化模型材质', desc: '更新光影场景的材质参数', status: '进行中', color: '#9df3df' },
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
  if (!route || target === 'profile') {
    return;
  }
  uni.redirectTo({ url: route });
}

function goWorksList() {
  uni.navigateTo({ url: '/pages/works/index' });
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
  justify-content: space-between;
  align-items: center;
}

.title {
  font-size: 22px;
  font-weight: 600;
  color: #1f1f1f;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.icon-button {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(145deg, rgba(63, 151, 255, 0.2), rgba(126, 198, 255, 0.12));
  position: relative;
}

.icon-button.search::before {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  border: 3px solid #ffffff;
  border-radius: 7px;
  left: 10px;
  top: 9px;
}

.icon-button.search::after {
  content: '';
  position: absolute;
  width: 6px;
  height: 3px;
  background: #ffffff;
  border-radius: 2px;
  right: 9px;
  bottom: 11px;
  transform: rotate(45deg);
}

.icon-button.more::before,
.icon-button.more::after {
  content: '';
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 2px;
  background: #ffffff;
  left: 50%;
  transform: translateX(-50%);
}

.icon-button.more::before {
  top: 12px;
  box-shadow: 0 8px 0 #ffffff;
}

.icon-button.more::after {
  top: 28px;
}

.profile-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
}

.avatar {
  width: 64px;
  height: 64px;
  border-radius: 24px;
  background: linear-gradient(135deg, #8fbaff, #c7dfff);
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-initial {
  font-size: 26px;
  font-weight: 600;
  color: #ffffff;
}

.profile-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.profile-name {
  font-size: 18px;
  font-weight: 600;
  color: #1f1f1f;
}

.profile-meta {
  font-size: 13px;
  color: #8a94a6;
}

.manage-btn {
  padding: 10px 18px;
  border-radius: 16px;
  border: none;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 14px;
  box-shadow: 0 8px 20px rgba(31, 122, 236, 0.3);
}

.stats-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 18px;
  display: flex;
  justify-content: space-between;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  color: #1f1f1f;
}

.stat-label {
  font-size: 12px;
  color: #8a94a6;
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

.works-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.work-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.work-thumb {
  width: 100%;
  height: 110px;
  border-radius: 18px;
  box-shadow: 0 12px 24px rgba(31, 122, 236, 0.12);
}

.work-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.work-name {
  font-size: 14px;
  color: #1f1f1f;
  font-weight: 600;
}

.work-meta {
  font-size: 12px;
  color: #8a94a6;
}

.work-stats {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(31, 122, 236, 0.08);
  padding: 4px 8px;
  border-radius: 10px;
  font-size: 11px;
  color: #1f1f1f;
}

.stat-item:last-child .stat-icon {
  color: #ff6f91;
}

.stat-icon {
  color: #ffaf42;
  font-size: 11px;
}

.stat-value {
  font-size: 12px;
}

.todo-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.todo-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.todo-bullet {
  width: 12px;
  height: 12px;
  border-radius: 6px;
}

.todo-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.todo-title {
  font-size: 14px;
  color: #1f1f1f;
}

.todo-desc {
  font-size: 12px;
  color: #8a94a6;
}

.todo-status {
  font-size: 12px;
  color: #1f7aec;
}
</style>
