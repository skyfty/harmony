<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader title="新建商业订单" />

    <view class="content">

      <view v-if="loading" class="state-card">
        <text class="state-title">加载中...</text>
      </view>

      <view v-else class="form-card">
        <view class="field">
          <text class="field-label">景点名称</text>
          <input v-model="form.scenicName" class="field-input" placeholder="请输入景点名称" />
        </view>

        <view class="field">
          <view class="field-header">
            <text class="field-label">地址</text>
            <button class="ghost-btn" @tap="pickLocation">定位获取</button>
          </view>
          <textarea v-model="form.addressText" class="field-textarea" placeholder="请输入详细地址或使用定位获取" />
        </view>

        <view class="field-row">
          <view class="field field-row__item">
            <text class="field-label">联系电话</text>
            <input v-model="form.contactPhone" class="field-input" type="number" placeholder="请输入联系电话" />
          </view>
          <view class="field field-row__item">
            <text class="field-label">景点面积</text>
            <input v-model="form.scenicArea" class="field-input" type="digit" placeholder="平方米" />
          </view>
        </view>

        <view class="field">
          <text class="field-label">景点类型</text>
          <picker :range="scenicTypeNames" :value="selectedCategoryIndex" @change="handleCategoryChange">
            <view class="field-picker">{{ selectedCategoryName }}</view>
          </picker>
        </view>

        <view class="field">
          <text class="field-label">特殊景观</text>
          <view class="chips">
            <view
              v-for="item in bootstrap.specialLandscapeOptions"
              :key="item.code"
              class="chip"
              :class="{ 'chip--active': form.specialLandscapeTags.includes(item.code) }"
              @tap="toggleLandscape(item.code)"
            >
              {{ item.label }}
            </view>
          </view>
        </view>

        <view class="form-actions">
          <button class="primary-btn" :disabled="submitting" @tap="submitForm">{{ submitting ? '提交中...' : '提交需求' }}</button>
          <button class="secondary-btn" @tap="contactBusiness">联系商务</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue';
import PageHeader from '@/components/PageHeader.vue';
import { createBusinessOrder, getBusinessBootstrap, getProfile } from '@/api/mini';
import type { BusinessBootstrapData } from '@/types/business';
import { ensureMiniCapability } from '@/platform/runtime';

const loading = ref(true);
const submitting = ref(false);
const bootstrap = reactive<BusinessBootstrapData>({
  contractStatus: 'unsigned',
  latestOrder: null,
  scenicTypes: [],
  specialLandscapeOptions: [],
  businessContactPhone: '400-000-0000',
});

const form = reactive({
  scenicName: '',
  addressText: '',
  contactPhone: '',
  scenicArea: '',
  sceneSpotCategoryId: '',
  specialLandscapeTags: [] as string[],
  location: null as { lat: number; lng: number } | null,
});

onShow(() => {
  void loadBootstrap();
});

const scenicTypeNames = computed(() => bootstrap.scenicTypes.map((item) => item.name));
const selectedCategoryIndex = computed(() => bootstrap.scenicTypes.findIndex((item) => item.id === form.sceneSpotCategoryId));
const selectedCategoryName = computed(() => {
  const found = bootstrap.scenicTypes.find((item) => item.id === form.sceneSpotCategoryId);
  return found?.name || '请选择景点类型';
});

async function loadBootstrap() {
  loading.value = true;
  try {
    const [response, profile] = await Promise.all([
      getBusinessBootstrap(),
      getProfile().catch(() => null),
    ]);
    bootstrap.contractStatus = response.contractStatus;
    bootstrap.latestOrder = response.latestOrder;
    bootstrap.scenicTypes = response.scenicTypes || [];
    bootstrap.specialLandscapeOptions = response.specialLandscapeOptions || [];
    bootstrap.businessContactPhone = response.businessContactPhone || '400-000-0000';

    const profilePhone = String(profile?.phone || '').trim();
    if (!form.contactPhone.trim() && profilePhone) {
      form.contactPhone = profilePhone;
    }
  } catch {
    void uni.showToast({ title: '加载失败', icon: 'none' });
  } finally {
    loading.value = false;
  }
}

function isValidPhone(phone: string) {
  return /^1[3-9]\d{9}$/.test(phone);
}

function handleCategoryChange(event: { detail?: { value?: number | string } }) {
  const index = Number(event?.detail?.value ?? -1);
  const option = bootstrap.scenicTypes[index];
  form.sceneSpotCategoryId = option?.id || '';
}

function toggleLandscape(code: string) {
  const exists = form.specialLandscapeTags.includes(code);
  form.specialLandscapeTags = exists
    ? form.specialLandscapeTags.filter((item) => item !== code)
    : [...form.specialLandscapeTags, code];
}

async function pickLocation() {
  try {
    if (!await ensureMiniCapability('locationPicker')) {
      void uni.showToast({ title: '当前平台暂不支持地图选点', icon: 'none' });
      return;
    }
    const result = await uni.chooseLocation({});
    if (result) {
      form.addressText = result.address || result.name || form.addressText;
      if (typeof result.latitude === 'number' && typeof result.longitude === 'number') {
        form.location = { lat: result.latitude, lng: result.longitude };
      }
    }
  } catch {
    void uni.showToast({ title: '定位获取失败', icon: 'none' });
  }
}

function contactBusiness() {
  if (!bootstrap.businessContactPhone) {
    void uni.showToast({ title: '暂无商务联系电话', icon: 'none' });
    return;
  }
  void uni.makePhoneCall({
    phoneNumber: bootstrap.businessContactPhone,
    fail: () => {
      void uni.showToast({ title: '拨号失败', icon: 'none' });
    },
  });
}

async function submitForm() {
  if (submitting.value) {
    return;
  }
  if (!form.scenicName.trim()) {
    void uni.showToast({ title: '请输入景点名称', icon: 'none' });
    return;
  }
  if (!form.addressText.trim()) {
    void uni.showToast({ title: '请输入地址', icon: 'none' });
    return;
  }
  if (!form.contactPhone.trim()) {
    void uni.showToast({ title: '请输入联系电话', icon: 'none' });
    return;
  }
  const contactPhone = form.contactPhone.trim();
  if (!isValidPhone(contactPhone)) {
    void uni.showToast({ title: '请输入有效的手机号', icon: 'none' });
    return;
  }
  if (!form.sceneSpotCategoryId) {
    void uni.showToast({ title: '请选择景点类型', icon: 'none' });
    return;
  }

  submitting.value = true;
  try {
    const order = await createBusinessOrder({
      scenicName: form.scenicName.trim(),
      addressText: form.addressText.trim(),
      location: form.location,
      contactPhone,
      scenicArea: form.scenicArea ? Number(form.scenicArea) : null,
      sceneSpotCategoryId: form.sceneSpotCategoryId,
      specialLandscapeTags: form.specialLandscapeTags,
    });
    void uni.showToast({ title: '需求已提交', icon: 'success' });
    setTimeout(() => {
      void uni.redirectTo({ url: `/pages/business/detail/index?id=${encodeURIComponent(order.id)}` });
    }, 400);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '提交失败';
    void uni.showToast({ title: message, icon: 'none' });
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped lang="scss">
.page {
  position: relative;
  isolation: isolate;
  min-height: 100vh;
  background:
    radial-gradient(circle at top right, rgba(255, 159, 67, 0.2), transparent 30%),
    radial-gradient(circle at 16% 8%, rgba(255, 255, 255, 0.08), transparent 18%),
    radial-gradient(circle at 78% 10%, rgba(101, 164, 255, 0.14), transparent 22%),
    linear-gradient(180deg, #13243b 0%, #13243b 16%, #f3f5f8 16%, #f7f8fa 100%);
}

.page::before,
.page::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  pointer-events: none;
  z-index: 0;
}

.page::before {
  top: 0;
  height: 240px;
  background:
    radial-gradient(circle at 18% 26%, rgba(255, 255, 255, 0.12), transparent 18%),
    radial-gradient(circle at 82% 18%, rgba(255, 159, 67, 0.22), transparent 18%),
    radial-gradient(circle at 52% 76%, rgba(90, 145, 220, 0.14), transparent 22%),
    repeating-linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.05) 0,
      rgba(255, 255, 255, 0.05) 1px,
      transparent 1px,
      transparent 18px
    );
  opacity: 0.82;
  animation: pageGlowDrift 12s ease-in-out infinite alternate;
}

.page::after {
  top: -28px;
  height: 180px;
  width: 55%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.16), transparent);
  filter: blur(10px);
  transform: skewX(-18deg);
  opacity: 0.72;
  animation: pageLightSweep 8s linear infinite;
}

.content {
  position: relative;
  z-index: 1;
  padding: 16px;
}

.hero-card,
.form-card,
.state-card {
  background: #fff;
  border-radius: 24px;
  box-shadow: 0 18px 40px rgba(16, 35, 57, 0.08);
}

.hero-card {
  padding: 22px 20px;
  background:
    linear-gradient(135deg, rgba(17, 39, 72, 0.92), rgba(39, 76, 124, 0.88)),
    #13243b;
}

.hero-title {
  color: #fff;
  font-size: 22px;
  font-weight: 700;
}

.hero-desc {
  margin-top: 8px;
  color: rgba(255, 255, 255, 0.76);
  font-size: 13px;
  line-height: 1.7;
}

.state-card,
.form-card {
  margin-top: 18px;
  padding: 18px;
}

.state-title {
  color: #11233c;
  font-size: 16px;
  font-weight: 700;
}

.field {
  display: flex;
  flex-direction: column;
  margin-top: 14px;
}

.field-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 10px;
}

.field-row__item {
  margin-top: 0;
}

.field-label {
  color: #41556f;
  font-size: 12px;
  font-weight: 600;
}

.field-input,
.field-picker,
.field-textarea {
  margin-top: 8px;
  width: 100%;
  box-sizing: border-box;
  border-radius: 16px;
  background: #f4f7fb;
  color: #11233c;
  font-size: 14px;
}

.field-input,
.field-picker {
  min-height: 46px;
  padding: 0 14px;
  display: flex;
  align-items: center;
}

.field-textarea {
  min-height: 110px;
  padding: 12px 14px;
}

.field-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ghost-btn {
  margin: 0;
  min-height: 28px;
  line-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(15, 39, 72, 0.08);
  color: #0f2748;
  font-size: 12px;
}

.chips {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.chip {
  padding: 9px 14px;
  border-radius: 999px;
  background: #f2f4f7;
  color: #526278;
  font-size: 12px;
}

.chip--active {
  background: linear-gradient(135deg, #10284a, #32598d);
  color: #fff;
}

.form-actions {
  margin-top: 22px;
  display: flex;
  gap: 12px;
}

.primary-btn,
.secondary-btn {
  flex: 1;
  border-radius: 999px;
  font-size: 14px;
}

.primary-btn {
  background: linear-gradient(135deg, #ff9f43, #ff6b00);
  color: #fff;
}

.secondary-btn {
  background: rgba(15, 39, 72, 0.08);
  color: #10284a;
}

@keyframes pageGlowDrift {
  0% {
    transform: translate3d(0, 0, 0) scale(1);
  }

  100% {
    transform: translate3d(0, 10px, 0) scale(1.03);
  }
}

@keyframes pageLightSweep {
  0% {
    transform: translateX(-30%) skewX(-18deg);
  }

  100% {
    transform: translateX(170%) skewX(-18deg);
  }
}
</style>
