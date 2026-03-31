<template>
  <view class="page">
    <view class="hero">
      <view class="hero-bg">
        <view class="hero-orb hero-orb-left" />
        <view class="hero-orb hero-orb-right" />
        <view class="hero-curve" />
      </view>

      <view class="hero-content">
        <text class="hero-tag">热门目的地</text>
        <text class="hero-title">探索你想去的景点</text>
        <text class="hero-subtitle">轻松查找景区路线与游玩进度</text>

        <view class="search-box" @tap="openScenicSearch">
          <svg class="search-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <text class="search-input">搜索景点名称</text>
        </view>
      </view>
    </view>

    <view class="content">

      <view class="grid">
        <view
          v-for="scenic in filtered"
          :key="scenic.id"
          class="card-item"
        >
          <ScenicCard
            :name="scenic.title"
            :summary="null"
            :cover-url="scenic.coverImage"
            :rating="scenic.averageRating"
              :distance="scenic.distance"
              :rating-count="scenic.ratingCount"
              :address="scenic.address"
              :favorite-count="scenic.favoriteCount"
              :is-home="scenic.isHome"
              :is-hot="scenic.homepageTag === 'hot'"
            variant="list"
            :progress-percent="resolveScenicProgress(scenic.id).percent"
            :progress-text="resolveScenicProgress(scenic.id).description"
            @tap="openDetail(scenic.id)"
          />
        </view>
      </view>

    </view>

    <BottomNav active="scenic" @navigate="handleNavigate" />
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';

import BottomNav from '@/components/BottomNav.vue';
import ScenicCard from '@/components/ScenicCard.vue';
import { listScenics } from '@/api/mini';
import { redirectToNav, type NavKey } from '@/utils/navKey';
import { applyLightNavigationBar } from '@/utils/safeArea';
import type { ScenicSummary } from '@/types/scenic';


const keyword = ref('');
const scenics = ref<ScenicSummary[]>([]);
const listScenicsSafe = listScenics as (query?: { featured?: boolean; q?: string }) => Promise<ScenicSummary[]>;

function composeFeaturedFirst(featuredScenics: ScenicSummary[], allScenics: ScenicSummary[]) {
  if (!featuredScenics.length) {
    return allScenics;
  }

  const merged = [...featuredScenics];
  const idSet = new Set(featuredScenics.map((item) => item.id));

  for (const scenic of allScenics) {
    if (!idSet.has(scenic.id)) {
      merged.push(scenic);
    }
  }

  return merged;
}

async function reload() {
  // request homepage-ordered list: featured -> hot -> others, each ordered by their `order` field
  const res = await listScenicsSafe({ homepage: true });
  scenics.value = res;
}

onMounted(() => {
  void reload().catch(() => {
    void uni.showToast({ title: '加载失败', icon: 'none' });
  });
});

onShow(() => {
  applyLightNavigationBar();
});

const filtered = computed(() => {
  const k = keyword.value.trim();
  if (!k) return scenics.value;
  return scenics.value.filter((s) => s.title.includes(k) || s.description.includes(k));
});

function openDetail(id: string) {
  void uni.navigateTo({ url: `/pages/scenic/detail?id=${encodeURIComponent(id)}` });
}

function openScenicSearch() {
  void uni.navigateTo({ url: '/pages/scenic/index' });
}

function resolveScenicProgress(_scenicId: string): { percent: number; description: string } {
  return {
    percent: 0,
    description: '打卡进度',
  };
}

function handleNavigate(key: NavKey) {
  redirectToNav(key);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
  padding-bottom: 65px;
  padding-bottom: calc(65px + constant(safe-area-inset-bottom));
  padding-bottom: calc(65px + env(safe-area-inset-bottom));
}

.hero {
  position: relative;
  min-height: 236px;
  overflow: hidden;
}

.hero-bg {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #4e8bff 0%, #7f60ff 55%, #a768ff 100%);
}

.hero-curve {
  position: absolute;
  left: 50%;
  bottom: -122px;
  width: 152%;
  height: 170px;
  transform: translateX(-50%);
  border-radius: 50%;
  background: #f8f8f8;
}

.hero-orb {
  position: absolute;
  border-radius: 999px;
  opacity: 0.35;
  background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.1));
  animation: hero-float 6s ease-in-out infinite;
}

.hero-orb-left {
  width: 86px;
  height: 86px;
  left: -8px;
  top: 20px;
}

.hero-orb-right {
  width: 54px;
  height: 54px;
  right: 34px;
  top: 28px;
  animation-duration: 7s;
}

.hero-content {
  position: relative;
  z-index: 2;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 20px;
}

.hero-tag {
  width: fit-content;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  color: #f8fbff;
  background: rgba(255, 255, 255, 0.24);
  animation: hero-pulse 3.4s ease-in-out infinite;
}

.hero-title {
  margin-top: 4px;
  font-size: 22px;
  font-weight: 700;
  color: #ffffff;
}

.hero-subtitle {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.88);
}

.search-box {
  margin-top: 12px;
  background: rgba(255, 255, 255, 0.98);
  border-radius: 14px;
  padding: 11px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.16);
}

.search-icon {
  width: 18px;
  height: 18px;
  color: #7b74e7;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  font-size: 13px;
  color: #55617a;
}

.content {
  padding: 0 16px 18px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 6px 0 10px;
}

.section-text {
  font-size: 14px;
  font-weight: 600;
  color: #1a1f2e;
}

.section-tip {
  font-size: 12px;
  color: #8a94a6;
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.card-item {
  overflow: visible;
}

@keyframes hero-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}

@keyframes hero-pulse {
  0%,
  100% {
    opacity: 0.9;
  }
  50% {
    opacity: 0.6;
  }
}
</style>
