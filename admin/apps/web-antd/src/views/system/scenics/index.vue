<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue'

import { ref, reactive, computed, onMounted } from 'vue'
import { useVbenVxeGrid } from '#/adapter/vxe-table'
import {
  listScenicsApi,
  getScenicApi,
  createScenicApi,
  updateScenicApi,
  deleteScenicApi,
  buildScenicDownloadUrl,
} from '#/api'
import { Button, Form, Input, message, Modal, Space, Upload } from 'ant-design-vue'
// Removed dependency on @ant-design/icons-vue to avoid build resolution issues

const modalOpen = ref(false)
const submitting = ref(false)
const editingId = ref<null | string>(null)
const formRef = ref<FormInstance>()

const formModel = reactive({
  name: '',
  description: '',
  metadata: '',
})

const fileList = ref<any[]>([])

const modalTitle = computed(() => (editingId.value ? '编辑场景' : '新增场景'))

function resetForm() {
  formModel.name = ''
  formModel.description = ''
  formModel.metadata = ''
  fileList.value = []
}

function openCreateModal() {
  editingId.value = null
  resetForm()
  modalOpen.value = true
}

async function openEditModal(row: any) {
  editingId.value = row.id
  try {
    const data = await getScenicApi(row.id)
    formModel.name = data.name || ''
    formModel.description = data.description || ''
    formModel.metadata = JSON.stringify(data.metadata ?? {}, null, 2)
    fileList.value = []
    modalOpen.value = true
  } catch (err) {
    message.error('读取场景信息失败')
  }
}

async function submitForm() {
  const form = formRef.value
  if (!form) return
  await form.validate()
  submitting.value = true
  try {
    const fd = new FormData()
    fd.append('name', formModel.name.trim())
    if (formModel.description) fd.append('description', formModel.description.trim())
    try {
      const parsed = formModel.metadata ? JSON.parse(formModel.metadata) : undefined
      if (parsed !== undefined) fd.append('metadata', JSON.stringify(parsed))
    } catch (err) {
      message.error('metadata 必须是合法的 JSON')
      submitting.value = false
      return
    }
    if (fileList.value.length) {
      const file = fileList.value[0].originFileObj || fileList.value[0]
      fd.append('file', file)
    }

    if (editingId.value) {
      await updateScenicApi(editingId.value, fd)
      message.success('场景更新成功')
    } else {
      await createScenicApi(fd)
      message.success('场景创建成功')
    }
    modalOpen.value = false
    gridApi.reload()
  } catch (err) {
    // noop
  } finally {
    submitting.value = false
  }
}

function handleDelete(row: any) {
  Modal.confirm({
    title: `确认删除场景 “${row.name}” 吗？`,
    content: '删除后不可恢复。',
    okType: 'danger',
    onOk: async () => {
      await deleteScenicApi(row.id)
      message.success('场景已删除')
      gridApi.reload()
    },
  })
}

const [GridComp, gridApi] = useVbenVxeGrid({
  formOptions: {
    schema: [
      { component: 'Input', fieldName: 'keyword', label: '关键字', componentProps: { allowClear: true, placeholder: '名称' } },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 200, title: '名称' },
      { field: 'fileUrl', minWidth: 260, title: '文件地址', slots: { default: 'fileUrl' } },
      { field: 'createdAt', minWidth: 180, formatter: 'formatDateTime', title: '创建时间' },
      { align: 'left', fixed: 'right', minWidth: 220, field: 'actions', slots: { default: 'actions' }, title: '操作' },
    ],
    keepSource: true,
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          const params = {
            keyword: formValues.keyword,
            page: page.currentPage,
            pageSize: page.pageSize,
          }
          return await listScenicsApi(params)
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
  tableTitle: '场景管理',
})

onMounted(() => {
  // no-op
})
</script>

<template>
  <div class="p-5">
    <GridComp>
      <template #toolbar-actions>
        <Button v-access:code="'scenic:write'" type="primary" @click="openCreateModal">新增场景</Button>
      </template>

      <template #fileUrl="{ row }">
        <a :href="buildScenicDownloadUrl(row.id)" target="_blank">下载</a>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'scenic:write'" size="small" type="link" @click="openEditModal(row)">编辑</Button>
          <Button v-access:code="'scenic:write'" danger size="small" type="link" @click="handleDelete(row)">删除</Button>
        </Space>
      </template>
    </GridComp>

    <Modal :open="modalOpen" :confirm-loading="submitting" :title="modalTitle" ok-text="保存" cancel-text="取消" destroy-on-close @cancel="() => (modalOpen = false)" @ok="submitForm">
      <Form ref="formRef" :label-col="{ span: 6 }" :model="formModel" :wrapper-col="{ span: 17 }">
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入名称' }]">
          <Input v-model:value="formModel.name" placeholder="场景名称" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input v-model:value="formModel.description" placeholder="场景描述" />
        </Form.Item>
        <Form.Item label="场景包">
          <Upload :file-list="fileList" :before-upload="(file) => (fileList.length = 0, fileList.push(file), false)" :max-count="1">
            <Button>上传文件</Button>
          </Upload>
        </Form.Item>
        <Form.Item label="metadata (JSON)">
          <Input.TextArea v-model:value="formModel.metadata" rows="6" placeholder='{"tags": ["tag1"]}' />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
