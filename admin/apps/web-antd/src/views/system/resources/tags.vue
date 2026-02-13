<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { useVbenVxeGrid } from '#/adapter/vxe-table'
import {
  createResourceTagApi,
  deleteResourceTagApi,
  listResourceTagsApi,
  updateResourceTagApi,
} from '#/api'
import { Button, Form, Input, message, Modal, Space } from 'ant-design-vue'

interface TagFormModel {
  name: string
  description: string
}

const modalOpen = ref(false)
const submitting = ref(false)
const editingId = ref<null | string>(null)
const formRef = ref<FormInstance>()

const formModel = reactive<TagFormModel>({
  name: '',
  description: '',
})

const modalTitle = computed(() => (editingId.value ? '编辑标签' : '新增标签'))

function resetForm() {
  formModel.name = ''
  formModel.description = ''
}

function openCreate() {
  editingId.value = null
  resetForm()
  modalOpen.value = true
}

function openEdit(row: { id: string; name: string; description: string | null }) {
  editingId.value = row.id
  formModel.name = row.name
  formModel.description = row.description ?? ''
  modalOpen.value = true
}

async function submit() {
  const form = formRef.value
  if (!form) return
  await form.validate()
  submitting.value = true
  try {
    if (editingId.value) {
      await updateResourceTagApi(editingId.value, {
        name: formModel.name.trim(),
        description: formModel.description || null,
      })
      message.success('标签已更新')
    } else {
      await createResourceTagApi({ name: formModel.name.trim(), description: formModel.description || undefined })
      message.success('标签已创建')
    }
    modalOpen.value = false
    gridApi.reload()
  } finally {
    submitting.value = false
  }
}

function handleDelete(row: { id: string; name: string }) {
  Modal.confirm({
    title: `确认删除标签“${row.name}”吗？`,
    content: '删除后若有资源使用该标签会阻止删除。',
    okType: 'danger',
    onOk: async () => {
      await deleteResourceTagApi(row.id)
      message.success('标签已删除')
      gridApi.reload()
    },
  })
}

const [Grid, gridApi] = useVbenVxeGrid<any>({
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 220, title: '名称' },
      { field: 'description', minWidth: 320, title: '描述' },
      { field: 'createdAt', minWidth: 180, formatter: 'formatDateTime', title: '创建时间' },
      { field: 'updatedAt', minWidth: 180, formatter: 'formatDateTime', title: '更新时间' },
      { align: 'left', field: 'actions', fixed: 'right', minWidth: 160, slots: { default: 'actions' }, title: '操作' },
    ],
    proxyConfig: {
      ajax: {
        query: async () => {
          const list = await listResourceTagsApi()
          return { items: list || [], total: (list || []).length }
        },
      },
    },
    toolbarConfig: { refresh: true },
    pagerConfig: { pageSize: 50 },
  },
  tableTitle: '标签管理',
})

onMounted(() => {})
</script>

<template>
  <div class="p-5">
    <Grid>
      <template #toolbar-actions>
        <Button type="primary" @click="openCreate">新增标签</Button>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button size="small" type="link" @click="openEdit(row)">编辑</Button>
          <Button danger size="small" type="link" @click="handleDelete(row)">删除</Button>
        </Space>
      </template>
    </Grid>

    <Modal :open="modalOpen" :confirm-loading="submitting" :title="modalTitle" ok-text="保存" cancel-text="取消" @cancel="() => (modalOpen.value = false)" @ok="submit" destroy-on-close>
      <Form ref="formRef" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }" :model="formModel">
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入名称' }]">
          <Input v-model:value="formModel.name" allow-clear placeholder="请输入名称" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input v-model:value="formModel.description" allow-clear placeholder="可选描述" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
