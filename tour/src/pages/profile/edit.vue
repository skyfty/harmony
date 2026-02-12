<template>
  <view class="page">
    <view class="header"><text class="title">个人信息编辑</text></view>
    <view class="content">
      <view class="card">
        <view class="avatar-row" @tap="pickAvatar">
          <text class="label">头像</text>
          <view class="avatar">
            <image v-if="form.avatarUrl" class="avatar-img" :src="form.avatarUrl" mode="aspectFill" />
            <text v-else class="avatar-text">{{ form.nickname.slice(0, 1) || 'U' }}</text>
          </view>
        </view>
        <view class="field">
          <text class="label">昵称</text>
          <input v-model="form.nickname" class="input" type="text" placeholder="请输入昵称" />
        </view>
        <view class="field" @tap="pickGender">
          <text class="label">性别</text>
          <text class="picker">{{ genderText(form.gender) }}</text>
        </view>
        <view class="field">
          <text class="label">生日</text>
          <picker mode="date" :value="form.birthDate" @change="(e:any)=> (form.birthDate = e.detail.value)">
            <view class="picker">{{ form.birthDate || '请选择生日' }}</view>
          </picker>
        </view>
      </view>

      <button class="save" @tap="save">保存</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { getProfile, saveProfile } from '@/mocks/profile';
import type { Gender, UserProfile } from '@/types/profile';

const current = getProfile();
const form = reactive<UserProfile>({ ...current });

const genderOptions: Array<{ value: Gender; label: string }> = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' },
];

function genderText(v: Gender) {
  return genderOptions.find((o) => o.value === v)?.label ?? '其他';
}

function pickGender() {
  uni.showActionSheet({
    itemList: genderOptions.map((o) => o.label),
    success: (res) => {
      const item = genderOptions[res.tapIndex];
      if (item) form.gender = item.value;
    },
  });
}

function pickAvatar() {
  if (typeof uni.chooseImage !== 'function') {
    return;
  }
  uni.chooseImage({
    count: 1,
    success: (res) => {
      const path = Array.isArray(res.tempFilePaths) ? res.tempFilePaths[0] : '';
      if (path) {
        form.avatarUrl = path;
      }
    },
  });
}

function save() {
  if (!form.nickname.trim()) {
    uni.showToast({ title: '请输入昵称', icon: 'none' });
    return;
  }
  saveProfile({ ...form, nickname: form.nickname.trim() });
  uni.showToast({ title: '已保存', icon: 'none' });
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

.avatar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid #f2f4f7;
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

.input {
  flex: 1;
  font-size: 13px;
  color: #1a1f2e;
}

.picker {
  flex: 1;
  font-size: 13px;
  color: #1a1f2e;
}

.avatar {
  width: 46px;
  height: 46px;
  border-radius: 23px;
  overflow: hidden;
  background: linear-gradient(145deg, rgba(63, 151, 255, 0.35), rgba(126, 198, 255, 0.2));
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-img {
  width: 46px;
  height: 46px;
}

.avatar-text {
  color: #ffffff;
  font-weight: 700;
}

.save {
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
