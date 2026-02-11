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
      <svg
        class="icon"
        viewBox="0 0 24 24"
        width="1em"
        height="1em"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          :d="active === item.key ? item.icon.active : item.icon.inactive"
          fill="currentColor"
        />
      </svg>
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
      inactive:
        'M12 2c3.31 0 6 2.66 6 5.95C18 12.41 12 19 12 19S6 12.41 6 7.95C6 4.66 8.69 2 12 2m0 4a2 2 0 0 0-2 2a2 2 0 0 0 2 2a2 2 0 0 0 2-2a2 2 0 0 0-2-2m8 13c0 2.21-3.58 4-8 4s-8-1.79-8-4c0-1.29 1.22-2.44 3.11-3.17l.64.91C6.67 17.19 6 17.81 6 18.5c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5c0-.69-.67-1.31-1.75-1.76l.64-.91C18.78 16.56 20 17.71 20 19',
      active:
        'M12 2c3.31 0 6 2.66 6 5.95C18 12.41 12 19 12 19S6 12.41 6 7.95C6 4.66 8.69 2 12 2m0 4a2 2 0 0 0-2 2a2 2 0 0 0 2 2a2 2 0 0 0 2-2a2 2 0 0 0-2-2m8 13c0 2.21-3.58 4-8 4s-8-1.79-8-4c0-1.29 1.22-2.44 3.11-3.17l.64.91C6.67 17.19 6 17.81 6 18.5c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5c0-.69-.67-1.31-1.75-1.76l.64-.91C18.78 16.56 20 17.71 20 19',
    },
  },
  {
    key: 'coupon',
    label: '卡券',
    icon: {
      inactive:
        'M4 4a2 2 0 0 0-2 2v4a2 2 0 0 1 2 2a2 2 0 0 1-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 1-2-2a2 2 0 0 1 2-2V6a2 2 0 0 0-2-2zm11.5 3L17 8.5L8.5 17L7 15.5zm-6.69.04c.98 0 1.77.79 1.77 1.77a1.77 1.77 0 0 1-1.77 1.77c-.98 0-1.77-.79-1.77-1.77a1.77 1.77 0 0 1 1.77-1.77m6.38 6.38c.98 0 1.77.79 1.77 1.77a1.77 1.77 0 0 1-1.77 1.77c-.98 0-1.77-.79-1.77-1.77a1.77 1.77 0 0 1 1.77-1.77',
      active:
        'M4 4a2 2 0 0 0-2 2v4a2 2 0 0 1 2 2a2 2 0 0 1-2 2v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4a2 2 0 0 1-2-2a2 2 0 0 1 2-2V6a2 2 0 0 0-2-2zm11.5 3L17 8.5L8.5 17L7 15.5zm-6.69.04c.98 0 1.77.79 1.77 1.77a1.77 1.77 0 0 1-1.77 1.77c-.98 0-1.77-.79-1.77-1.77a1.77 1.77 0 0 1 1.77-1.77m6.38 6.38c.98 0 1.77.79 1.77 1.77a1.77 1.77 0 0 1-1.77 1.77c-.98 0-1.77-.79-1.77-1.77a1.77 1.77 0 0 1 1.77-1.77',
    },
  },
  {
    key: 'achievement',
    label: '成就',
    icon: {
      inactive:
        'M18 2c-.9 0-2 1-2 2H8c0-1-1.1-2-2-2H2v9c0 1 1 2 2 2h2.2c.4 2 1.7 3.7 4.8 4v2.08C8 19.54 8 22 8 22h8s0-2.46-3-2.92V17c3.1-.3 4.4-2 4.8-4H20c1 0 2-1 2-2V2zM6 11H4V4h2zm14 0h-2V4h2z',
      active:
        'M17 4V2H7v2H2v7c0 1.1.9 2 2 2h3.1a5.01 5.01 0 0 0 3.9 3.9v2.18C8 19.54 8 22 8 22h8s0-2.46-3-2.92V16.9a5.01 5.01 0 0 0 3.9-3.9H20c1.1 0 2-.9 2-2V4zM4 11V6h3v5zm16 0h-3V6h3z',
    },
  },
  {
    key: 'vehicle',
    label: '车辆',
    icon: {
      inactive:
        'm5 11l1.5-4.5h11L19 11m-1.5 5a1.5 1.5 0 0 1-1.5-1.5a1.5 1.5 0 0 1 1.5-1.5a1.5 1.5 0 0 1 1.5 1.5a1.5 1.5 0 0 1-1.5 1.5m-11 0A1.5 1.5 0 0 1 5 14.5A1.5 1.5 0 0 1 6.5 13A1.5 1.5 0 0 1 8 14.5A1.5 1.5 0 0 1 6.5 16M18.92 6c-.2-.58-.76-1-1.42-1h-11c-.66 0-1.22.42-1.42 1L3 12v8a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h12v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-8z',
      active:
        'M18.92 2c-.2-.58-.76-1-1.42-1h-11c-.66 0-1.21.42-1.42 1L3 8v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1V8zM6.5 12c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9S8 9.67 8 10.5S7.33 12 6.5 12m11 0c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5s-.67 1.5-1.5 1.5M5 7l1.5-4.5h11L19 7zm2 13h4v-2l6 3h-4v2z',
    },
  },
  {
    key: 'profile',
    label: '我的',
    icon: {
      inactive:
        'M12 4a4 4 0 0 1 4 4a4 4 0 0 1-4 4a4 4 0 0 1-4-4a4 4 0 0 1 4-4m0 10c4.42 0 8 1.79 8 4v2H4v-2c0-2.21 3.58-4 8-4',
      active:
        'M12 19.2c-2.5 0-4.71-1.28-6-3.2c.03-2 4-3.1 6-3.1s5.97 1.1 6 3.1a7.23 7.23 0 0 1-6 3.2M12 5a3 3 0 0 1 3 3a3 3 0 0 1-3 3a3 3 0 0 1-3-3a3 3 0 0 1 3-3m0-3A10 10 0 0 0 2 12a10 10 0 0 0 10 10a10 10 0 0 0 10-10c0-5.53-4.5-10-10-10',
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
