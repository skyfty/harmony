<template>
  <view class="page">
    <PageHeader title="个人信息编辑" />
    <view class="content">
      <view class="card">
        <view class="avatar-row" @tap="handleAvatarTap">
          <text class="label">头像</text>
          <view class="avatar">
            <image v-if="form.avatarUrl" class="avatar-img" :src="form.avatarUrl" mode="aspectFill" />
            <text v-else class="avatar-text">{{ form.displayName.slice(0, 1) || 'U' }}</text>
          </view>
          <button
            v-if="isWechatMiniProgram"
            class="avatar-action"
            open-type="chooseAvatar"
            @chooseavatar="handleChooseAvatar"
          >选择头像</button>
          <text v-else class="avatar-action">选择头像</text>
        </view>
        <view class="field">
          <text class="label">昵称</text>
          <input v-model="form.displayName" class="input" type="text" placeholder="请输入昵称" />
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
import { onShow } from '@dcloudio/uni-app';
import { getProfile, saveProfile, uploadProfileAvatar } from '@/api/mini';
import PageHeader from '@/components/PageHeader.vue';
import type { Gender, UserProfile } from '@/types/profile';

const isWechatMiniProgram = typeof wx !== 'undefined';

const form = reactive<UserProfile>({
  id: '',
  avatarUrl: '',
  displayName: '',
  gender: 'other',
  birthDate: '',
});
const avatarUploading = reactive({ value: false });

onShow(() => {
  void loadProfile();
});

async function loadProfile() {
  try {
    const current = await getProfile();
    form.id = current.id;
    form.avatarUrl = current.avatarUrl || '';
    form.displayName = current.displayName;
    form.gender = current.gender;
    form.birthDate = current.birthDate || '';
  } catch {
    uni.showToast({ title: '加载失败', icon: 'none' });
  }
}

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
    success: async (res) => {
      const path = Array.isArray(res.tempFilePaths) ? res.tempFilePaths[0] : '';
      if (path) {
        await uploadAvatarAndApply(path);
      }
    },
  });
}

function handleAvatarTap() {
  if (!isWechatMiniProgram) {
    pickAvatar();
  }
}

function handleChooseAvatar(event: { detail?: { avatarUrl?: string } }) {
  const avatarUrl = String(event?.detail?.avatarUrl || '').trim();
  if (!avatarUrl) {
    return;
  }
  void uploadAvatarAndApply(avatarUrl);
}

async function uploadAvatarAndApply(localPath: string) {
  if (avatarUploading.value) {
    return;
  }

  avatarUploading.value = true;
  uni.showLoading({ title: '上传头像中...' });
  try {
    const uploadedUrl = await uploadProfileAvatar(localPath);
    form.avatarUrl = uploadedUrl;
    uni.showToast({ title: '头像已更新', icon: 'none' });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : '头像上传失败';
    uni.showToast({ title: message, icon: 'none' });
  } finally {
    avatarUploading.value = false;
    uni.hideLoading();
  }
}

function save() {
  if (avatarUploading.value) {
    uni.showToast({ title: '头像上传中，请稍候', icon: 'none' });
    return;
  }
  if (!form.displayName.trim()) {
    uni.showToast({ title: '请输入昵称', icon: 'none' });
    return;
  }
  void submitProfile();
}

async function submitProfile() {
  try {
    await saveProfile({ ...form, displayName: form.displayName.trim() });
    uni.showToast({ title: '已保存', icon: 'none' });
    setTimeout(() => uni.navigateBack(), 200);
  } catch {
    uni.showToast({ title: '保存失败', icon: 'none' });
  }
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f8f8f8;
}

.content {
  padding: 12px 16px 24px;
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
  gap: 10px;
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

.avatar-action {
  margin: 0;
  border: 1px solid rgba(31, 122, 236, 0.3);
  background: rgba(31, 122, 236, 0.08);
  color: #1f7aec;
  border-radius: 999px;
  height: 30px;
  line-height: 30px;
  font-size: 12px;
  padding: 0 12px;
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
