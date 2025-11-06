<template>
  <view class="page settings">
    <view class="header">
      <text class="title">体验优化设置</text>
      <text class="subtitle">监控性能并调整渲染质量</text>
    </view>

    <view class="card performance">
      <view class="card-header">
        <text class="card-title">性能监控</text>
        <text class="card-tag normal">实时</text>
      </view>
      <view class="chart">
        <svg viewBox="0 0 200 80" preserveAspectRatio="none">
          <defs>
            <linearGradient id="lineGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="#62a6ff" stop-opacity="0.8" />
              <stop offset="1" stop-color="#62a6ff" stop-opacity="0" />
            </linearGradient>
          </defs>
          <polyline
            points="0,60 20,40 40,45 60,25 80,35 100,18 120,30 140,22 160,28 180,20 200,26"
            fill="none"
            stroke="#1f7aec"
            stroke-width="4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <polygon
            points="0,80 0,60 20,40 40,45 60,25 80,35 100,18 120,30 140,22 160,28 180,20 200,26 200,80"
            fill="url(#lineGradient)"
          />
        </svg>
      </view>
      <view class="metrics">
        <view class="metric" v-for="metric in metrics" :key="metric.label">
          <text class="metric-label">{{ metric.label }}</text>
          <text class="metric-value">{{ metric.value }}</text>
        </view>
      </view>
    </view>

    <view class="card quality">
      <view class="card-header">
        <text class="card-title">画质设置</text>
        <text class="card-sub">根据设备性能自动调节</text>
      </view>
      <view class="quality-options">
        <button
          v-for="option in qualityOptions"
          :key="option"
          class="quality-btn"
          :class="{ active: option === currentQuality }"
          @tap="currentQuality = option"
        >
          {{ option }}
        </button>
      </view>
    </view>

    <view class="card network">
      <view class="card-header">
        <text class="card-title">网络加速</text>
        <switch color="#1f7aec" :checked="networkBoost" @change="onNetworkToggle" />
      </view>
      <text class="card-desc">开启后优先使用 CDN 加速资源加载，提升远程素材访问速度。</text>
    </view>

    <view class="card tips">
      <text class="card-title">优化建议</text>
      <view class="tip-item" v-for="tip in tips" :key="tip.id">
        <view class="tip-dot"></view>
        <view class="tip-info">
          <text class="tip-title">{{ tip.title }}</text>
          <text class="tip-desc">{{ tip.desc }}</text>
        </view>
      </view>
    </view>

    <BottomNav active="settings" @navigate="handleNavigate" />
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import BottomNav from '@/components/BottomNav.vue';

type NavKey = 'home' | 'upload' | 'exhibition' | 'profile' | 'settings';

const metrics = [
  { label: 'FPS', value: '58' },
  { label: '内存', value: '248M' },
  { label: '延时', value: '16ms' },
];

const qualityOptions: Array<'流畅' | '标准' | '高'> = ['流畅', '标准', '高'];
const currentQuality = ref<'流畅' | '标准' | '高'>('标准');
const networkBoost = ref(true);

const tips = [
  { id: 't1', title: '定期清理缓存', desc: '每周清理素材缓存可节省 120MB 存储空间。' },
  { id: 't2', title: '使用压缩纹理', desc: '将纹理转换为 KTX2 格式可提升加载速度 35%。' },
];

const routes: Record<NavKey, string> = {
  home: '/pages/home/index',
  upload: '/pages/upload/index',
  exhibition: '/pages/exhibition/index',
  profile: '/pages/profile/index',
  settings: '/pages/settings/index',
};

function handleNavigate(target: NavKey) {
  const route = routes[target];
  if (!route || target === 'settings') {
    return;
  }
  uni.redirectTo({ url: route });
}

function onNetworkToggle(event: any) {
  networkBoost.value = Boolean(event.detail?.value);
  const message = networkBoost.value ? '已开启网络加速' : '已关闭网络加速';
  uni.showToast({ title: message, icon: 'none' });
}
</script>
<style scoped lang="scss">
.page {
  padding: 20px 20px 96px;
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

.title {
  font-size: 22px;
  font-weight: 600;
  color: #1f1f1f;
}

.subtitle {
  font-size: 14px;
  color: #8a94a6;
}

.card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
}

.card-sub {
  font-size: 13px;
  color: #8a94a6;
}

.card-tag {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 12px;
  color: #1f7aec;
  background: rgba(31, 122, 236, 0.12);
}

.card-tag.normal {
  color: #1f7aec;
}

.chart {
  width: 100%;
  height: 120px;
}

.chart svg {
  width: 100%;
  height: 100%;
}

.metrics {
  display: flex;
  justify-content: space-between;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}

.metric-label {
  font-size: 12px;
  color: #8a94a6;
}

.metric-value {
  font-size: 18px;
  font-weight: 600;
  color: #1f1f1f;
}

.quality-options {
  display: flex;
  gap: 12px;
}

.quality-btn {
  flex: 1;
  padding: 12px 0;
  border-radius: 16px;
  border: none;
  background: rgba(31, 122, 236, 0.1);
  color: #1f7aec;
  font-size: 14px;
  box-shadow: 0 6px 12px rgba(31, 122, 236, 0.08);
}

.quality-btn.active {
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  box-shadow: 0 10px 20px rgba(31, 122, 236, 0.25);
}

.card-desc {
  font-size: 13px;
  color: #8a94a6;
  line-height: 1.5;
}

.tip-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.tip-dot {
  width: 10px;
  height: 10px;
  border-radius: 5px;
  background: #1f7aec;
  margin-top: 6px;
}

.tip-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tip-title {
  font-size: 14px;
  color: #1f1f1f;
}

.tip-desc {
  font-size: 12px;
  color: #8a94a6;
  line-height: 1.5;
}
</style>
