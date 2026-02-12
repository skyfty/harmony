<template>
  <view class="card" :class="{ selected }" @tap="emit('tap')">
    <image class="cover" :src="coverUrl" mode="aspectFill" />
    <view class="body">
      <view class="row">
        <text class="name">{{ name }}</text>
        <text class="badge" :class="badgeClass">{{ badgeText }}</text>
      </view>
      <text class="summary">{{ summary }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { VehicleStatus } from '@/types/vehicle';

const props = defineProps<{
  name: string;
  summary: string;
  coverUrl: string;
  status: VehicleStatus;
  selected: boolean;
}>();

const emit = defineEmits<{ (event: 'tap'): void }>();

const badgeText = computed(() => {
  if (props.status === 'locked') return '未解锁';
  if (props.selected) return '使用中';
  if (props.status === 'owned') return '已拥有';
  return '可使用';
});

const badgeClass = computed(() => {
  if (props.status === 'locked') return 'badge--locked';
  if (props.selected) return 'badge--selected';
  if (props.status === 'owned') return 'badge--owned';
  return 'badge--available';
});
</script>

<style scoped lang="scss">
.card {
  background: #ffffff;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
  border: 1px solid rgba(31, 122, 236, 0.08);
}

.card.selected {
  border-color: rgba(31, 122, 236, 0.35);
}

.cover {
  width: 100%;
  height: 150px;
  display: block;
}

.body {
  padding: 12px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.name {
  font-size: 15px;
  font-weight: 600;
  color: #1a1f2e;
}

.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: #eef4ff;
  color: #1f7aec;
}

.badge--locked {
  background: #f2f4f7;
  color: #98a2b3;
}

.badge--owned {
  background: rgba(255, 179, 64, 0.14);
  color: #ffb340;
}

.badge--available {
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
}

.badge--selected {
  background: rgba(31, 122, 236, 0.2);
  color: #1f7aec;
}

.summary {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #8a94a6;
  line-height: 18px;
}
</style>
