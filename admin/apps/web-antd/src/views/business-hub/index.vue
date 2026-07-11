<script setup lang="ts">
import dayjs from 'dayjs';
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  createBusinessHubProjectApi,
  getBusinessHubDashboardApi,
  listBusinessHubProjectsApi,
  type BusinessHubDashboard,
  type BusinessHubProjectListItem,
} from '#/api';

import { Button, Card, Input, Modal, Select, Space, Table, Tag, message } from 'ant-design-vue';

const router = useRouter();
const loading = ref(false);
const dashboardLoading = ref(false);
const dashboard = ref<BusinessHubDashboard | null>(null);
const items = ref<BusinessHubProjectListItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const createOpen = ref(false);
const createSubmitting = ref(false);
const filters = reactive({
  keyword: '',
  stage: '' as '' | 'lead' | 'quote' | 'signing' | 'production' | 'publish' | 'operation',
  status: '' as '' | 'active' | 'paused' | 'completed' | 'archived',
  serviceStatus: '' as '' | 'pending' | 'active' | 'expiring' | 'expired',
});
const createForm = reactive({
  title: '',
  customerName: '',
  customerPhone: '',
  sourceChannel: '',
  summary: '',
  notes: '',
});

const stageOptions = [
  { label: '潜在', value: 'lead' },
  { label: '报价', value: 'quote' },
  { label: '签约', value: 'signing' },
  { label: '制作', value: 'production' },
  { label: '发布', value: 'publish' },
  { label: '运营', value: 'operation' },
];

const statusOptions = [
  { label: '激活', value: 'active' },
  { label: '暂停', value: 'paused' },
  { label: '完成', value: 'completed' },
  { label: '归档', value: 'archived' },
];

const serviceStatusOptions = [
  { label: '待生效', value: 'pending' },
  { label: '服务中', value: 'active' },
  { label: '即将到期', value: 'expiring' },
  { label: '已到期', value: 'expired' },
];

const summaryCards = [
  { key: 'totalProjects', label: '项目总数', tone: 'text-slate-900' },
  { key: 'activeProjects', label: '活跃项目', tone: 'text-emerald-600' },
  { key: 'expiringProjects', label: '即将到期', tone: 'text-amber-600' },
  { key: 'openReminders', label: '未关闭提醒', tone: 'text-rose-600' },
] as const;

async function loadDashboard() {
  dashboardLoading.value = true;
  try {
    dashboard.value = await getBusinessHubDashboardApi();
  } catch {
    message.error('加载商业看板失败');
  } finally {
    dashboardLoading.value = false;
  }
}

async function loadProjects() {
  loading.value = true;
  try {
    const response = await listBusinessHubProjectsApi({
      keyword: filters.keyword || undefined,
      stage: filters.stage || undefined,
      status: filters.status || undefined,
      serviceStatus: filters.serviceStatus || undefined,
      page: page.value,
      pageSize: pageSize.value,
    });
    items.value = response.items;
    total.value = response.total;
    page.value = response.page;
    pageSize.value = response.pageSize;
  } catch {
    message.error('加载商业项目失败');
  } finally {
    loading.value = false;
  }
}

async function reloadAll() {
  await Promise.all([loadDashboard(), loadProjects()]);
}

function openDetail(id: string) {
  router.push({ name: 'BusinessHubDetail', params: { id } });
}

function openCreate() {
  createOpen.value = true;
}

function resetCreateForm() {
  createForm.title = '';
  createForm.customerName = '';
  createForm.customerPhone = '';
  createForm.sourceChannel = '';
  createForm.summary = '';
  createForm.notes = '';
}

async function submitCreate() {
  if (createSubmitting.value) {
    return;
  }
  if (!createForm.title.trim()) {
    message.warning('请输入项目名称');
    return;
  }
  if (!createForm.customerName.trim()) {
    message.warning('请输入客户名称');
    return;
  }
  if (!createForm.customerPhone.trim()) {
    message.warning('请输入客户电话');
    return;
  }
  createSubmitting.value = true;
  try {
    const created = await createBusinessHubProjectApi({
      title: createForm.title.trim(),
      customerName: createForm.customerName.trim(),
      customerPhone: createForm.customerPhone.trim(),
      sourceChannel: createForm.sourceChannel.trim() || undefined,
      summary: createForm.summary.trim() || undefined,
      notes: createForm.notes.trim() || undefined,
    });
    message.success('商业项目已创建');
    createOpen.value = false;
    resetCreateForm();
    await reloadAll();
    openDetail(created.id);
  } catch (error) {
    message.error((error as Error)?.message || '创建失败');
  } finally {
    createSubmitting.value = false;
  }
}

function formatDate(value: string | null) {
  if (!value) {
    return '-';
  }
  const d = dayjs(value);
  return d.isValid() ? d.format('YYYY-MM-DD') : value;
}

function stageText(stage: string) {
  const found = stageOptions.find((item) => item.value === stage);
  return found?.label || stage;
}

function statusText(status: string) {
  const found = statusOptions.find((item) => item.value === status);
  return found?.label || status;
}

function serviceStatusText(status: string) {
  const found = serviceStatusOptions.find((item) => item.value === status);
  return found?.label || status;
}

function serviceStatusColor(status: string) {
  if (status === 'active') return 'success';
  if (status === 'expiring') return 'warning';
  if (status === 'expired') return 'error';
  return 'default';
}

function stageColor(stage: string) {
  if (stage === 'operation') return 'green';
  if (stage === 'production') return 'blue';
  if (stage === 'publish') return 'purple';
  if (stage === 'signing') return 'gold';
  return 'default';
}

function queryProjects() {
  page.value = 1;
  void reloadAll();
}

function handleTableChange(pagination: { current?: number; pageSize?: number }) {
  page.value = pagination.current || 1;
  pageSize.value = pagination.pageSize || 20;
  void loadProjects();
}

onMounted(() => {
  void reloadAll();
});
</script>

<template>
  <div class="p-5">
    <Card class="mb-4" :loading="dashboardLoading" title="商业协作台">
      <div class="grid gap-4 md:grid-cols-4">
        <Card v-for="card in summaryCards" :key="card.key" size="small">
          <div class="text-sm text-slate-500">{{ card.label }}</div>
          <div class="mt-2 text-2xl font-semibold" :class="card.tone">{{ dashboard?.[card.key] ?? 0 }}</div>
        </Card>
      </div>
      <div class="mt-4 grid gap-4 md:grid-cols-4">
        <Card size="small">
          <div class="text-sm text-slate-500">提醒总数</div>
          <div class="mt-2 text-xl font-semibold text-rose-600">{{ dashboard?.openReminders ?? 0 }}</div>
        </Card>
        <Card size="small">
          <div class="text-sm text-slate-500">待审批</div>
          <div class="mt-2 text-xl font-semibold text-amber-600">{{ dashboard?.pendingApprovals ?? 0 }}</div>
        </Card>
        <Card size="small">
          <div class="text-sm text-slate-500">待办任务</div>
          <div class="mt-2 text-xl font-semibold text-slate-900">{{ dashboard?.todoTasks ?? 0 }}</div>
        </Card>
        <Card size="small">
          <div class="text-sm text-slate-500">续费记录</div>
          <div class="mt-2 text-xl font-semibold text-sky-600">{{ dashboard?.totalRenewals ?? 0 }}</div>
        </Card>
      </div>
    </Card>

    <Card class="mb-4" title="项目筛选">
      <Space wrap>
        <Input v-model:value="filters.keyword" allow-clear placeholder="项目名 / 客户 / 电话 / 编号" style="width: 240px" />
        <Select v-model:value="filters.stage" allow-clear :options="stageOptions" placeholder="阶段" style="width: 140px" />
        <Select v-model:value="filters.status" allow-clear :options="statusOptions" placeholder="状态" style="width: 140px" />
        <Select v-model:value="filters.serviceStatus" allow-clear :options="serviceStatusOptions" placeholder="服务状态" style="width: 160px" />
        <Button type="primary" @click="queryProjects">查询</Button>
        <Button @click="openCreate">新建项目</Button>
      </Space>
    </Card>

    <Card title="商业项目列表">
      <Table
        row-key="id"
        :columns="[
          { title: '项目编号', dataIndex: 'projectNumber', key: 'projectNumber', width: 190 },
          { title: '项目名称', dataIndex: 'title', key: 'title', width: 200 },
          { title: '客户', dataIndex: 'customerName', key: 'customerName', width: 140 },
          { title: '阶段', dataIndex: 'stage', key: 'stage', width: 110, slots: { customRender: 'stage' } },
          { title: '服务状态', dataIndex: 'serviceStatus', key: 'serviceStatus', width: 120, slots: { customRender: 'serviceStatus' } },
          { title: '交付场景', dataIndex: 'deliverySceneSpotTitle', key: 'deliverySceneSpotTitle', width: 180 },
          { title: '待办', dataIndex: 'todoTaskCount', key: 'todoTaskCount', width: 90 },
          { title: '提醒', dataIndex: 'openReminderCount', key: 'openReminderCount', width: 90 },
          { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 150, customRender: ({ text }: { text: string }) => formatDate(text) },
          { title: '操作', key: 'actions', width: 90, fixed: 'right', slots: { customRender: 'actions' } },
        ]"
        :data-source="items"
        :loading="loading"
        :pagination="{ current: page, pageSize, total, showSizeChanger: true }"
        :scroll="{ x: 1200 }"
        @change="handleTableChange"
      >
        <template #stage="{ text }">
          <Tag :color="stageColor(text)">{{ stageText(text) }}</Tag>
        </template>
        <template #serviceStatus="{ text }">
          <Tag :color="serviceStatusColor(text)">{{ serviceStatusText(text) }}</Tag>
        </template>
        <template #actions="{ record }">
          <Button type="link" size="small" @click="openDetail(record.id)">详情</Button>
        </template>
      </Table>
    </Card>

    <Modal
      v-model:open="createOpen"
      title="新建商业项目"
      :confirm-loading="createSubmitting"
      ok-text="创建"
      cancel-text="取消"
      @ok="submitCreate"
      @cancel="resetCreateForm"
    >
      <div class="grid gap-3">
        <Input v-model:value="createForm.title" placeholder="项目名称" />
        <Input v-model:value="createForm.customerName" placeholder="客户名称" />
        <Input v-model:value="createForm.customerPhone" placeholder="客户电话" />
        <Input v-model:value="createForm.sourceChannel" placeholder="来源渠道" />
        <Input v-model:value="createForm.summary" placeholder="项目摘要" />
        <Input v-model:value="createForm.notes" placeholder="备注" />
      </div>
    </Modal>
  </div>
</template>
