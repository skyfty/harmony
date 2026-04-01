<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue'
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVbenVxeGrid } from '#/adapter/vxe-table'
import {
  listAchievementsApi,
  createAchievementApi,
  getAchievementApi,
  updateAchievementApi,
  deleteAchievementApi,
  listAchievementRulesApi,
  addRulesToAchievementApi,
  removeRuleFromAchievementApi,
} from '#/api/core/achievements'
import { listRulesApi } from '#/api/core/rules'
import { Button, Form, Input, message, Modal, Select, Space, Tooltip } from 'ant-design-vue'
import { EditOutlined, DeleteOutlined } from '@ant-design/icons-vue'

const { t } = useI18n()

const modalOpen = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()

const formModel = reactive({ name: '', description: '' })

function resetForm() {
  formModel.name = ''
  formModel.description = ''
}

async function openCreateModal() {
  editingId.value = null
  resetForm()
  modalOpen.value = true
}

async function openEditModal(row: any) {
  editingId.value = row.id
  try {
    const data = await getAchievementApi(row.id)
    formModel.name = data.name || ''
    formModel.description = data.description || ''
    modalOpen.value = true
  } catch {
    message.error('读取成就失败')
  }
}

async function submit() {
  const form = formRef.value
  if (!form) return
  await form.validate()
  submitting.value = true
  try {
    const payload = { name: formModel.name.trim(), description: formModel.description?.trim() }
    if (editingId.value) {
      await updateAchievementApi(editingId.value, payload)
      message.success('更新成功')
    } else {
      await createAchievementApi(payload)
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
    title: `删除成就：${row.name || row.title || ''}`,
    content: '确定删除吗？',
    okType: 'danger',
    onOk: async () => {
      await deleteAchievementApi(row.id)
      message.success('删除成功')
      gridApi.reload()
    },
  })
}

// Rules modal
const rulesModalOpen = ref(false)
const currentAchievementId = ref<string | null>(null)
const currentAchievementName = ref('')
const achievementRules = ref<any[]>([])
const availableRules = ref<any[]>([])
const selectedRuleIds = ref<string[]>([])

async function openRulesModal(row: any) {
  currentAchievementId.value = row.id
  currentAchievementName.value = row.name || ''
  rulesModalOpen.value = true
  await loadAchievementRules()
  await loadAvailableRules()
}

async function loadAchievementRules() {
  if (!currentAchievementId.value) return
  achievementRules.value = await listAchievementRulesApi(currentAchievementId.value)
}

async function loadAvailableRules() {
  try {
    const res = await listRulesApi({ page: 1, pageSize: 200 })
    availableRules.value = res.items
  } catch {
    availableRules.value = []
  }
}

async function addSelectedRules() {
  if (!currentAchievementId.value || !selectedRuleIds.value.length) return
  await addRulesToAchievementApi(currentAchievementId.value, selectedRuleIds.value)
  message.success('已添加规则')
  selectedRuleIds.value = []
  await loadAchievementRules()
}

async function removeRule(rule: any) {
  if (!currentAchievementId.value) return
  await removeRuleFromAchievementApi(currentAchievementId.value, rule.id)
  message.success('已删除')
  await loadAchievementRules()
}

const [Grid, gridApi] = useVbenVxeGrid({
  formOptions: { schema: [{ component: 'Input', fieldName: 'keyword', label: '关键字', componentProps: { allowClear: true } }] },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', title: '名称', minWidth: 200 },
      { field: 'description', title: '描述', minWidth: 300 },
      { field: 'createdAt', title: '创建时间', formatter: 'formatDateTime', minWidth: 160 },
      { align: 'left', fixed: 'right', minWidth: 220, field: 'actions', slots: { default: 'actions' }, title: '操作' },
    ],
    proxyConfig: { ajax: { query: async ({ page }: any, formValues: Record<string, any>) => await listAchievementsApi({ keyword: formValues.keyword, page: page.currentPage, pageSize: page.pageSize }) } },
    pagerConfig: { pageSize: 20 },
  },
})

const gridComponent = Grid

const gridApiRef = gridApi

// expose for template
const AchievementGrid = gridComponent

</script>

<template>
  <div class="p-5">
    <AchievementGrid>
      <template #toolbar-actions>
        <Button type="primary" @click="openCreateModal">创建成就</Button>
      </template>

      <template #actions="{ row }">
        <Space>
          <Tooltip title="编辑">
            <Button size="small" type="text" @click="openEditModal(row)">
              <EditOutlined />
            </Button>
          </Tooltip>
          <Tooltip title="管理规则">
            <Button size="small" type="text" @click="openRulesModal(row)">规则</Button>
          </Tooltip>
          <Tooltip title="删除">
            <Button danger size="small" type="text" @click="handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </AchievementGrid>

    <Modal v-model:open="modalOpen" :confirm-loading="submitting" title="成就" @ok="submit" destroy-on-close>
      <Form ref="formRef" :model="formModel" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item label="名称" name="name" :rules="[{ required: true, message: '名称为必填' }]">
          <Input v-model:value="formModel.name" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea v-model:value="formModel.description" rows="4" />
        </Form.Item>
      </Form>
    </Modal>

    <Modal v-model:open="rulesModalOpen" title="规则管理" destroy-on-close @cancel="() => (rulesModalOpen = false)">
      <div>
        <div class="mb-3">当前成就：{{ currentAchievementName }}</div>
        <Select v-model:value="selectedRuleIds" mode="multiple" style="width:100%" placeholder="选择要添加的规则">
          <Select.Option v-for="r in availableRules" :key="r.id" :value="r.id">{{ r.name }}</Select.Option>
        </Select>
        <div class="mt-2 text-right"><Button type="primary" @click="addSelectedRules">添加</Button></div>

        <div class="mt-4">
          <div class="font-medium mb-2">已关联规则</div>
          <div v-if="achievementRules.length">
            <div v-for="r in achievementRules" :key="r.id" class="flex items-center justify-between p-2 border rounded mb-2">
              <div>{{ r.name }} <small v-if="r.scenicId">（景区：{{ r.scenicId }}）</small></div>
              <div><Button size="small" danger type="text" @click="removeRule(r)">移除</Button></div>
            </div>
          </div>
          <div v-else>暂无规则</div>
        </div>
      </div>
    </Modal>
  </div>
</template>
