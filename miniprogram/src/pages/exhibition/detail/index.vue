<template>
  <view class="page exhibition-detail">
    <view class="header">
      <text class="title">{{ exhibit?.name || '展览详情' }}</text>
    </view>

    <text class="subtitle" v-if="exhibit">上次参观：{{ exhibit.visitedAt }}</text>

    <view class="cover-card" :style="{ background: exhibit?.gradient || defaultGradient }">
      <text class="cover-label">展览封面</text>
    </view>

    <view class="info-card">
      <text class="section-title">展览信息</text>
      <text class="info-line">展览主题：{{ exhibit?.name || '—' }}</text>
      <text class="info-line">参观记录：{{ exhibit?.visitedAt || '—' }}</text>
      <text class="info-line">作品数量：{{ exhibit?.worksCount ?? 12 }}</text>
      <text class="info-line">简介：{{ exhibit?.desc || '该展览为示例数据，后续可从服务端拉取详情。' }}</text>
    </view>

    <view class="enter-bar">
      <button class="enter-btn"  @tap="enterExhibition">进入</button>
    </view>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';

type Exhibit = {
  id: string;
  name: string;
  visitedAt: string;
  gradient: string;
  desc?: string;
  worksCount?: number;
};

const defaultGradient = 'linear-gradient(135deg, #dff5ff, #c6ebff)';
const exhibitId = ref('');

const samples: Exhibit[] = [
  { id: 'ex1', name: '沉浸式光影展', visitedAt: '昨天', gradient: 'linear-gradient(135deg, #c1d8ff, #a0c5ff)', desc: '光与影的空间叙事，沉浸式体验。', worksCount: 18 },
  { id: 'ex2', name: '未来装置馆', visitedAt: '3 天前', gradient: 'linear-gradient(135deg, #b7f5ec, #90e0d9)', desc: '机械装置与艺术的融合。', worksCount: 24 },
  { id: 'ex3', name: '数字画廊', visitedAt: '上周', gradient: 'linear-gradient(135deg, #ffd6ec, #ffeaf5)', desc: '数字绘画与新媒介艺术。', worksCount: 12 },
  { id: 'ex4', name: '交互媒体展', visitedAt: '上月', gradient: 'linear-gradient(135deg, #e7e4ff, #f1eeff)', desc: '互动媒介与创意体验。', worksCount: 16 },
];

const exhibit = computed<Exhibit | undefined>(() => samples.find((e) => e.id === exhibitId.value));

onLoad((options) => {
  const raw = typeof options?.id === 'string' ? options.id : '';
  exhibitId.value = decodeURIComponent(raw);
});

function enterExhibition() {
  if (!exhibitId.value) {
    return;
  }
  // Navigate into the exhibition. Currently we show a toast as a placeholder.
  uni.showToast({ title: `进入展览 ${exhibitId.value}`, icon: 'none' });
}
</script>
<style scoped lang="scss">
.page {
  padding: 20px 16px 40px;
  min-height: 100vh;
  background: #f5f7fb;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header {
  width: 100%;
  max-width: 560px;
  align-self: center;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.title {
  font-size: 20px;
  font-weight: 600;
  color: #1f1f1f;
}

.subtitle {
  font-size: 13px;
  color: #8a94a6;
  width: 100%;
  max-width: 560px;
  align-self: center;
}

.cover-card,
.info-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  width: 100%;
  max-width: 560px;
  align-self: center;
}

.cover-card {
  height: 200px;
  display: flex;
  align-items: flex-end;
  color: #ffffff;
  font-weight: 600;
}

.cover-label {
  background: rgba(0, 0, 0, 0.25);
  padding: 6px 12px;
  border-radius: 12px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f1f1f;
}

.info-line {
  display: block;
  margin-top: 6px;
  font-size: 13px;
  color: #5f6b83;
}

.enter-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 18px;
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
