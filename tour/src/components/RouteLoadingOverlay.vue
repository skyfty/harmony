<template>
  <view v-if="visible" class="route-loading" :class="{ 'route-loading--compact': compact }">
    <view class="route-loading__backdrop">
      <view class="route-loading__glow route-loading__glow--one" />
      <view class="route-loading__glow route-loading__glow--two" />
      <view class="route-loading__grid" />
    </view>

    <view class="route-loading__panel">
      <view class="route-loading__badge">
        <view class="route-loading__orbital">
          <view class="route-loading__dot route-loading__dot--one" />
          <view class="route-loading__dot route-loading__dot--two" />
          <view class="route-loading__dot route-loading__dot--three" />
        </view>
        <text class="route-loading__badge-text">{{ title }}</text>
      </view>

      <text class="route-loading__subtitle">{{ subtitle }}</text>

      <view class="route-loading__cards">
        <view
          v-for="n in 3"
          :key="n"
          class="route-loading__card"
          :style="{ animationDelay: `${(n - 1) * 140}ms` }"
        >
          <view class="route-loading__cover" />
          <view class="route-loading__line route-loading__line--title" />
          <view class="route-loading__line route-loading__line--short" />
          <view class="route-loading__chips">
            <view class="route-loading__chip route-loading__chip--wide" />
            <view class="route-loading__chip route-loading__chip--narrow" />
          </view>
        </view>
      </view>

      <text class="route-loading__hint">{{ hint }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    visible?: boolean;
    title?: string;
    subtitle?: string;
    hint?: string;
    compact?: boolean;
  }>(),
  {
    visible: true,
    title: '正在加载',
    subtitle: '正在为你准备内容',
    hint: '请稍候，精彩内容马上出现',
    compact: false,
  },
);
</script>

<style scoped lang="scss">
.route-loading {
  position: fixed;
  inset: 0;
  z-index: 80;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(28px + env(safe-area-inset-top)) 20px calc(28px + env(safe-area-inset-bottom) + 65px);
  background:
    radial-gradient(circle at top, rgba(125, 119, 255, 0.18), transparent 35%),
    linear-gradient(180deg, rgba(246, 249, 255, 0.98) 0%, rgba(255, 255, 255, 0.98) 100%);
  box-sizing: border-box;
}

.route-loading--compact {
  padding-top: calc(18px + env(safe-area-inset-top));
}

.route-loading__backdrop {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.route-loading__glow {
  position: absolute;
  border-radius: 999px;
  filter: blur(4px);
  opacity: 0.78;
  animation: route-loading-float 7s ease-in-out infinite;
}

.route-loading__glow--one {
  width: 180px;
  height: 180px;
  left: -40px;
  top: 64px;
  background: radial-gradient(circle, rgba(83, 132, 255, 0.48), rgba(83, 132, 255, 0));
}

.route-loading__glow--two {
  width: 240px;
  height: 240px;
  right: -80px;
  bottom: 110px;
  animation-delay: -2s;
  background: radial-gradient(circle, rgba(169, 104, 255, 0.38), rgba(169, 104, 255, 0));
}

.route-loading__grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(126, 127, 181, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(126, 127, 181, 0.07) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.9), transparent 90%);
  opacity: 0.4;
}

.route-loading__panel {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 520px;
  padding: 22px 18px 18px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 20px 60px rgba(52, 74, 149, 0.12);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
}

.route-loading__badge {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(74, 111, 255, 0.12), rgba(170, 103, 255, 0.12));
  color: #243045;
}

.route-loading__orbital {
  position: relative;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.route-loading__orbital::before {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: 999px;
  border: 1.5px solid rgba(106, 113, 255, 0.26);
  animation: route-loading-rotate 2.5s linear infinite;
}

.route-loading__dot {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 999px;
}

.route-loading__dot--one {
  left: 0;
  top: 8px;
  background: #4f82ff;
  animation: route-loading-pulse 1.1s ease-in-out infinite;
}

.route-loading__dot--two {
  right: 0;
  top: 3px;
  background: #7a6bff;
  animation: route-loading-pulse 1.1s ease-in-out infinite 0.2s;
}

.route-loading__dot--three {
  right: 1px;
  bottom: 1px;
  background: #a55eff;
  animation: route-loading-pulse 1.1s ease-in-out infinite 0.4s;
}

.route-loading__badge-text {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.route-loading__subtitle {
  display: block;
  margin-top: 12px;
  font-size: 18px;
  font-weight: 700;
  color: #182033;
}

.route-loading__cards {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.route-loading__card {
  overflow: hidden;
  position: relative;
  padding: 12px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(245, 248, 255, 0.94));
  border: 1px solid rgba(132, 146, 180, 0.12);
  box-shadow: 0 10px 28px rgba(65, 84, 147, 0.07);
  animation: route-loading-rise 1.2s ease-in-out infinite alternate;
}

.route-loading__card::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.7), transparent);
  animation: route-loading-shimmer 1.7s ease-in-out infinite;
}

.route-loading__cover {
  height: 104px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(85, 134, 255, 0.24), rgba(168, 108, 255, 0.24));
}

.route-loading__line {
  height: 10px;
  margin-top: 10px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(79, 97, 135, 0.16), rgba(79, 97, 135, 0.06));
}

.route-loading__line--title {
  width: 72%;
}

.route-loading__line--short {
  width: 48%;
}

.route-loading__chips {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.route-loading__chip {
  height: 18px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(123, 116, 231, 0.12), rgba(123, 116, 231, 0.22));
}

.route-loading__chip--wide {
  width: 94px;
}

.route-loading__chip--narrow {
  width: 60px;
}

.route-loading__hint {
  display: block;
  margin-top: 16px;
  text-align: center;
  font-size: 12px;
  color: #7a8497;
}

@keyframes route-loading-float {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(0, -14px, 0) scale(1.04);
  }
}

@keyframes route-loading-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes route-loading-pulse {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.92);
  }
  50% {
    opacity: 1;
    transform: scale(1.18);
  }
}

@keyframes route-loading-rise {
  0% {
    transform: translateY(0);
  }
  100% {
    transform: translateY(-4px);
  }
}

@keyframes route-loading-shimmer {
  0% {
    transform: translateX(-100%);
  }
  60%,
  100% {
    transform: translateX(100%);
  }
}
</style>
