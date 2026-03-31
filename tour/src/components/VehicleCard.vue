<template>
  <view class="card list" @tap="emit('tap')">
    <view class="list-row">
      <image class="thumb" :src="coverUrl" mode="aspectFill" />
      <view class="body-list">
        <view class="row">
          <text class="name">{{ name }}</text>
          <text class="badge" :class="badgeClass">{{ badgeText }}</text>
        </view>
        <text v-if="summary" class="summary">{{ summary }}</text>
        <view v-if="hasStats" class="meta-row">
          <text v-if="typeof maxSpeed === 'number'">速度 {{ maxSpeed }} km/h</text>
          <text v-if="typeof acceleration === 'number'"> · 加速 {{ acceleration }} m/s²</text>
          <text v-if="typeof handling === 'number'"> · 操控 {{ handling }}</text>
        </view>
      </view>
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
  maxSpeed?: number | null;
  acceleration?: number | null;
  braking?: number | null;
  handling?: number | null;
  mass?: number | null;
  drag?: number | null;
}>();

const emit = defineEmits<{ (event: 'tap'): void }>();

const badgeText = computed(() => {
  if (props.status === 'locked') return '未拥有';
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

const hasStats = computed(() => {
  return (
    typeof props.maxSpeed === 'number' ||
    typeof props.acceleration === 'number' ||
    typeof props.handling === 'number'
  )
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

.list {
  display: block;
  padding: 8px;
}

.thumb {
  width: 110px;
  height: 110px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}

.list-row {
  display: flex;
  flex-direction: row;
  gap: 10px;
  align-items: flex-start;
}

.body-list {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  padding-left: 10px;
  padding-top: 8px;
  flex: 1;

.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-right: 6px;
}

.stat-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
}

.stat-value {
  font-size: 14px;
  font-weight: 700;
  color: #1a1f2e;
}
}

.meta-row {
  margin-top: 8px;
  display: flex;
  gap: 8px;
  align-items: center;
  color: #8a94a6;
  font-size: 12px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.name {
  font-size: 16px;
  font-weight: 700;
  color: #1a1f2e;
}

.badge {
  font-size: 12px;
  padding: 4px 10px;
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
  margin-top: 8px;
  font-size: 12px;
  color: #5f6b83;
  line-height: 18px;
}
</style>
