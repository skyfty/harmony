<template>
  <view class="page exhibition">
    <view class="header">
      <view class="header-info">
        <text class="title">创建新展览</text>
        <text class="subtitle">根据场景配置展览空间</text>
      </view>
      <button class="create-btn" @tap="goCreate">新增展览</button>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">展览列表</text>
        <text class="section-extra">{{ exhibitions.length }} 个进行中</text>
      </view>
      <view class="exhibition-list">
        <view
          class="exhibition-card"
          v-for="exhibition in exhibitions"
          :key="exhibition.id"
          :style="{ background: exhibition.cover }"
        >
          <view class="card-overlay"></view>
          <view class="card-content">
            <text class="card-title">{{ exhibition.name }}</text>
            <view class="card-meta">
              <text>{{ exhibition.date }}</text>
              <text>{{ exhibition.works }} 件作品</text>
            </view>
          </view>
          <view class="action-buttons">
            <button class="action-btn primary" @tap.stop="enterExhibition(exhibition.id)">进入</button>
            <button class="action-btn" @tap.stop="shareExhibition(exhibition.id)">分享</button>
            <button class="action-btn danger" @tap.stop="withdrawExhibition(exhibition.id)">撤展</button>
          </view>
        </view>
      </view>
    </view>

    <BottomNav active="exhibition" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import BottomNav from '@/components/BottomNav.vue';

type NavKey = 'home' | 'upload' | 'exhibition' | 'profile' | 'settings';

type Exhibition = {
  id: string;
  name: string;
  date: string;
  works: number;
  cover: string;
};

const exhibitions: Exhibition[] = [
  {
    id: 'e1',
    name: '沉浸光影展',
    date: '2025.04.10 - 2025.05.30',
    works: 18,
    cover: 'linear-gradient(135deg, #8fbaff, #d7e8ff)',
  },
  {
    id: 'e2',
    name: '数字浮岛联展',
    date: '2025.05.01 - 2025.06.15',
    works: 24,
    cover: 'linear-gradient(135deg, #9df3df, #c8fff0)',
  },
  {
    id: 'e3',
    name: '雕刻空间特展',
    date: '2025.03.18 - 2025.04.28',
    works: 16,
    cover: 'linear-gradient(135deg, #ffdcb5, #ffe7ca)',
  },
];

const routes: Record<NavKey, string> = {
  home: '/pages/home/index',
  upload: '/pages/upload/index',
  exhibition: '/pages/exhibition/index',
  profile: '/pages/profile/index',
  settings: '/pages/settings/index',
};

function goCreate() {
  uni.navigateTo({ url: '/pages/exhibition/create/index' });
}

function enterExhibition(id: string) {
  uni.showToast({ title: `进入展览 ${id}`, icon: 'none' });
}

function shareExhibition(id: string) {
  uni.showToast({ title: `分享展览 ${id}`, icon: 'none' });
}

function withdrawExhibition(id: string) {
  uni.showModal({
    title: '撤展确认',
    content: '确认要撤下该展览吗？',
    confirmColor: '#d93025',
    success: (res) => {
      if (res.confirm) {
        uni.showToast({ title: '已提交撤展', icon: 'none' });
      }
    },
  });
}

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
  gap: 16px;
}

.header-info {
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

.create-btn {
  width: 100%;
  padding: 14px 20px;
  border-radius: 18px;
  border: none;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 16px;
  font-weight: 600;
  box-shadow: 0 16px 32px rgba(31, 122, 236, 0.22);
  text-align: center;
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

.section-extra {
  font-size: 14px;
  color: #1f7aec;
}

.exhibition-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.exhibition-card {
  position: relative;
  min-height: 160px;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 18px 40px rgba(31, 122, 236, 0.18);
  background-size: cover;
  background-position: center;
}

.card-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(145deg, rgba(31, 47, 84, 0.65), rgba(31, 122, 236, 0.25));
}

.card-content {
  position: absolute;
  inset: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: #ffffff;
  z-index: 1;
}

.card-title {
  font-size: 18px;
  font-weight: 600;
}

.card-meta {
  display: flex;
  gap: 16px;
  font-size: 13px;
  opacity: 0.9;
}


.action-buttons {
  position: absolute;
  right: 16px;
  bottom: 16px;
  display: flex;
  gap: 6px;
  z-index: 1;
}

.action-btn {
  padding: 6px 12px;
  border-radius: 12px;
  border: none;
  background: rgba(255, 255, 255, 0.22);
  color: #ffffff;
  font-size: 12px;
  line-height: 16px;
  backdrop-filter: blur(4px);
}

.action-btn.primary {
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
}

.action-btn.danger {
  background: rgba(217, 48, 37, 0.75);
}
</style>
