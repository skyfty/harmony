<script setup lang="ts">
import type { BusinessOrderAnalyticsItem, BusinessOrderItem } from '#/api';
import type { EchartsUIType } from '@vben/plugins/echarts';

import dayjs from 'dayjs';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  advanceBusinessOrderProductionApi,
  approveBusinessOrderRenewalApi,
  completeBusinessOrderOperationApi,
  completeBusinessOrderProductionApi,
  completeBusinessOrderPublishApi,
  getBusinessOrderAnalyticsApi,
  getBusinessOrderApi,
  signBusinessOrderApi,
  updateBusinessOrderApi,
} from '#/api';
import { listSceneSpotsApi } from '#/api/core/scene-spots';
import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import {
  Button,
  Card,
  DatePicker,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Timeline,
  message,
} from 'ant-design-vue';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const submitting = ref(false);
const order = ref<BusinessOrderItem | null>(null);
const analytics = ref<BusinessOrderAnalyticsItem | null>(null);
const analyticsLoading = ref(false);
const analyticsPreset = ref<null | {
  dimension: 'category' | 'checkpoint';
  end: string | null;
  granularity: 'day' | 'month';
  limit: number;
  metric: 'pv' | 'uv' | 'newUsers' | 'punchCount';
  start: string | null;
}>(null);
const analyticsStartDraft = ref<string | null>(null);
const analyticsEndDraft = ref<string | null>(null);
const analyticsGranularityDraft = ref<'day' | 'month'>('day');
const analyticsMetricDraft = ref<'pv' | 'uv' | 'newUsers' | 'punchCount'>('uv');
const analyticsDimensionDraft = ref<'category' | 'checkpoint'>('checkpoint');
const analyticsLimitDraft = ref<number>(8);
const notesDraft = ref('');
const contactDraft = ref('');
const promoterPhoneDraft = ref('');
const productionRemark = ref('');
const serviceDurationDaysDraft = ref<number>(365);
const servicePriceDraft = ref<number>(0);
const renewalWarningDaysDraft = ref<number>(15);
const serviceStartDraft = ref<string | null>(null);
const serviceEndDraft = ref<string | null>(null);
const selectedSceneSpotId = ref<string | undefined>(undefined);
const sceneSpotOptions = ref<Array<{ label: string; value: string }>>([]);
const trendChartRef = ref<EchartsUIType>();
const breakdownChartRef = ref<EchartsUIType>();
const { renderEcharts: renderTrendChart } = useEcharts(trendChartRef);
const { renderEcharts: renderBreakdownChart } = useEcharts(breakdownChartRef);
const specialLandscapeLabelMap = new Map([
  ['light-show', '灯光秀'],
  ['water-fountain', '水景喷泉'],
  ['glass-skywalk', '玻璃栈道'],
  ['night-performance', '夜游演艺'],
  ['naked-eye-3d', '裸眼3D大屏'],
  ['mountain-projection', '山体投影'],
  ['interactive-device', '互动装置'],
  ['ropeway-elevator', '索道/观光电梯'],
]);

const currentProductionNode = computed(() => order.value?.productionProgress.find((item) => item.status === 'active') || null);
const pendingRenewals = computed(() => (order.value?.renewalHistory || []).filter((item) => !item.approvedAt));
const activeTab = ref('overview');

const analyticsMetricOptions = [
  { label: 'UV', value: 'uv' },
  { label: 'PV', value: 'pv' },
  { label: '新增用户', value: 'newUsers' },
  { label: '打卡次数', value: 'punchCount' },
];

const analyticsDimensionOptions = [
  { label: '打卡点', value: 'checkpoint' },
  { label: '景点分类', value: 'category' },
];

const analyticsGranularityOptions = [
  { label: '按天', value: 'day' },
  { label: '按月', value: 'month' },
];

const analyticsLimitOptions = [5, 8, 10, 12, 15, 20].map((value) => ({
  label: `${value}`,
  value,
}));

function analyticsMetricLabel(metric: 'pv' | 'uv' | 'newUsers' | 'punchCount') {
  switch (metric) {
    case 'pv':
      return 'PV';
    case 'newUsers':
      return '新增用户';
    case 'punchCount':
      return '打卡次数';
    default:
      return 'UV';
  }
}

function analyticsDimensionLabel(dimension: 'category' | 'checkpoint') {
  return dimension === 'category' ? '景点分类' : '打卡点';
}

function analyticsGranularityLabel(granularity: 'day' | 'month') {
  return granularity === 'month' ? '按月' : '按天';
}

function toAnalyticsIso(value: unknown, granularity: 'day' | 'month', boundary: 'start' | 'end') {
  if (!value || typeof value === 'string') {
    return null;
  }
  const parsed = dayjs(value as any);
  if (!parsed.isValid()) {
    return null;
  }
  const normalized = granularity === 'month'
    ? (boundary === 'start' ? parsed.startOf('month') : parsed.endOf('month'))
    : (boundary === 'start' ? parsed.startOf('day') : parsed.endOf('day'));
  return normalized.toISOString();
}

function setAnalyticsPreset(response: BusinessOrderAnalyticsItem) {
  if (analyticsPreset.value) {
    return;
  }

  const granularity = response.charts?.trend?.granularity || 'day';
  const metric = response.charts?.trend?.metric || 'uv';
  const dimension = response.charts?.breakdown?.dimension || 'checkpoint';
  const limit = Math.max(response.charts?.breakdown?.categories?.length || 8, 1);

  analyticsPreset.value = {
    dimension,
    end: response.query.end || null,
    granularity,
    limit,
    metric,
    start: response.query.start || null,
  };
  analyticsStartDraft.value = response.query.start || null;
  analyticsEndDraft.value = response.query.end || null;
  analyticsGranularityDraft.value = granularity;
  analyticsMetricDraft.value = metric;
  analyticsDimensionDraft.value = dimension;
  analyticsLimitDraft.value = limit;
}

function buildAnalyticsParams() {
  const start = analyticsStartDraft.value ? dayjs(analyticsStartDraft.value) : null;
  const end = analyticsEndDraft.value ? dayjs(analyticsEndDraft.value) : null;

  if (!start || !end) {
    return null;
  }
  if (!start.isValid() || !end.isValid()) {
    return null;
  }
  if (start.isAfter(end)) {
    return null;
  }

  return {
    dimension: analyticsDimensionDraft.value,
    end: toAnalyticsIso(end, analyticsGranularityDraft.value, 'end') || undefined,
    granularity: analyticsGranularityDraft.value,
    limit: Math.max(1, analyticsLimitDraft.value || 1),
    metric: analyticsMetricDraft.value,
    start: toAnalyticsIso(start, analyticsGranularityDraft.value, 'start') || undefined,
  };
}

function normalizeAnalyticsData() {
  return analytics.value?.charts || null;
}

function renderAnalyticsCharts() {
  const chartData = normalizeAnalyticsData();
  const trend = chartData?.trend;
  const breakdown = chartData?.breakdown;

  renderTrendChart({
    grid: {
      bottom: 12,
      left: '1%',
      right: '2%',
      top: 24,
    },
    legend: {
      bottom: 0,
      data: trend?.series.map((item) => item.name) || [],
    },
    series: (trend?.series || []).map((item) => ({
      areaStyle: { opacity: 0.18 },
      data: item.data,
      itemStyle: {
        color: '#1677ff',
      },
      name: item.name,
      smooth: true,
      symbol: 'circle',
      symbolSize: 8,
      type: 'line',
    })),
    tooltip: {
      trigger: 'axis',
    },
    xAxis: {
      axisTick: {
        show: false,
      },
      boundaryGap: false,
      data: trend?.categories || [],
      type: 'category',
    },
    yAxis: {
      axisTick: {
        show: false,
      },
      splitLine: {
        lineStyle: {
          color: '#f0f0f0',
        },
      },
      type: 'value',
    },
  });

  renderBreakdownChart({
    grid: {
      bottom: 12,
      left: '2%',
      right: '2%',
      top: 24,
    },
    legend: {
      bottom: 0,
      data: breakdown?.series.map((item) => item.name) || [],
    },
    series: (breakdown?.series || []).map((item, index) => ({
      barMaxWidth: 24,
      data: item.data,
      name: item.name,
      type: 'bar',
      itemStyle: {
        color: index === 0 ? '#1677ff' : '#52c41a',
      },
    })),
    tooltip: {
      trigger: 'axis',
    },
    xAxis: {
      axisTick: {
        show: false,
      },
      axisLabel: {
        interval: 0,
        rotate: 18,
      },
      data: breakdown?.categories || [],
      type: 'category',
    },
    yAxis: {
      axisTick: {
        show: false,
      },
      splitLine: {
        lineStyle: {
          color: '#f0f0f0',
        },
      },
      type: 'value',
    },
  });
}

function stageText(stage?: string) {
  switch (stage) {
    case 'quote':
      return '报价';
    case 'signing':
      return '签约';
    case 'production':
      return '制作';
    case 'publish':
      return '发布';
    case 'operation':
      return '运营';
    default:
      return stage || '-';
  }
}

function stageColor(stage?: string) {
  switch (stage) {
    case 'signing':
      return 'gold';
    case 'production':
      return 'processing';
    case 'publish':
      return 'purple';
    case 'operation':
      return 'success';
    default:
      return 'default';
  }
}

function serviceStatusText(status?: string) {
  switch (status) {
    case 'active':
      return '服务中';
    case 'expiring':
      return '即将到期';
    case 'expired':
      return '已到期';
    default:
      return '待生效';
  }
}

function serviceStatusColor(status?: string) {
  switch (status) {
    case 'active':
      return 'success';
    case 'expiring':
      return 'warning';
    case 'expired':
      return 'error';
    default:
      return 'default';
  }
}

function paymentStatusText(status?: string) {
  switch (status) {
    case 'processing':
      return '支付中';
    case 'succeeded':
      return '已支付';
    case 'failed':
      return '支付失败';
    case 'refunded':
      return '已退款';
    case 'closed':
      return '已关闭';
    default:
      return '未支付';
  }
}

function paymentStatusColor(status?: string) {
  switch (status) {
    case 'processing':
      return 'processing';
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'error';
    case 'refunded':
      return 'purple';
    case 'closed':
      return 'default';
    default:
      return 'default';
  }
}

function productionStatusColor(status: string) {
  if (status === 'completed') return 'green';
  if (status === 'active') return 'blue';
  return 'gray';
}

function specialLandscapeText(tags: string[] | undefined | null) {
  if (!tags?.length) return '-';
  return tags.map((tag) => specialLandscapeLabelMap.get(tag) || tag).join('、');
}

async function loadSceneSpotOptions() {
  const result = await listSceneSpotsApi({ page: 1, pageSize: 100 });
  sceneSpotOptions.value = (result.items || []).map((item) => ({
    value: item.id,
    label: `${item.title} (${item.sceneId})`,
  }));
}

async function loadAnalytics() {
  const id = String(route.params.id || '');
  if (!id || !order.value?.analyticsAvailable) {
    analytics.value = null;
    return;
  }
  analyticsLoading.value = true;
  try {
    const params = buildAnalyticsParams();
    const response = await getBusinessOrderAnalyticsApi(id, params || undefined);
    analytics.value = response;
    setAnalyticsPreset(response);
    await nextTick();
    renderAnalyticsCharts();
  } catch (error) {
    message.warning((error as Error)?.message || '加载订单运营数据失败');
  } finally {
    analyticsLoading.value = false;
  }
}

async function reloadAnalytics() {
  if (!order.value?.analyticsAvailable) {
    return;
  }
  const start = analyticsStartDraft.value ? dayjs(analyticsStartDraft.value) : null;
  const end = analyticsEndDraft.value ? dayjs(analyticsEndDraft.value) : null;

  if (!start || !end || !start.isValid() || !end.isValid()) {
    message.warning('请先选择完整的开始和结束日期');
    return;
  }
  if (start.isAfter(end)) {
    message.warning('开始日期不能晚于结束日期');
    return;
  }

  await loadAnalytics();
}

async function resetAnalyticsFilters() {
  if (!analyticsPreset.value) {
    message.warning('暂无可重置的筛选条件');
    return;
  }

  analyticsStartDraft.value = analyticsPreset.value.start;
  analyticsEndDraft.value = analyticsPreset.value.end;
  analyticsGranularityDraft.value = analyticsPreset.value.granularity;
  analyticsMetricDraft.value = analyticsPreset.value.metric;
  analyticsDimensionDraft.value = analyticsPreset.value.dimension;
  analyticsLimitDraft.value = analyticsPreset.value.limit;
  await loadAnalytics();
}

async function loadOrder() {
  const id = String(route.params.id || '');
  if (!id) return;
  loading.value = true;
  try {
    const response = await getBusinessOrderApi(id);
    order.value = response;
    notesDraft.value = response.notes || '';
    contactDraft.value = response.contactPhoneForBusiness || '';
    promoterPhoneDraft.value = response.promoterPhone || '';
    serviceDurationDaysDraft.value = response.service.durationDays;
    servicePriceDraft.value = response.service.price;
    renewalWarningDaysDraft.value = response.service.warningDays;
    serviceStartDraft.value = response.service.startAt;
    serviceEndDraft.value = response.service.endAt;
    selectedSceneSpotId.value = response.delivery.sceneSpotId || undefined;
    await loadAnalytics();
  } finally {
    loading.value = false;
  }
}

async function withSubmit(task: () => Promise<void>) {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await task();
  } finally {
    submitting.value = false;
  }
}

async function saveAdminFields() {
  const id = String(route.params.id || '');
  await withSubmit(async () => {
    await updateBusinessOrderApi(id, {
      notes: notesDraft.value,
      contactPhoneForBusiness: contactDraft.value,
        promoterPhone: promoterPhoneDraft.value || null,
      sceneSpotId: selectedSceneSpotId.value || null,
      serviceDurationDays: serviceDurationDaysDraft.value,
      servicePrice: servicePriceDraft.value,
      renewalWarningDays: renewalWarningDaysDraft.value,
      serviceStartAt: serviceStartDraft.value,
      serviceEndAt: serviceEndDraft.value,
    });
    message.success('商业订单信息已更新');
    await loadOrder();
  });
}

async function signOrder() {
  const id = String(route.params.id || '');
  await withSubmit(async () => {
    await signBusinessOrderApi(id);
    message.success('已完成签约并进入制作阶段');
    await loadOrder();
  });
}

async function advanceProduction() {
  const id = String(route.params.id || '');
  await withSubmit(async () => {
    await advanceBusinessOrderProductionApi(id, productionRemark.value || undefined);
    productionRemark.value = '';
    message.success('制作进度已推进');
    await loadOrder();
  });
}

async function completeProduction() {
  const id = String(route.params.id || '');
  await withSubmit(async () => {
    await completeBusinessOrderProductionApi(id);
    message.success('制作已完成，进入发布阶段');
    await loadOrder();
  });
}

async function completePublish() {
  const id = String(route.params.id || '');
  await withSubmit(async () => {
    await completeBusinessOrderPublishApi(id);
    message.success('发布已完成，可继续绑定交付场景并开启运营');
    await loadOrder();
  });
}

async function completeOperation() {
  const id = String(route.params.id || '');
  await withSubmit(async () => {
    await completeBusinessOrderOperationApi(id);
    message.success('订单已进入运营阶段');
    await loadOrder();
  });
}

async function approveRenewal(renewalId: string) {
  await withSubmit(async () => {
    await approveBusinessOrderRenewalApi(renewalId);
    message.success('续费订单已审批并生效');
    await loadOrder();
  });
}

function confirmAction(title: string, action: () => Promise<void>) {
  Modal.confirm({
    title,
    onOk: async () => {
      await action();
    },
  });
}

watch(activeTab, async (nextTab) => {
  if (nextTab !== 'analytics' || !analytics.value) {
    return;
  }

  await nextTick();
  renderAnalyticsCharts();
});

onMounted(async () => {
  await loadSceneSpotOptions();
  await loadOrder();
});
</script>

<template>
  <div class="p-5">
    <Spin :spinning="loading">
      <Card v-if="order" title="业务订单详情">
        <div class="mb-4 flex items-center justify-between gap-3">
          <div>
            <div class="text-lg font-semibold">{{ order.scenicName }}</div>
            <div class="text-text-secondary mt-1">{{ order.orderNumber }}</div>
          </div>
          <Button @click="router.back()">返回</Button>
        </div>

        <Tabs v-model:activeKey="activeTab" class="mt-4">
          <Tabs.TabPane key="overview" tab="概览">
            <Card size="small" title="订单基础信息">
              <Descriptions bordered :column="2" size="small">
                <Descriptions.Item label="订单编号">{{ order.orderNumber }}</Descriptions.Item>
                <Descriptions.Item label="当前阶段">
                  <Tag :color="stageColor(order.topStage)">{{ stageText(order.topStage) }}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="服务状态">
                  <Tag :color="serviceStatusColor(order.service.status)">{{ serviceStatusText(order.service.status) }}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="剩余天数">
                  {{ order.service.daysRemaining == null ? '-' : `${order.service.daysRemaining} 天` }}
                </Descriptions.Item>
                <Descriptions.Item label="用户">
                  {{ order.userInfo?.displayName || order.userInfo?.username || '-' }}
                </Descriptions.Item>
                <Descriptions.Item label="推广人手机号">{{ order.promoterPhone || '-' }}</Descriptions.Item>
                <Descriptions.Item label="推广人信息">{{ order.promoterUserInfo?.displayName || order.promoterUserInfo?.username || order.promoterUserInfo?.phone || '-' }}</Descriptions.Item>
                <Descriptions.Item label="签约状态">
                  <Tag :color="order.userInfo?.contractStatus === 'signed' ? 'success' : 'default'">
                    {{ order.userInfo?.contractStatus === 'signed' ? '已签约' : '未签约' }}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="景点类型">{{ order.sceneSpotCategoryName || '-' }}</Descriptions.Item>
                <Descriptions.Item label="景点面积">{{ order.scenicArea ?? '-' }}</Descriptions.Item>
                <Descriptions.Item label="联系电话">{{ order.contactPhone }}</Descriptions.Item>
                <Descriptions.Item label="商务电话">{{ order.contactPhoneForBusiness || '-' }}</Descriptions.Item>
                <Descriptions.Item label="交付场景">{{ order.delivery.sceneSpotTitle || '-' }}</Descriptions.Item>
                <Descriptions.Item label="交付绑定时间">{{ order.delivery.boundAt || '-' }}</Descriptions.Item>
                <Descriptions.Item label="服务开始">{{ order.service.startAt || '-' }}</Descriptions.Item>
                <Descriptions.Item label="服务结束">{{ order.service.endAt || '-' }}</Descriptions.Item>
                <Descriptions.Item label="续费次数">{{ order.renewalCount }}</Descriptions.Item>
                <Descriptions.Item label="最近续费">{{ order.lastRenewedAt || '-' }}</Descriptions.Item>
                <Descriptions.Item label="地址" :span="2">{{ order.addressText }}</Descriptions.Item>
                <Descriptions.Item label="特殊景观" :span="2">{{ specialLandscapeText(order.specialLandscapeTags) }}</Descriptions.Item>
                <Descriptions.Item label="分享链接" :span="2">
                  <div class="break-all">{{ order.share.miniProgramPath || '-' }}</div>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Tabs.TabPane>

          <Tabs.TabPane key="operation" tab="流程操作">
            <Card size="small" title="主流程操作">
              <Space wrap>
                <Button
                  type="primary"
                  :disabled="order.topStage !== 'signing'"
                  :loading="submitting"
                  @click="confirmAction('确认签约完成并进入制作阶段吗？', signOrder)"
                >签约完成</Button>
                <Button
                  :disabled="order.topStage !== 'production'"
                  :loading="submitting"
                  @click="confirmAction('确认推进到下一个制作节点吗？', advanceProduction)"
                >推进制作节点</Button>
                <Button
                  :disabled="order.topStage !== 'production'"
                  :loading="submitting"
                  @click="confirmAction('确认制作完成并进入发布阶段吗？', completeProduction)"
                >制作完成</Button>
                <Button
                  :disabled="order.topStage !== 'publish'"
                  :loading="submitting"
                  @click="confirmAction('确认内容发布已经完成吗？', completePublish)"
                >发布完成</Button>
                <Button
                  type="primary"
                  :disabled="order.topStage !== 'publish' || !order.publishedAt"
                  :loading="submitting"
                  @click="confirmAction('确认开启运营并开始计算服务周期吗？', completeOperation)"
                >进入运营</Button>
              </Space>

              <div class="mt-4 grid gap-3 md:grid-cols-2">
                <Input v-model:value="productionRemark" :disabled="order.topStage !== 'production'" placeholder="推进制作节点时可附带备注" />
                <div class="text-text-secondary text-sm">
                  当前节点：{{ currentProductionNode?.label || '无进行中节点' }}
                </div>
              </div>
            </Card>
          </Tabs.TabPane>

          <Tabs.TabPane key="service" tab="交付与服务">
            <Card size="small" title="交付与服务维护">
              <div class="grid gap-4 md:grid-cols-2">
                <div>
                  <div class="mb-2 text-sm font-medium">绑定交付场景</div>
                  <Select
                    v-model:value="selectedSceneSpotId"
                    class="w-full"
                    :options="sceneSpotOptions"
                    placeholder="请选择交付场景"
                    show-search
                  />
                </div>
                <div>
                  <div class="mb-2 text-sm font-medium">商务联系电话</div>
                  <Input v-model:value="contactDraft" placeholder="商务联系电话" />
                </div>
                <div>
                  <div class="mb-2 text-sm font-medium">推广人手机号</div>
                  <Input v-model:value="promoterPhoneDraft" placeholder="推广人手机号" />
                </div>
                <div>
                  <div class="mb-2 text-sm font-medium">服务时长(天)</div>
                  <InputNumber v-model:value="serviceDurationDaysDraft" class="w-full" :min="1" />
                </div>
                <div>
                  <div class="mb-2 text-sm font-medium">服务价格</div>
                  <InputNumber v-model:value="servicePriceDraft" class="w-full" :min="0" />
                </div>
                <div>
                  <div class="mb-2 text-sm font-medium">续费提醒天数</div>
                  <InputNumber v-model:value="renewalWarningDaysDraft" class="w-full" :min="1" />
                </div>
                <div>
                  <div class="mb-2 text-sm font-medium">订单备注</div>
                  <Input v-model:value="notesDraft" placeholder="订单备注" />
                </div>
                <div>
                  <div class="mb-2 text-sm font-medium">服务开始时间</div>
                  <DatePicker
                    :value="serviceStartDraft ? dayjs(serviceStartDraft) : undefined"
                    class="w-full"
                    show-time
                    @update:value="serviceStartDraft = $event && typeof $event !== 'string' ? $event.toISOString() : null"
                  />
                </div>
                <div>
                  <div class="mb-2 text-sm font-medium">服务结束时间</div>
                  <DatePicker
                    :value="serviceEndDraft ? dayjs(serviceEndDraft) : undefined"
                    class="w-full"
                    show-time
                    @update:value="serviceEndDraft = $event && typeof $event !== 'string' ? $event.toISOString() : null"
                  />
                </div>
              </div>
              <div class="mt-4">
                <Button type="primary" :loading="submitting" @click="saveAdminFields">保存配置</Button>
              </div>
            </Card>
          </Tabs.TabPane>

          <Tabs.TabPane key="production" tab="生产进度">
            <Card size="small" title="生产时间线">
              <Timeline>
                <Timeline.Item
                  v-for="item in order.productionProgress"
                  :key="item.code"
                  :color="productionStatusColor(item.status)"
                >
                  <div class="font-medium">{{ item.label }}</div>
                  <div class="text-text-secondary">状态：{{ item.status === 'completed' ? '已完成' : item.status === 'active' ? '进行中' : '待开始' }}</div>
                  <div v-if="item.activatedAt" class="text-text-secondary">时间：{{ item.activatedAt }}</div>
                  <div v-if="item.remark" class="text-text-secondary">备注：{{ item.remark }}</div>
                </Timeline.Item>
              </Timeline>
            </Card>
          </Tabs.TabPane>

          <Tabs.TabPane key="renewal" tab="续费记录">
            <Card size="small" title="续费记录">
              <Empty v-if="!order.renewalHistory.length" description="暂无续费记录" />
              <Table
                v-else
                :columns="[
                  { title: '续费单号', dataIndex: 'orderNumber', key: 'orderNumber' },
                  { title: '续费周期', dataIndex: 'window', key: 'window' },
                  { title: '时长(天)', dataIndex: 'durationDays', key: 'durationDays' },
                  { title: '金额', dataIndex: 'price', key: 'price' },
                  { title: '支付状态', dataIndex: 'paymentStatus', key: 'paymentStatus' },
                  { title: '状态', dataIndex: 'serviceStatus', key: 'serviceStatus' },
                  { title: '审批时间', dataIndex: 'approvedAt', key: 'approvedAt' },
                  { title: '操作', dataIndex: 'actions', key: 'actions' },
                ]"
                :data-source="order.renewalHistory.map((item) => ({ ...item, key: item.id, window: `${item.serviceStartAt || '-'} ~ ${item.serviceEndAt || '-'}` }))"
                :pagination="false"
                size="small"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'paymentStatus'">
                    <Tag :color="paymentStatusColor(record.paymentStatus)">{{ paymentStatusText(record.paymentStatus) }}</Tag>
                  </template>
                  <template v-if="column.key === 'serviceStatus'">
                    <Tag :color="serviceStatusColor(record.serviceStatus)">{{ serviceStatusText(record.serviceStatus) }}</Tag>
                  </template>
                  <template v-else-if="column.key === 'actions'">
                    <Button
                      v-if="!record.approvedAt"
                      size="small"
                      type="primary"
                      :loading="submitting"
                      @click="confirmAction('确认让该续费订单生效吗？', () => approveRenewal(record.id))"
                    >审批生效</Button>
                    <span v-else>-</span>
                  </template>
                </template>
              </Table>

              <div v-if="pendingRenewals.length" class="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">
                当前有 {{ pendingRenewals.length }} 笔待审批续费订单，审批后主订单服务时间会顺延。
              </div>
            </Card>
          </Tabs.TabPane>

          <Tabs.TabPane key="analytics" tab="运营数据">
            <Card size="small" title="运营数据">
              <Spin :spinning="analyticsLoading">
                <Empty v-if="!order.analyticsAvailable" description="订单未进入可分析状态，或尚未绑定交付场景" />
                <template v-else-if="analytics">
                  <Card size="small" title="筛选条件" class="mb-4">
                    <div class="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                      <div>
                        <div class="mb-2 text-sm font-medium">开始日期</div>
                        <DatePicker
                          :value="analyticsStartDraft ? dayjs(analyticsStartDraft) : undefined"
                          class="w-full"
                          placeholder="选择开始日期"
                          @update:value="analyticsStartDraft = $event && typeof $event !== 'string' ? $event.toISOString() : null"
                        />
                      </div>
                      <div>
                        <div class="mb-2 text-sm font-medium">结束日期</div>
                        <DatePicker
                          :value="analyticsEndDraft ? dayjs(analyticsEndDraft) : undefined"
                          class="w-full"
                          placeholder="选择结束日期"
                          @update:value="analyticsEndDraft = $event && typeof $event !== 'string' ? $event.toISOString() : null"
                        />
                      </div>
                      <div>
                        <div class="mb-2 text-sm font-medium">时间粒度</div>
                        <Select v-model:value="analyticsGranularityDraft" class="w-full" :options="analyticsGranularityOptions" />
                      </div>
                      <div>
                        <div class="mb-2 text-sm font-medium">分析指标</div>
                        <Select v-model:value="analyticsMetricDraft" class="w-full" :options="analyticsMetricOptions" />
                      </div>
                      <div>
                        <div class="mb-2 text-sm font-medium">分组维度</div>
                        <Select v-model:value="analyticsDimensionDraft" class="w-full" :options="analyticsDimensionOptions" />
                      </div>
                      <div>
                        <div class="mb-2 text-sm font-medium">Top N</div>
                        <Select v-model:value="analyticsLimitDraft" class="w-full" :options="analyticsLimitOptions" />
                      </div>
                    </div>
                    <div class="mt-4 flex flex-wrap items-center gap-2">
                      <Button type="primary" :loading="analyticsLoading" @click="reloadAnalytics">查询</Button>
                      <Button :disabled="analyticsLoading" @click="resetAnalyticsFilters">重置</Button>
                      <Tag color="blue">当前粒度：{{ analyticsGranularityLabel(analyticsGranularityDraft) }}</Tag>
                      <Tag color="green">当前指标：{{ analyticsMetricLabel(analyticsMetricDraft) }}</Tag>
                      <Tag color="purple">当前维度：{{ analyticsDimensionLabel(analyticsDimensionDraft) }}</Tag>
                      <Tag color="gold">Top {{ analyticsLimitDraft }}</Tag>
                    </div>
                  </Card>

                  <div class="grid gap-4 md:grid-cols-4">
                    <Card size="small">
                      <div class="text-sm text-slate-500">累计用户数</div>
                      <div class="mt-2 text-2xl font-semibold text-slate-900">{{ analytics.overview.totalUv }}</div>
                    </Card>
                    <Card size="small">
                      <div class="text-sm text-slate-500">日访问人数</div>
                      <div class="mt-2 text-2xl font-semibold text-slate-900">{{ analytics.overview.todayUv }}</div>
                    </Card>
                    <Card size="small">
                      <div class="text-sm text-slate-500">日新增用户</div>
                      <div class="mt-2 text-2xl font-semibold text-slate-900">{{ analytics.overview.todayNewUsers }}</div>
                    </Card>
                    <Card size="small">
                      <div class="text-sm text-slate-500">打卡总数</div>
                      <div class="mt-2 text-2xl font-semibold text-slate-900">{{ analytics.overview.totalPunchCount }}</div>
                    </Card>
                  </div>

                  <div class="mt-4 grid gap-4 lg:grid-cols-2">
                    <Card size="small" title="访问趋势">
                      <div class="h-[320px]">
                        <EchartsUI ref="trendChartRef" />
                      </div>
                    </Card>
                    <Card size="small" title="打卡点统计">
                      <div class="h-[320px]">
                        <EchartsUI ref="breakdownChartRef" />
                      </div>
                    </Card>
                  </div>
                </template>
              </Spin>
            </Card>
          </Tabs.TabPane>
        </Tabs>
      </Card>
    </Spin>
  </div>
</template>

