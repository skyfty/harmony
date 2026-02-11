<template>
  <view class="page">
    <view class="header">
      <text class="title">地址管理</text>
      <button class="add" @tap="create">新增地址</button>
    </view>
    <view class="content">
      <view v-if="items.length === 0" class="empty">暂无地址</view>
      <view v-for="addr in items" :key="addr.id" class="card">
        <view class="top">
          <text class="name">{{ addr.receiverName }}</text>
          <text class="phone">{{ addr.phone }}</text>
        </view>
        <text class="addr">{{ addr.region }} {{ addr.detail }}</text>
        <view class="bottom">
          <text v-if="addr.isDefault" class="badge">默认</text>
          <view class="actions">
            <text class="link" @tap="edit(addr.id)">编辑</text>
            <text class="sep">|</text>
            <text class="link link--danger" @tap="remove(addr.id)">删除</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';
import { listAddresses, removeAddress } from '@/mocks/addresses';

const items = ref(listAddresses());

onShow(() => {
  items.value = listAddresses();
});

function create() {
  uni.navigateTo({ url: '/pages/address/edit' });
}

function edit(id: string) {
  uni.navigateTo({ url: `/pages/address/edit?id=${encodeURIComponent(id)}` });
}

function remove(id: string) {
  uni.showModal({
    title: '确认删除',
    content: '确定删除该地址吗？',
    success: (res) => {
      if (res.confirm) {
        removeAddress(id);
        items.value = listAddresses();
        uni.showToast({ title: '已删除', icon: 'none' });
      }
    },
  });
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

.top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.name {
  font-size: 14px;
  font-weight: 700;
  color: #1a1f2e;
}

.phone {
  font-size: 12px;
  color: #5f6b83;
}

.addr {
  display: block;
  margin-top: 10px;
  font-size: 12px;
  color: #1a1f2e;
  line-height: 18px;
}

.bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}

.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 179, 64, 0.14);
  color: #ffb340;
}

.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.link {
  font-size: 12px;
  color: #1f7aec;
}

.link--danger {
  color: #ff3b57;
}

.sep {
  color: #d0d5dd;
}

.empty {
  text-align: center;
  color: #a8b0c1;
  font-size: 12px;
  padding: 40px 0;
}
</style>
