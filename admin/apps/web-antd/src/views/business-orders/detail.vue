<script setup lang="ts">
import type { BusinessOrderAnalyticsItem, BusinessOrderItem } from '#/api';

import dayjs from 'dayjs';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  advanceBusinessOrderProductionApi,
  approveBusinessOrderRenewalApi,
  bindBusinessOrderDeliveryApi,
  completeBusinessOrderOperationApi,
  completeBusinessOrderProductionApi,
  completeBusinessOrderPublishApi,
  getBusinessOrderAnalyticsApi,
  getBusinessOrderApi,
  signBusinessOrderApi,
  updateBusinessOrderApi,
} from '#/api';
import { listSceneSpotsApi } from '#/api/core/scene-spots';

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
const notesDraft = ref('');
const contactDraft = ref('');
const productionRemark = ref('');
const serviceDurationDaysDraft = ref<number>(365);
const servicePriceDraft = ref<number>(0);
const renewalWarningDaysDraft = ref<number>(15);
const serviceStartDraft = ref<string | null>(null);
const serviceEndDraft = ref<string | null>(null);
const selectedSceneSpotId = ref<string | undefined>(undefined);
const sceneSpotOptions = ref<Array<{ label: string; value: string }>>([]);

const currentProductionNode = computed(() => order.value?.productionProgress.find((item) => item.status === 'active') || null);
const pendingRenewals = computed(() => (order.value?.renewalHistory || []).filter((item) => !item.approvedAt));

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
    analytics.value = await getBusinessOrderAnalyticsApi(id);
  } catch (error) {
    message.warning((error as Error)?.message || '加载订单运营数据失败');
  } finally {
    analyticsLoading.value = false;
  }
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

async function bindDeliveryScene() {
  const id = String(route.params.id || '');
  if (!selectedSceneSpotId.value) {
    message.warning('请选择交付场景');
    return;
  }
  await withSubmit(async () => {
    await bindBusinessOrderDeliveryApi(id, { sceneSpotId: selectedSceneSpotId.value! });
    message.success('交付场景已绑定');
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

onMounted(async () => {
  await loadSceneSpotOptions();
  await loadOrder();
});
</script>

<template>
  <div class="p-5">
    <Spin :spinning="loading">
      <Card v-if="order" title="商业订单详情">
        <div class="mb-4 flex items-center justify-between gap-3">
          <div>
            <div class="text-lg font-semibold">{{ order.scenicName }}</div>
            <div class="text-text-secondary mt-1">{{ order.orderNumber }}</div>
          </div>
          <Button @click="router.back()">返回</Button>
        </div>

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
          <Descriptions.Item label="特殊景观" :span="2">{{ order.specialLandscapeTags.join('、') || '-' }}</Descriptions.Item>
          <Descriptions.Item label="分享链接" :span="2">
            <div class="break-all">{{ order.share.miniProgramPath || '-' }}</div>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card v-if="order" class="mt-4" title="主流程操作">
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
            @click="confirmAction('确认推进到下一制作节点吗？', advanceProduction)"
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

      <Card v-if="order" class="mt-4" title="交付与服务维护">
        <div class="grid gap-4 md:grid-cols-2">
          <div>
            <div class="mb-2 text-sm font-medium">绑定交付场景</div>
            <Space.Compact class="w-full">
              <Select
                v-model:value="selectedSceneSpotId"
                class="w-full"
                :options="sceneSpotOptions"
                placeholder="请选择交付场景"
                show-search
              />
              <Button :loading="submitting" type="primary" @click="bindDeliveryScene">绑定</Button>
            </Space.Compact>
          </div>
          <div>
            <div class="mb-2 text-sm font-medium">商务联系电话</div>
            <Input v-model:value="contactDraft" placeholder="商务联系电话" />
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

      <Card v-if="order" class="mt-4" title="制作时间线">
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

      <Card v-if="order" class="mt-4" title="续费记录">
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

      <Card v-if="order" class="mt-4" title="运营数据">
        <Spin :spinning="analyticsLoading">
          <Empty v-if="!order.analyticsAvailable" description="订单未进入可分析状态，或尚未绑定交付场景" />
          <template v-else-if="analytics">
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
                <Table
                  :columns="[
                    { title: '日期', dataIndex: 'date', key: 'date' },
                    { title: 'PV', dataIndex: 'pv', key: 'pv' },
                    { title: 'UV', dataIndex: 'uv', key: 'uv' },
                    { title: '新增', dataIndex: 'newUsers', key: 'newUsers' },
                  ]"
                  :data-source="analytics.visitTrend.map((item) => ({ ...item, key: item.date }))"
                  :pagination="{ pageSize: 7 }"
                  size="small"
                />
              </Card>
              <Card size="small" title="打卡点统计">
                <Table
                  :columns="[
                    { title: '打卡点', dataIndex: 'nodeName', key: 'nodeName' },
                    { title: '打卡次数', dataIndex: 'punchCount', key: 'punchCount' },
                    { title: '参与人数', dataIndex: 'userCount', key: 'userCount' },
                  ]"
                  :data-source="analytics.checkpointStats.map((item) => ({ ...item, key: `${item.nodeId}-${item.nodeName}` }))"
                  :pagination="{ pageSize: 6 }"
                  size="small"
                />
              </Card>
            </div>
          </template>
        </Spin>
      </Card>
    </Spin>
  </div>
</template>
