<template>
  <view class="page">
    <MiniAuthRecovery />
    <view class="hero">
      <view class="hero-bg">
        <view class="hero-orb hero-orb-left" />
        <view class="hero-orb hero-orb-right" />
        <view class="hero-curve" />
      </view>
      <view class="hero-content">
        <text class="hero-title">探索你想去的景点</text>
        <text class="hero-subtitle">轻松查找景区路线与游玩进度</text>

        <view class="search-box" @tap="openScenicSearch">
          <image src="/static/images/fangdajing.png" class="search-icon" mode="aspectFit" />
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
              :is-featured="scenic.isFeatured"
              :is-hot="scenic.isHot"
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
import { guardedNavigateTo } from '@/utils/navigationGuard';

import BottomNav from '@/components/BottomNav.vue';
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue';
import ScenicCard from '@/components/ScenicCard.vue';
import { listScenics } from '@/api/mini';
import { listAchievements } from '@/api/mini/achievements';
import { redirectToNav, type NavKey } from '@/utils/navKey';
import { applyLightNavigationBar } from '@/utils/safeArea';
import type { ScenicCheckinProgressItem } from '@/types/achievement';
import type { ScenicSummary } from '@/types/scenic';

type HomeScenicSummary = ScenicSummary & {
  isFeatured?: boolean;
  isHot?: boolean;
};


const keyword = ref('');
const scenics = ref<HomeScenicSummary[]>([]);
const scenicCheckinProgresses = ref<ScenicCheckinProgressItem[]>([]);
const listScenicsSafe = listScenics as (query?: {
  featured?: boolean;
  homepage?: boolean;
  q?: string;
}) => Promise<HomeScenicSummary[]>;

async function reload() {
  // request homepage-ordered list: featured -> hot -> others, each ordered by their `order` field
  const res = await listScenicsSafe({ homepage: true });
  scenics.value = res;
}

onMounted(() => {
  void reload().catch(() => {
    void uni.showToast({ title: '加载失败', icon: 'none' });
  });
  void loadScenicCheckinProgresses();
});

onShow(() => {
  applyLightNavigationBar();
  void loadScenicCheckinProgresses();
});

const filtered = computed(() => {
  const k = keyword.value.trim();
  if (!k) return scenics.value;
  return scenics.value.filter((s) => s.title.includes(k) || s.description.includes(k));
});

function openDetail(id: string) {
  const url = `/pages/scenic/detail?id=${encodeURIComponent(id)}`;
  void guardedNavigateTo(url);
}

function openScenicSearch() {
  void guardedNavigateTo('/pages/scenic/index');
}

function resolveScenicProgress(_scenicId: string): { percent: number; description: string } {
  const progress = scenicCheckinProgresses.value.find((item) => item.scenicId === _scenicId) ?? null;
  const checked = getSafeCount(progress?.checkedCount);
  const total = getSafeCount(progress?.totalCount);
  const ratio = total > 0 ? Math.min(checked / total, 1) : 0;
  const percent = Math.round(ratio * 100);

  return {
    percent,
    description:
      ratio >= 1 && total > 0
        ? '已完成该景区所有景点打卡'
        : total > 0
          ? `已完成该景区${checked}/${total}个景点打卡`
          : '暂未开始该景区景点打卡',
  };
}

async function loadScenicCheckinProgresses(): Promise<void> {
  try {
    const achievementData = await listAchievements();
    scenicCheckinProgresses.value = achievementData.scenicCheckinProgresses;
  } catch {
    scenicCheckinProgresses.value = [];
  }
}

function getSafeCount(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(Number(value), 0);
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: #0b1020;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 8px 20px rgba(79, 70, 229, 0.12);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
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
  width: 24px;
  height: 24px;
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
