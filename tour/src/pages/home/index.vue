<template>
  <view class="page" :style="{ paddingTop: topInset + 'px' }">

    <view class="content">
      <view class="grid">
        <ScenicCard
          v-for="scenic in filtered"
          :key="scenic.id"
          :name="scenic.title"
          :summary="null"
          :cover-url="scenic.coverImage"
          :rating="scenic.averageRating"
          :progress-percent="resolveScenicProgress(scenic.id).percent"
          :progress-text="resolveScenicProgress(scenic.id).description"
          @tap="openDetail(scenic.id)"
        />
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
import { listAchievements, listHotEvents, listScenics } from '@/api/mini';
import { redirectToNav, type NavKey } from '@/utils/navKey';
import { applyLightNavigationBar, getTopSafeAreaMetrics } from '@/utils/safeArea';
import type { ScenicCheckinProgressItem } from '@/types/achievement';
import type { ScenicSummary } from '@/types/scenic';

const topInset = ref(getTopSafeAreaMetrics().contentTopInset);

const keyword = ref('');
const scenics = ref<ScenicSummary[]>([]);
const events = ref<{ id: string; title: string; description: string }[]>([]);
const scenicProgressMap = ref<Record<string, ScenicCheckinProgressItem>>({});
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
  const [featuredScenicsRes, allScenicsRes, eventsRes, achievementsRes] = await Promise.all([
    listScenicsSafe({ featured: true }),
    listScenicsSafe(),
    listHotEvents(),
    listAchievements().catch(() => null),
  ]);
  const normalizedEvents = Array.isArray(eventsRes)
    ? eventsRes
    : [];
  const progressMap: Record<string, ScenicCheckinProgressItem> = {};
  const progressList = Array.isArray(achievementsRes?.scenicCheckinProgresses)
    ? achievementsRes.scenicCheckinProgresses
    : [];
  for (const item of progressList) {
    if (!item || typeof item.scenicId !== 'string' || !item.scenicId) {
      continue;
    }
    progressMap[item.scenicId] = item;
  }

  scenics.value = composeFeaturedFirst(featuredScenicsRes, allScenicsRes);
  scenicProgressMap.value = progressMap;
  events.value = normalizedEvents.map((event) => ({
    id: event.id,
    title: event.title,
    description: event.description,
  }));
}

onMounted(() => {
  void reload().catch(() => {
    void uni.showToast({ title: '加载失败', icon: 'none' });
  });
});

onShow(() => {
  topInset.value = getTopSafeAreaMetrics().contentTopInset;
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

function resolveScenicProgress(scenicId: string): { percent: number; description: string } {
  const progress = scenicProgressMap.value[scenicId];
  if (!progress) {
    return {
      percent: 0,
      description: '打卡进度',
    };
  }

  const checked = Number.isFinite(progress.checkedCount) ? Math.max(progress.checkedCount, 0) : 0;
  const total = Number.isFinite(progress.totalCount) ? Math.max(progress.totalCount, 0) : 0;
  const ratio = total > 0
    ? Math.min(checked / total, 1)
    : 0;
  const percent = Math.round(ratio * 100);
  return {
    percent,
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

.header {
  padding: 16px 16px 10px;
}

.search-box {
  background: #ffffff;
  border-radius: 14px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.search-icon {
  font-size: 14px;
  color: #8a94a6;
}

.search-input {
  flex: 1;
  font-size: 13px;
  color: #1a1f2e;
}

.clear-icon {
  font-size: 14px;
  color: #a8b0c1;
}

.content {
  padding: 0 16px 18px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 14px 0 10px;
}

.section-text {
  font-size: 14px;
  font-weight: 600;
  color: #1a1f2e;
}

.grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.activity {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.activity-card {
  background: #ffffff;
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.activity-title {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #1a1f2e;
}

.activity-desc {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #5f6b83;
}
</style>
