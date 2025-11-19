<template>
  <view class="page edit-profile">
    <view class="header">
      <view class="back-button" @tap="goBack">
        <text class="back-icon">‹</text>
      </view>
      <text class="title">编辑资料</text>
    </view>

    <view class="form-section">
      <view class="avatar-section">
        <view class="avatar-upload" @tap="chooseAvatar">
          <image v-if="formData.avatarUrl" :src="formData.avatarUrl" class="avatar-preview" mode="aspectFill" />
          <view v-else class="avatar-placeholder">
            <text class="placeholder-text">+</text>
          </view>
        </view>
      </view>

      <view class="form-item">
        <text class="label">昵称</text>
        <input 
          v-model="formData.displayName" 
          class="input" 
          placeholder="请输入昵称" 
          maxlength="20"
          @blur="autoSave"
        />
      </view>

      <view class="form-item">
        <text class="label">性别</text>
        <view class="gender-selector">
          <view 
            class="gender-option"
            :class="{ active: formData.gender === 'male' }"
            @tap="selectGender('male')"
          >
            <text>男</text>
          </view>
          <view 
            class="gender-option"
            :class="{ active: formData.gender === 'female' }"
            @tap="selectGender('female')"
          >
            <text>女</text>
          </view>
          <view 
            class="gender-option"
            :class="{ active: formData.gender === 'other' }"
            @tap="selectGender('other')"
          >
            <text>其他</text>
          </view>
        </view>
      </view>

      <view class="form-item">
        <text class="label">出生日期</text>
        <picker 
          mode="date" 
          :value="formData.birthDate" 
          @change="onDateChange"
          :end="maxDate"
        >
          <view class="date-display">
            <text v-if="formData.birthDate" class="date-text">{{ formData.birthDate }}</text>
            <text v-else class="placeholder-text">请选择出生日期</text>
          </view>
        </picker>
      </view>

      <view class="form-item">
        <text class="label">联系电话</text>
        <input 
          v-model="formData.phone" 
          class="input" 
          type="number"
          placeholder="请输入联系电话" 
          maxlength="11"
          @blur="autoSave"
        />
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { apiGetProfile, apiUpdateProfile } from '@/api/miniprogram';

const formData = ref({
  avatarUrl: '',
  displayName: '',
  gender: undefined as 'male' | 'female' | 'other' | undefined,
  birthDate: '',
  phone: '',
});

const maxDate = new Date().toISOString().split('T')[0];
let saveTimeout: number | null = null;
let isSaving = false;

async function loadProfile() {
  try {
    const profile = await apiGetProfile();
    formData.value = {
      avatarUrl: profile.user.avatarUrl || '',
      displayName: profile.user.displayName || '',
      gender: profile.user.gender,
      birthDate: profile.user.birthDate ? profile.user.birthDate.split('T')[0] : '',
      phone: profile.user.phone || '',
    };
  } catch (error) {
    console.error('Failed to load profile:', error);
    uni.showToast({ title: '加载失败', icon: 'none' });
  }
}

async function autoSave() {
  // Debounce auto-save
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  saveTimeout = setTimeout(async () => {
    if (isSaving) return;
    
    // Validate phone number format if provided
    if (formData.value.phone && !/^1[3-9]\d{9}$/.test(formData.value.phone)) {
      uni.showToast({ title: '请输入有效的手机号码', icon: 'none' });
      return;
    }

    isSaving = true;
    try {
      const updateData: Record<string, unknown> = {};
      if (formData.value.avatarUrl) updateData.avatarUrl = formData.value.avatarUrl;
      if (formData.value.displayName) updateData.displayName = formData.value.displayName;
      if (formData.value.gender) updateData.gender = formData.value.gender;
      if (formData.value.birthDate) updateData.birthDate = formData.value.birthDate;
      if (formData.value.phone) updateData.phone = formData.value.phone;

      if (Object.keys(updateData).length > 0) {
        await apiUpdateProfile(updateData);
        uni.showToast({ title: '已保存', icon: 'success', duration: 1000 });
      }
    } catch (error) {
      console.error('Failed to update profile:', error);
      uni.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      isSaving = false;
    }
  }, 800);
}

function chooseAvatar() {
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: async (res) => {
      const tempFilePath = res.tempFilePaths[0];
      
      // Show loading
      uni.showLoading({ title: '上传中...' });
      
      try {
        // For now, use the temp file path directly
        // In production, you would upload to a server and get a permanent URL
        // Example: const uploadResult = await apiUploadAsset({ filePath: tempFilePath, categoryId: 'avatar', type: 'image' });
        
        // Simulate upload by using temp path (in production replace with actual upload)
        formData.value.avatarUrl = tempFilePath;
        
        // Save immediately after selecting
        await autoSaveAvatar(tempFilePath);
        
        uni.hideLoading();
        uni.showToast({ title: '头像已更新', icon: 'success', duration: 1500 });
      } catch (error) {
        uni.hideLoading();
        console.error('Failed to upload avatar:', error);
        uni.showToast({ title: '上传失败', icon: 'none' });
      }
    },
    fail: () => {
      uni.showToast({ title: '选择图片失败', icon: 'none' });
    },
  });
}

async function autoSaveAvatar(avatarUrl: string) {
  isSaving = true;
  try {
    await apiUpdateProfile({ avatarUrl });
  } catch (error) {
    console.error('Failed to save avatar:', error);
    throw error;
  } finally {
    isSaving = false;
  }
}

function selectGender(gender: 'male' | 'female' | 'other') {
  formData.value.gender = gender;
  autoSave();
}

function onDateChange(e: any) {
  formData.value.birthDate = e.detail.value;
  autoSave();
}

function goBack() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  uni.navigateBack();
}

onMounted(() => {
  loadProfile();
});
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background: #f5f7fb;
  padding-bottom: 40px;
  padding-top: 84px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
  background: #ffffff;
  border-bottom: 1px solid #e5e8ef;
  position: sticky;
  top: 0;
  z-index: 100;
}

.back-button {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.back-icon {
  font-size: 32px;
  color: #1f1f1f;
  font-weight: 300;
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: #1f1f1f;
  flex: 1;
  text-align: center;
  margin-right: 40px;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin: 20px;
}

.avatar-section {
  background: #ffffff;
  border-radius: 16px;
  padding: 40px 20px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.form-item {
  display: flex;
  align-items: center;
  padding: 20px;
  background: #ffffff;
  border-radius: 16px;

  &:last-child {
    border-bottom: none;
  }
}

.label {
  font-size: 15px;
  color: #1f1f1f;
  font-weight: 500;
  width: 80px;
  flex-shrink: 0;
}

.input {
  flex: 1;
  font-size: 15px;
  color: #1f1f1f;
  text-align: right;
}

.avatar-upload {
  width: 120px;
  height: 120px;
  border-radius: 60px;
  overflow: hidden;
  background: #f5f7fb;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.2s;
  
  &:active {
    transform: scale(0.95);
  }
}

.avatar-preview {
  width: 100%;
  height: 100%;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, rgba(63, 151, 255, 0.1), rgba(126, 198, 255, 0.05));
}

.placeholder-text {
  font-size: 32px;
  color: #3f97ff;
}

.gender-selector {
  flex: 1;
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.gender-option {
  padding: 8px 20px;
  border-radius: 20px;
  background: #f5f7fb;
  font-size: 14px;
  color: #666;
  transition: all 0.3s;

  &.active {
    background: linear-gradient(135deg, #3f97ff 0%, #7ec6ff 100%);
    color: #ffffff;
  }
}

.date-display {
  flex: 1;
  text-align: right;
}

.date-text {
  font-size: 15px;
  color: #1f1f1f;
}

.date-display .placeholder-text {
  font-size: 15px;
  color: #999;
}
</style>
