<template>
  <view class="page">
    <view class="header">
      <text class="title">用户建议</text>
      <button class="add" @tap="create">提交建议</button>
    </view>
    <view class="content">
      <view v-if="items.length === 0" class="empty">暂无反馈记录</view>
      <view v-for="fb in items" :key="fb.id" class="card">
        <view class="row">
          <text class="cat">{{ categoryText(fb.category) }}</text>
          <text class="status">{{ statusText(fb.status) }}</text>
        </view>
        <text class="body">{{ fb.content }}</text>
        <text class="time">{{ formatDate(fb.createdAt) }}</text>
        <text v-if="fb.reply" class="reply">回复：{{ fb.reply }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { listFeedback } from '@/mocks/feedback';
import type { FeedbackCategory, FeedbackStatus } from '@/types/feedback';

const items = ref(listFeedback());

onShow(() => {
  items.value = listFeedback();
});

function create() {
  uni.navigateTo({ url: '/pages/feedback/create' });
}

function categoryText(cat: FeedbackCategory) {
  const map: Record<FeedbackCategory, string> = {
    bug: '问题',
    ui: '界面',
    feature: '功能',
    content: '内容',
    other: '其他',
  };
  return map[cat] ?? '其他';
}

function statusText(status: FeedbackStatus) {
  const map: Record<FeedbackStatus, string> = {
    new: '新建',
    in_progress: '处理中',
    resolved: '已解决',
    closed: '已关闭',
  };
  return map[status] ?? '新建';
}

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
}

.header {
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.title {
  font-size: 16px;
  font-weight: 700;
  color: #1a1f2e;
}

.add {
  background: rgba(31, 122, 236, 0.12);
  color: #1f7aec;
  border-radius: 999px;
  font-size: 12px;
  padding: 0 12px;
  height: 30px;
  line-height: 30px;
}

.content {
  padding: 0 16px 18px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.card {
  background: #ffffff;
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.cat {
  font-size: 12px;
  color: #1f7aec;
  background: rgba(31, 122, 236, 0.12);
  padding: 2px 8px;
  border-radius: 999px;
}

.status {
  font-size: 12px;
  color: #8a94a6;
}

.body {
  display: block;
  margin-top: 10px;
  font-size: 13px;
  color: #1a1f2e;
  line-height: 20px;
}

.time {
  display: block;
  margin-top: 8px;
  font-size: 11px;
  color: #a8b0c1;
}

.reply {
  display: block;
  margin-top: 10px;
  font-size: 12px;
  color: #5f6b83;
}

.empty {
  text-align: center;
  color: #a8b0c1;
  font-size: 12px;
  padding: 40px 0;
}
</style>
