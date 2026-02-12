<template>
  <view class="bottom-nav">
    <view
      v-for="item in navItems"
      :key="item.key"
      class="nav-item"
      :class="[
        `nav-item--${item.key}`,
        {
          active: active === item.key,
        },
      ]"
      @tap="go(item.key)"
    >
      <image
        class="icon"
        mode="aspectFit"
        :src="active === item.key ? item.icon.active : item.icon.inactive"
      />
      <text class="label">
        {{ item.label }}
      </text>
    </view>
  </view>
</template>

<script setup lang="ts">
import type { NavKey } from '@/utils/navKey';

type NavItem = {
  key: NavKey;
  label: string;
  icon: {
    inactive: string;
    active: string;
  };
};

const props = defineProps<{ active: NavKey }>();
const emit = defineEmits<{ (event: 'navigate', value: NavKey): void }>();

const navItems: ReadonlyArray<NavItem> = [
  {
    key: 'scenic',
    label: '景区',
    icon: {
      inactive: '/static/icons/bottom-nav/scenic-inactive.png',
      active: '/static/icons/bottom-nav/scenic-active.png',
    },
  },
  {
    key: 'coupon',
    label: '卡券',
    icon: {
      inactive: '/static/icons/bottom-nav/coupon-inactive.png',
      active: '/static/icons/bottom-nav/coupon-active.png',
    },
  },
  {
    key: 'achievement',
    label: '成就',
    icon: {
      inactive: '/static/icons/bottom-nav/achievement-inactive.png',
      active: '/static/icons/bottom-nav/achievement-active.png',
    },
  },
  {
    key: 'vehicle',
    label: '车辆',
    icon: {
      inactive: '/static/icons/bottom-nav/vehicle-inactive.png',
      active: '/static/icons/bottom-nav/vehicle-active.png',
    },
  },
  {
    key: 'profile',
    label: '我的',
    icon: {
      inactive: '/static/icons/bottom-nav/profile-inactive.png',
      active: '/static/icons/bottom-nav/profile-active.png',
    },
  },
];

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
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: #ffffff;
  border-top: 1px solid #f3f4f6;
  height: 85px;
  box-sizing: border-box;
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  height: calc(85px + constant(safe-area-inset-bottom));
  height: calc(85px + env(safe-area-inset-bottom));
  z-index: 100;
}

.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 20%;
  color: #9ca3af;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
}

.icon {
  width: 30px;
  height: 30px;
  display: block;
}

.label {
  font-size: 11px;
  margin-top: 2px;
}

.nav-item.active {
  font-weight: 900;
}

.nav-item--scenic.active {
  color: #0284c7;
  font-weight: 500;
}

.nav-item--coupon.active {
  color: #4f46e5;
}

.nav-item--achievement.active {
  color: #f59e0b;
}

.nav-item--vehicle.active {
  color: #059669;
}

.nav-item--profile.active {
  color: #1e293b;
}
</style>
