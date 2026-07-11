<script setup lang="ts">
import dayjs from 'dayjs';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  advanceBusinessHubProductionApi,
  approveBusinessHubRenewalApi,
  bindBusinessHubDeliveryApi,
  blockBusinessHubTaskApi,
  closeBusinessHubReminderApi,
  completeBusinessHubTaskApi,
  completeBusinessHubOperationApi,
  completeBusinessHubProductionApi,
  completeBusinessHubPublishApi,
  createBusinessHubApprovalApi,
  createBusinessHubMaterialApi,
  createBusinessHubReminderApi,
  createBusinessHubRenewalApi,
  createBusinessHubTaskApi,
  decideBusinessHubApprovalApi,
  deleteBusinessHubMaterialApi,
  getBusinessHubProjectApi,
  signBusinessHubProjectApi,
  updateBusinessHubProjectApi,
  type BusinessHubProjectDetail,
  type BusinessHubTaskItem,
  type BusinessHubReminderItem,
  type BusinessHubMaterialItem,
  type BusinessHubApprovalItem,
  type BusinessHubRenewalItem,
} from '#/api';
import { listSceneSpotsApi, type SceneSpotItem } from '#/api/core/scene-spots';

import {
  Button,
  Card,
  DatePicker,
  Descriptions,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  message,
} from 'ant-design-vue';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const submitting = ref(false);
const project = ref<BusinessHubProjectDetail | null>(null);
const sceneSpotOptions = ref<Array<{ label: string; value: string }>>([]);
const selectedSceneSpotId = ref<string | undefined>(undefined);

const projectDraft = reactive({
  title: '',
  customerName: '',
  customerPhone: '',
  sourceChannel: '',
  summary: '',
  notes: '',
  serviceDurationDays: 365,
  servicePrice: 0,
  renewalWarningDays: 15,
  serviceStartAt: null as string | null,
  serviceEndAt: null as string | null,
  status: 'active' as 'active' | 'paused' | 'completed' | 'archived',
});

const taskForm = reactive({
  title: '',
  priority: 'medium' as 'low' | 'medium' | 'high',
  assignee: '',
  remark: '',
});

const reminderForm = reactive({
  kind: 'workflow-note' as BusinessHubReminderItem['kind'],
  title: '',
  message: '',
});

const materialForm = reactive({
  kind: 'copy' as BusinessHubMaterialItem['kind'],
  title: '',
  content: '',
  url: '',
  fileUrl: '',
});

const approvalForm = reactive({
  kind: 'custom' as BusinessHubApprovalItem['kind'],
  title: '',
  remark: '',
});

const renewalForm = reactive({
  durationDays: 365,
  price: 0,
  remark: '',
});

const projectId = computed(() => String(route.params.id || ''));

const taskCompletionRate = computed(() => {
  const tasks = project.value?.tasks || [];
  if (!tasks.length) return 0;
  const doneCount = tasks.filter((item) => item.status === 'done').length;
  return Math.round((doneCount / tasks.length) * 100);
});

const activeTask = computed(() => project.value?.tasks.find((item) => item.status === 'doing') || null);
const pendingApprovals = computed(() => (project.value?.approvals || []).filter((item) => item.status === 'pending'));

const stageOptions = [
  { label: '潜在', value: 'lead' },
  { label: '报价', value: 'quote' },
  { label: '签约', value: 'signing' },
  { label: '制作', value: 'production' },
  { label: '发布', value: 'publish' },
  { label: '运营', value: 'operation' },
];

const serviceStatusMap: Record<string, string> = {
  pending: '待生效',
  active: '服务中',
  expiring: '即将到期',
  expired: '已到期',
};

const materialKindMap: Record<BusinessHubMaterialItem['kind'], string> = {
  poster: '海报',
  qrcode: '二维码',
  copy: '文案',
  link: '链接',
  file: '文件',
};

const reminderKindMap: Record<BusinessHubReminderItem['kind'], string> = {
  'service-expiring': '到期提醒',
  'service-expired': '已到期提醒',
  'delivery-blocked': '交付阻塞',
  'workflow-note': '流程备注',
  custom: '自定义',
};

const approvalKindMap: Record<BusinessHubApprovalItem['kind'], string> = {
  quote: '报价',
  signing: '签约',
  delivery: '交付',
  publish: '发布',
  renewal: '续费',
  custom: '自定义',
};

async function loadSceneSpots() {
  const result = await listSceneSpotsApi({ page: 1, pageSize: 100 });
  sceneSpotOptions.value = (result.items || []).map((item: SceneSpotItem) => ({
    label: `${item.title} · ${item.sceneId}`,
    value: item.id,
  }));
}

async function loadProject() {
  const id = projectId.value;
  if (!id) {
    return;
  }
  loading.value = true;
  try {
    const response = await getBusinessHubProjectApi(id);
    project.value = response;
    projectDraft.title = response.title;
    projectDraft.customerName = response.customerName;
    projectDraft.customerPhone = response.customerPhone;
    projectDraft.sourceChannel = response.sourceChannel || '';
    projectDraft.summary = response.summary || '';
    projectDraft.notes = response.notes || '';
    projectDraft.serviceDurationDays = response.serviceDurationDays;
    projectDraft.servicePrice = response.servicePrice;
    projectDraft.renewalWarningDays = response.renewalWarningDays;
    projectDraft.serviceStartAt = response.serviceStartAt;
    projectDraft.serviceEndAt = response.serviceEndAt;
    projectDraft.status = response.status;
    selectedSceneSpotId.value = response.delivery.sceneSpotId || undefined;
    renewalForm.durationDays = response.serviceDurationDays || 365;
    renewalForm.price = response.servicePrice || 0;
  } catch {
    message.error('加载商业项目失败');
  } finally {
    loading.value = false;
  }
}

function formatDate(value: string | null) {
  if (!value) return '-';
  const d = dayjs(value);
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : value;
}

function stageText(stage: string) {
  return stageOptions.find((item) => item.value === stage)?.label || stage;
}

function stageColor(stage: string) {
  if (stage === 'operation') return 'green';
  if (stage === 'production') return 'blue';
  if (stage === 'publish') return 'purple';
  if (stage === 'signing') return 'gold';
  return 'default';
}

function serviceStatusColor(status: string) {
  if (status === 'active') return 'success';
  if (status === 'expiring') return 'warning';
  if (status === 'expired') return 'error';
  return 'default';
}

function daysRemainingText() {
  if (!project.value) {
    return '-';
  }
  if (project.value.serviceStatus === 'pending') {
    return '待生效';
  }
  if (project.value.serviceStatus === 'expired') {
    return '已到期';
  }
  if (!project.value.serviceEndAt) {
    return '-';
  }
  const diff = dayjs(project.value.serviceEndAt).diff(dayjs(), 'day');
  return `${Math.max(diff, 0)} 天`;
}

function priorityColor(priority: string) {
  if (priority === 'high') return 'red';
  if (priority === 'medium') return 'gold';
  return 'blue';
}

function taskStatusText(status: string) {
  if (status === 'doing') return '进行中';
  if (status === 'done') return '已完成';
  if (status === 'blocked') return '阻塞';
  return '待开始';
}

function taskStatusColor(status: string) {
  if (status === 'doing') return 'processing';
  if (status === 'done') return 'success';
  if (status === 'blocked') return 'error';
  return 'default';
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

async function saveProject() {
  if (!projectId.value) return;
  await withSubmit(async () => {
    const response = await updateBusinessHubProjectApi(projectId.value, {
      title: projectDraft.title.trim(),
      customerName: projectDraft.customerName.trim(),
      customerPhone: projectDraft.customerPhone.trim(),
      sourceChannel: projectDraft.sourceChannel.trim() || null,
      summary: projectDraft.summary.trim() || null,
      notes: projectDraft.notes.trim() || null,
      serviceDurationDays: projectDraft.serviceDurationDays,
      servicePrice: projectDraft.servicePrice,
      renewalWarningDays: projectDraft.renewalWarningDays,
      serviceStartAt: projectDraft.serviceStartAt,
      serviceEndAt: projectDraft.serviceEndAt,
      status: projectDraft.status,
    });
    project.value = response;
    message.success('项目已更新');
  });
}

async function signProject() {
  if (!projectId.value) return;
  await withSubmit(async () => {
    project.value = await signBusinessHubProjectApi(projectId.value);
    message.success('项目已进入签约阶段');
  });
}

async function advanceProduction() {
  if (!projectId.value) return;
  await withSubmit(async () => {
    project.value = await advanceBusinessHubProductionApi(projectId.value, '推进制作节点');
    message.success('制作节点已推进');
  });
}

async function completeProduction() {
  if (!projectId.value) return;
  await withSubmit(async () => {
    project.value = await completeBusinessHubProductionApi(projectId.value);
    message.success('制作已完成');
  });
}

async function completePublish() {
  if (!projectId.value) return;
  await withSubmit(async () => {
    project.value = await completeBusinessHubPublishApi(projectId.value);
    message.success('发布已完成');
  });
}

async function completeOperation() {
  if (!projectId.value) return;
  await withSubmit(async () => {
    project.value = await completeBusinessHubOperationApi(projectId.value);
    message.success('已进入运营阶段');
  });
}

async function bindDelivery() {
  if (!projectId.value || !selectedSceneSpotId.value) {
    message.warning('请选择交付场景');
    return;
  }
  await withSubmit(async () => {
    project.value = await bindBusinessHubDeliveryApi(projectId.value, { sceneSpotId: selectedSceneSpotId.value! });
    message.success('交付场景已绑定');
  });
}

async function addTask() {
  if (!projectId.value) return;
  if (!taskForm.title.trim()) {
    message.warning('请输入任务名称');
    return;
  }
  await withSubmit(async () => {
    project.value = await createBusinessHubTaskApi(projectId.value, {
      title: taskForm.title.trim(),
      priority: taskForm.priority,
      assignee: taskForm.assignee.trim() || null,
      remark: taskForm.remark.trim() || null,
    });
    taskForm.title = '';
    taskForm.assignee = '';
    taskForm.remark = '';
    taskForm.priority = 'medium';
    message.success('任务已添加');
  });
}

async function closeTask(task: BusinessHubTaskItem) {
  if (!task.id) return;
  await withSubmit(async () => {
    project.value = await blockBusinessHubTaskApi(task.id, '已阻塞');
    message.warning('任务已标记为阻塞');
  });
}

async function completeTask(task: BusinessHubTaskItem) {
  if (!task.id) return;
  await withSubmit(async () => {
    project.value = await completeBusinessHubTaskApi(task.id);
    message.success('任务已完成');
  });
}

async function addReminder() {
  if (!projectId.value) return;
  if (!reminderForm.title.trim()) {
    message.warning('请输入提醒标题');
    return;
  }
  await withSubmit(async () => {
    project.value = await createBusinessHubReminderApi(projectId.value, {
      kind: reminderForm.kind,
      title: reminderForm.title.trim(),
      message: reminderForm.message.trim() || null,
    });
    reminderForm.title = '';
    reminderForm.message = '';
    message.success('提醒已添加');
  });
}

async function closeReminder(reminder: BusinessHubReminderItem) {
  if (!reminder.id) return;
  await withSubmit(async () => {
    project.value = await closeBusinessHubReminderApi(reminder.id);
    message.success('提醒已关闭');
  });
}

async function addMaterial() {
  if (!projectId.value) return;
  if (!materialForm.title.trim()) {
    message.warning('请输入素材标题');
    return;
  }
  await withSubmit(async () => {
    project.value = await createBusinessHubMaterialApi(projectId.value, {
      kind: materialForm.kind,
      title: materialForm.title.trim(),
      content: materialForm.content.trim() || null,
      url: materialForm.url.trim() || null,
      fileUrl: materialForm.fileUrl.trim() || null,
    });
    materialForm.title = '';
    materialForm.content = '';
    materialForm.url = '';
    materialForm.fileUrl = '';
    message.success('素材已添加');
  });
}

async function removeMaterial(material: BusinessHubMaterialItem) {
  if (!material.id) return;
  await withSubmit(async () => {
    project.value = await deleteBusinessHubMaterialApi(material.id);
    message.success('素材已删除');
  });
}

async function addApproval() {
  if (!projectId.value) return;
  if (!approvalForm.title.trim()) {
    message.warning('请输入审批标题');
    return;
  }
  await withSubmit(async () => {
    project.value = await createBusinessHubApprovalApi(projectId.value, {
      kind: approvalForm.kind,
      title: approvalForm.title.trim(),
      remark: approvalForm.remark.trim() || null,
    });
    approvalForm.title = '';
    approvalForm.remark = '';
    approvalForm.kind = 'custom';
    message.success('审批已创建');
  });
}

async function decideApproval(approval: BusinessHubApprovalItem, status: 'approved' | 'rejected') {
  if (!approval.id) return;
  await withSubmit(async () => {
    project.value = await decideBusinessHubApprovalApi(approval.id, { status, remark: approval.remark || undefined });
    message.success(status === 'approved' ? '审批已通过' : '审批已驳回');
  });
}

async function addRenewal() {
  if (!projectId.value) return;
  await withSubmit(async () => {
    project.value = await createBusinessHubRenewalApi(projectId.value, {
      durationDays: renewalForm.durationDays,
      price: renewalForm.price,
      remark: renewalForm.remark.trim() || null,
    });
    renewalForm.remark = '';
    message.success('续费单已创建');
  });
}

async function approveRenewal(renewal: BusinessHubRenewalItem) {
  if (!renewal.id) return;
  await withSubmit(async () => {
    project.value = await approveBusinessHubRenewalApi(renewal.id);
    message.success('续费已生效');
  });
}

function goBack() {
  router.back();
}

onMounted(async () => {
  await Promise.all([loadSceneSpots(), loadProject()]);
});
</script>

<template>
  <div class="p-5">
    <Card v-if="project" :loading="loading" class="mb-4" title="商业项目详情">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div>
          <div class="text-2xl font-semibold text-slate-900">{{ project.title }}</div>
          <div class="mt-1 text-text-secondary">{{ project.projectNumber }}</div>
        </div>
        <Space>
          <Button @click="goBack">返回</Button>
          <Button type="primary" @click="saveProject">保存</Button>
        </Space>
      </div>

      <Descriptions bordered :column="2" size="small">
        <Descriptions.Item label="阶段">
          <Tag :color="stageColor(project.stage)">{{ stageText(project.stage) }}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="服务状态">
          <Tag :color="serviceStatusColor(project.serviceStatus)">{{ serviceStatusMap[project.serviceStatus] || project.serviceStatus }}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="客户名称">{{ project.customerName }}</Descriptions.Item>
        <Descriptions.Item label="客户电话">{{ project.customerPhone }}</Descriptions.Item>
        <Descriptions.Item label="服务周期">{{ formatDate(project.serviceStartAt) }} ~ {{ formatDate(project.serviceEndAt) }}</Descriptions.Item>
        <Descriptions.Item label="剩余天数">{{ daysRemainingText() }}</Descriptions.Item>
        <Descriptions.Item label="任务完成率">{{ taskCompletionRate }}%</Descriptions.Item>
        <Descriptions.Item label="待审批">{{ pendingApprovals.length }}</Descriptions.Item>
      </Descriptions>
    </Card>

    <Card v-if="project" class="mb-4" title="基础信息">
      <div class="grid gap-4 md:grid-cols-2">
        <Input v-model:value="projectDraft.title" placeholder="项目名称" />
        <Input v-model:value="projectDraft.customerName" placeholder="客户名称" />
        <Input v-model:value="projectDraft.customerPhone" placeholder="客户电话" />
        <Input v-model:value="projectDraft.sourceChannel" placeholder="来源渠道" />
        <Input v-model:value="projectDraft.summary" placeholder="项目摘要" />
        <Input v-model:value="projectDraft.notes" placeholder="备注" />
        <InputNumber v-model:value="projectDraft.serviceDurationDays" :min="1" class="w-full" placeholder="服务天数" />
        <InputNumber v-model:value="projectDraft.servicePrice" :min="0" class="w-full" placeholder="服务价格" />
        <InputNumber v-model:value="projectDraft.renewalWarningDays" :min="1" class="w-full" placeholder="提醒天数" />
        <Select v-model:value="projectDraft.status" :options="[
          { label: '激活', value: 'active' },
          { label: '暂停', value: 'paused' },
          { label: '完成', value: 'completed' },
          { label: '归档', value: 'archived' },
        ]" />
      </div>
      <div class="mt-4 grid gap-4 md:grid-cols-2">
        <DatePicker
          :value="projectDraft.serviceStartAt ? dayjs(projectDraft.serviceStartAt) : null"
          show-time
          class="w-full"
          @update:value="projectDraft.serviceStartAt = $event && typeof $event !== 'string' ? $event.toISOString() : null"
        />
        <DatePicker
          :value="projectDraft.serviceEndAt ? dayjs(projectDraft.serviceEndAt) : null"
          show-time
          class="w-full"
          @update:value="projectDraft.serviceEndAt = $event && typeof $event !== 'string' ? $event.toISOString() : null"
        />
      </div>
      <div class="mt-4">
        <Button type="primary" :loading="submitting" @click="saveProject">保存基础信息</Button>
      </div>
    </Card>

    <Card v-if="project" class="mb-4" title="流程推进">
      <Space wrap>
        <Button :disabled="project.stage !== 'quote'" :loading="submitting" type="primary" @click="signProject">签约完成</Button>
        <Button :disabled="project.stage !== 'production'" :loading="submitting" @click="advanceProduction">推进制作节点</Button>
        <Button :disabled="project.stage !== 'production'" :loading="submitting" @click="completeProduction">制作完成</Button>
        <Button :disabled="project.stage !== 'publish'" :loading="submitting" @click="completePublish">发布完成</Button>
        <Button :disabled="project.stage !== 'publish' || !project.delivery.sceneSpotId" :loading="submitting" type="primary" @click="completeOperation">进入运营</Button>
      </Space>
      <div class="mt-4 text-sm text-slate-500">当前活跃任务：{{ activeTask?.title || '暂无' }}</div>
    </Card>

    <Card v-if="project" class="mb-4" title="交付绑定">
      <Space.Compact class="w-full">
        <Select
          v-model:value="selectedSceneSpotId"
          class="w-full"
          :options="sceneSpotOptions"
          placeholder="请选择交付场景"
          show-search
        />
        <Button :loading="submitting" type="primary" @click="bindDelivery">绑定</Button>
      </Space.Compact>
      <div class="mt-3 text-sm text-slate-500">当前绑定：{{ project.delivery.sceneSpotTitle || '未绑定' }}</div>
    </Card>

    <Card v-if="project" class="mb-4" title="交付任务">
      <div class="grid gap-3 md:grid-cols-4">
        <Input v-model:value="taskForm.title" placeholder="任务名称" />
        <Select v-model:value="taskForm.priority" :options="[
          { label: '低', value: 'low' },
          { label: '中', value: 'medium' },
          { label: '高', value: 'high' },
        ]" />
        <Input v-model:value="taskForm.assignee" placeholder="负责人" />
        <Button :loading="submitting" type="primary" @click="addTask">添加任务</Button>
      </div>
      <Input v-model:value="taskForm.remark" class="mt-3" placeholder="任务备注" />
      <Table
        class="mt-4"
        row-key="id"
        :data-source="project.tasks"
        :pagination="false"
        :columns="[
          { title: '任务', dataIndex: 'title', key: 'title' },
          { title: '负责人', dataIndex: 'assignee', key: 'assignee' },
          { title: '优先级', dataIndex: 'priority', key: 'priority' },
          { title: '状态', dataIndex: 'status', key: 'status' },
          { title: '截止', dataIndex: 'dueAt', key: 'dueAt' },
          { title: '操作', key: 'actions' },
        ]"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'priority'">
            <Tag :color="priorityColor(record.priority)">{{ record.priority }}</Tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="taskStatusColor(record.status)">{{ taskStatusText(record.status) }}</Tag>
          </template>
          <template v-else-if="column.key === 'dueAt'">
            {{ formatDate(record.dueAt) }}
          </template>
          <template v-else-if="column.key === 'actions'">
            <Space>
              <Button size="small" type="link" @click="completeTask(record)">完成</Button>
              <Button size="small" type="link" @click="closeTask(record)">阻塞</Button>
            </Space>
          </template>
        </template>
      </Table>
    </Card>

    <Card v-if="project" class="mb-4" title="提醒中心">
      <div class="grid gap-3 md:grid-cols-3">
        <Select v-model:value="reminderForm.kind" :options="Object.entries(reminderKindMap).map(([value, label]) => ({ label, value }))" />
        <Input v-model:value="reminderForm.title" placeholder="提醒标题" />
        <Button :loading="submitting" type="primary" @click="addReminder">添加提醒</Button>
      </div>
      <Input v-model:value="reminderForm.message" class="mt-3" placeholder="提醒说明" />
      <Table
        class="mt-4"
        row-key="id"
        :data-source="project.reminders"
        :pagination="false"
        :columns="[
          { title: '类型', dataIndex: 'kind', key: 'kind' },
          { title: '标题', dataIndex: 'title', key: 'title' },
          { title: '状态', dataIndex: 'status', key: 'status' },
          { title: '到期', dataIndex: 'dueAt', key: 'dueAt' },
          { title: '操作', key: 'actions' },
        ]"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'kind'">
            {{ reminderKindMap[record.kind] || record.kind }}
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="record.status === 'closed' ? 'default' : 'warning'">{{ record.status === 'closed' ? '已关闭' : '未关闭' }}</Tag>
          </template>
          <template v-else-if="column.key === 'dueAt'">
            {{ formatDate(record.dueAt) }}
          </template>
          <template v-else-if="column.key === 'actions'">
            <Button size="small" type="link" :disabled="record.status === 'closed'" @click="closeReminder(record)">关闭</Button>
          </template>
        </template>
      </Table>
    </Card>

    <Card v-if="project" class="mb-4" title="素材中心">
      <div class="grid gap-3 md:grid-cols-4">
        <Select v-model:value="materialForm.kind" :options="Object.entries(materialKindMap).map(([value, label]) => ({ label, value }))" />
        <Input v-model:value="materialForm.title" placeholder="素材标题" />
        <Input v-model:value="materialForm.url" placeholder="素材链接" />
        <Button :loading="submitting" type="primary" @click="addMaterial">添加素材</Button>
      </div>
      <div class="mt-3 grid gap-3 md:grid-cols-2">
        <Input v-model:value="materialForm.content" placeholder="素材文案" />
        <Input v-model:value="materialForm.fileUrl" placeholder="文件地址" />
      </div>
      <Table
        class="mt-4"
        row-key="id"
        :data-source="project.materials"
        :pagination="false"
        :columns="[
          { title: '类型', dataIndex: 'kind', key: 'kind' },
          { title: '标题', dataIndex: 'title', key: 'title' },
          { title: '内容', dataIndex: 'content', key: 'content' },
          { title: '链接', dataIndex: 'url', key: 'url' },
          { title: '操作', key: 'actions' },
        ]"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'kind'">
            {{ materialKindMap[record.kind] || record.kind }}
          </template>
          <template v-else-if="column.key === 'url'">
            <span class="break-all">{{ record.url || record.fileUrl || '-' }}</span>
          </template>
          <template v-else-if="column.key === 'actions'">
            <Button size="small" type="link" danger @click="removeMaterial(record)">删除</Button>
          </template>
        </template>
      </Table>
    </Card>

    <Card v-if="project" class="mb-4" title="审批中心">
      <div class="grid gap-3 md:grid-cols-4">
        <Select v-model:value="approvalForm.kind" :options="Object.entries(approvalKindMap).map(([value, label]) => ({ label, value }))" />
        <Input v-model:value="approvalForm.title" placeholder="审批标题" />
        <Input v-model:value="approvalForm.remark" placeholder="备注" />
        <Button :loading="submitting" type="primary" @click="addApproval">添加审批</Button>
      </div>
      <Table
        class="mt-4"
        row-key="id"
        :data-source="project.approvals"
        :pagination="false"
        :columns="[
          { title: '类型', dataIndex: 'kind', key: 'kind' },
          { title: '标题', dataIndex: 'title', key: 'title' },
          { title: '状态', dataIndex: 'status', key: 'status' },
          { title: '决定时间', dataIndex: 'decidedAt', key: 'decidedAt' },
          { title: '操作', key: 'actions' },
        ]"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'kind'">
            {{ approvalKindMap[record.kind] || record.kind }}
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="record.status === 'approved' ? 'success' : record.status === 'rejected' ? 'error' : 'warning'">{{ record.status === 'approved' ? '已通过' : record.status === 'rejected' ? '已驳回' : '待审批' }}</Tag>
          </template>
          <template v-else-if="column.key === 'decidedAt'">
            {{ formatDate(record.decidedAt) }}
          </template>
          <template v-else-if="column.key === 'actions'">
            <Space v-if="record.status === 'pending'">
              <Button size="small" type="link" @click="decideApproval(record, 'approved')">通过</Button>
              <Button size="small" type="link" danger @click="decideApproval(record, 'rejected')">驳回</Button>
            </Space>
            <span v-else>-</span>
          </template>
        </template>
      </Table>
    </Card>

    <Card v-if="project" class="mb-4" title="续费中心">
      <div class="grid gap-3 md:grid-cols-4">
        <InputNumber v-model:value="renewalForm.durationDays" :min="1" class="w-full" placeholder="续费天数" />
        <InputNumber v-model:value="renewalForm.price" :min="0" class="w-full" placeholder="续费金额" />
        <Input v-model:value="renewalForm.remark" placeholder="备注" />
        <Button :loading="submitting" type="primary" @click="addRenewal">创建续费单</Button>
      </div>
      <Table
        class="mt-4"
        row-key="id"
        :data-source="project.renewals"
        :pagination="false"
        :columns="[
          { title: '续费单号', dataIndex: 'renewalNumber', key: 'renewalNumber' },
          { title: '周期', dataIndex: 'window', key: 'window' },
          { title: '金额', dataIndex: 'price', key: 'price' },
          { title: '状态', dataIndex: 'status', key: 'status' },
          { title: '操作', key: 'actions' },
        ]"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'window'">
            {{ formatDate(record.serviceStartAt) }} ~ {{ formatDate(record.serviceEndAt) }}
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="record.status === 'approved' ? 'success' : record.status === 'rejected' ? 'error' : 'warning'">{{ record.status === 'approved' ? '已生效' : record.status === 'rejected' ? '已驳回' : '待审批' }}</Tag>
          </template>
          <template v-else-if="column.key === 'actions'">
            <Button size="small" type="link" :disabled="record.status !== 'pending'" @click="approveRenewal(record)">审批生效</Button>
          </template>
        </template>
      </Table>
    </Card>

    <Card v-if="project" title="活动日志">
      <Timeline v-if="project.activityLogs.length">
        <Timeline.Item v-for="item in project.activityLogs" :key="item.id">
          <div class="font-medium">{{ item.content }}</div>
          <div class="text-text-secondary text-sm">{{ formatDate(item.createdAt) }} · {{ item.actorType }}</div>
        </Timeline.Item>
      </Timeline>
      <Empty v-else description="暂无活动日志" />
    </Card>

    <Card v-if="!project && !loading">
      <Empty description="商业项目不存在" />
    </Card>
  </div>
</template>
