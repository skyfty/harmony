<template>
  <view class="page">
    <view v-if="!scenic" class="state">
      <text class="state-title">景区不存在</text>
      <button class="btn" @tap="goBack">返回</button>
    </view>

    <view v-else class="content">
      <ImageSwiper :image-urls="scenic.slides" />

      <view class="card">
        <view class="row">
          <text class="name">{{ scenic.title }}</text>
        </view>
        <text class="summary">{{ scenic.description }}</text>
      </view>

      <view class="card">
        <text class="section">景区介绍</text>
        <text class="desc">{{ scenic.description }}</text>
      </view>

      <view class="card">
        <text class="section">景区信息</text>
        <view class="info-row">
          <text class="label">地址</text>
          <text class="value">{{ scenic.address }}</text>
        </view>
      </view>

      <view class="card">
        <text class="section">评论</text>
        <view class="comments">
          <UserCommentItem
            v-for="c in comments"
            :key="c.id"
            :nickname="c.nickname"
            :time-i-s-o="c.timeISO"
            :content="c.content"
          />
          <view v-if="comments.length === 0" class="empty">暂无评论</view>
        </view>
      </view>

      <view class="cta">
        <button class="enter" @tap="enterScenery">进入景区</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { ref } from 'vue';
import ImageSwiper from '@/components/ImageSwiper.vue';
import UserCommentItem from '@/components/UserCommentItem.vue';
import { getScenic } from '@/api/mini';
import { listCommentsByScenic } from '@/mocks/comments';
import type { ScenicDetail } from '@/types/scenic';

const scenic = ref<ScenicDetail | null>(null);
const comments = ref(listCommentsByScenic(''));

onLoad((query) => {
  const id = typeof query?.id === 'string' ? query.id : '';
  comments.value = id ? listCommentsByScenic(id) : [];
  if (!id) {
    scenic.value = null;
    return;
  }
  void getScenic(id)
    .then((scenicRes) => {
      scenic.value = scenicRes ?? null;
    })
    .catch(() => {
      scenic.value = null;
      uni.showToast({ title: '加载失败', icon: 'none' });
    });
});

function goBack() {
  uni.navigateBack();
}

function enterScenery() {
  if (!scenic.value) return;
  uni.navigateTo({
    url: `/pages/scenery/index?packageUrl=${encodeURIComponent(scenic.value.scene.fileUrl)}`,
  });
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
}

.content {
  padding: 16px;
  padding-bottom: 90px;
}

.card {
  margin-top: 12px;
  background: #ffffff;
  border-radius: 18px;
  padding: 14px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.08);
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

.summary {
  display: block;
  margin-top: 8px;
  font-size: 12px;
  color: #5f6b83;
  line-height: 18px;
}

.section {
  display: block;
  font-size: 14px;
  font-weight: 700;
  color: #1a1f2e;
}

.desc {
  display: block;
  margin-top: 10px;
  font-size: 13px;
  color: #5f6b83;
  line-height: 20px;
}

.info-row {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.label {
  width: 48px;
  font-size: 12px;
  color: #8a94a6;
}

.value {
  flex: 1;
  font-size: 12px;
  color: #1a1f2e;
}

.comments {
  margin-top: 10px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.empty {
  padding: 10px 0;
  text-align: center;
  color: #a8b0c1;
  font-size: 12px;
}

.cta {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px 16px 20px;
  background: rgba(248, 248, 248, 0.92);
  backdrop-filter: blur(10px);
}

.enter {
  width: 100%;
  background: #1f7aec;
  color: #ffffff;
  border-radius: 14px;
  height: 44px;
  line-height: 44px;
  font-size: 15px;
  font-weight: 700;
}

.state {
  padding: 40px 16px;
  text-align: center;
}

.state-title {
  display: block;
  font-size: 14px;
  color: #1a1f2e;
}

.btn {
  margin-top: 14px;
  width: 160px;
  background: #1f7aec;
  color: #ffffff;
  border-radius: 999px;
  height: 36px;
  line-height: 36px;
  font-size: 13px;
}
</style>
