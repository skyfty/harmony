<template>
  <view class="comment">
    <view class="meta">
      <text class="nickname">{{ nickname }}</text>
      <text class="time">{{ formattedTime }}</text>
    </view>
    <text class="content">{{ content }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  nickname: string;
  timeISO: string;
  content: string;
}>();

const formattedTime = computed(() => {
  const d = new Date(props.timeISO);
  if (Number.isNaN(d.getTime())) {
    return props.timeISO;
  }
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
});
</script>

<style scoped>
.comment {
  padding: 12px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 6px 18px rgba(31, 122, 236, 0.06);
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.nickname {
  font-size: 13px;
  color: #1a1f2e;
}

.time {
  font-size: 11px;
  color: #a8b0c1;
}

.content {
  font-size: 13px;
  color: #5f6b83;
  line-height: 18px;
}
</style>
