<template>
  <view class="page create-exhibition">
    <view class="header">
      <text class="title">新增展览</text>
      <text class="subtitle">完善展览信息并发布到展厅</text>
    </view>

    <view class="form-card">
      <view class="form-item">
        <text class="label">展览标题</text>
        <input
          class="field"
          type="text"
          placeholder="请输入展览名称"
          :value="form.name"
          @input="updateField('name', $event)"
        />
      </view>

      <view class="form-item">
        <text class="label">展览时间</text>
        <input
          class="field"
          type="text"
          placeholder="例如：2025.05.01 - 2025.06.15"
          :value="form.date"
          @input="updateField('date', $event)"
        />
      </view>

      <view class="form-item">
        <text class="label">展览地点</text>
        <input
          class="field"
          type="text"
          placeholder="请输入展厅或空间信息"
          :value="form.location"
          @input="updateField('location', $event)"
        />
      </view>

      <view class="form-item">
        <text class="label">展览简介</text>
        <textarea
          class="textarea"
          placeholder="简要描述展览亮点、策展思路等内容"
          :value="form.description"
          @input="updateField('description', $event)"
        />
      </view>

      <view class="upload-hint">
        <text class="hint-title">封面图片</text>
        <text class="hint-desc">支持 JPG/PNG，建议尺寸 1200×720</text>
        <button class="upload-btn" @tap="pickCover">上传封面</button>
        <text v-if="form.cover" class="cover-name">{{ form.cover }}</text>
      </view>
    </view>

    <button class="submit-btn" @tap="submit">立即创建</button>
  </view>
</template>
<script setup lang="ts">
import { reactive } from 'vue';

type FormKey = 'name' | 'date' | 'location' | 'description' | 'cover';

const form = reactive<Record<FormKey, string>>({
  name: '',
  date: '',
  location: '',
  description: '',
  cover: '',
});

function updateField(key: FormKey, event: any) {
  form[key] = event?.detail?.value ?? '';
}

function pickCover() {
  uni.chooseImage({
    count: 1,
    success: (res) => {
      const file = res.tempFilePaths?.[0] ?? '';
      if (file) {
        form.cover = file.split('/').pop() || '已选择封面';
        uni.showToast({ title: '已选择封面', icon: 'none' });
      }
    },
  });
}

function submit() {
  if (!form.name) {
    uni.showToast({ title: '请输入展览标题', icon: 'none' });
    return;
  }
  uni.showToast({ title: '展览已创建', icon: 'success' });
  setTimeout(() => {
    uni.navigateBack();
  }, 600);
}
</script>
<style scoped lang="scss">
.page {
  padding: 24px 20px 96px;
  min-height: 100vh;
  background: #f5f7fb;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.title {
  font-size: 22px;
  font-weight: 600;
  color: #1f1f1f;
}

.subtitle {
  font-size: 14px;
  color: #8a94a6;
}

.form-card {
  background: #ffffff;
  border-radius: 20px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  box-shadow: 0 12px 32px rgba(31, 122, 236, 0.08);
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.label {
  font-size: 14px;
  color: #1f1f1f;
  font-weight: 600;
}

.field {
  padding: 12px 14px;
  border-radius: 14px;
  background: #f0f4fb;
  font-size: 14px;
  color: #1f1f1f;
}

.textarea {
  min-height: 120px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #f0f4fb;
  font-size: 14px;
  color: #1f1f1f;
}

.upload-hint {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(31, 122, 236, 0.08), rgba(98, 166, 255, 0.16));
}

.hint-title {
  font-size: 14px;
  color: #1f1f1f;
  font-weight: 600;
}

.hint-desc {
  font-size: 12px;
  color: #5f6b83;
}

.upload-btn {
  align-self: stretch;
  width: 100%;
  padding: 12px 0;
  border-radius: 18px;
  border: none;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  margin-top: 10px;
  box-shadow: 0 10px 24px rgba(31, 122, 236, 0.2);
}

.cover-name {
  font-size: 12px;
  color: #1f1f1f;
  opacity: 0.75;
}

.submit-btn {
  margin-top: auto;
  width: 100%;
  padding: 14px 0;
  border-radius: 20px;
  border: none;
  background: linear-gradient(135deg, #1f7aec, #62a6ff);
  color: #ffffff;
  font-size: 16px;
  font-weight: 700;
  box-shadow: 0 16px 32px rgba(31, 122, 236, 0.22);
}
</style>
