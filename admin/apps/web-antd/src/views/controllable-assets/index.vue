<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { Button, Form, Input, InputNumber, message, Modal, Select, Space, Switch, Tooltip } from 'ant-design-vue'
import { EditOutlined, DeleteOutlined } from '@ant-design/icons-vue'
import { useVbenVxeGrid } from '#/adapter/vxe-table'
import {
  createControllableAssetApi,
  deleteControllableAssetApi,
  getControllableAssetApi,
  listControllableAssetsApi,
  type ControllableAssetItem,
  type ControllableAssetPayload,
  type ControllableType,
  updateControllableAssetApi,
} from '#/api'
import { listProductCategoriesApi } from '#/api'

const modalOpen = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()
const categoryOptions = ref<Array<{ label: string; value: string }>>([])

const typeOptions: Array<{ label: string; value: ControllableType }> = [
  { label: '车辆', value: 'vehicle' },
  { label: '人物', value: 'character' },
  { label: '船舶', value: 'ship' },
  { label: '飞行器', value: 'aircraft' },
]

const typeLabel = (value: ControllableType) => typeOptions.find((item) => item.value === value)?.label || value

type ControllableAssetFormModel = Omit<ControllableAssetPayload, 'prefabUrl' | 'categoryId'> & {
  prefabUrl: string
  categoryId: string
}

const formModel = reactive<ControllableAssetFormModel>({
  identifier: '',
  name: '',
  type: 'vehicle',
  sortOrder: 0,
  description: '',
  prefabUrl: '',
  isActive: true,
  isDefault: false,
  categoryId: '',
  runtimeConfig: null,
  metadata: null,
})

const modalTitle = computed(() => (editingId.value ? '编辑可控资产' : '新增可控资产'))

function resetForm() {
  Object.assign(formModel, {
    identifier: '',
    name: '',
    type: 'vehicle',
    sortOrder: 0,
    description: '',
    prefabUrl: '',
    isActive: true,
    isDefault: false,
    categoryId: '',
    runtimeConfig: null,
    metadata: null,
  })
}

function openCreate() {
  editingId.value = null
  resetForm()
  modalOpen.value = true
}

async function openEdit(row: ControllableAssetItem) {
  const item = await getControllableAssetApi(row.id)
  editingId.value = row.id
  Object.assign(formModel, {
    identifier: item.identifier,
    name: item.name,
    type: item.type,
    sortOrder: item.sortOrder,
    description: item.description,
    prefabUrl: item.prefabUrl ?? '',
    isActive: item.isActive !== false,
    isDefault: item.isDefault === true,
    categoryId: item.product?.categoryId ?? '',
    runtimeConfig: item.runtimeConfig ?? null,
    metadata: item.metadata ?? null,
  })
  modalOpen.value = true
}

async function submit() {
  if (!formRef.value) {
    return
  }
  await formRef.value.validate()
  submitting.value = true
  try {
    const payload: ControllableAssetPayload = {
      identifier: formModel.identifier.trim(),
      name: formModel.name.trim(),
      type: formModel.type,
      sortOrder: Number(formModel.sortOrder) || 0,
      description: formModel.description?.trim() || '',
      prefabUrl: formModel.prefabUrl?.trim() || '',
      isActive: formModel.isActive !== false,
      isDefault: formModel.isDefault === true,
      categoryId: formModel.categoryId || undefined,
      runtimeConfig: formModel.runtimeConfig ?? null,
      metadata: formModel.metadata ?? null,
    }
    if (editingId.value) {
      await updateControllableAssetApi(editingId.value, payload)
      message.success('可控资产已更新')
    } else {
      await createControllableAssetApi(payload)
      message.success('可控资产已创建')
    }
    modalOpen.value = false
    await gridApi.query()
  } finally {
    submitting.value = false
  }
}

function remove(row: ControllableAssetItem) {
  Modal.confirm({
    title: `确认删除“${row.name}”？`,
    content: '删除后会同时下线关联商品，请谨慎操作。',
    okType: 'danger',
    onOk: async () => {
      await deleteControllableAssetApi(row.id)
      message.success('删除成功')
      await gridApi.query()
    },
  })
}

const [AssetGrid, gridApi] = useVbenVxeGrid<ControllableAssetItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键词',
        componentProps: {
          allowClear: true,
          placeholder: '标识/名称/描述',
        },
      },
      {
        component: 'Select',
        fieldName: 'type',
        label: '类型',
        componentProps: {
          allowClear: true,
          options: typeOptions,
          placeholder: '全部类型',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'identifier', title: '标识', minWidth: 150 },
      { field: 'name', title: '名称', minWidth: 160 },
      {
        field: 'type',
        title: '类型',
        minWidth: 100,
        formatter: ({ cellValue }: { cellValue: ControllableType }) => typeLabel(cellValue),
      },
      { field: 'product.name', title: '关联商品', minWidth: 180 },
      { field: 'product.price', title: '价格', minWidth: 100 },
      { field: 'isDefault', title: '默认', minWidth: 90, slots: { default: 'isDefault' } },
      { field: 'isActive', title: '启用', minWidth: 90, slots: { default: 'isActive' } },
      { field: 'actions', title: '操作', fixed: 'right', minWidth: 150, slots: { default: 'actions' } },
    ],
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, values: Record<string, any>) => {
          return await listControllableAssetsApi({
            keyword: values.keyword || undefined,
            type: values.type || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          })
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
})

onMounted(async () => {
  try {
    const categories = await listProductCategoriesApi()
    categoryOptions.value = (categories || [])
      .filter((item) => item.enabled !== false)
      .map((item) => ({ label: item.name, value: item.id }))
  } catch {
    categoryOptions.value = []
  }
})
</script>

<template>
  <div class="p-5">
    <AssetGrid>
      <template #toolbar-actions>
        <Button v-access:code="'controllableAsset:write'" type="primary" @click="openCreate">新增可控资产</Button>
      </template>

      <template #isDefault="{ row }">
        <span :style="{ color: row.isDefault ? '#2563eb' : '#9ca3af' }">
          {{ row.isDefault ? '默认' : '非默认' }}
        </span>
      </template>

      <template #isActive="{ row }">
        <span :style="{ color: row.isActive ? '#16a34a' : '#9ca3af' }">
          {{ row.isActive ? '启用' : '停用' }}
        </span>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="编辑">
            <Button v-access:code="'controllableAsset:write'" size="small" type="text" @click="openEdit(row)">
              <EditOutlined />
            </Button>
          </Tooltip>

          <Tooltip title="删除">
            <Button v-access:code="'controllableAsset:write'" danger size="small" type="text" @click="remove(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </AssetGrid>

    <Modal
      :open="modalOpen"
      :title="modalTitle"
      :confirm-loading="submitting"
      ok-text="保存"
      cancel-text="取消"
      destroy-on-close
      :width="960"
      @cancel="() => (modalOpen = false)"
      @ok="submit"
    >
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item label="类型" name="type" :rules="[{ required: true, message: '请选择类型' }]">
          <Select v-model:value="formModel.type" :options="typeOptions" />
        </Form.Item>
        <Form.Item label="标识" name="identifier" :rules="[{ required: true, message: '请输入标识' }]">
          <Input v-model:value="formModel.identifier" />
        </Form.Item>
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入名称' }]">
          <Input v-model:value="formModel.name" />
        </Form.Item>
        <Form.Item label="排序">
          <InputNumber v-model:value="formModel.sortOrder" :min="0" style="width: 100%" />
        </Form.Item>
        <Form.Item label="商品分类">
          <Select v-model:value="formModel.categoryId" :options="categoryOptions" allow-clear />
        </Form.Item>
        <Form.Item label="Prefab URL">
          <Input v-model:value="formModel.prefabUrl" />
        </Form.Item>
        <Form.Item label="描述">
          <Input.TextArea v-model:value="formModel.description" :rows="4" />
        </Form.Item>
        <Form.Item label="默认使用">
          <Switch v-model:checked="formModel.isDefault" />
        </Form.Item>
        <Form.Item label="启用">
          <Switch v-model:checked="formModel.isActive" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
