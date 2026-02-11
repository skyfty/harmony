<template>
  <view class="page">
    <view class="header">
      <text class="title">{{ editing ? '编辑地址' : '新增地址' }}</text>
    </view>

    <view class="content">
      <view class="card">
        <view class="field">
          <text class="label">收货人</text>
          <input v-model="form.receiverName" class="input" type="text" placeholder="请输入姓名" />
        </view>
        <view class="field">
          <text class="label">手机号</text>
          <input v-model="form.phone" class="input" type="number" placeholder="请输入手机号" />
        </view>
        <view class="field">
          <text class="label">省市区</text>
          <picker mode="region" @change="onRegionChange">
            <view class="picker">{{ form.region || '请选择省市区' }}</view>
          </picker>
        </view>
        <view class="field">
          <text class="label">详细地址</text>
          <textarea v-model="form.detail" class="textarea" placeholder="街道、门牌号等" />
        </view>
        <view class="field field--switch">
          <text class="label">默认地址</text>
          <switch :checked="form.isDefault" @change="(e:any)=> (form.isDefault = !!e.detail.value)" />
        </view>
      </view>

      <button class="save" @tap="save">保存</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { reactive, ref } from 'vue';
import { getAddressById, upsertAddress } from '@/mocks/addresses';

const editing = ref(false);
const editId = ref('');

const form = reactive({
  receiverName: '',
  phone: '',
  region: '',
  detail: '',
  isDefault: false,
});

onLoad((query) => {
  const id = typeof query?.id === 'string' ? query.id : '';
  if (!id) return;
  const addr = getAddressById(id);
  if (!addr) return;
  editing.value = true;
  editId.value = id;
  form.receiverName = addr.receiverName;
  form.phone = addr.phone;
  form.region = addr.region;
  form.detail = addr.detail;
  form.isDefault = addr.isDefault;
});

function onRegionChange(e: any) {
  const value = e?.detail?.value;
  if (Array.isArray(value)) {
    form.region = value.join('/');
  }
}

function save() {
  if (!form.receiverName.trim() || !form.phone.trim() || !form.region.trim() || !form.detail.trim()) {
    uni.showToast({ title: '请填写完整信息', icon: 'none' });
    return;
  }
  upsertAddress({
    id: editId.value || undefined,
    receiverName: form.receiverName.trim(),
    phone: form.phone.trim(),
    region: form.region.trim(),
    detail: form.detail.trim(),
    isDefault: form.isDefault,
  });
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

.field--switch {
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

.textarea {
  flex: 1;
  font-size: 13px;
  color: #1a1f2e;
  min-height: 72px;
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
