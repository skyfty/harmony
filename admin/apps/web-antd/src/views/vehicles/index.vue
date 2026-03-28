<script setup lang="ts">
import type { FormInstance, UploadFile, UploadProps } from 'ant-design-vue';
import type { VehicleItem } from '#/api';

import { computed, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createVehicleApi,
  deleteVehicleApi,
  getVehicleApi,
  listVehiclesApi,
  updateVehicleApi,
} from '#/api';

import {
  Button,
  Form,
  Input,
  message,
  Modal,
  Space,
  Switch,
  Upload,
  Tooltip,
} from 'ant-design-vue';
import { EditOutlined, DeleteOutlined } from '@ant-design/icons-vue';
import { createResourceAssetApi } from '#/api/core/resources';

interface VehicleFormModel {
  identifier: string;
  name: string;
  description: string;
  coverUrl: string;
  isActive: boolean;
  isDefault: boolean;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const vehicleFormRef = ref<FormInstance>();

const vehicleFormModel = reactive<VehicleFormModel>({
  identifier: '',
  name: '',
  description: '',
  coverUrl: '',
  isActive: true,
  isDefault: false,
});

const imageFileList = ref<UploadFile[]>([]);
const imagePreview = ref('');

const imageUploadProps: UploadProps = {
  beforeUpload: () => false,
  maxCount: 1,
  accept: 'image/*',
};

const modalTitle = computed(() => (editingId.value ? '编辑车辆' : '新增车辆'));

function resetForm() {
  vehicleFormModel.identifier = '';
  vehicleFormModel.name = '';
  vehicleFormModel.description = '';
  vehicleFormModel.coverUrl = '';
  vehicleFormModel.isActive = true;
  vehicleFormModel.isDefault = false;
  imageFileList.value = [];
  imagePreview.value = '';
}

function openCreateModal() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

async function openEditModal(row: VehicleItem) {
  editingId.value = row.id;
  try {
    const data = await getVehicleApi(row.id);
    vehicleFormModel.identifier = data.identifier || '';
    vehicleFormModel.name = data.name || '';
    vehicleFormModel.description = data.description || '';
    vehicleFormModel.coverUrl = data.coverUrl || '';
    vehicleFormModel.isActive = data.isActive !== false;
    vehicleFormModel.isDefault = data.isDefault !== false;
    imageFileList.value = [];
    imagePreview.value = data.coverUrl || '';
    modalOpen.value = true;
  } catch {
    message.error('读取车辆信息失败');
  }
}

async function uploadImageIfNeeded() {
  if (!imageFileList.value.length) {
    return vehicleFormModel.coverUrl;
  }
  const origin = (imageFileList.value[0] as any).originFileObj as File;
  if (!origin) {
    return vehicleFormModel.coverUrl;
  }
  const fd = new FormData();
  fd.append('file', origin);
  const res = await createResourceAssetApi(fd);
  return res?.asset?.previewUrl || res?.asset?.thumbnailUrl || res?.asset?.url || vehicleFormModel.coverUrl;
}

async function submitVehicle() {
  const form = vehicleFormRef.value;
  if (!form) return;
  await form.validate();
  submitting.value = true;
  try {
    const coverUrl = await uploadImageIfNeeded();
    const payload = {
      identifier: vehicleFormModel.identifier.trim(),
      name: vehicleFormModel.name.trim(),
      description: vehicleFormModel.description.trim(),
      coverUrl: coverUrl || '',
      isActive: vehicleFormModel.isActive,
      isDefault: vehicleFormModel.isDefault,
    };
    if (editingId.value) {
      await updateVehicleApi(editingId.value, payload);
      message.success('车辆更新成功');
    } else {
      await createVehicleApi(payload);
      message.success('车辆创建成功');
    }
    modalOpen.value = false;
    vehicleGridApi.reload();
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: VehicleItem) {
  Modal.confirm({
    title: `确认删除车辆 “${row.name}” 吗？`,
    content: '删除后会同时下线对应商品并删除用户车辆关系。',
    okType: 'danger',
    onOk: async () => {
      await deleteVehicleApi(row.id);
      message.success('车辆已删除');
      vehicleGridApi.reload();
    },
  });
}

const [VehicleGrid, vehicleGridApi] = useVbenVxeGrid<VehicleItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: { allowClear: true, placeholder: '标识符/名称/描述' },
      },
      {
        component: 'Select',
        fieldName: 'isActive',
        label: '状态',
        componentProps: {
          allowClear: true,
          options: [
            { label: '启用', value: true },
            { label: '禁用', value: false },
          ],
          placeholder: '全部状态',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'identifier', minWidth: 180, title: '标识符' },
      { field: 'name', minWidth: 180, title: '名称' },
      { field: 'coverUrl', minWidth: 120, title: '图片', slots: { default: 'image' } },
      { field: 'description', minWidth: 260, title: '描述' },
      { field: 'isActive', minWidth: 110, title: '状态', slots: { default: 'status' } },
      { field: 'isDefault', minWidth: 110, title: '默认', slots: { default: 'default' } },
      { field: 'createdAt', minWidth: 180, formatter: 'formatDateTime', title: '创建时间' },
      { field: 'updatedAt', minWidth: 180, formatter: 'formatDateTime', title: '更新时间' },
      { align: 'left', fixed: 'right', minWidth: 160, field: 'actions', slots: { default: 'actions' }, title: '操作' },
    ],
    keepSource: true,
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          return await listVehiclesApi({
            keyword: formValues.keyword || undefined,
            isActive: formValues.isActive,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
});
</script>

<template>
  <div class="p-5">
    <VehicleGrid>
      <template #toolbar-actions>
        <Button v-access:code="'vehicle:write'" type="primary" @click="openCreateModal">新增车辆</Button>
      </template>

      <template #image="{ row }">
        <img
          v-if="row.coverUrl"
          :src="row.coverUrl"
          alt="vehicle"
          style="width: 56px; height: 56px; object-fit: cover; border-radius: 8px"
        />
        <span v-else>-</span>
      </template>

      <template #status="{ row }">
        <span :style="{ color: row.isActive ? '#16a34a' : '#9ca3af' }">{{ row.isActive ? '启用' : '禁用' }}</span>
      </template>

      <template #default="{ row }">
        <span :style="{ color: row.isDefault ? '#2563eb' : '#9ca3af' }">{{ row.isDefault ? '默认' : '非默认' }}</span>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="编辑">
            <Button v-access:code="'vehicle:write'" size="small" type="text" @click="openEditModal(row)">
              <EditOutlined />
            </Button>
          </Tooltip>

          <Tooltip title="删除">
            <Button v-access:code="'vehicle:write'" danger size="small" type="text" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </VehicleGrid>

    <Modal
      :open="modalOpen"
      :confirm-loading="submitting"
      :title="modalTitle"
      ok-text="保存"
      cancel-text="取消"
      destroy-on-close
      @cancel="() => (modalOpen = false)"
      @ok="submitVehicle"
    >
      <Form ref="vehicleFormRef" :label-col="{ span: 6 }" :model="vehicleFormModel" :wrapper-col="{ span: 17 }">
        <Form.Item label="标识符" name="identifier" :rules="[{ required: true, message: '请输入唯一标识符' }]">
          <Input v-model:value="vehicleFormModel.identifier" placeholder="如：car-001 或 1001" />
        </Form.Item>
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入名称' }]">
          <Input v-model:value="vehicleFormModel.name" placeholder="如：观光车、跑车" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea v-model:value="vehicleFormModel.description" placeholder="用于 tour 展示" rows="4" />
        </Form.Item>
        <Form.Item label="商品联动">
          <span>保存后会自动创建/更新关联商品，并归类到“交通工具”</span>
        </Form.Item>
        <Form.Item label="图片上传">
          <Upload v-bind="imageUploadProps" v-model:file-list="imageFileList" list-type="picture-card">
            <div>上传</div>
          </Upload>
        </Form.Item>
        <Form.Item v-if="imagePreview" label="当前图片">
          <img
            :src="imagePreview"
            alt="preview"
            style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px"
          />
        </Form.Item>
        <Form.Item label="启用" name="isActive">
          <Switch v-model:checked="vehicleFormModel.isActive" />
        </Form.Item>
        <Form.Item label="默认" name="isDefault">
          <Switch v-model:checked="vehicleFormModel.isDefault" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
