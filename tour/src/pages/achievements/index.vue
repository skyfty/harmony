<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader title="打卡成就"  :showBack="false" />

    <view class="content">
      <view class="medal-section">
        <view class="section-head">
          <text class="section-title">勋章墙</text>
          <text class="section-meta">已获得 {{ earnedMedalCount }}/{{ medals.length }}</text>
        </view>

        <view v-if="medals.length" class="medal-grid">
          <view
            v-for="medal in medals"
            :key="medal.id"
            :class="['medal-card', medal.earned ? 'medal-card--earned' : '']"
          >
            <image class="medal-icon" :src="resolveMedalIcon(medal)" mode="aspectFill" />
            <text :class="['medal-name', medal.earned ? 'medal-name--earned' : '']">{{ medal.name }}</text>
            <text class="medal-status">{{ medal.earned ? '已获得' : '未获得' }}</text>
          </view>
        </view>

        <view v-else class="medal-empty">
          暂无勋章配置
        </view>
      </view>

      <view
        v-for="item in filteredScenicCheckins"
        :key="item.scenicId"
        class="scenic-card"
        :style="buildCardStyle(item)"
      >
        <view class="scenic-card-mask">
          <view class="scenic-header">
            <text class="scenic-title">
              {{ item.scenicTitle || item.sceneName || '未命名景区' }}
            </text>
            <view class="progress-badge">
              <text class="progress-icon">
                ★
              </text>
              <text class="progress-value">
                {{ formatPercent(item) }}
              </text>
            </view>
          </view>

          <view class="card-spacer" />

          <view
            class="enter-btn"
            @tap="openScenic(item.scenicId)"
          >
            进入景区
          </view>
        </view>
      </view>

      <view
        v-if="!filteredScenicCheckins.length"
        class="empty"
      >
        暂无打卡成就数据
      </view>
    </view>

    <BottomNav
      active="achievement"
      @navigate="handleNavigate"
    />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getStatusBarHeight } from '@/utils/systemInfo';
import type { MedalItem } from '@/types/achievement';

const statusBarHeight = ref(getStatusBarHeight());

import BottomNav from '@/components/BottomNav.vue';
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue';
import PageHeader from '@/components/PageHeader.vue';
import { listAchievements } from '@/api/mini/achievements';
import { redirectToNav, type NavKey } from '@/utils/navKey';

defineOptions({
  name: 'AchievementsPage',
});

interface ScenicCardItem {
  scenicId: string;
  sceneId: string;
  sceneName?: string;
  scenicTitle: string;
  coverImage?: string;
  slides?: string[];
  checkedCount: number;
  totalCount: number;
  ratio?: number;
}

const keyword = ref('');
const medals = ref<MedalItem[]>([]);
const scenicCheckinProgresses = ref<ScenicCardItem[]>([]);

onShow(() => {
  void reload();
});

async function reload() {
  try {
    const achievementData = await listAchievements();
    medals.value = achievementData.medals;
    scenicCheckinProgresses.value = achievementData.scenicCheckinProgresses;
  } catch {
    void uni.showToast({ title: '加载失败', icon: 'none' });
  }
}

const earnedMedalCount = computed(() => medals.value.filter((item) => item.earned).length);

const filteredScenicCheckins = computed(() => {
  const k = keyword.value.trim();
  const source = scenicCheckinProgresses.value;

  if (!k) {
    return source;
  }

  const filtered: ScenicCardItem[] = [];
  for (const item of source) {
    const sceneText = item.scenicTitle || item.sceneName || item.scenicId;
    if (sceneText.includes(k)) {
      filtered.push(item);
    }
  }
  return filtered;
});

function clampCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(value, 0);
}

function computeAchievementRatio(item: ScenicCardItem): number {
  const checkedCount = clampCount(item.checkedCount);
  const totalCount = clampCount(item.totalCount);
  if (totalCount <= 0) {
    return 0;
  }
  return Math.min(checkedCount / totalCount, 1);
}

function formatPercent(item: ScenicCardItem): string {
  return `${Math.round(computeAchievementRatio(item) * 100)}%`;
}

function resolveBackgroundImage(item: ScenicCardItem): string {
  const cover = typeof item.coverImage === 'string' ? item.coverImage.trim() : '';
  if (cover) {
    return cover;
  }
  const firstSlide = Array.isArray(item.slides) ? String(item.slides[0] ?? '').trim() : '';
  return firstSlide;
}

function buildCardStyle(item: ScenicCardItem): Record<string, string> {
  const image = resolveBackgroundImage(item);
  if (!image) {
    return {
      background: 'linear-gradient(135deg, #7f8599 0%, #6e7386 100%)',
    };
  }
  return {
    backgroundImage: `linear-gradient(180deg, rgba(14, 20, 38, 0.16) 0%, rgba(14, 20, 38, 0.55) 100%), url(${image})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
}

function resolveMedalIcon(item: MedalItem): string {
  return item.displayIconUrl || item.unlockedIconUrl || item.lockedIconUrl || '';
}

function openScenic(scenicId: string) {
  void uni.navigateTo({ url: `/pages/scenic/detail?id=${encodeURIComponent(scenicId)}` });
}

function handleNavigate(key: NavKey) {
  redirectToNav(key);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f3f6fb;
  padding-bottom: 85px;
  padding-bottom: calc(85px + constant(safe-area-inset-bottom));
  padding-bottom: calc(85px + env(safe-area-inset-bottom));
}

.header {
  padding: 8px 16px 12px;
}

.title {
  font-size: 22px;
  font-weight: 700;
  color: #171f37;
  text-align: center;
  margin-bottom: 14px;
}

.search-box {
  background: #e6ebf3;
  border-radius: 999px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-icon {
  font-size: 14px;
  color: #94a0b6;
}

.search-input {
  flex: 1;
  font-size: 13px;
  color: #1b2438;
}

.clear-icon {
  font-size: 14px;
  color: #8f99ac;
}

.content {
  padding: 12px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.medal-section {
  padding: 18px 16px;
  border-radius: 20px;
  background: linear-gradient(135deg, #fff9ef 0%, #f6efe1 100%);
  box-shadow: 0 12px 28px rgba(98, 74, 18, 0.08);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.section-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #4a3614;
}

.section-meta {
  font-size: 24rpx;
  color: #8f7444;
}

.medal-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.medal-card {
  padding: 16px 10px 14px;
  border-radius: 16px;
  background: rgba(125, 111, 78, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  opacity: 0.72;
}

.medal-card--earned {
  background: linear-gradient(180deg, rgba(255, 231, 170, 0.9) 0%, rgba(255, 214, 102, 0.75) 100%);
  box-shadow: 0 10px 20px rgba(179, 127, 16, 0.18);
  opacity: 1;
}

.medal-icon {
  width: 88rpx;
  height: 88rpx;
  border-radius: 22rpx;
  background: rgba(255, 255, 255, 0.7);
}

.medal-name {
  font-size: 24rpx;
  font-weight: 600;
  color: #7f7262;
  text-align: center;
}

.medal-name--earned {
  color: #5d3f07;
}

.medal-status {
  font-size: 22rpx;
  color: #917b56;
}

.medal-empty {
  font-size: 24rpx;
  color: #8f7444;
  text-align: center;
  padding: 20rpx 0;
}

.scenic-card {
  min-height: 118px;
  border-radius: 16px;
  overflow: hidden;
  background-size: cover;
  background-position: center;
  box-shadow: 0 8px 20px rgba(13, 22, 42, 0.14);
}

.scenic-card-mask {
  min-height: 118px;
  padding: 14px 14px 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.scenic-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.scenic-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #ffffff;
  text-shadow: 0 2px 8px rgba(6, 12, 26, 0.42);
}

.progress-badge {
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  background: rgba(33, 42, 62, 0.72);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.progress-icon {
  font-size: 13px;
  color: #00f7c2;
}

.progress-value {
  font-size: 30rpx;
  font-weight: 700;
  color: #00f7c2;
}

.card-spacer {
  flex: 1;
  min-height: 10px;
}

.enter-btn {
  height: 60rpx;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.78);
  color: #ffffff;
  font-size: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
}

.empty {
  font-size: 13px;
  color: #8b96aa;
  text-align: center;
  padding: 28px 0;
}
</style>
