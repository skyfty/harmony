<template>
  <view class="bottom-nav">
    <view class="nav-item" :class="{ active: active === 'scenic' }" @tap="go('scenic')">
      <view class="icon scenic"></view>
      <text class="label">景区</text>
    </view>
    <view class="nav-item" :class="{ active: active === 'coupon' }" @tap="go('coupon')">
      <view class="icon coupon"></view>
      <text class="label">卡券</text>
    </view>
    <view class="nav-item" :class="{ active: active === 'achievement' }" @tap="go('achievement')">
      <view class="icon achievement"></view>
      <text class="label">成就</text>
    </view>
    <view class="nav-item" :class="{ active: active === 'vehicle' }" @tap="go('vehicle')">
      <view class="icon vehicle"></view>
      <text class="label">车辆</text>
    </view>
    <view class="nav-item" :class="{ active: active === 'profile' }" @tap="go('profile')">
      <view class="icon profile"></view>
      <text class="label">我的</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import type { NavKey } from '@/utils/navKey';

const props = defineProps<{ active: NavKey }>();
const emit = defineEmits<{ (event: 'navigate', value: NavKey): void }>();

function go(value: NavKey) {
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

  .icon.scenic::before {
    width: 12px;
    height: 10px;
    left: 6px;
    top: 7px;
    border-radius: 2px;
  }
  .icon.scenic::after {
    width: 8px;
    height: 2px;
    left: 8px;
    top: 5px;
    border-radius: 2px;
  }

  .icon.coupon::before {
    width: 14px;
    height: 10px;
    left: 5px;
    top: 7px;
    border-radius: 2px;
  }
  .icon.coupon::after {
    width: 6px;
    height: 6px;
    left: 9px;
    top: 9px;
    border-radius: 50%;
    background: transparent;
    border: 2px solid #ffffff;
  }

  .icon.achievement::before {
    width: 12px;
    height: 12px;
    left: 6px;
    top: 6px;
    border-radius: 3px;
  }
  .icon.achievement::after {
    width: 2px;
    height: 12px;
    left: 11px;
    top: 6px;
    border-radius: 2px;
  }

  .icon.vehicle::before {
    width: 14px;
    height: 8px;
    left: 5px;
    top: 9px;
    border-radius: 3px;
  }
  .icon.vehicle::after {
    width: 16px;
    height: 2px;
    left: 4px;
    top: 7px;
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
}

.nav-item.active {
  color: #1f7aec;
  background: linear-gradient(145deg, rgba(63, 151, 255, 0.16), rgba(126, 198, 255, 0.08));
  box-shadow: 0 4px 12px rgba(31, 122, 236, 0.12);
}
</style>
