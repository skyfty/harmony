<script setup lang="ts">
import type { FormInstance, UploadFile, UploadProps } from 'ant-design-vue'
import type { Rule } from 'ant-design-vue/es/form'
import type {
  ScenicCreatePayload,
  ScenicItem,
  ScenicUpdatePayload,
  SceneSpotCreatePayload,
  SceneSpotItem,
  SceneSpotUpdatePayload,
} from '#/api'

import { computed, reactive, ref } from 'vue'

import { useVbenVxeGrid } from '#/adapter/vxe-table'
import {
  createScenicApi,
  createSceneSpotApi,
  deleteScenicApi,
  deleteSceneSpotApi,
  listScenicsApi,
  listSceneSpotsApi,
  updateScenicApi,
  updateSceneSpotApi,
} from '#/api'
import { $t } from '#/locales'

import { Button, Form, Input, InputNumber, Modal, Space, Upload, message } from 'ant-design-vue'

interface ScenicFormModel {
  fileList: UploadFile[]
  name: string
}

interface SceneSpotFormModel {
  title: string
  coverImage: string
  slides: string
  description: string
  address: string
  order: number
}

const { TextArea } = Input
const t = (key: string, args?: Record<string, unknown>) => $t(key as never, args as never)

const scenicFormRef = ref<FormInstance>()
const scenicModalOpen = ref(false)
const scenicSubmitting = ref(false)
const editingScenicId = ref<null | string>(null)

const scenicFormModel = reactive<ScenicFormModel>({
  fileList: [],
  name: '',
})

const sceneSpotModalOpen = ref(false)
const sceneSpotSubmitting = ref(false)
const sceneSpotFormRef = ref<FormInstance>()
const sceneSpots = ref<SceneSpotItem[]>([])
const currentScene = ref<null | ScenicItem>(null)
const editingSceneSpotId = ref<null | string>(null)

const sceneSpotFormModel = reactive<SceneSpotFormModel>({
  title: '',
  coverImage: '',
  slides: '',
  description: '',
  address: '',
  order: 0,
})

const scenicModalTitle = computed(() =>
  editingScenicId.value ? t('page.scenics.index.modal.edit') : t('page.scenics.index.modal.create'),
)

const scenicRules = computed(
  () =>
    ({
      name: [
        {
          message: t('page.scenics.index.formFields.name.required'),
          required: true,
          trigger: 'blur',
        },
      ] as Rule[],
    }) as Record<string, Rule[]>,
)

const scenicUploadProps: UploadProps = {
  beforeUpload: () => false,
  maxCount: 1,
}

function resetScenicForm() {
  scenicFormModel.name = ''
  scenicFormModel.fileList = []
}

function openCreateScenicModal() {
  editingScenicId.value = null
  resetScenicForm()
  scenicModalOpen.value = true
}

function openEditScenicModal(record: ScenicItem) {
  editingScenicId.value = record.id
  scenicFormModel.name = record.name || ''
  scenicFormModel.fileList = []
  scenicModalOpen.value = true
}

function closeScenicModal() {
  scenicModalOpen.value = false
}

function currentUploadFile(): Blob | File | null {
  const first = scenicFormModel.fileList[0]
  if (!first) {
    return null
  }
  const origin = first.originFileObj
  return origin || null
}

async function submitScenic() {
  const form = scenicFormRef.value
  if (!form) {
    return
  }
  await form.validate()
  scenicSubmitting.value = true
  try {
    const basePayload = {
      name: scenicFormModel.name.trim(),
    }
    const uploadFile = currentUploadFile()

    if (editingScenicId.value) {
      const payload: ScenicUpdatePayload = {
        ...basePayload,
        file: uploadFile,
      }
      await updateScenicApi(editingScenicId.value, payload)
      message.success(t('page.scenics.index.message.updateSuccess'))
    } else {
      const payload: ScenicCreatePayload = {
        ...basePayload,
        file: uploadFile,
      }
      await createScenicApi(payload)
      message.success(t('page.scenics.index.message.createSuccess'))
    }

    scenicModalOpen.value = false
    scenicGridApi.reload()
  } finally {
    scenicSubmitting.value = false
  }
}

function resetSceneSpotForm() {
  editingSceneSpotId.value = null
  sceneSpotFormModel.title = ''
  sceneSpotFormModel.coverImage = ''
  sceneSpotFormModel.slides = ''
  sceneSpotFormModel.description = ''
  sceneSpotFormModel.address = ''
  sceneSpotFormModel.order = 0
}

async function reloadSceneSpots() {
  if (!currentScene.value) {
    sceneSpots.value = []
    return
  }
  sceneSpots.value = await listSceneSpotsApi(currentScene.value.id)
}

async function openSceneSpotModal(scene: ScenicItem) {
  currentScene.value = scene
  sceneSpotModalOpen.value = true
  resetSceneSpotForm()
  await reloadSceneSpots()
}

function closeSceneSpotModal() {
  sceneSpotModalOpen.value = false
  currentScene.value = null
  sceneSpots.value = []
  resetSceneSpotForm()
}

function openEditSceneSpot(spot: SceneSpotItem) {
  editingSceneSpotId.value = spot.id
  sceneSpotFormModel.title = spot.title
  sceneSpotFormModel.coverImage = spot.coverImage ?? ''
  sceneSpotFormModel.slides = Array.isArray(spot.slides) ? spot.slides.join('\n') : ''
  sceneSpotFormModel.description = spot.description ?? ''
  sceneSpotFormModel.address = spot.address ?? ''
  sceneSpotFormModel.order = spot.order ?? 0
}

async function submitSceneSpot() {
  const scene = currentScene.value
  if (!scene) {
    return
  }

  const form = sceneSpotFormRef.value
  if (!form) {
    return
  }
  await form.validate()

  const slides = sceneSpotFormModel.slides
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)

  const payload: SceneSpotCreatePayload | SceneSpotUpdatePayload = {
    title: sceneSpotFormModel.title.trim(),
    coverImage: sceneSpotFormModel.coverImage.trim() || null,
    slides,
    description: sceneSpotFormModel.description.trim() || null,
    address: sceneSpotFormModel.address.trim() || null,
    order: Number(sceneSpotFormModel.order) || 0,
  }

  sceneSpotSubmitting.value = true
  try {
    if (editingSceneSpotId.value) {
      await updateSceneSpotApi(scene.id, editingSceneSpotId.value, payload)
      message.success('景点已更新')
    } else {
      await createSceneSpotApi(scene.id, payload as SceneSpotCreatePayload)
      message.success('景点已创建')
    }
    resetSceneSpotForm()
    await reloadSceneSpots()
  } finally {
    sceneSpotSubmitting.value = false
  }
}

function handleDeleteSceneSpot(spot: SceneSpotItem) {
  if (!currentScene.value) {
    return
  }
  const sceneId = currentScene.value.id
  Modal.confirm({
    title: `确认删除景点「${spot.title}」?`,
    okType: 'danger',
    onOk: async () => {
      await deleteSceneSpotApi(sceneId, spot.id)
      message.success('景点已删除')
      await reloadSceneSpots()
    },
  })
}

function handleDeleteScenic(row: ScenicItem) {
  Modal.confirm({
    title: t('page.scenics.index.confirm.delete.title', { name: row.name }),
    content: t('page.scenics.index.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteScenicApi(row.id)
      message.success(t('page.scenics.index.message.deleteSuccess'))
      scenicGridApi.reload()
    },
  })
}

const [ScenicGrid, scenicGridApi] = useVbenVxeGrid<ScenicItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: t('page.scenics.index.form.keyword.label'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.scenics.index.form.keyword.placeholder'),
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 180, title: t('page.scenics.index.table.name') },
      { field: 'fileUrl', minWidth: 280, title: '场景文件地址', slots: { default: 'fileUrl' } },
      { field: 'fileSize', minWidth: 120, title: '文件大小(B)' },
      {
        field: 'updatedAt',
        minWidth: 180,
        sortable: true,
        formatter: 'formatDateTime',
        title: t('page.scenics.index.table.updatedAt'),
      },
      {
        align: 'left',
        field: 'actions',
        fixed: 'right',
        minWidth: 260,
        slots: { default: 'actions' },
        title: t('page.scenics.index.table.actions'),
      },
    ],
    pagerConfig: {
      pageSize: 20,
    },
    proxyConfig: {
      ajax: {
        query: async (
          { page }: { page: { currentPage: number; pageSize: number } },
          formValues: Record<string, any>,
        ) => {
          return await listScenicsApi({
            keyword: formValues.keyword || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          })
        },
      },
    },
    sortConfig: {
      defaultSort: { field: 'updatedAt', order: 'desc' },
      remote: false,
    },
    toolbarConfig: {
      custom: true,
      refresh: true,
      search: true,
      zoom: true,
    },
  },
  tableTitle: t('page.scenics.index.table.title'),
})
</script>

<template>
  <div class="p-5">
    <ScenicGrid>
      <template #toolbar-actions>
        <Button v-access:code="'scene:write'" type="primary" @click="openCreateScenicModal">
          {{ t('page.scenics.index.toolbar.create') }}
        </Button>
      </template>

      <template #fileUrl="{ row }">
        <a v-if="row.fileUrl" :href="row.fileUrl" target="_blank" rel="noopener noreferrer">{{ row.fileUrl }}</a>
        <span v-else class="text-text-secondary">-</span>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'scene:write'" size="small" type="link" @click="openEditScenicModal(row)">
            {{ t('page.scenics.index.actions.edit') }}
          </Button>
          <Button v-access:code="'sceneSpot:write'" size="small" type="link" @click="openSceneSpotModal(row)">
            景点
          </Button>
          <Button v-access:code="'scene:write'" danger size="small" type="link" @click="handleDeleteScenic(row)">
            {{ t('page.scenics.index.actions.delete') }}
          </Button>
        </Space>
      </template>
    </ScenicGrid>

    <Modal
      :open="scenicModalOpen"
      :title="scenicModalTitle"
      :confirm-loading="scenicSubmitting"
      :ok-text="t('page.scenics.index.modal.ok')"
      :cancel-text="t('page.scenics.index.modal.cancel')"
      destroy-on-close
      @cancel="closeScenicModal"
      @ok="submitScenic"
    >
      <Form ref="scenicFormRef" :model="scenicFormModel" :rules="scenicRules" :label-col="{ span: 6 }" :wrapper-col="{ span: 17 }">
        <Form.Item :label="t('page.scenics.index.formFields.name.label')" name="name">
          <Input v-model:value="scenicFormModel.name" allow-clear />
        </Form.Item>
        <Form.Item :label="t('page.scenics.index.formFields.file.label')" name="file">
          <Upload v-model:file-list="scenicFormModel.fileList" v-bind="scenicUploadProps">
            <Button>{{ t('page.scenics.index.formFields.file.button') }}</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>

    <Modal
      :open="sceneSpotModalOpen"
      :title="currentScene ? `景点管理 - ${currentScene.name}` : '景点管理'"
      :confirm-loading="sceneSpotSubmitting"
      ok-text="保存景点"
      cancel-text="关闭"
      width="900px"
      destroy-on-close
      @cancel="closeSceneSpotModal"
      @ok="submitSceneSpot"
    >
      <div class="mb-4 max-h-56 overflow-auto rounded border border-gray-200 p-3">
        <div v-if="sceneSpots.length === 0" class="text-sm text-gray-500">暂无景点</div>
        <div v-for="spot in sceneSpots" :key="spot.id" class="mb-2 flex items-center justify-between rounded border border-gray-100 p-2">
          <div>
            <div class="font-medium">{{ spot.title }}</div>
            <div class="text-xs text-gray-500">{{ spot.address || '无地址' }}</div>
          </div>
          <Space>
            <Button size="small" type="link" @click="openEditSceneSpot(spot)">编辑</Button>
            <Button size="small" danger type="link" @click="handleDeleteSceneSpot(spot)">删除</Button>
          </Space>
        </div>
      </div>

      <Form ref="sceneSpotFormRef" :model="sceneSpotFormModel" :rules="scenicRules" :label-col="{ span: 5 }" :wrapper-col="{ span: 18 }">
        <Form.Item label="名称" name="title" :rules="[{ required: true, message: '请输入景点名称', trigger: 'blur' }]">
          <Input v-model:value="sceneSpotFormModel.title" allow-clear />
        </Form.Item>
        <Form.Item label="介绍图" name="coverImage">
          <Input v-model:value="sceneSpotFormModel.coverImage" allow-clear />
        </Form.Item>
        <Form.Item label="幻灯片" name="slides">
          <TextArea v-model:value="sceneSpotFormModel.slides" :rows="3" placeholder="每行一个图片 URL" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <TextArea v-model:value="sceneSpotFormModel.description" :rows="3" />
        </Form.Item>
        <Form.Item label="地址" name="address">
          <Input v-model:value="sceneSpotFormModel.address" allow-clear />
        </Form.Item>
        <Form.Item label="排序" name="order">
          <InputNumber v-model:value="sceneSpotFormModel.order" :min="0" style="width: 100%" />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
