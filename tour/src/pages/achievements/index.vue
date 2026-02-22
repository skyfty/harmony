<template>
  <view class="page">
    <view
      class="header"
      :style="{ paddingTop: statusBarHeight + 'px' }"
    >
      <view class="title">
        打卡成就
      </view>
      <view class="search-box">
        <text class="search-icon">
          🔎
        </text>
        <input
          v-model="keyword"
          class="search-input"
          type="text"
          placeholder="搜索已打卡景区..."
        >
        <text
          v-if="keyword"
          class="clear-icon"
          @tap="keyword = ''"
        >
          ✕
        </text>
      </view>
    </view>

    <view class="content">
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
                {{ formatPercent(item.ratio) }}
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

const statusBarHeight = ref(0);
try {
  const sysInfo = uni.getSystemInfoSync();
  statusBarHeight.value = sysInfo?.statusBarHeight ?? 0;
} catch { /* fallback */ }

import BottomNav from '@/components/BottomNav.vue';
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
  ratio: number;
}

const keyword = ref('');
const scenicCheckinProgresses = ref<ScenicCardItem[]>([]);

onShow(() => {
  void reload();
});

async function reload() {
  try {
    const fetchAchievements = listAchievements as unknown as () => Promise<unknown>;
    const achievementPayload = await fetchAchievements();
    const achievementData = normalizeAchievementData(achievementPayload);

    scenicCheckinProgresses.value = achievementData.scenicCheckinProgresses;
  } catch {
    void uni.showToast({ title: '加载失败', icon: 'none' });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeAchievementData(value: unknown): {
  scenicCheckinProgresses: ScenicCardItem[];
} {
  if (!isObject(value)) {
    return {
      scenicCheckinProgresses: [],
    };
  }

  const scenicCheckinProgresses: ScenicCardItem[] = [];
  const rawList = value.scenicCheckinProgresses;
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (isScenicCardItem(item)) {
        scenicCheckinProgresses.push(item);
      }
    }
  }

  return {
    scenicCheckinProgresses,
  };
}

function isScenicCardItem(value: unknown): value is ScenicCardItem {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.scenicId === 'string'
    && typeof value.sceneId === 'string'
    && typeof value.scenicTitle === 'string'
    && typeof value.checkedCount === 'number'
    && typeof value.totalCount === 'number'
    && typeof value.ratio === 'number'
  );
}

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

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 1);
}

function formatPercent(ratio: number): string {
  return `${Math.round(clampRatio(ratio) * 100)}%`;
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
  padding: 0 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
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
