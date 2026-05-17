<template>
  <view v-if="overlayActive" class="viewer-overlay">
    <view
      v-if="sceneSwitchOverlayVisible"
      class="viewer-overlay__flash"
      :class="{ 'is-active': sceneSwitchFlashActive }"
    ></view>
    <view v-if="overlayCardActive" class="viewer-overlay__backdrop" aria-hidden="true">
      <view class="viewer-overlay__aurora viewer-overlay__aurora--cyan"></view>
      <view class="viewer-overlay__aurora viewer-overlay__aurora--amber"></view>
      <view class="viewer-overlay__grid"></view>
      <view class="viewer-overlay__scanline"></view>
    </view>
    <view v-if="overlayCardActive" class="viewer-overlay__content viewer-overlay__card">
      <view class="viewer-loader" aria-hidden="true">
        <view class="viewer-loader__halo viewer-loader__halo--outer"></view>
        <view class="viewer-loader__halo viewer-loader__halo--mid"></view>
        <view class="viewer-loader__ring viewer-loader__ring--a"></view>
        <view class="viewer-loader__ring viewer-loader__ring--b"></view>
        <view class="viewer-loader__ring viewer-loader__ring--c"></view>
        <view class="viewer-loader__core">
          <view class="viewer-loader__core-pulse"></view>
          <view class="viewer-loader__core-dot"></view>
        </view>
        <view class="viewer-loader__particle viewer-loader__particle--1"></view>
        <view class="viewer-loader__particle viewer-loader__particle--2"></view>
        <view class="viewer-loader__particle viewer-loader__particle--3"></view>
        <view class="viewer-loader__particle viewer-loader__particle--4"></view>
      </view>
      <text v-if="overlayTitle" class="viewer-overlay__title">{{ overlayTitle }}</text>
      <view class="viewer-progress">
        <view class="viewer-progress__bar" :class="{ 'is-indeterminate': overlayIndeterminate }">
          <view
            class="viewer-progress__bar-fill"
            :class="{ 'is-indeterminate': overlayIndeterminate }"
            :style="overlayProgressStyle"
          />
          <view v-if="overlayIndeterminate" class="viewer-progress__bar-glow" />
        </view>
        <view class="viewer-progress__stats">
          <text class="viewer-progress__percent">{{ overlayPercentText }}</text>
          <text v-if="overlayBytesLabel" class="viewer-progress__bytes">{{ overlayBytesLabel }}</text>
        </view>
      </view>
      <text v-if="overlayCaption" class="viewer-overlay__caption">{{ overlayCaption }}</text>
      <text v-if="overlayDetail" class="viewer-overlay__detail">{{ overlayDetail }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';

type SceneLoadPhase =
  | 'download'
  | 'parse'
  | 'read-cache'
  | 'unzip'
  | 'manifest'
  | 'resource-map'
  | 'project-meta'
  | 'scene-documents'
  | 'scene-runtime'
  | 'bundle'
  | 'render';

type SceneDownloadState = {
  active: boolean;
  phase: SceneLoadPhase;
  loaded: number;
  total: number;
  percent: number;
  label: string;
  detail: string;
  currentIndex: number;
  currentTotal: number;
  currentLabel: string;
  indeterminate: boolean;
};

type ResourcePreloadState = {
  active: boolean;
  loaded: number;
  total: number;
  loadedBytes: number;
  totalBytes: number;
  label: string;
};

const props = defineProps<{
  loading: boolean;
  sceneSwitchOverlayVisible: boolean;
  sceneSwitchFlashActive: boolean;
  sceneDownload: SceneDownloadState;
  resourcePreload: ResourcePreloadState;
}>();

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatByteSize(value: number): string {
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (normalized <= 0) {
    return '0B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = normalized;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const digits = index === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)}${units[index]}`;
}

function formatSceneLoadCount(index: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) {
    return '';
  }
  const current = Math.max(0, Math.min(total, Math.floor(index) + 1));
  return `${current} / ${Math.max(0, Math.floor(total))}`;
}

function formatSceneLoadDetail(detail: string, currentLabel?: string): string {
  const normalizedDetail = typeof detail === 'string' ? detail.trim() : '';
  const normalizedLabel = typeof currentLabel === 'string' ? currentLabel.trim() : '';
  if (normalizedDetail && normalizedLabel) {
    return `${normalizedDetail} | ${normalizedLabel}`;
  }
  return normalizedDetail || normalizedLabel;
}

const overlayCardActive = computed(() => props.loading || props.sceneDownload.active || props.resourcePreload.active);
const overlayActive = computed(() => overlayCardActive.value || props.sceneSwitchOverlayVisible);

const resourcePreloadPercent = computed(() => {
  const preload = props.resourcePreload;
  if (preload.totalBytes > 0) {
    const ratio = Math.min(1, Math.max(0, preload.loadedBytes / preload.totalBytes));
    return preload.active ? Math.round(ratio * 100) : 100;
  }
  if (preload.total > 0) {
    const ratio = Math.min(1, Math.max(0, preload.loaded / preload.total));
    return preload.active ? Math.round(ratio * 100) : 100;
  }
  return preload.active ? 0 : 100;
});

const resourcePreloadBytesLabel = computed(() => {
  const preload = props.resourcePreload;
  if (preload.totalBytes > 0) {
    return `${formatByteSize(preload.loadedBytes)} / ${formatByteSize(preload.totalBytes)}`;
  }
  if (preload.total > 0) {
    return `已加载 ${preload.loaded} / ${preload.total}`;
  }
  return '';
});

const overlayTitle = computed(() => {
  const load = props.sceneDownload;
  if (load.active) {
    switch (load.phase) {
      case 'download':
        return '正在下载场景包';
      case 'read-cache':
        return '正在读取本地缓存';
      case 'unzip':
        return '正在解压场景包';
      case 'manifest':
        return '正在解析 manifest';
      case 'resource-map':
        return '正在构建资源覆盖表';
      case 'project-meta':
        return '正在解析项目配置';
      case 'scene-documents':
        return '正在解析场景数据';
      case 'scene-runtime':
        return '正在注入场景运行时';
      case 'bundle':
        return '正在组装场景索引';
      case 'render':
        return '正在进入渲染初始化';
      default:
        return '正在加载场景包';
    }
  }
  if (props.resourcePreload.active) {
    return '资源加载中';
  }
  if (props.loading) {
    return '正在初始化场景';
  }
  return '';
});

const overlayPercent = computed(() => {
  const load = props.sceneDownload;
  if (load.active) {
    if (load.phase === 'download' && load.total > 0) {
      const ratio = Math.min(1, Math.max(0, load.loaded / load.total));
      return Math.round(ratio * 100);
    }
    if (load.phase === 'render' && props.resourcePreload.active) {
      const base = clampPercent(load.percent);
      const preloadPercent = clampPercent(resourcePreloadPercent.value);
      const blended = base + Math.round((100 - base) * (preloadPercent / 100));
      return Math.max(base, Math.min(100, blended));
    }
    return clampPercent(load.percent);
  }
  if (props.resourcePreload.active) {
    return resourcePreloadPercent.value;
  }
  if (props.loading) {
    const hasHistory = props.resourcePreload.total > 0 || props.resourcePreload.totalBytes > 0;
    return hasHistory ? resourcePreloadPercent.value : 0;
  }
  return resourcePreloadPercent.value;
});

const overlayBytesLabel = computed(() => {
  const load = props.sceneDownload;
  if (load.active && load.phase === 'download' && load.total > 0) {
    return `${formatByteSize(load.loaded)} / ${formatByteSize(load.total)}`;
  }
  if (load.active && load.phase === 'render' && props.resourcePreload.active && resourcePreloadBytesLabel.value) {
    return resourcePreloadBytesLabel.value;
  }
  if (props.resourcePreload.active && resourcePreloadBytesLabel.value) {
    return resourcePreloadBytesLabel.value;
  }
  return '';
});

const overlayIndeterminate = computed(() => props.sceneDownload.active && props.sceneDownload.indeterminate);
const overlayPercentText = computed(() => (overlayIndeterminate.value ? '解析中…' : `${overlayPercent.value}%`));
const overlayProgressStyle = computed(() => (overlayIndeterminate.value ? {} : { width: `${overlayPercent.value}%` }));

const overlayCaption = computed(() => {
  if (props.sceneDownload.active) {
    return props.sceneDownload.label;
  }
  if (props.resourcePreload.active) {
    return props.resourcePreload.label;
  }
  if (props.loading) {
    return '正在准备渲染上下文...';
  }
  return '';
});

const overlayDetail = computed(() => {
  const load = props.sceneDownload;
  if (load.active) {
    const count = formatSceneLoadCount(load.currentIndex, load.currentTotal);
    const detail = formatSceneLoadDetail(load.detail, load.currentLabel);
    if (load.phase === 'render' && props.resourcePreload.active && props.resourcePreload.label) {
      const renderDetail = detail || '正在准备渲染初始化';
      return `${renderDetail} | ${props.resourcePreload.label}`;
    }
    if (count && detail) {
      return `${count} | ${detail}`;
    }
    return count || detail;
  }
  if (props.resourcePreload.active) {
    return props.resourcePreload.label;
  }
  if (props.loading) {
    return '请稍候，正在准备渲染上下文。';
  }
  return '';
});
</script>

<style scoped>
.viewer-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background-color: rgba(29, 30, 34, 0.4);
  color: #ffffff;
  font-size: 14px;
  text-align: center;
  padding: 12px;
  z-index: 1600;
}

.viewer-overlay__backdrop {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.viewer-overlay__aurora {
  position: absolute;
  border-radius: 999px;
  filter: blur(16px);
  opacity: 0.72;
  mix-blend-mode: screen;
  animation: viewer-overlay-aurora 9s ease-in-out infinite;
}

.viewer-overlay__aurora--cyan {
  top: 8%;
  left: -12%;
  width: 56%;
  height: 34%;
  background: radial-gradient(circle at 30% 50%, rgba(96, 245, 255, 0.82) 0%, rgba(96, 245, 255, 0.18) 38%, rgba(96, 245, 255, 0) 78%);
}

.viewer-overlay__aurora--amber {
  right: -10%;
  bottom: 4%;
  width: 52%;
  height: 30%;
  background: radial-gradient(circle at 50% 50%, rgba(255, 181, 77, 0.78) 0%, rgba(255, 113, 77, 0.18) 40%, rgba(255, 181, 77, 0) 76%);
  animation-duration: 11s;
  animation-direction: reverse;
}

.viewer-overlay__grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px);
  background-size: 40px 40px;
  mask-image: radial-gradient(circle at 50% 42%, rgba(0, 0, 0, 0.86) 0%, rgba(0, 0, 0, 0.66) 34%, transparent 82%);
  opacity: 0.34;
  transform: perspective(700px) rotateX(70deg) translateY(24%);
  transform-origin: center top;
}

.viewer-overlay__scanline {
  position: absolute;
  left: -10%;
  right: -10%;
  top: -16%;
  height: 28%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(112, 225, 255, 0.06) 42%, rgba(112, 225, 255, 0.24) 50%, rgba(112, 225, 255, 0.06) 58%, rgba(255, 255, 255, 0) 100%);
  filter: blur(2px);
  opacity: 0.82;
  animation: viewer-overlay-scanline 3.8s linear infinite;
}

.viewer-overlay__flash {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.28);
  opacity: 0;
  transition: opacity 0.18s ease;
  pointer-events: none;
}

.viewer-overlay__flash.is-active {
  opacity: 1;
}

.viewer-overlay__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 80%;
  max-width: 320px;
  z-index: 1;
}

.viewer-overlay__card {
  position: relative;
  overflow: hidden;
  width: 100%;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.86) 0%, rgba(244, 249, 255, 0.72) 100%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(210, 232, 255, 0.08));
  border: 1px solid rgba(153, 193, 255, 0.22);
  border-radius: 28px;
  padding: 24px 22px;
  box-shadow: 0 24px 60px rgba(52, 87, 128, 0.16), 0 6px 16px rgba(83, 126, 173, 0.08);
  backdrop-filter: blur(16px) saturate(1.08);
}

.viewer-overlay__card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    radial-gradient(circle at top, rgba(120, 208, 255, 0.18), transparent 34%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.12), transparent 34%, transparent 66%, rgba(157, 229, 143, 0.08));
  pointer-events: none;
}

.viewer-loader {
  position: relative;
  width: 160px;
  height: 160px;
  margin-bottom: 8px;
}

.viewer-loader__halo,
.viewer-loader__ring,
.viewer-loader__core,
.viewer-loader__particle {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.viewer-loader__halo {
  border-radius: 999px;
  background: radial-gradient(circle, rgba(111, 233, 255, 0.22) 0%, rgba(111, 233, 255, 0.08) 36%, rgba(111, 233, 255, 0) 72%);
  animation: viewer-loader-breathe 2.8s ease-in-out infinite;
}

.viewer-loader__halo--outer {
  width: 160px;
  height: 160px;
}

.viewer-loader__halo--mid {
  width: 118px;
  height: 118px;
  animation-duration: 2.2s;
  animation-direction: reverse;
}

.viewer-loader__ring {
  border-radius: 999px;
  border: 1px solid rgba(143, 224, 255, 0.28);
}

.viewer-loader__ring--a {
  width: 132px;
  height: 132px;
  border-style: solid;
  border-width: 1px 1px 0 0;
  animation: viewer-loader-spin 2.8s linear infinite;
}

.viewer-loader__ring--b {
  width: 104px;
  height: 104px;
  border-style: solid;
  border-width: 0 0 1px 1px;
  animation: viewer-loader-spin-reverse 2.1s linear infinite;
}

.viewer-loader__ring--c {
  width: 78px;
  height: 78px;
  border-style: dashed;
  border-width: 1px;
  opacity: 0.68;
  animation: viewer-loader-tilt 2.6s ease-in-out infinite;
}

.viewer-loader__core {
  width: 72px;
  height: 72px;
  border-radius: 999px;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(214, 241, 255, 0.92));
  box-shadow: 0 0 26px rgba(118, 197, 255, 0.28);
  overflow: hidden;
}

.viewer-loader__core-pulse {
  position: absolute;
  inset: 20%;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(111, 233, 255, 0.8) 0%, rgba(111, 233, 255, 0.15) 56%, rgba(111, 233, 255, 0) 76%);
  animation: viewer-loader-core 1.6s ease-in-out infinite;
}

.viewer-loader__core-dot {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ffffff 0%, rgba(103, 190, 255, 0.98) 100%);
  box-shadow: 0 0 18px rgba(92, 173, 255, 0.35);
}

.viewer-loader__particle {
  width: 12px;
  height: 12px;
  margin-left: -6px;
  margin-top: -6px;
  border-radius: 999px;
  box-shadow: 0 0 12px rgba(94, 161, 255, 0.32);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(114, 212, 255, 0.92));
}

.viewer-loader__particle--1 {
  animation: viewer-loader-orbit-a 2.4s linear infinite;
}

.viewer-loader__particle--2 {
  animation: viewer-loader-orbit-a 2.4s linear infinite;
  animation-delay: -1.2s;
}

.viewer-loader__particle--3 {
  animation: viewer-loader-orbit-b 3.1s linear infinite;
}

.viewer-loader__particle--4 {
  animation: viewer-loader-orbit-b 3.1s linear infinite;
  animation-delay: -1.2s;
}

.viewer-overlay__title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: #12314d;
}

.viewer-progress {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.viewer-progress__bar {
  position: relative;
  width: 100%;
  height: 12px;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(120, 152, 194, 0.12);
}

.viewer-progress__bar-fill {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  border-radius: inherit;
  transition: width 0.35s ease;
  background-image: linear-gradient(90deg, rgba(94, 161, 255, 0.42) 0%, rgba(94, 161, 255, 0.84) 45%, rgba(157, 229, 143, 0.92) 100%);
  background-size: 200% 100%;
  animation: viewer-progress-fill 1.8s linear infinite;
}

.viewer-progress__bar-fill.is-indeterminate {
  width: 38%;
  min-width: 120px;
  transition: none;
  background-image: linear-gradient(90deg, rgba(78, 221, 255, 0.28) 0%, rgba(94, 161, 255, 0.94) 35%, rgba(157, 229, 143, 0.96) 70%, rgba(114, 247, 255, 0.26) 100%);
  background-size: 240% 100%;
  animation: viewer-progress-indeterminate 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  filter: saturate(1.15);
}

.viewer-progress__bar.is-indeterminate {
  background: rgba(120, 152, 194, 0.1);
}

.viewer-progress__bar-glow {
  position: absolute;
  inset: -6px;
  pointer-events: none;
  border-radius: inherit;
  background: radial-gradient(circle at 50% 50%, rgba(124, 188, 255, 0.22) 0%, rgba(124, 188, 255, 0) 72%);
  animation: viewer-progress-glow 1.6s ease-in-out infinite;
}

@keyframes viewer-progress-fill {
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: -200% 50%;
  }
}

@keyframes viewer-progress-indeterminate {
  0% {
    left: -40%;
    opacity: 0.82;
  }
  50% {
    opacity: 1;
  }
  100% {
    left: 100%;
    opacity: 0.82;
  }
}

@keyframes viewer-progress-glow {
  0%,
  100% {
    opacity: 0.34;
    transform: scale(1);
  }
  50% {
    opacity: 0.62;
    transform: scale(1.03);
  }
}

@keyframes viewer-overlay-aurora {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(4%, -3%, 0) scale(1.08);
  }
}

@keyframes viewer-overlay-scanline {
  0% {
    transform: translateY(-18%);
    opacity: 0;
  }
  15% {
    opacity: 0.9;
  }
  50% {
    transform: translateY(98%);
    opacity: 0.72;
  }
  100% {
    transform: translateY(214%);
    opacity: 0;
  }
}

@keyframes viewer-loader-breathe {
  0%,
  100% {
    transform: translate(-50%, -50%) scale(0.96);
    opacity: 0.8;
  }
  50% {
    transform: translate(-50%, -50%) scale(1.04);
    opacity: 1;
  }
}

@keyframes viewer-loader-spin {
  from {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

@keyframes viewer-loader-spin-reverse {
  from {
    transform: translate(-50%, -50%) rotate(360deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(0deg);
  }
}

@keyframes viewer-loader-tilt {
  0%,
  100% {
    transform: translate(-50%, -50%) rotate(0deg) scale(1);
  }
  50% {
    transform: translate(-50%, -50%) rotate(8deg) scale(1.02);
  }
}

@keyframes viewer-loader-core {
  0%,
  100% {
    transform: scale(0.92);
    opacity: 0.7;
  }
  50% {
    transform: scale(1.02);
    opacity: 1;
  }
}

@keyframes viewer-loader-orbit-a {
  from {
    transform: translate(-50%, -50%) rotate(0deg) translateX(72px) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(360deg) translateX(72px) rotate(-360deg);
  }
}

@keyframes viewer-loader-orbit-b {
  from {
    transform: translate(-50%, -50%) rotate(0deg) translateX(58px) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(-360deg) translateX(58px) rotate(360deg);
  }
}

.viewer-progress__stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  font-size: 12px;
  color: rgba(21, 50, 79, 0.78);
}

.viewer-progress__percent {
  font-weight: 600;
  letter-spacing: 0.5px;
}

.viewer-progress__bytes {
  font-size: 12px;
  color: rgba(21, 50, 79, 0.62);
}

.viewer-overlay__caption {
  font-size: 12px;
  color: rgba(21, 50, 79, 0.68);
  text-align: center;
}

.viewer-overlay__detail {
  font-size: 11px;
  color: rgba(21, 50, 79, 0.56);
  text-align: center;
  line-height: 1.45;
}

.viewer-overlay.error {
  background-color: rgba(208, 0, 0, 0.6);
}

@media (max-width: 480px) {
  .viewer-overlay {
    padding: 16px;
  }

  .viewer-overlay__card {
    padding: 22px 18px;
    border-radius: 22px;
  }

  .viewer-loader {
    width: 132px;
    height: 132px;
  }

  .viewer-loader__halo--outer {
    width: 132px;
    height: 132px;
  }

  .viewer-loader__halo--mid {
    width: 96px;
    height: 96px;
  }

  .viewer-loader__ring--a {
    width: 110px;
    height: 110px;
  }

  .viewer-loader__ring--b {
    width: 84px;
    height: 84px;
  }

  .viewer-loader__ring--c {
    width: 60px;
    height: 60px;
  }
}
</style>
