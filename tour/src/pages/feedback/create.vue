<template>
  <view class="page">
    <view class="header">
      <text class="title">提交建议</text>
    </view>
    <view class="content">
      <view class="card">
        <view class="field" @tap="pickCategory">
          <text class="label">分类</text>
          <text class="picker">{{ categoryText(category) }}</text>
        </view>
        <view class="field">
          <text class="label">内容</text>
          <textarea v-model="content" class="textarea" placeholder="请描述你的建议或问题" />
        </view>
        <view class="field">
          <text class="label">联系</text>
          <input v-model="contact" class="input" type="text" placeholder="可选：微信/手机号/邮箱" />
        </view>
      </view>
      <button class="submit" @tap="submit">提交</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { createFeedback } from '@/mocks/feedback';
import type { FeedbackCategory } from '@/types/feedback';

const category = ref<FeedbackCategory>('other');
const content = ref('');
const contact = ref('');

const categoryOptions: Array<{ value: FeedbackCategory; label: string }> = [
  { value: 'bug', label: '问题' },
  { value: 'ui', label: '界面' },
  { value: 'feature', label: '功能' },
  { value: 'content', label: '内容' },
  { value: 'other', label: '其他' },
];

function categoryText(v: FeedbackCategory) {
  return categoryOptions.find((o) => o.value === v)?.label ?? '其他';
}

function pickCategory() {
  uni.showActionSheet({
    itemList: categoryOptions.map((o) => o.label),
    success: (res) => {
      const idx = res.tapIndex;
      const item = categoryOptions[idx];
      if (item) category.value = item.value;
    },
  });
}

function submit() {
  if (!content.value.trim()) {
    uni.showToast({ title: '请填写内容', icon: 'none' });
    return;
  }
  createFeedback({
    category: category.value,
    content: content.value.trim(),
    contact: contact.value.trim(),
  });
  uni.showToast({ title: '已提交', icon: 'none' });
  setTimeout(() => uni.navigateBack(), 200);
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
}

.header {
  padding: 16px;
}

.title {
  font-size: 16px;
  font-weight: 700;
  color: #1a1f2e;
}

.content {
  padding: 0 16px 18px;
}

.card {
  background: #ffffff;
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid #f2f4f7;
}

.field:last-child {
  border-bottom: none;
}

.label {
  width: 64px;
  font-size: 12px;
  color: #8a94a6;
}

.picker {
  flex: 1;
  font-size: 13px;
  color: #1a1f2e;
}

.textarea {
  flex: 1;
  font-size: 13px;
  color: #1a1f2e;
  min-height: 110px;
}

.input {
  flex: 1;
  font-size: 13px;
  color: #1a1f2e;
}

.submit {
  margin-top: 14px;
  width: 100%;
  background: #1f7aec;
  color: #ffffff;
  border-radius: 14px;
  height: 44px;
  line-height: 44px;
  font-size: 15px;
  font-weight: 700;
}
</style>
