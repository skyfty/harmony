<template>
  <view class="page home">
    <view class="header">
      <view>
        <text class="header-title">最新展览</text>
        <text class="header-sub">雕塑展、绘画展、数字艺术</text>
      </view>
      <view class="search-icon"></view>
    </view>

    <view class="hero-card">
      <view class="hero-info">
        <text class="hero-title">雕塑展</text>
        <text class="hero-desc">探索前沿 3D 艺术作品</text>
      </view>
      <button class="hero-link">查看全部</button>
    </view>

    <view class="category-panel">
      <text class="panel-title">展览分类</text>
      <scroll-view scroll-x class="category-scroll">
        <view class="category-tag" v-for="tag in categories" :key="tag">
          <text>{{ tag }}</text>
        </view>
      </scroll-view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">最新展览</text>
        <text class="section-more">查看全部</text>
      </view>
      <view class="works-grid">
        <view class="work-card" v-for="card in exhibitionCards" :key="card.id">
          <view class="work-thumb" :style="{ background: card.gradient }"></view>
          <view class="work-info">
            <text class="work-name">{{ card.name }}</text>
            <text class="work-meta">{{ card.meta }}</text>
          </view>
        </view>
      </view>
    </view>

    <view class="section">
      <view class="section-header">
        <text class="section-title">热门作品</text>
        <text class="section-more" @tap="goWorksList">更多</text>
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

    <BottomNav active="home" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import BottomNav from '@/components/BottomNav.vue';

type NavKey = 'home' | 'upload' | 'exhibition' | 'profile' | 'settings';

const categories = [
  '雕塑展',
  '绘画展',
  '数字艺术',
  '建模',
  '虚拟展厅',
  '互动媒体',
];

const exhibitionCards = computed(() => [
  { id: 'a', name: '浮光影展', meta: '沉浸式光影体验', gradient: 'linear-gradient(135deg, #90b6ff 0%, #c8d6ff 100%)' },
  { id: 'b', name: '数字艺术馆', meta: '多维色彩体验', gradient: 'linear-gradient(135deg, #7fe9de 0%, #b5fff4 100%)' },
  { id: 'c', name: '未来装置展', meta: '机械与艺术融合', gradient: 'linear-gradient(135deg, #ffd59e 0%, #ffe8c9 100%)' },
]);

const works = computed(() => [
  { id: 'w1', name: '抽象雕塑', meta: '展览热度 2.4K', rating: '4.8', likes: 236, gradient: 'linear-gradient(135deg, #ffe1ec, #ffd6f6)' },
  { id: 'w2', name: '空间构成', meta: '展览热度 2.0K', rating: '4.6', likes: 198, gradient: 'linear-gradient(135deg, #d9f7ff, #c0f1ff)' },
  { id: 'w3', name: '光影叙事', meta: '展览热度 1.7K', rating: '4.9', likes: 321, gradient: 'linear-gradient(135deg, #e3f4ff, #e8e3ff)' },
  { id: 'w4', name: '数字地景', meta: '展览热度 1.5K', rating: '4.7', likes: 178, gradient: 'linear-gradient(135deg, #fff2d9, #ffe5c2)' },
]);

const routes: Record<NavKey, string> = {
  home: '/pages/home/index',
  upload: '/pages/upload/index',
  exhibition: '/pages/exhibition/index',
  profile: '/pages/profile/index',
  settings: '/pages/settings/index',
};

function handleNavigate(target: NavKey) {
  const route = routes[target];
  if (!route) {
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

.header-title {
  font-size: 22px;
  font-weight: 600;
  color: #1f1f1f;
}

.header-sub {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  color: #8a94a6;
}

.search-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(145deg, rgba(63, 151, 255, 0.25), rgba(126, 198, 255, 0.15));
  position: relative;
}

.search-icon::before {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 7px;
  border: 3px solid #ffffff;
  left: 10px;
  top: 9px;
}

.search-icon::after {
  content: '';
  position: absolute;
  width: 6px;
  height: 3px;
  background: #ffffff;
  border-radius: 2px;
  right: 9px;
  bottom: 10px;
  transform: rotate(45deg);
}

.hero-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-radius: 20px;
  background: linear-gradient(140deg, #8bb8ff 0%, #b0d1ff 52%, #d2e3ff 100%);
  color: #ffffff;
  box-shadow: 0 12px 32px rgba(63, 151, 255, 0.25);
}

.hero-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hero-title {
  font-size: 20px;
  font-weight: 600;
}

.hero-desc {
  font-size: 14px;
  opacity: 0.9;
}

.hero-link {
  padding: 10px 16px;
  border-radius: 16px;
  border: none;
  background: rgba(255, 255, 255, 0.25);
  color: #ffffff;
  font-size: 14px;
}

.category-panel {
  background: #ffffff;
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 6px 16px rgba(31, 122, 236, 0.08);
}


.work-stats {
  display: flex;
  gap: 8px;
  margin-top: 4px;
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
.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
  margin-bottom: 12px;
}

.category-scroll {
  display: flex;
  flex-direction: row;
  gap: 12px;
}

.category-tag {
  padding: 10px 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(31, 122, 236, 0.12), rgba(126, 198, 255, 0.12));
  color: #1f7aec;
  font-size: 14px;
  margin-right: 12px;
}

.section {
  background: #ffffff;
  border-radius: 18px;
  padding: 16px;
  box-shadow: 0 6px 18px rgba(31, 122, 236, 0.06);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.section-more {
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
  font-weight: 600;
  color: #1f1f1f;
}

.work-meta {
  font-size: 12px;
  color: #8a94a6;
}
</style>
