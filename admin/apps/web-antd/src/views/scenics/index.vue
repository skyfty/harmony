<script setup lang="ts">
import type { FormInstance, UploadFile, UploadProps } from 'ant-design-vue'
import type { Rule } from 'ant-design-vue/es/form'
import type { ScenicCreatePayload, ScenicItem, ScenicMetadata, ScenicUpdatePayload } from '#/api'

import { computed, reactive, ref } from 'vue'

import { useVbenVxeGrid } from '#/adapter/vxe-table'
import { createScenicApi, deleteScenicApi, listScenicsApi, updateScenicApi } from '#/api'
import { $t } from '#/locales'

import { Button, Form, Input, Modal, Space, Upload, message } from 'ant-design-vue'

interface ScenicFormModel {
  fileList: UploadFile[]
  metadata: string
  name: string
  url: string
}

const { TextArea } = Input
const t = (key: string, args?: Record<string, unknown>) => $t(key as never, args as never)

const scenicFormRef = ref<FormInstance>()
const scenicModalOpen = ref(false)
const scenicSubmitting = ref(false)
const editingScenicId = ref<null | string>(null)

const scenicFormModel = reactive<ScenicFormModel>({
  fileList: [],
  metadata: '',
  name: '',
  url: '',
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
  scenicFormModel.url = ''
  scenicFormModel.metadata = ''
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
  scenicFormModel.url = typeof record.url === 'string' ? record.url : ''
  scenicFormModel.metadata =
    record.metadata && Object.keys(record.metadata).length
      ? JSON.stringify(record.metadata, null, 2)
      : ''
  scenicFormModel.fileList = []
  scenicModalOpen.value = true
}

function closeScenicModal() {
  scenicModalOpen.value = false
}

function parseMetadataText(): ScenicMetadata | null {
  const raw = scenicFormModel.metadata.trim()
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('invalid metadata')
    }
    return parsed as ScenicMetadata
  } catch {
    throw new Error(t('page.scenics.index.message.invalidMetadata'))
  }
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
    const metadata = parseMetadataText()
    const basePayload = {
      metadata,
      name: scenicFormModel.name.trim(),
      url: scenicFormModel.url.trim() || null,
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
  } catch (error) {
    if (error instanceof Error && error.message === t('page.scenics.index.message.invalidMetadata')) {
      message.error(error.message)
    } else {
      throw error
    }
  } finally {
    scenicSubmitting.value = false
  }
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
      { field: 'url', minWidth: 240, title: t('page.scenics.index.table.url'), slots: { default: 'url' } },
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
        minWidth: 200,
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
        <Button v-access:code="'scenic:write'" type="primary" @click="openCreateScenicModal">
          {{ t('page.scenics.index.toolbar.create') }}
        </Button>
      </template>

      <template #url="{ row }">
        <a v-if="row.url" :href="row.url" target="_blank" rel="noopener noreferrer">{{ row.url }}</a>
        <span v-else class="text-text-secondary">-</span>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'scenic:write'" size="small" type="link" @click="openEditScenicModal(row)">
            {{ t('page.scenics.index.actions.edit') }}
          </Button>
          <Button v-access:code="'scenic:write'" danger size="small" type="link" @click="handleDeleteScenic(row)">
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
        <Form.Item :label="t('page.scenics.index.formFields.url.label')" name="url">
          <Input v-model:value="scenicFormModel.url" allow-clear />
        </Form.Item>
        
        <Form.Item :label="t('page.scenics.index.formFields.metadata.label')" name="metadata">
          <TextArea
            v-model:value="scenicFormModel.metadata"
            :rows="4"
            :placeholder="t('page.scenics.index.formFields.metadata.placeholder')"
          />
        </Form.Item>
        <Form.Item :label="t('page.scenics.index.formFields.file.label')" name="file">
          <Upload v-model:file-list="scenicFormModel.fileList" v-bind="scenicUploadProps">
            <Button>{{ t('page.scenics.index.formFields.file.button') }}</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
