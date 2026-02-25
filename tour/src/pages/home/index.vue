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
import { listScenics } from '@/api/mini';
import { redirectToNav, type NavKey } from '@/utils/navKey';
import { applyLightNavigationBar, getTopSafeAreaMetrics } from '@/utils/safeArea';
import type { ScenicSummary } from '@/types/scenic';

const topInset = ref(getTopSafeAreaMetrics().contentTopInset);

const keyword = ref('');
const scenics = ref<ScenicSummary[]>([]);
const events = ref<{ id: string; title: string; description: string }[]>([]);
// achievements and hot events removed — `events` kept for future use if needed
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
  const [featuredScenicsRes, allScenicsRes] = await Promise.all([
    listScenicsSafe({ featured: true }),
    listScenicsSafe(),
  ]);

  scenics.value = composeFeaturedFirst(featuredScenicsRes, allScenicsRes);
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
