<script setup lang="ts">
import type { FormInstance, UploadFile, UploadProps } from 'ant-design-vue';

import { onMounted, reactive, ref, watch } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createMedalApi,
  deleteMedalApi,
  getMedalApi,
  listMedalsApi,
  updateMedalApi,
  type MedalRuleItem,
  type MedalRuleType,
} from '#/api/core/medals';
import { createResourceAssetApi } from '#/api/core/resources';
import { listSceneSpotsApi, type SceneSpotItem } from '#/api/core/scene-spots';

import {
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Upload,
} from 'ant-design-vue';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons-vue';

type ScenicRuleScope = 'any_scenic' | 'specific_scenic';
type SetCompleteType = 'enter_scenic' | 'punch_ratio_gte';

interface MedalRuleFormItem {
  type: MedalRuleType;
  scope: ScenicRuleScope;
  scenicId: string;
  scenicCount: number;
  conditionValue?: number;
  threshold: number;
  scenicIds: string[];
  completeType: SetCompleteType;
  completeValue?: number;
}

interface MedalFormModel {
  name: string;
  description: string;
  lockedIconUrl: string;
  unlockedIconUrl: string;
  enabled: boolean;
  sort: number;
  rules: MedalRuleFormItem[];
}

const ruleTypeOptions: Array<{ label: string; value: MedalRuleType }> = [
  { label: '进入景点', value: 'enter_scenic' },
  { label: '打卡比例', value: 'punch_ratio_gte' },
  { label: '累计进入次数', value: 'enter_count_gte' },
  { label: '累计打卡点数量', value: 'punch_count_gte' },
  { label: '指定景点集合完成', value: 'specific_scenic_set_complete' },
];

const scopeOptions = [
  { label: '任意景点', value: 'any_scenic' },
  { label: '指定景点', value: 'specific_scenic' },
];

const setCompleteTypeOptions = [
  { label: '进入景点', value: 'enter_scenic' },
  { label: '打卡比例', value: 'punch_ratio_gte' },
];

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const formRef = ref<FormInstance>();
const activeTab = ref<'basic' | 'rules'>('basic');

const formModel = reactive<MedalFormModel>({
  name: '',
  description: '',
  lockedIconUrl: '',
  unlockedIconUrl: '',
  enabled: true,
  sort: 0,
  rules: [],
});

const scenicOptions = ref<Array<{ label: string; value: string }>>([]);
const scenicNameById = ref<Record<string, string>>({});
const lockedFileList = ref<UploadFile[]>([]);
const unlockedFileList = ref<UploadFile[]>([]);
const lockedPreview = ref('');
const unlockedPreview = ref('');

const imageUploadProps: UploadProps = {
  beforeUpload: () => false,
  maxCount: 1,
  accept: 'image/*',
};

function resolveUploadPreview(fileList: UploadFile[], fallback = ''): string {
  const [file] = fileList;
  if (!file) {
    return fallback;
  }
  if (typeof file.thumbUrl === 'string' && file.thumbUrl) {
    return file.thumbUrl;
  }
  if (typeof file.url === 'string' && file.url) {
    return file.url;
  }
  const origin = (file as any).originFileObj as File | undefined;
  if (origin && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(origin);
  }
  return fallback;
}

function createDefaultRule(type: MedalRuleType = 'enter_scenic'): MedalRuleFormItem {
  return {
    type,
    scope: 'any_scenic',
    scenicId: '',
    scenicCount: 1,
    conditionValue: 100,
    threshold: 1,
    scenicIds: [],
    completeType: 'enter_scenic',
    completeValue: 100,
  };
}

function applyRuleTypeDefaults(rule: MedalRuleFormItem) {
  if (rule.type === 'enter_scenic' || rule.type === 'punch_ratio_gte') {
    if (rule.scope === 'specific_scenic') {
      rule.scenicCount = 1;
    }
    if (rule.type === 'enter_scenic') {
      rule.conditionValue = undefined;
    } else if (rule.conditionValue === undefined) {
      rule.conditionValue = 100;
    }
  }

  if (rule.type === 'enter_count_gte' || rule.type === 'punch_count_gte') {
    rule.threshold = Math.max(rule.threshold || 1, 1);
  }

  if (rule.type === 'specific_scenic_set_complete') {
    rule.completeType = rule.completeType || 'enter_scenic';
    if (rule.completeType === 'enter_scenic') {
      rule.completeValue = undefined;
    } else if (rule.completeValue === undefined) {
      rule.completeValue = 100;
    }
  }
}

function formatScenicNames(scenicIds: string[]): string {
  const names = scenicIds
    .map((id) => scenicNameById.value[id] || '未命名景点')
    .filter(Boolean);
  if (!names.length) {
    return '未选景点';
  }
  if (names.length <= 2) {
    return names.join('、');
  }
  return `${names.slice(0, 2).join('、')} 等 ${names.length} 个景点`;
}

function mapApiRuleToForm(rule: MedalRuleItem): MedalRuleFormItem {
  const params = (rule.params || {}) as Record<string, unknown>;
  switch (rule.type) {
    case 'enter_scenic':
    case 'punch_ratio_gte':
      return {
        ...createDefaultRule(rule.type),
        scope: params.scope === 'specific_scenic' ? 'specific_scenic' : 'any_scenic',
        scenicId: typeof params.scenicId === 'string' ? params.scenicId : '',
        scenicCount: Number(params.scenicCount || 1),
        conditionValue: typeof params.conditionValue === 'number' ? params.conditionValue : 100,
      };
    case 'enter_count_gte':
    case 'punch_count_gte':
      return {
        ...createDefaultRule(rule.type),
        threshold: Number(params.threshold || 1),
      };
    case 'specific_scenic_set_complete':
      return {
        ...createDefaultRule(rule.type),
        scenicIds: Array.isArray(params.scenicIds) ? params.scenicIds.map((item) => String(item)) : [],
        completeType: params.completeType === 'punch_ratio_gte' ? 'punch_ratio_gte' : 'enter_scenic',
        completeValue: typeof params.completeValue === 'number' ? params.completeValue : 100,
      };
    default:
      return createDefaultRule();
  }
}

function mapFormRuleToApi(rule: MedalRuleFormItem): MedalRuleItem {
  switch (rule.type) {
    case 'enter_scenic':
      return {
        type: rule.type,
        params: {
          scope: rule.scope,
          scenicId: rule.scope === 'specific_scenic' ? rule.scenicId || null : null,
          scenicCount: rule.scope === 'specific_scenic' ? 1 : Math.max(rule.scenicCount || 1, 1),
          conditionValue: null,
        },
      };
    case 'punch_ratio_gte':
      return {
        type: rule.type,
        params: {
          scope: rule.scope,
          scenicId: rule.scope === 'specific_scenic' ? rule.scenicId || null : null,
          scenicCount: rule.scope === 'specific_scenic' ? 1 : Math.max(rule.scenicCount || 1, 1),
          conditionValue: Math.max(0, Math.min(100, Number(rule.conditionValue || 0))),
        },
      };
    case 'enter_count_gte':
    case 'punch_count_gte':
      return {
        type: rule.type,
        params: {
          threshold: Math.max(1, Number(rule.threshold || 1)),
        },
      };
    case 'specific_scenic_set_complete':
      return {
        type: rule.type,
        params: {
          scenicIds: rule.scenicIds,
          completeType: rule.completeType,
          completeValue: rule.completeType === 'punch_ratio_gte'
            ? Math.max(0, Math.min(100, Number(rule.completeValue || 0)))
            : null,
        },
      };
    default:
      return {
        type: 'enter_scenic',
        params: { scope: 'any_scenic', scenicCount: 1, conditionValue: null },
      };
  }
}

function ruleSummary(rule: MedalRuleFormItem) {
  switch (rule.type) {
    case 'enter_scenic':
      return rule.scope === 'specific_scenic'
        ? `进入 ${scenicNameById.value[rule.scenicId] || '指定景点'}`
        : `进入任意 ${rule.scenicCount} 个景点`;
    case 'punch_ratio_gte':
      return rule.scope === 'specific_scenic'
        ? `${scenicNameById.value[rule.scenicId] || '指定景点'} 打卡比例 >= ${rule.conditionValue || 0}%`
        : `任意 ${rule.scenicCount} 个景点打卡比例 >= ${rule.conditionValue || 0}%`;
    case 'enter_count_gte':
      return `累计进入次数 >= ${rule.threshold}`;
    case 'punch_count_gte':
      return `累计打卡点数量 >= ${rule.threshold}`;
    case 'specific_scenic_set_complete':
      return `${formatScenicNames(rule.scenicIds)}${rule.completeType === 'punch_ratio_gte' ? ` 打卡比例 >= ${rule.completeValue || 0}%` : ' 全部进入'}`;
    default:
      return '-';
  }
}

function validateRules(): string | null {
  if (!formModel.rules.length) {
    return '至少需要一条规则';
  }

  for (const [index, rule] of formModel.rules.entries()) {
    const order = index + 1;
    if (rule.type === 'enter_scenic' || rule.type === 'punch_ratio_gte') {
      if (rule.scope === 'specific_scenic' && !rule.scenicId) {
        return `规则 ${order} 需要选择指定景点`;
      }
      if (rule.scope === 'any_scenic' && (!Number.isFinite(rule.scenicCount) || rule.scenicCount < 1)) {
        return `规则 ${order} 的景点数量必须大于等于 1`;
      }
      if (rule.type === 'punch_ratio_gte') {
        const value = Number(rule.conditionValue);
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          return `规则 ${order} 的打卡比例必须在 0 到 100 之间`;
        }
      }
    }

    if (rule.type === 'enter_count_gte' || rule.type === 'punch_count_gte') {
      if (!Number.isFinite(rule.threshold) || rule.threshold < 1) {
        return `规则 ${order} 的阈值必须大于等于 1`;
      }
    }

    if (rule.type === 'specific_scenic_set_complete') {
      if (!rule.scenicIds.length) {
        return `规则 ${order} 至少需要选择一个景点`;
      }
      if (rule.completeType === 'punch_ratio_gte') {
        const value = Number(rule.completeValue);
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          return `规则 ${order} 的集合打卡比例必须在 0 到 100 之间`;
        }
      }
    }
  }

  return null;
}

function resetForm() {
  activeTab.value = 'basic';
  formModel.name = '';
  formModel.description = '';
  formModel.lockedIconUrl = '';
  formModel.unlockedIconUrl = '';
  formModel.enabled = true;
  formModel.sort = 0;
  formModel.rules = [createDefaultRule()];
  lockedFileList.value = [];
  unlockedFileList.value = [];
  lockedPreview.value = '';
  unlockedPreview.value = '';
}

function addRule(type: MedalRuleType = 'enter_scenic') {
  formModel.rules.push(createDefaultRule(type));
}

function removeRule(index: number) {
  formModel.rules.splice(index, 1);
}

async function openCreateModal() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

async function openEditModal(row: any) {
  editingId.value = row.id;
  resetForm();
  try {
    const data = await getMedalApi(row.id);
    formModel.name = data.name || '';
    formModel.description = data.description || '';
    formModel.lockedIconUrl = data.lockedIconUrl || '';
    formModel.unlockedIconUrl = data.unlockedIconUrl || '';
    formModel.enabled = data.enabled !== false;
    formModel.sort = Number(data.sort || 0);
    formModel.rules = Array.isArray(data.rules) && data.rules.length
      ? data.rules.map(mapApiRuleToForm)
      : [createDefaultRule()];
    lockedPreview.value = formModel.lockedIconUrl;
    unlockedPreview.value = formModel.unlockedIconUrl;
    modalOpen.value = true;
  } catch {
    message.error('读取勋章失败');
  }
}

async function uploadSingleImage(fileList: UploadFile[], currentValue: string) {
  if (!fileList.length) {
    return currentValue;
  }
  const origin = (fileList[0] as any).originFileObj as File;
  if (!origin) {
    return currentValue;
  }
  const fd = new FormData();
  fd.append('file', origin);
  const res = await createResourceAssetApi(fd);
  return res?.asset?.previewUrl || res?.asset?.thumbnailUrl || res?.asset?.url || currentValue;
}

async function submit() {
  const form = formRef.value;
  if (!form) return;
  await form.validate();
  if (!formModel.lockedIconUrl && !lockedFileList.value.length) {
    activeTab.value = 'basic';
    message.error('请上传未获得图标');
    return;
  }
  if (!formModel.unlockedIconUrl && !unlockedFileList.value.length) {
    activeTab.value = 'basic';
    message.error('请上传已获得图标');
    return;
  }
  const ruleError = validateRules();
  if (ruleError) {
    activeTab.value = 'rules';
    message.error(ruleError);
    return;
  }

  submitting.value = true;
  try {
    const lockedIconUrl = await uploadSingleImage(lockedFileList.value, formModel.lockedIconUrl);
    const unlockedIconUrl = await uploadSingleImage(unlockedFileList.value, formModel.unlockedIconUrl);
    const payload = {
      name: formModel.name.trim(),
      description: formModel.description.trim() || undefined,
      lockedIconUrl: lockedIconUrl || undefined,
      unlockedIconUrl: unlockedIconUrl || undefined,
      enabled: formModel.enabled,
      sort: Number(formModel.sort || 0),
      rules: formModel.rules.map(mapFormRuleToApi),
    };
    if (editingId.value) {
      await updateMedalApi(editingId.value, payload);
      message.success('更新成功');
    } else {
      await createMedalApi(payload);
      message.success('创建成功');
    }
    modalOpen.value = false;
    medalGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: any) {
  Modal.confirm({
    title: `删除勋章：${row.name || ''}`,
    content: '确定删除吗？',
    okType: 'danger',
    onOk: async () => {
      await deleteMedalApi(row.id);
      message.success('删除成功');
      medalGridApi.reload();
    },
  });
}

const [MedalGrid, medalGridApi] = useVbenVxeGrid({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: { allowClear: true, placeholder: '勋章名称 / 描述' },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', title: '名称', minWidth: 180 },
      { field: 'lockedIconUrl', title: '图标', minWidth: 120, slots: { default: 'icon' } },
      { field: 'description', title: '描述', minWidth: 220 },
      { field: 'ruleCount', title: '规则数', minWidth: 90 },
      { field: 'enabled', title: '状态', minWidth: 90, slots: { default: 'enabled' } },
      { field: 'sort', title: '排序', minWidth: 80 },
      { field: 'createdAt', title: '创建时间', formatter: 'formatDateTime', minWidth: 160 },
      { align: 'left', fixed: 'right', minWidth: 160, field: 'actions', slots: { default: 'actions' }, title: '操作' },
    ],
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          return await listMedalsApi({
            keyword: formValues.keyword,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
  },
});

onMounted(() => {
  resetForm();
  void (async () => {
    try {
      const response = await listSceneSpotsApi({ page: 1, pageSize: 500 });
      const spots = (response.items || []) as SceneSpotItem[];
      scenicOptions.value = spots.map((item) => ({ label: item.title, value: item.id }));
      scenicNameById.value = spots.reduce(
        (acc, item) => ({ ...acc, [item.id]: item.title }),
        {} as Record<string, string>,
      );
    } catch {
      scenicOptions.value = [];
      scenicNameById.value = {};
    }
  })();
});

watch(
  lockedFileList,
  (next) => {
    lockedPreview.value = resolveUploadPreview(next, formModel.lockedIconUrl);
  },
  { deep: true },
);

watch(
  unlockedFileList,
  (next) => {
    unlockedPreview.value = resolveUploadPreview(next, formModel.unlockedIconUrl);
  },
  { deep: true },
);

watch(
  () => formModel.lockedIconUrl,
  (next) => {
    if (!lockedFileList.value.length) {
      lockedPreview.value = next || '';
    }
  },
);

watch(
  () => formModel.unlockedIconUrl,
  (next) => {
    if (!unlockedFileList.value.length) {
      unlockedPreview.value = next || '';
    }
  },
);
</script>

<template>
  <div class="p-5">
    <MedalGrid>
      <template #toolbar-actions>
        <Button v-access:code="'medal:write'" type="primary" @click="openCreateModal">创建勋章</Button>
      </template>

      <template #icon="{ row }">
        <img
          v-if="row.lockedIconUrl || row.unlockedIconUrl"
          :src="row.unlockedIconUrl || row.lockedIconUrl"
          alt="medal"
          style="width: 56px; height: 56px; object-fit: cover; border-radius: 12px"
        />
        <span v-else>-</span>
      </template>

      <template #enabled="{ row }">
        <Tag :color="row.enabled ? 'green' : 'default'">{{ row.enabled ? '启用' : '停用' }}</Tag>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="编辑">
            <Button v-access:code="'medal:write'" size="small" type="text" @click="openEditModal(row)">
              <EditOutlined />
            </Button>
          </Tooltip>
          <Tooltip title="删除">
            <Button v-access:code="'medal:write'" danger size="small" type="text" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </MedalGrid>

    <Modal
      v-model:open="modalOpen"
      :confirm-loading="submitting"
      :width="960"
      destroy-on-close
      title="勋章"
      @ok="submit"
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 4 }" :wrapper-col="{ span: 19 }">
        <Tabs v-model:activeKey="activeTab">
          <Tabs.TabPane key="basic" tab="基本字段">
            <Form.Item label="名称" name="name" :rules="[{ required: true, message: '名称为必填' }]">
              <Input v-model:value="formModel.name" />
            </Form.Item>
            <Form.Item label="描述" name="description">
              <Input.TextArea v-model:value="formModel.description" :rows="3" />
            </Form.Item>
            <Form.Item label="未获得图标">
              <Space align="start">
                <Upload v-model:file-list="lockedFileList" v-bind="imageUploadProps">
                  <Button>上传图标</Button>
                </Upload>
                <div class="flex flex-col gap-2">
                  <img
                    v-if="lockedPreview || formModel.lockedIconUrl"
                    :src="lockedPreview || formModel.lockedIconUrl"
                    alt="locked"
                    style="width: 64px; height: 64px; object-fit: cover; border-radius: 12px"
                  />
                  <span class="text-text-secondary text-xs">未获得时默认显示</span>
                </div>
              </Space>
            </Form.Item>
            <Form.Item label="已获得图标">
              <Space align="start">
                <Upload v-model:file-list="unlockedFileList" v-bind="imageUploadProps">
                  <Button>上传图标</Button>
                </Upload>
                <div class="flex flex-col gap-2">
                  <img
                    v-if="unlockedPreview || formModel.unlockedIconUrl"
                    :src="unlockedPreview || formModel.unlockedIconUrl"
                    alt="unlocked"
                    style="width: 64px; height: 64px; object-fit: cover; border-radius: 12px"
                  />
                  <span class="text-text-secondary text-xs">获得后高亮显示</span>
                </div>
              </Space>
            </Form.Item>
            <Form.Item label="启用状态">
              <Switch v-model:checked="formModel.enabled" />
            </Form.Item>
            <Form.Item label="排序">
              <InputNumber v-model:value="formModel.sort" :min="0" :precision="0" style="width: 160px" />
            </Form.Item>
          </Tabs.TabPane>

          <Tabs.TabPane key="rules" :tab="`规则列表（${formModel.rules.length}）`">

            <Form.Item>
              <div class="w-full flex flex-col gap-3">
                <div
                  v-for="(rule, index) in formModel.rules"
                  :key="`${rule.type}-${index}`"
                  class="w-full rounded border border-solid border-gray-200 p-4"
                >
                  <div class="mb-3 flex items-center justify-between gap-3">
                    <Space>
                      <span class="font-medium">规则 {{ index + 1 }}</span>
                      <Tag color="blue">{{ ruleSummary(rule) }}</Tag>
                    </Space>
                    <Button danger size="small" type="text" @click="removeRule(index)">删除</Button>
                  </div>


                  <div class="w-full flex flex-wrap items-end gap-3">
                    <div class="flex-1 min-w-0">
                      <div class="mb-1 text-text-secondary">规则类型</div>
                      <Select
                        v-model:value="rule.type"
                        :options="ruleTypeOptions"
                        @change="() => applyRuleTypeDefaults(rule)"
                      />
                    </div>

                    <template v-if="rule.type === 'enter_scenic' || rule.type === 'punch_ratio_gte'">
                      <div class="flex-1 min-w-0">
                        <div class="mb-1 text-text-secondary">景点范围</div>
                        <Select
                          v-model:value="rule.scope"
                          :options="scopeOptions"
                          @change="() => applyRuleTypeDefaults(rule)"
                        />
                      </div>
                      <div v-if="rule.scope === 'specific_scenic'" class="flex-[1.3] min-w-0">
                        <div class="mb-1 text-text-secondary">指定景点</div>
                        <Select v-model:value="rule.scenicId" :options="scenicOptions" show-search option-filter-prop="label" />
                      </div>
                      <div v-else class="flex-none w-[140px]">
                        <div class="mb-1 text-text-secondary">景点数量</div>
                        <InputNumber v-model:value="rule.scenicCount" :min="1" :precision="0" style="width: 100%" />
                      </div>
                      <div v-if="rule.type === 'punch_ratio_gte'" class="flex-none w-[160px]">
                        <div class="mb-1 text-text-secondary">打卡比例(%)</div>
                        <InputNumber v-model:value="rule.conditionValue" :min="0" :max="100" :precision="0" style="width: 100%" />
                      </div>
                    </template>

                    <template v-if="rule.type === 'enter_count_gte' || rule.type === 'punch_count_gte'">
                      <div class="flex-none w-[160px]">
                        <div class="mb-1 text-text-secondary">阈值</div>
                        <InputNumber v-model:value="rule.threshold" :min="1" :precision="0" style="width: 100%" />
                      </div>
                    </template>

                    <template v-if="rule.type === 'specific_scenic_set_complete'">
                      <div class="flex-[2] min-w-0">
                        <div class="mb-1 text-text-secondary">景点集合</div>
                        <Select
                          v-model:value="rule.scenicIds"
                          :options="scenicOptions"
                          mode="multiple"
                          show-search
                          option-filter-prop="label"
                        />
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="mb-1 text-text-secondary">完成条件</div>
                        <Select
                          v-model:value="rule.completeType"
                          :options="setCompleteTypeOptions"
                          @change="() => applyRuleTypeDefaults(rule)"
                        />
                      </div>
                      <div v-if="rule.completeType === 'punch_ratio_gte'" class="flex-none w-[160px]">
                        <div class="mb-1 text-text-secondary">打卡比例(%)</div>
                        <InputNumber v-model:value="rule.completeValue" :min="0" :max="100" :precision="0" style="width: 100%" />
                      </div>
                    </template>
                  </div>
                </div>

                <Button type="dashed" class="w-full" @click="addRule()">
                  <PlusOutlined />
                  添加规则
                </Button>
              </div>
            </Form.Item>
          </Tabs.TabPane>
        </Tabs>
      </Form>
    </Modal>
  </div>
</template>