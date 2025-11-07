<template>
  <view class="page exhibition-detail">
    <view class="header">
      <view class="header-info">
        <text class="title">{{ exhibit?.name || '展览详情' }}</text>
        <text class="subtitle">{{ exhibitSubtitle }}</text>
      </view>
    </view>

    <view v-if="exhibit" class="preview" :style="{ background: exhibit.gradient || defaultGradient }">
      <text class="preview-label">展览预览</text>
    </view>

    <view v-if="exhibit" class="stats-card">
      <view class="stat">
        <text class="stat-icon">★</text>
        <text class="stat-value">{{ exhibitRating }}</text>
        <text class="stat-desc">评分</text>
      </view>
      <view class="stat">
        <text class="stat-icon visitors">👥</text>
        <text class="stat-value">{{ exhibitVisitors }}</text>
        <text class="stat-desc">参观人次</text>
      </view>
      <view class="stat">
        <text class="stat-icon works">🎨</text>
        <text class="stat-value">{{ exhibitWorksCount }}</text>
        <text class="stat-desc">展品数量</text>
      </view>
    </view>

    <view v-if="exhibit" class="collections-card">
      <view class="collections-header">
        <text class="collections-title">展览亮点</text>
      </view>
      <view v-if="exhibitHighlights.length" class="collection-tags">
        <view class="collection-tag" v-for="item in exhibitHighlights" :key="item.title">
          <text class="collection-name">{{ item.title }}</text>
          <text v-if="item.meta" class="collection-count">{{ item.meta }}</text>
        </view>
      </view>
      <view v-else class="collection-empty">
        <text>精彩亮点正在筹备中，敬请期待。</text>
      </view>
    </view>

    <view v-if="exhibit" class="info-card">
      <text class="info-title">展览简介</text>
      <text class="info-desc">{{ exhibit.desc || '该展览为示例数据，后续可从服务端拉取详情。' }}</text>
    </view>

    <view v-else class="empty">
      <text class="empty-title">未找到展览</text>
      <text class="empty-desc">请返回展览列表重新选择</text>
    </view>

    <view v-if="exhibit" class="enter-bar">
      <button class="enter-btn" @tap="enterExhibition">进入</button>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';

type ExhibitHighlight = {
  title: string;
  meta?: string;
};

type Exhibit = {
  id: string;
  name: string;
  visitedAt: string;
  gradient: string;
  desc?: string;
  worksCount?: number;
  rating?: number;
  visitors?: number;
  schedule?: string;
  highlights?: ExhibitHighlight[];
};

const defaultGradient = 'linear-gradient(135deg, #dff5ff, #c6ebff)';
const exhibitId = ref('');

const samples: Exhibit[] = [
  {
    id: 'ex1',
    name: '沉浸式光影展',
    visitedAt: '昨天',
    gradient: 'linear-gradient(135deg, #c1d8ff, #a0c5ff)',
    desc: '光与影的空间叙事，营造沉浸式行走体验，结合动态灯光与空间声场。',
    worksCount: 18,
    rating: 4.7,
    visitors: 15680,
    schedule: '2025.09.18 - 2025.12.20',
    highlights: [
      { title: '入口光影廊道', meta: '沉浸式引导区' },
      { title: '互动光场剧场', meta: '多维感官体验' },
      { title: '媒体艺术展区', meta: '12 件精选作品' },
    ],
  },
  {
    id: 'ex2',
    name: '未来装置馆',
    visitedAt: '3 天前',
    gradient: 'linear-gradient(135deg, #b7f5ec, #90e0d9)',
    desc: '机械装置与艺术的融合，通过动态结构表达未来城市节奏。',
    worksCount: 24,
    rating: 4.6,
    visitors: 20450,
    schedule: '2025.10.05 - 2026.01.08',
    highlights: [
      { title: '机械律动中庭', meta: '大型悬挂装置' },
      { title: '能量循环装置', meta: '实时数据可视化' },
    ],
  },
  {
    id: 'ex3',
    name: '数字画廊',
    visitedAt: '上周',
    gradient: 'linear-gradient(135deg, #ffd6ec, #ffeaf5)',
    desc: '数字绘画与新媒介艺术的联合展，呈现虚拟与现实交织的视觉旅程。',
    worksCount: 12,
    rating: 4.8,
    visitors: 9820,
    schedule: '2025.08.12 - 2025.11.30',
    highlights: [{ title: '沉浸式数字画廊', meta: '环幕投影体验' }],
  },
  {
    id: 'ex4',
    name: '交互媒体展',
    visitedAt: '上月',
    gradient: 'linear-gradient(135deg, #e7e4ff, #f1eeff)',
    desc: '互动媒介与创意体验，探索人机交互的感知边界。',
    worksCount: 16,
    rating: 4.5,
    visitors: 13240,
    schedule: '2025.07.01 - 2025.10.15',
    highlights: [
      { title: '互动感应墙', meta: '实时响应互动' },
      { title: '声音体验区', meta: '空间声场互动' },
    ],
  },
];

const exhibit = computed<Exhibit | undefined>(() => samples.find((e) => e.id === exhibitId.value));

const exhibitSubtitle = computed(() => {
  if (!exhibit.value) {
    return '正在加载展览信息';
  }
  const pieces: string[] = [];
  if (exhibit.value.schedule) {
    pieces.push(`展期 ${exhibit.value.schedule}`);
  }
  if (exhibit.value.visitedAt) {
    pieces.push(`最近参观 · ${exhibit.value.visitedAt}`);
  }
  return pieces.join('  ') || '展览详情';
});

const exhibitHighlights = computed<ExhibitHighlight[]>(() => exhibit.value?.highlights || []);

const exhibitRating = computed(() => {
  const rating = exhibit.value?.rating;
  return typeof rating === 'number' ? rating.toFixed(1) : '4.6';
});

const exhibitVisitors = computed(() => {
  const visitors = exhibit.value?.visitors;
  return formatNumber(typeof visitors === 'number' ? visitors : 0);
});

const exhibitWorksCount = computed(() => {
  const total = exhibit.value?.worksCount;
  return typeof total === 'number' ? total.toString() : '0';
});

onLoad((options) => {
  const raw = typeof options?.id === 'string' ? options.id : '';
  exhibitId.value = decodeURIComponent(raw);
});

function formatNumber(value: number): string {
  if (value <= 0) {
    return '0';
  }
  if (value >= 1000) {
    const formatted = value / 1000;
    return `${formatted.toFixed(formatted >= 10 ? 0 : 1)}K`;
  }
  return value.toString();
}

function enterExhibition() {
  if (!exhibitId.value) {
    return;
  }
  uni.showToast({ title: `进入展览 ${exhibit.value?.name || ''}`, icon: 'none' });
}
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 120px;
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
  gap: 6px;
}

.header-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title {
  font-size: 20px;
  font-weight: 600;
  color: #1f1f1f;
}

.subtitle {
  font-size: 13px;
  color: #8a94a6;
}

.preview {
  height: 220px;
  border-radius: 20px;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: flex-end;
  padding: 16px;
  color: #ffffff;
  font-weight: 600;
  font-size: 16px;
}

.preview-label {
  background: rgba(0, 0, 0, 0.25);
  padding: 6px 12px;
  border-radius: 12px;
}

.stats-card {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.stat {
  background: #ffffff;
  border-radius: 18px;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  box-shadow: 0 12px 24px rgba(31, 122, 236, 0.08);
}

.stat-icon {
  font-size: 18px;
  color: #1f7aec;
}

.stat:nth-child(1) .stat-icon {
  color: #ffaf42;
}

.stat:nth-child(2) .stat-icon {
  color: #62a6ff;
}

.stat:nth-child(3) .stat-icon {
  color: #8b6cff;
}

.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: #1f1f1f;
}

.stat-desc {
  font-size: 12px;
  color: #8a94a6;
}

.collections-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.collections-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.collections-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.collection-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.collection-tag {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(31, 122, 236, 0.08);
  color: #1f1f1f;
  font-size: 12px;
}

.collection-name {
  font-weight: 600;
}

.collection-count {
  color: #8a94a6;
}

.collection-empty {
  font-size: 12px;
  color: #8a94a6;
}

.info-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.info-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.info-desc {
  font-size: 13px;
  color: #5f6b83;
  line-height: 1.6;
}

.empty {
  margin-top: 80px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  color: #8a94a6;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f1f1f;
}

.empty-desc {
  font-size: 13px;
  color: #8a94a6;
}

.enter-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 20px;
  display: flex;
  justify-content: center;
  z-index: 40;
}

.enter-btn {
  width: calc(100% - 40px);
  max-width: 560px;
  padding: 12px 18px;
  border: none;
  border-radius: 18px;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 16px;
  font-weight: 600;
  box-shadow: 0 12px 28px rgba(31, 122, 236, 0.18);
  text-align: center;
}
</style>
