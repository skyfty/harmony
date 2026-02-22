<template>
  <view class="page">
    <view class="header" :style="{ paddingTop: statusBarHeight + 'px' }">
      <view class="search-box">
        <text class="search-icon">
          🔍
        </text>
        <input
          v-model="keyword"
          class="search-input"
          type="text"
          placeholder="搜索成就"
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
      <view class="section">
        <view class="section-title">
          成就
        </view>
        <AchievementCard
          v-for="ach in filteredAchievements"
          :key="ach.id"
          :title="ach.title"
          :description="ach.description"
          :progress="ach.progress"
          :scenic-id="ach.scenicId"
          @enter="openScenic"
        />
        <view
          v-if="!filteredAchievements.length"
          class="empty"
        >
          暂无成就数据
        </view>
      </view>

      <view class="section">
        <view class="section-title">
          打卡成就
        </view>
        <view
          v-for="item in filteredCheckinProgresses"
          :key="item.sceneId"
          class="ratio-card"
        >
          <view class="ratio-header">
            <text class="ratio-scene">
              {{ item.sceneName || item.sceneId }}
            </text>
            <text class="ratio-text">
              {{ item.checkedCount }}/{{ item.totalCount }}
            </text>
          </view>
          <view class="ratio-track">
            <view
              class="ratio-fill"
              :style="{ width: `${Math.min(Math.max(item.ratio * 100, 0), 100)}%` }"
            />
          </view>
        </view>
        <view
          v-if="!filteredCheckinProgresses.length"
          class="empty"
        >
          暂无打卡成就数据
        </view>
      </view>

      <view class="section">
        <view class="section-title">
          游历记录
        </view>
        <view
          v-for="record in filteredTravelRecords"
          :key="record.id"
          class="travel-card"
        >
          <view class="travel-scene">
            {{ record.sceneName || record.sceneId }}
          </view>
          <view class="travel-line">
            进入时间：{{ formatDateTime(record.enterTime) }}
          </view>
          <view class="travel-line">
            离开时间：{{ formatDateTime(record.leaveTime) }}
          </view>
          <view class="travel-line">
            停留时长：{{ formatDuration(record.durationSeconds) }}
          </view>
          <view class="travel-line">
            状态：{{ record.status === 'completed' ? '已完成' : '进行中' }}
          </view>
        </view>
        <view
          v-if="!filteredTravelRecords.length"
          class="empty"
        >
          暂无游历记录
        </view>
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
import AchievementCard from '@/components/AchievementCard.vue';
import { listAchievements } from '@/api/mini/achievements';
import { listTravelRecords } from '@/api/mini/travel';
import { redirectToNav, type NavKey } from '@/utils/navKey';

defineOptions({
  name: 'AchievementsPage',
});

interface Achievement {
  id: string;
  title: string;
  description: string;
  progress: number;
  scenicId?: string;
}

interface CheckinProgressItem {
  sceneId: string;
  sceneName?: string;
  checkedCount: number;
  totalCount: number;
  ratio: number;
}

interface TravelSummaryItem {
  sceneId: string;
  sceneName?: string;
  visitedCount: number;
  totalDurationSeconds: number;
}

interface TravelRecordItem {
  id: string;
  sceneId: string;
  sceneName?: string;
  enterTime: string;
  leaveTime?: string;
  durationSeconds?: number;
  status: 'active' | 'completed';
}

const keyword = ref('');
const achievements = ref<Achievement[]>([]);
const checkinProgresses = ref<CheckinProgressItem[]>([]);
const travelSummary = ref<TravelSummaryItem[]>([]);
const travelRecords = ref<TravelRecordItem[]>([]);

onShow(() => {
  void reload();
});

async function reload() {
  try {
    const fetchAchievements = listAchievements as unknown as () => Promise<unknown>;
    const fetchTravelRecords = listTravelRecords as unknown as (params?: {
      page?: number;
      pageSize?: number;
      sceneId?: string;
    }) => Promise<unknown>;

    const achievementPayload = await fetchAchievements();
    const travelPayload = await fetchTravelRecords({ page: 1, pageSize: 100 });
    const achievementData = normalizeAchievementData(achievementPayload);
    const travelData = normalizeTravelData(travelPayload);

    achievements.value = achievementData.achievements;
    checkinProgresses.value = achievementData.checkinProgresses;
    travelSummary.value = achievementData.travelSummary;
    travelRecords.value = travelData.records;
  } catch {
    void uni.showToast({ title: '加载失败', icon: 'none' });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeAchievementData(value: unknown): {
  achievements: Achievement[];
  checkinProgresses: CheckinProgressItem[];
  travelSummary: TravelSummaryItem[];
} {
  if (!isObject(value)) {
    return {
      achievements: [],
      checkinProgresses: [],
      travelSummary: [],
    };
  }

  const achievements = Array.isArray(value.achievements) ? (value.achievements as Achievement[]) : [];
  const checkinProgresses = Array.isArray(value.checkinProgresses)
    ? (value.checkinProgresses as CheckinProgressItem[])
    : [];
  const travelSummary = Array.isArray(value.travelSummary) ? (value.travelSummary as TravelSummaryItem[]) : [];

  return {
    achievements,
    checkinProgresses,
    travelSummary,
  };
}

function normalizeTravelData(value: unknown): { records: TravelRecordItem[] } {
  if (!isObject(value)) {
    return { records: [] };
  }

  return {
    records: Array.isArray(value.records) ? (value.records as TravelRecordItem[]) : [],
  };
}

function isCheckinProgressItem(value: unknown): value is CheckinProgressItem {
  if (!isObject(value)) {
    return false;
  }
  return typeof value.sceneId === 'string' && typeof value.checkedCount === 'number' && typeof value.totalCount === 'number';
}

function isTravelSummaryItem(value: unknown): value is TravelSummaryItem {
  if (!isObject(value)) {
    return false;
  }
  return typeof value.sceneId === 'string' && typeof value.visitedCount === 'number';
}

function isTravelRecordItem(value: unknown): value is TravelRecordItem {
  if (!isObject(value)) {
    return false;
  }
  return typeof value.id === 'string' && typeof value.sceneId === 'string' && typeof value.enterTime === 'string';
}

const filteredAchievements = computed(() => {
  const k = keyword.value.trim();
  if (!k) return achievements.value;
  return achievements.value.filter((a) => a.title.includes(k) || a.description.includes(k));
});

const filteredCheckinProgresses = computed(() => {
  const k = keyword.value.trim();
  const sourceCheckins: CheckinProgressItem[] = [];
  const sourceTravelSummary: TravelSummaryItem[] = [];

  const rawCheckins = checkinProgresses.value as unknown;
  if (Array.isArray(rawCheckins)) {
    for (const entry of rawCheckins) {
      if (isCheckinProgressItem(entry)) {
        sourceCheckins.push(entry);
      }
    }
  }

  const rawTravelSummary = travelSummary.value as unknown;
  if (Array.isArray(rawTravelSummary)) {
    for (const entry of rawTravelSummary) {
      if (isTravelSummaryItem(entry)) {
        sourceTravelSummary.push(entry);
      }
    }
  }

  const merged: CheckinProgressItem[] = [];
  for (const checkinItem of sourceCheckins) {
    let mergedSceneName = checkinItem.sceneName;
    for (const summaryItem of sourceTravelSummary) {
      if (summaryItem.sceneId === checkinItem.sceneId) {
        mergedSceneName = mergedSceneName || summaryItem.sceneName;
        break;
      }
    }
    merged.push({
      ...checkinItem,
      sceneName: mergedSceneName,
    });
  }

  if (!k) {
    return merged;
  }

  const filtered: CheckinProgressItem[] = [];
  for (const item of merged) {
    const sceneText = item.sceneName || item.sceneId;
    if (sceneText.includes(k)) {
      filtered.push(item);
    }
  }
  return filtered;
});

const filteredTravelRecords = computed(() => {
  const k = keyword.value.trim();
  const source: TravelRecordItem[] = [];
  const rawRecords = travelRecords.value as unknown;
  if (Array.isArray(rawRecords)) {
    for (const entry of rawRecords) {
      if (isTravelRecordItem(entry)) {
        source.push(entry);
      }
    }
  }

  if (!k) {
    return source;
  }

  const filtered: TravelRecordItem[] = [];
  for (const item of source) {
    const sceneText = item.sceneName || item.sceneId;
    if (sceneText.includes(k)) {
      filtered.push(item);
    }
  }
  return filtered;
});

function formatDateTime(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function formatDuration(value?: number): string {
  if (typeof value !== 'number' || value <= 0) return '-';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  if (hours > 0) {
    return `${hours}小时${minutes}分${seconds}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }
  return `${seconds}秒`;
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
  background: #f8f8f8;
  padding-bottom: 85px;
  padding-bottom: calc(85px + constant(safe-area-inset-bottom));
  padding-bottom: calc(85px + env(safe-area-inset-bottom));
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
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

.section {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: #1a1f2e;
}

.ratio-card,
.travel-card {
  background: #fff;
  border-radius: 12px;
  padding: 12px;
  box-shadow: 0 8px 20px rgba(31, 122, 236, 0.08);
}

.ratio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.ratio-scene,
.travel-scene {
  font-size: 14px;
  color: #1a1f2e;
  font-weight: 600;
}

.ratio-text {
  font-size: 12px;
  color: #5b667a;
}

.ratio-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: #edf2ff;
  overflow: hidden;
}

.ratio-fill {
  height: 100%;
  background: #3a7afe;
}

.travel-line {
  font-size: 12px;
  color: #5b667a;
  margin-top: 6px;
}

.empty {
  font-size: 12px;
  color: #8a94a6;
  text-align: center;
  padding: 8px 0;
}
</style>
