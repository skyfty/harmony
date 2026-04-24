<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader title="打卡成就"  :showBack="false" />

    <view class="content">
      <view class="filter-tabs">
        <view
          :class="['tab', { active: activeTab === 'medals' }]"
          @tap="setActiveTab('medals')"
        >
          勋章墙
        </view>
        <view
          :class="['tab', { active: activeTab === 'records' }]"
          @tap="setActiveTab('records')"
        >
          打卡记录
        </view>
      </view>

      <view v-if="activeTab === 'medals'" class="medal-section">
        <view class="section-head">
          <text class="section-title">勋章墙</text>
          <text class="section-meta">已获得 {{ earnedMedalCount }}/{{ medals.length }}</text>
        </view>

        <view v-if="medals.length" class="medal-list">
          <view
            v-for="medal in medals"
            :key="medal.id"
            :class="['medal-card', medal.earned ? 'medal-card--earned' : 'medal-card--locked']"
          >
            <view class="medal-visual">
              <view class="medal-progress-shell">
                <view class="medal-progress-ring" :style="buildMedalRingStyle(medal)" />
                <view class="medal-progress-core">
                  <image class="medal-icon" :src="resolveMedalIcon(medal)" mode="aspectFit" />
                </view>
                <view class="medal-progress-value">
                  <view class="medal-progress-track">
                    <view class="medal-progress-fill" :style="buildMedalProgressBarStyle(medal)" />
                    <text class="medal-progress-text">
                      {{ formatMedalCompletionPercent(medal) }}
                    </text>
                  </view>
                </view>
              </view>
              <text :class="['medal-status', medal.earned ? 'medal-status--earned' : 'medal-status--locked']">
                {{ medal.earned ? '已获得' : '未获得' }}
              </text>
            </view>

            <view class="medal-body">
              <text :class="['medal-name', medal.earned ? 'medal-name--earned' : 'medal-name--locked']">
                {{ medal.name }}
              </text>
              <text class="medal-description">{{ getMedalDescription(medal) }}</text>
            </view>
          </view>
        </view>

        <view v-else class="medal-empty">
          暂无勋章配置
        </view>
      </view>

      <template v-else>
        <view
          v-for="item in scenicCheckins"
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
          v-if="!scenicCheckins.length"
          class="empty"
        >
          暂无打卡成就数据
        </view>
      </template>
    </view>

    <BottomNav
      active="achievement"
      @navigate="handleNavigate"
    />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { buildQueryString } from '@harmony/utils';
import type { MedalItem } from '@/types/achievement';

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

type AchievementTab = 'medals' | 'records';

const activeTab = ref<AchievementTab>('medals');
const medals = ref<MedalItem[]>([]);
const scenicCheckinProgresses = ref<ScenicCardItem[]>([]);

onLoad((query) => {
  if (query?.tab === 'records') {
    activeTab.value = 'records';
  }
});

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

const earnedMedalCount = computed(() => medals.value.filter((item: MedalItem) => item.earned).length);

const scenicCheckins = computed(() => scenicCheckinProgresses.value);

function setActiveTab(tab: AchievementTab) {
  activeTab.value = tab;
}

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

function getMedalCompletionRatio(item: MedalItem): number {
  if (item.earned) {
    return 1;
  }
  const parsed = Number(item.completionRatio ?? 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(1, parsed));
}

function getMedalCompletionPercent(item: MedalItem): number {
  return Math.round(getMedalCompletionRatio(item) * 100);
}

function formatMedalCompletionPercent(item: MedalItem): string {
  return `${getMedalCompletionPercent(item)}%`;
}

function buildMedalProgressBarStyle(item: MedalItem): Record<string, string> {
  const ratio = getMedalCompletionRatio(item);
  return {
    width: `${Math.round(ratio * 100)}%`,
    background: item.earned
      ? 'linear-gradient(90deg, rgba(255, 212, 102, 0.98) 0%, rgba(240, 178, 58, 0.98) 52%, rgba(217, 131, 22, 0.98) 100%)'
      : 'linear-gradient(90deg, rgba(110, 176, 255, 0.98) 0%, rgba(77, 129, 255, 0.98) 55%, rgba(54, 95, 218, 0.98) 100%)',
  };
}

function buildMedalRingStyle(item: MedalItem): Record<string, string> {
  const ratio = getMedalCompletionRatio(item);
  const degrees = Math.round(ratio * 360);
  const progressColor = item.earned ? '#f0b23a' : '#4d81ff';
  return {
    background: `conic-gradient(${progressColor} 0deg ${degrees}deg, rgba(255, 255, 255, 0.26) ${degrees}deg 360deg)`,
  };
}

function getMedalDescription(item: MedalItem): string {
  const description = typeof item.description === 'string' ? item.description.trim() : '';
  return description || '完成对应打卡目标后即可解锁这枚勋章。';
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

.filter-tabs {
  display: flex;
  gap: 10px;
}

.tab {
  min-width: 168rpx;
  height: 72rpx;
  padding: 0 24rpx;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 8px 18px rgba(24, 38, 68, 0.08);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 600;
  color: #5b6780;
}

.tab.active {
  background: linear-gradient(135deg, #f2c14d 0%, #d69425 100%);
  box-shadow: 0 12px 24px rgba(180, 119, 16, 0.2);
  color: #ffffff;
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

.medal-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.medal-card {
  padding: 7px 7px;
  border-radius: 22px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid transparent;
}

.medal-card--earned {
  background: linear-gradient(135deg, rgba(255, 243, 204, 0.98) 0%, rgba(255, 225, 149, 0.88) 100%);
  border-color: rgba(211, 153, 38, 0.18);
  box-shadow: 0 14px 28px rgba(179, 127, 16, 0.16);
}

.medal-card--locked {
  background: linear-gradient(135deg, rgba(234, 240, 249, 0.96) 0%, rgba(222, 229, 241, 0.92) 100%);
  border-color: rgba(109, 123, 150, 0.14);
}

.medal-visual {
  width: 188rpx;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.medal-progress-shell {
  width: 164rpx;
  height: 164rpx;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.medal-progress-shell::before {
  content: '';
  position: absolute;
  inset: 10rpx;
  border-radius: 50%;
  filter: blur(8rpx);
  opacity: 0.95;
  pointer-events: none;
}

.medal-progress-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.34);
}

.medal-progress-ring::after {
  content: '';
  position: absolute;
  inset: 8rpx;
  border-radius: 50%;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.46) 0%, rgba(255, 255, 255, 0.08) 42%, rgba(255, 255, 255, 0) 72%);
  mix-blend-mode: screen;
  pointer-events: none;
}

.medal-progress-core {
  width: 136rpx;
  height: 136rpx;
  border-radius: 50%;
  box-shadow: 0 12rpx 24rpx rgba(23, 31, 55, 0.14);
  border: 2rpx solid rgba(255, 255, 255, 0.68);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

.medal-progress-core::before {
  content: '';
  position: absolute;
  top: 10rpx;
  left: 18rpx;
  width: 64rpx;
  height: 34rpx;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.72) 0%, rgba(255, 255, 255, 0.08) 100%);
  transform: rotate(-18deg);
  pointer-events: none;
}

.medal-icon {
  width: 114rpx;
  height: 114rpx;
  background: transparent;
}

.medal-card--earned .medal-progress-shell::before {
  background: radial-gradient(circle at 28% 28%, rgba(255, 255, 255, 0.52) 0%, rgba(255, 247, 209, 0.26) 24%, rgba(255, 201, 70, 0.24) 58%, rgba(255, 142, 32, 0.12) 100%);
}

.medal-card--earned .medal-progress-ring {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.34), 0 16rpx 30rpx rgba(240, 178, 58, 0.28), 0 6rpx 14rpx rgba(255, 132, 0, 0.18);
}

.medal-card--earned .medal-progress-ring::after {
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.52) 0%, rgba(255, 244, 202, 0.18) 38%, rgba(255, 196, 76, 0.04) 72%);
}

.medal-card--earned .medal-progress-core {
  background: radial-gradient(circle at 30% 28%, rgba(255, 255, 255, 0.99) 0%, rgba(255, 248, 228, 0.96) 34%, rgba(255, 219, 136, 0.92) 66%, rgba(255, 190, 66, 0.84) 100%);
  box-shadow: inset 0 4rpx 10rpx rgba(255, 255, 255, 0.56), inset 0 -10rpx 18rpx rgba(191, 130, 18, 0.2), 0 12rpx 24rpx rgba(23, 31, 55, 0.14);
}

.medal-card--earned .medal-progress-core::before {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.76) 0%, rgba(255, 244, 196, 0.14) 100%);
}

.medal-card--earned .medal-icon {
  filter: drop-shadow(0 8rpx 10rpx rgba(111, 63, 0, 0.16));
}

.medal-card--locked .medal-progress-shell::before {
  background: radial-gradient(circle at 34% 26%, rgba(255, 255, 255, 0.42) 0%, rgba(212, 229, 255, 0.24) 24%, rgba(110, 169, 255, 0.22) 54%, rgba(76, 110, 196, 0.14) 100%);
}

.medal-card--locked .medal-progress-ring {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.34), 0 16rpx 30rpx rgba(90, 148, 255, 0.22), 0 6rpx 18rpx rgba(117, 241, 255, 0.16);
}

.medal-card--locked .medal-progress-ring::after {
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.48) 0%, rgba(211, 233, 255, 0.22) 42%, rgba(111, 162, 255, 0.04) 78%);
}

.medal-card--locked .medal-progress-core {
  background: radial-gradient(circle at 34% 26%, rgba(249, 252, 255, 0.98) 0%, rgba(224, 236, 255, 0.94) 36%, rgba(176, 203, 255, 0.88) 68%, rgba(130, 162, 225, 0.82) 100%);
  box-shadow: inset 0 4rpx 10rpx rgba(255, 255, 255, 0.48), inset 0 -10rpx 18rpx rgba(65, 98, 170, 0.18), 0 12rpx 24rpx rgba(23, 31, 55, 0.12);
}

.medal-card--locked .medal-progress-core::before {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.68) 0%, rgba(200, 229, 255, 0.12) 100%);
}

.medal-card--locked .medal-icon {
  filter: drop-shadow(0 8rpx 10rpx rgba(45, 74, 132, 0.16));
}

.medal-progress-value {
  position: absolute;
  right: -14rpx;
  bottom: -2rpx;
  width: 124rpx;
  height: 38rpx;
}

.medal-progress-track {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(23, 31, 55, 0.78) 0%, rgba(37, 47, 78, 0.84) 100%);
  overflow: hidden;
  position: relative;
  box-shadow: 0 8px 16px rgba(18, 24, 43, 0.18);
  border: 1rpx solid rgba(255, 255, 255, 0.2);
}

.medal-progress-track::after {
  content: '';
  position: absolute;
  inset: 1rpx;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.02) 100%);
  pointer-events: none;
}

.medal-progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  min-width: 0;
  border-radius: 999px;
  box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.3);
}

.medal-progress-text {
  position: absolute;
  z-index: 1;
  width: 100%;
  height: 100%;
  color: #ffffff;
  font-size: 20rpx;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-shadow: 0 1px 4px rgba(11, 16, 30, 0.32);
}

.medal-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.medal-name {
  font-size: 32rpx;
  font-weight: 800;
  line-height: 1.35;
}

.medal-name--earned {
  color: #5d3f07;
}

.medal-name--locked {
  color: #45546f;
}

.medal-description {
  font-size: 25rpx;
  line-height: 1.6;
  color: #6b7280;
}

.medal-status {
  min-width: 112rpx;
  height: 48rpx;
  padding: 0 18rpx;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  font-weight: 700;
}

.medal-status--earned {
  color: #8a5400;
  background: rgba(255, 255, 255, 0.72);
}

.medal-status--locked {
  color: #60708c;
  background: rgba(255, 255, 255, 0.62);
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
