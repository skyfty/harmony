<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue'
import { computed, reactive, ref } from 'vue'
import { useVbenVxeGrid } from '#/adapter/vxe-table'
import { listRulesApi, createRuleApi, getRuleApi, updateRuleApi, deleteRuleApi } from '#/api/core/rules'
import { Button, Form, Input, message, Modal, Space, Tooltip, Switch } from 'ant-design-vue'
import { EditOutlined, DeleteOutlined } from '@ant-design/icons-vue'

const modalOpen = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()

const formModel = reactive({ name: '', scenicId: '', enterScenic: false, viewPercentage: 0 })

function resetForm() {
  formModel.name = ''
  formModel.scenicId = ''
  formModel.enterScenic = false
  formModel.viewPercentage = 0
}

async function openCreateModal() {
  editingId.value = null
  resetForm()
  modalOpen.value = true
}

async function openEditModal(row: any) {
  editingId.value = row.id
  try {
    const data = await getRuleApi(row.id)
    formModel.name = data.name || ''
    formModel.scenicId = data.scenicId || ''
    formModel.enterScenic = !!data.enterScenic
    formModel.viewPercentage = data.viewPercentage ?? 0
    modalOpen.value = true
  } catch {
    message.error('读取规则失败')
  }
}

async function submit() {
  const form = formRef.value
  if (!form) return
  await form.validate()
  submitting.value = true
  try {
    const payload = { name: formModel.name.trim(), scenicId: formModel.scenicId || null, enterScenic: formModel.enterScenic, viewPercentage: formModel.viewPercentage }
    if (editingId.value) {
      await updateRuleApi(editingId.value, payload)
      message.success('更新成功')
    } else {
      await createRuleApi(payload)
      message.success('创建成功')
    }
    modalOpen.value = false
    gridApi.reload()
  } finally {
    submitting.value = false
  }
}

function handleDelete(row: any) {
  Modal.confirm({
    title: `删除规则：${row.name || ''}`,
    content: '确定删除吗？',
    okType: 'danger',
    onOk: async () => {
      await deleteRuleApi(row.id)
      message.success('删除成功')
      gridApi.reload()
    },
  })
}

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: { schema: [{ component: 'Input', fieldName: 'keyword', label: '关键字', componentProps: { allowClear: true } }] },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', title: '名称', minWidth: 200 },
      { field: 'scenicId', title: '景区', minWidth: 160 },
      { field: 'enterScenic', title: '进入景区', minWidth: 120 },
      { field: 'viewPercentage', title: '浏览百分比', minWidth: 120 },
      { align: 'left', fixed: 'right', minWidth: 160, field: 'actions', slots: { default: 'actions' }, title: '操作' },
    ],
    proxyConfig: { ajax: { query: async ({ page }: any, formValues: Record<string, any>) => await listRulesApi({ keyword: formValues.keyword, page: page.currentPage, pageSize: page.pageSize }) } },
    pagerConfig: { pageSize: 20 },
  },
})

const ruleGrid = Grid

</script>

<template>
  <div class="p-5">
    <ruleGrid>
      <template #toolbar-actions>
        <Button type="primary" @click="openCreateModal">创建规则</Button>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="编辑">
            <Button size="small" type="text" @click="openEditModal(row)">
              <EditOutlined />
            </Button>
          </Tooltip>
          <Tooltip title="删除">
            <Button danger size="small" type="text" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </ruleGrid>

    <Modal v-model:open="modalOpen" :confirm-loading="submitting" title="规则" @ok="submit" destroy-on-close>
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '名称为必填' }]">
          <Input v-model:value="formModel.name" />
        </Form.Item>
        <Form.Item label="景区 ID" name="scenicId">
          <Input v-model:value="formModel.scenicId" placeholder="留空表示任意景区" />
        </Form.Item>
        <Form.Item label="进入景区" name="enterScenic">
          <Switch v-model:checked="formModel.enterScenic" />
        </Form.Item>
        <Form.Item label="浏览百分比" name="viewPercentage">
          <Input v-model:value="formModel.viewPercentage" type="number" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
