<template>
  <view class="page">
    <MiniAuthRecovery />
    <PageHeader title="商业页面" />

    <view class="content">
      <view class="hero-card">
        <text class="hero-title">商业合作中心</text>
        <text class="hero-desc">从需求提交到运营上线，实时查看项目推进状态。</text>
      </view>

      <view class="timeline-scroll">
        <view class="timeline-row">
          <view v-for="(item, index) in stageItems" :key="item.key" class="timeline-item">
            <view class="timeline-dot" :class="timelineDotClass(item.key)">{{ index + 1 }}</view>
            <text class="timeline-label" :class="{ 'timeline-label--active': isStageReached(item.key) }">{{ item.label }}</text>
            <view v-if="index < stageItems.length - 1" class="timeline-line" :class="{ 'timeline-line--active': isStageReached(stageItems[index + 1].key) }" />
          </view>
        </view>
      </view>

      <view v-if="loading" class="state-card">
        <text class="state-title">加载中...</text>
      </view>

      <template v-else>
        <view v-if="showQuoteForm" class="card form-card">
          <text class="section-title">需求订单表单</text>

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

        <view v-else-if="currentStage === 'signing'" class="state-card">
          <text class="state-title">等待签约</text>
          <text class="state-desc">需求已提交，商务团队会尽快与你联系确认方案与签约安排。</text>
          <button class="secondary-btn state-btn" @tap="contactBusiness">联系商务</button>
        </view>

        <view v-else-if="currentStage === 'publish'" class="state-card">
          <text class="state-title">发布进度</text>
          <text class="state-desc">等待审核</text>
        </view>

        <view v-else-if="currentStage === 'operation'" class="state-card success-card">
          <text class="state-title">运营中</text>
          <text class="state-desc">项目已发布上线，当前处于运营阶段。</text>
        </view>

        <view v-if="currentOrder" class="card summary-card">
          <text class="section-title">订单信息</text>
          <view class="summary-grid">
            <view class="summary-item">
              <text class="summary-label">订单编号</text>
              <text class="summary-value">{{ currentOrder.orderNumber }}</text>
            </view>
            <view class="summary-item">
              <text class="summary-label">景点名称</text>
              <text class="summary-value">{{ currentOrder.scenicName }}</text>
            </view>
            <view class="summary-item">
              <text class="summary-label">景点类型</text>
              <text class="summary-value">{{ currentOrder.sceneSpotCategoryName || '未选择' }}</text>
            </view>
            <view class="summary-item">
              <text class="summary-label">联系电话</text>
              <text class="summary-value">{{ currentOrder.contactPhone }}</text>
            </view>
          </view>
        </view>

        <view v-if="showProductionTimeline" class="card progress-card">
          <text class="section-title">制作进度</text>
          <view class="vertical-timeline">
            <view v-for="item in currentOrder?.productionProgress || []" :key="item.code" class="vertical-node">
              <view class="vertical-track">
                <view class="vertical-dot" :class="verticalDotClass(item.status)" />
                <view class="vertical-line" />
              </view>
              <view class="vertical-content">
                <text class="vertical-title">{{ item.label }}</text>
                <text class="vertical-status">{{ productionStatusText(item.status) }}</text>
                <text v-if="item.activatedAt" class="vertical-meta">{{ formatDateTime(item.activatedAt) }}</text>
                <text v-if="item.remark" class="vertical-meta">{{ item.remark }}</text>
              </view>
            </view>
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import MiniAuthRecovery from '@/components/MiniAuthRecovery.vue';
import PageHeader from '@/components/PageHeader.vue';
import { createBusinessOrder, getBusinessBootstrap } from '@/api/mini';
import type { BusinessBootstrapData, BusinessTopStage } from '@/types/business';

const stageItems = [
  { key: 'quote', label: '报价' },
  { key: 'signing', label: '签约' },
  { key: 'production', label: '制作' },
  { key: 'publish', label: '发布' },
  { key: 'operation', label: '运营' },
] as const;

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

const currentOrder = computed(() => bootstrap.latestOrder);
const currentStage = computed<BusinessTopStage>(() => {
  return currentOrder.value?.topStage || 'quote';
});
const showQuoteForm = computed(() => !currentOrder.value && bootstrap.contractStatus === 'unsigned');
const showProductionTimeline = computed(() => currentStage.value === 'production' || currentStage.value === 'publish' || currentStage.value === 'operation');
const scenicTypeNames = computed(() => bootstrap.scenicTypes.map((item) => item.name));
const selectedCategoryIndex = computed(() => bootstrap.scenicTypes.findIndex((item) => item.id === form.sceneSpotCategoryId));
const selectedCategoryName = computed(() => {
  const found = bootstrap.scenicTypes.find((item) => item.id === form.sceneSpotCategoryId);
  return found?.name || '请选择景点类型';
});

async function loadBootstrap() {
  loading.value = true;
  try {
    const response = await getBusinessBootstrap();
    bootstrap.contractStatus = response.contractStatus;
    bootstrap.latestOrder = response.latestOrder;
    bootstrap.scenicTypes = response.scenicTypes || [];
    bootstrap.specialLandscapeOptions = response.specialLandscapeOptions || [];
    bootstrap.businessContactPhone = response.businessContactPhone || '400-000-0000';
    if (!form.contactPhone && currentOrder.value?.contactPhone) {
      form.contactPhone = currentOrder.value.contactPhone;
    }
  } catch {
    uni.showToast({ title: '商业页面加载失败', icon: 'none' });
  } finally {
    loading.value = false;
  }
}

function stageIndex(stage: BusinessTopStage) {
  return stageItems.findIndex((item) => item.key === stage);
}

function isStageReached(stage: BusinessTopStage) {
  return stageIndex(currentStage.value) >= stageIndex(stage);
}

function timelineDotClass(stage: BusinessTopStage) {
  if (currentStage.value === stage) {
    return 'timeline-dot--current';
  }
  return isStageReached(stage) ? 'timeline-dot--done' : '';
}

function verticalDotClass(status: 'pending' | 'active' | 'completed') {
  if (status === 'completed') {
    return 'vertical-dot--done';
  }
  if (status === 'active') {
    return 'vertical-dot--active';
  }
  return '';
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
    const result = await uni.chooseLocation({});
    if (result) {
      form.addressText = result.address || result.name || form.addressText;
      if (typeof result.latitude === 'number' && typeof result.longitude === 'number') {
        form.location = { lat: result.latitude, lng: result.longitude };
      }
    }
  } catch {
    uni.showToast({ title: '定位获取失败', icon: 'none' });
  }
}

function contactBusiness() {
  const phoneNumber = currentOrder.value?.contactPhoneForBusiness || bootstrap.businessContactPhone;
  if (!phoneNumber) {
    uni.showToast({ title: '暂无商务联系电话', icon: 'none' });
    return;
  }
  uni.makePhoneCall({
    phoneNumber,
    fail: () => {
      uni.showToast({ title: '拨号失败', icon: 'none' });
    },
  });
}

async function submitForm() {
  if (submitting.value) {
    return;
  }
  if (!form.scenicName.trim()) {
    uni.showToast({ title: '请输入景点名称', icon: 'none' });
    return;
  }
  if (!form.addressText.trim()) {
    uni.showToast({ title: '请输入地址', icon: 'none' });
    return;
  }
  if (!form.contactPhone.trim()) {
    uni.showToast({ title: '请输入联系电话', icon: 'none' });
    return;
  }
  if (!form.sceneSpotCategoryId) {
    uni.showToast({ title: '请选择景点类型', icon: 'none' });
    return;
  }

  submitting.value = true;
  try {
    const order = await createBusinessOrder({
      scenicName: form.scenicName.trim(),
      addressText: form.addressText.trim(),
      location: form.location,
      contactPhone: form.contactPhone.trim(),
      scenicArea: form.scenicArea ? Number(form.scenicArea) : null,
      sceneSpotCategoryId: form.sceneSpotCategoryId,
      specialLandscapeTags: form.specialLandscapeTags,
    });
    bootstrap.latestOrder = order;
    uni.showToast({ title: '需求已提交', icon: 'success' });
  } catch (error: any) {
    uni.showToast({ title: error?.message || '提交失败', icon: 'none' });
  } finally {
    submitting.value = false;
  }
}

function productionStatusText(status: 'pending' | 'active' | 'completed') {
  if (status === 'completed') return '已完成';
  if (status === 'active') return '进行中';
  return '待开始';
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  width: 100%;
  overflow-x: hidden;
  background:
    radial-gradient(circle at top left, rgba(30, 112, 255, 0.18), transparent 32%),
    linear-gradient(180deg, #eef5ff 0%, #f8fafc 42%, #f3f6fb 100%);
}

.content {
  width: 100%;
  box-sizing: border-box;
  padding: 14px 16px 28px;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
}

.content > * {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin-bottom: 14px;
}

.content > *:last-child {
  margin-bottom: 0;
}

.hero-card,
.card,
.state-card {
  width: 100%;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  border-radius: 20px;
  box-shadow: 0 14px 32px rgba(36, 79, 145, 0.08);
}

.hero-card {
  padding: 18px;
  display: flex;
  flex-direction: column;
}

.hero-title {
  font-size: 20px;
  font-weight: 700;
  color: #172033;
}

.hero-desc {
  margin-top: 6px;
  font-size: 13px;
  color: #667085;
  line-height: 1.5;
}

.timeline-scroll {
  width: 100%;
  box-sizing: border-box;
}

.timeline-row {
  display: flex;
  align-items: flex-start;
  width: 100%;
  padding: 8px 4px 0;
}

.timeline-item {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  position: relative;
  padding: 0 4px;
}

.timeline-dot {
  width: 30px;
  height: 30px;
  border-radius: 15px;
  background: #d7e3f5;
  color: #8a94a6;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.timeline-dot--done {
  background: #194185;
  color: #ffffff;
}

.timeline-dot--current {
  background: #ff7a00;
  color: #ffffff;
  box-shadow: 0 0 0 6px rgba(255, 122, 0, 0.15);
}

.timeline-label {
  margin-top: 8px;
  color: #8a94a6;
  font-size: 12px;
  line-height: 1.4;
  text-align: center;
  white-space: normal;
  word-break: break-word;
}

.timeline-label--active {
  color: #172033;
  font-weight: 600;
}

.timeline-line {
  position: absolute;
  top: 14px;
  left: calc(50% + 19px);
  width: calc(100% - 38px);
  height: 2px;
  background: #d7e3f5;
  margin: 0;
}

.timeline-line--active {
  background: #194185;
}

.card,
.state-card {
  padding: 16px;
}

.section-title,
.state-title {
  font-size: 16px;
  font-weight: 700;
  color: #172033;
}

.state-card {
  display: flex;
  flex-direction: column;
}

.state-desc {
  margin-top: 8px;
  font-size: 13px;
  color: #667085;
  line-height: 1.6;
}

.success-card {
  background: linear-gradient(135deg, rgba(17, 153, 142, 0.12), rgba(56, 239, 125, 0.06));
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
}

.field-row__item {
  margin-top: 0;
}

.field-label {
  font-size: 13px;
  color: #344054;
  font-weight: 600;
}

.field-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.field-input,
.field-picker,
.field-textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  border-radius: 14px;
  background: #f7f9fc;
  border: 1px solid #dde5f0;
  padding: 16px 14px;
  color: #172033;
  font-size: 14px;
  line-height: 1.5;
  min-height: 52px;
  margin-top: 8px;
}

.field-textarea {
  min-height: 88px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  padding: 8px 12px;
  border-radius: 999px;
  background: #edf2f7;
  color: #526072;
  font-size: 12px;
}

.chip--active {
  background: #194185;
  color: #ffffff;
}

.form-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}

.primary-btn,
.secondary-btn,
.ghost-btn {
  margin: 0;
  border-radius: 999px;
  font-size: 13px;
}

.primary-btn {
  background: linear-gradient(135deg, #194185, #2d68c4);
  color: #ffffff;
}

.secondary-btn {
  background: #e7eefb;
  color: #194185;
}

.ghost-btn {
  height: 28px;
  line-height: 28px;
  padding: 0 12px;
  background: rgba(25, 65, 133, 0.08);
  color: #194185;
}

.state-btn {
  width: 160px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.summary-item {
  display: flex;
  flex-direction: column;
}

.summary-label {
  font-size: 12px;
  color: #8a94a6;
}

.summary-value {
  margin-top: 4px;
  font-size: 13px;
  color: #172033;
  word-break: break-all;
}

.vertical-timeline {
  margin-top: 16px;
}

.vertical-node {
  display: flex;
  gap: 10px;
}

.vertical-track {
  width: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.vertical-dot {
  width: 12px;
  height: 12px;
  border-radius: 6px;
  background: #d7e3f5;
  margin-top: 4px;
}

.vertical-dot--active {
  background: #ff7a00;
}

.vertical-dot--done {
  background: #194185;
}

.vertical-line {
  width: 2px;
  flex: 1;
  min-height: 42px;
  background: #d7e3f5;
  margin-top: 4px;
}

.vertical-node:last-child .vertical-line {
  display: none;
}

.vertical-content {
  flex: 1;
  padding-bottom: 18px;
  display: flex;
  flex-direction: column;
}

.vertical-title {
  font-size: 14px;
  color: #172033;
  font-weight: 600;
}

.vertical-status,
.vertical-meta {
  font-size: 12px;
  color: #667085;
}

.vertical-status {
  margin-top: 4px;
}

.vertical-meta {
  margin-top: 4px;
}

@media (max-width: 420px) {
  .content {
    padding-left: 12px;
    padding-right: 12px;
  }

  .timeline-row {
    padding-left: 0;
    padding-right: 0;
  }

  .timeline-dot {
    width: 26px;
    height: 26px;
    border-radius: 13px;
    font-size: 11px;
  }

  .timeline-line {
    top: 12px;
    left: calc(50% + 17px);
    width: calc(100% - 34px);
  }

  .timeline-label {
    font-size: 11px;
  }

  .field-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .ghost-btn,
  .state-btn {
    width: 100%;
  }

  .field-row,
  .form-actions,
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>