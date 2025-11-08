<template>
  <view class="bottom-nav">
    <view class="nav-item" :class="{ active: active === 'home' }" @tap="go('home')">
      <view class="icon home"></view>
      <text class="label">首页</text>
    </view>
    <view class="nav-item" :class="{ active: active === 'work' }" @tap="go('work')">
      <view class="icon work"></view>
      <text class="label">作品</text>
    </view>
    <view class="nav-item" :class="{ active: active === 'exhibition' }" @tap="go('exhibition')">
      <view class="icon exhibition"></view>
      <text class="label">展览</text>
    </view>
    <view class="nav-item" :class="{ active: active === 'optimize' }" @tap="go('optimize')">
      <view class="icon optimize"></view>
      <text class="label">优化</text>
    </view>
    <view class="nav-item" :class="{ active: active === 'profile' }" @tap="go('profile')">
      <view class="icon profile"></view>
      <text class="label">我的</text>
    </view>
  </view>
</template>
<script setup lang="ts">
const props = defineProps<{ active: 'home' | 'work' | 'exhibition' | 'profile' | 'optimize' }>();
const emit = defineEmits<{ (event: 'navigate', value: typeof props.active): void }>();

function go(value: typeof props.active) {
  if (value === props.active) {
    return;
  }
  emit('navigate', value);
}
</script>
<style scoped lang="scss">
.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: space-around;
  padding: 6px 10px 8px;
  background: #ffffff;
  box-shadow: 0 -4px 16px rgba(31, 122, 236, 0.08);
  z-index: 100;
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 20%;
  color: #8a94a6;
  font-size: 11px;
  padding: 4px 0;
  border-radius: 10px;
  transition: all 0.2s ease;

  .icon {
    width: 24px;
    height: 24px;
    margin-bottom: 3px;
    border-radius: 12px;
    background: linear-gradient(145deg, rgba(63, 151, 255, 0.35), rgba(126, 198, 255, 0.2));
    position: relative;
  }

  .icon::before,
  .icon::after {
    content: '';
    position: absolute;
    background: #ffffff;
  }

  .icon.home::before {
    width: 10px;
    height: 8px;
    left: 7px;
    bottom: 5px;
    border-radius: 2px;
  }

  .icon.home::after {
    width: 0;
    height: 0;
    left: 6px;
    top: 5px;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-bottom: 5px solid #ffffff;
  }

  .icon.work::before {
    width: 3px;
    height: 10px;
    left: 10px;
    top: 5px;
    border-radius: 2px;
  }

  .icon.work::after {
    width: 0;
    height: 0;
    left: 8px;
    top: 3px;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-bottom: 5px solid #ffffff;
  }

  .icon.exhibition::before {
    width: 12px;
    height: 8px;
    left: 6px;
    top: 8px;
    border-radius: 3px;
  }

  .icon.exhibition::after {
    width: 16px;
    height: 2px;
    left: 4px;
    top: 6px;
    border-radius: 2px;
  }

  .icon.profile::before {
    width: 8px;
    height: 8px;
    left: 8px;
    top: 5px;
    border-radius: 50%;
  }

  .icon.profile::after {
    width: 14px;
    height: 5px;
    left: 5px;
    bottom: 5px;
    border-radius: 3px 3px 6px 6px;
  }

  .icon.optimize::before {
    width: 10px;
    height: 10px;
    left: 7px;
    top: 7px;
    border-radius: 50%;
    border: 2px solid #ffffff;
    background: transparent;
  }

  .icon.optimize::after {
    width: 10px;
    height: 2px;
    left: 7px;
    bottom: 5px;
    border-radius: 2px;
  }
}

.nav-item.active {
  color: #1f7aec;
  background: linear-gradient(145deg, rgba(63, 151, 255, 0.16), rgba(126, 198, 255, 0.08));
  box-shadow: 0 4px 12px rgba(31, 122, 236, 0.12);
}
</style>
