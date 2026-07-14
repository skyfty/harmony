<script setup lang="ts">
import type { UploadChangeParam, UploadFile, UploadProps } from 'ant-design-vue';

import { reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import {
  deleteFileUploadApi,
  listFileUploadsApi,
  uploadFileApi,
  type FileUploadItem,
} from '#/api/core/file-uploads';

import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Upload,
  message,
} from 'ant-design-vue';
import { DeleteOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons-vue';

const moduleOptions = [
  { label: '通用', value: 'general' },
  { label: '车辆', value: 'vehicle' },
  { label: '商品', value: 'product' },
  { label: '勋章', value: 'medal' },
  { label: '用户', value: 'user' },
  { label: '景点', value: 'scene-spot' },
  { label: '其他', value: 'other' },
];

const submitting = ref(false);
const openUploadModal = ref(false);
const uploadFileList = ref<UploadFile[]>([]);
const uploadPreview = ref('');

const uploadForm = reactive({
  label: '',
  module: 'general',
});

const [FileUploadGrid, fileUploadGridApi] = useVbenVxeGrid<FileUploadItem>({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: {
          allowClear: true,
          placeholder: '按名称、文件名或上传者搜索',
        },
      },
      {
        component: 'Select',
        fieldName: 'module',
        label: '模块',
        componentProps: {
          allowClear: true,
          options: moduleOptions,
          placeholder: '按模块筛选',
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'url', minWidth: 120, title: '预览', slots: { default: 'preview' } },
      { field: 'label', minWidth: 220, title: '名称', slots: { default: 'name' } },
      { field: 'module', minWidth: 120, title: '模块', slots: { default: 'module' } },
      { field: 'originalFilename', minWidth: 220, title: '原始文件名', slots: { default: 'originalFilename' } },
      { field: 'mimeType', minWidth: 160, title: 'MIME 类型', slots: { default: 'mimeType' } },
      { field: 'size', minWidth: 120, title: '大小', slots: { default: 'size' } },
      { field: 'uploaderUsername', minWidth: 140, title: '上传者', slots: { default: 'uploader' } },
      { field: 'createdAt', minWidth: 180, title: '创建时间', slots: { default: 'createdAt' } },
      { align: 'left', fixed: 'right', minWidth: 180, field: 'actions', slots: { default: 'actions' }, title: '操作' },
    ],
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          return await listFileUploadsApi({
            keyword: formValues.keyword?.trim() || undefined,
            module: formValues.module || undefined,
            page: page.currentPage,
            pageSize: page.pageSize,
          });
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
});
const uploadProps: UploadProps = {
  beforeUpload: () => false,
  accept: '*',
  maxCount: 1,
};

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size < 0) {
    return '-'
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '-'
  }
  return date.toLocaleString()
}

function openUploadDialog() {
  uploadForm.label = ''
  const formValues = (fileUploadGridApi.formApi?.getValues?.() ?? {}) as Record<string, any>
  uploadForm.module = formValues.module || 'general'
  uploadFileList.value = []
  uploadPreview.value = ''
  openUploadModal.value = true
}

function handleUploadChange(info: UploadChangeParam<UploadFile<any>>) {
  const list = info.fileList.slice(-1)
  uploadFileList.value = list
  const [file] = list
  const origin = file?.originFileObj as File | undefined
  if (origin && origin.type.startsWith('image/')) {
    uploadPreview.value = URL.createObjectURL(origin)
  } else {
    uploadPreview.value = ''
  }
}

async function submitUpload() {
  if (!uploadFileList.value.length) {
    message.error('请选择要上传的文件')
    return
  }
  const origin = (uploadFileList.value[0] as any).originFileObj as File | undefined
  if (!origin) {
    message.error('无法读取文件')
    return
  }

  submitting.value = true
  try {
    const formData = new FormData()
    formData.append('file', origin)
    formData.append('module', uploadForm.module || 'general')
    if (uploadForm.label.trim()) {
      formData.append('label', uploadForm.label.trim())
    }
    await uploadFileApi(formData)
    message.success('上传成功')
    openUploadModal.value = false
    fileUploadGridApi.reload()
  } finally {
    submitting.value = false
  }
}

function handleDelete(record: FileUploadItem) {
  Modal.confirm({
    title: '确认删除该文件吗？',
    content: record.label || record.originalFilename || record.fileKey,
    okType: 'danger',
    onOk: async () => {
      await deleteFileUploadApi(record.id)
      message.success('删除成功')
      await fileUploadGridApi.query()
    },
  })
}

function handleDownload(record: FileUploadItem) {
  if (!record.url) {
    message.warning('文件地址不存在')
    return
  }

  globalThis.open(record.url, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div class="p-5">
    <FileUploadGrid>
      <template #toolbar-actions>
        <Button type="primary" @click="openUploadDialog">
          <template #icon>
            <UploadOutlined />
          </template>
          上传文件
        </Button>
      </template>

      <template #preview="{ row }">
        <img
          v-if="row.mimeType?.startsWith('image/') && row.url"
          :src="row.url"
          :alt="row.label || row.originalFilename || row.fileKey"
          style="width: 56px; height: 56px; object-fit: cover; border-radius: 8px; display: block"
        />
        <Tag v-else color="blue">{{ row.mimeType?.split('/')[0] || 'file' }}</Tag>
      </template>

      <template #name="{ row }">
        <div>
          <div style="font-weight: 600;">{{ row.label || row.originalFilename || row.fileKey }}</div>
        </div>
      </template>

      <template #module="{ row }">
        <Tag>{{ row.module }}</Tag>
      </template>

      <template #originalFilename="{ row }">
        <span>{{ row.originalFilename || '-' }}</span>
      </template>

      <template #mimeType="{ row }">
        <Tag>{{ row.mimeType || '-' }}</Tag>
      </template>

      <template #size="{ row }">
        <span>{{ formatFileSize(row.size) }}</span>
      </template>

      <template #uploader="{ row }">
        <span>{{ row.uploaderUsername || '-' }}</span>
      </template>

      <template #createdAt="{ row }">
        <span>{{ formatDateTime(row.createdAt) }}</span>
      </template>

      <template #actions="{ row }">
        <Space size="small">
          <Button type="link" @click="handleDownload(row)">
            <template #icon>
              <DownloadOutlined />
            </template>
          </Button>
          <Button danger type="link" @click="handleDelete(row)">
            <template #icon>
              <DeleteOutlined />
            </template>
          </Button>
        </Space>
      </template>
    </FileUploadGrid>

    <Modal v-model:open="openUploadModal" title="上传文件" :confirm-loading="submitting" ok-text="上传" cancel-text="取消" @ok="submitUpload">
      <Form layout="vertical">
        <Form.Item label="模块">
          <Select v-model:value="uploadForm.module" :options="moduleOptions" />
        </Form.Item>
        <Form.Item label="名称">
          <Input v-model:value="uploadForm.label" placeholder="可选，用于管理页显示" />
        </Form.Item>
        <Form.Item label="文件">
          <Upload v-bind="uploadProps" :file-list="uploadFileList" @change="handleUploadChange">
            <Button>
              <template #icon>
                <UploadOutlined />
              </template>
              选择文件
            </Button>
          </Upload>
        </Form.Item>
        <Form.Item v-if="uploadPreview" label="预览">
          <img
            :src="uploadPreview"
            alt="preview"
            width="120"
            height="120"
            class="upload-preview-image"
          />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>

<style scoped>
.upload-preview-image {
  object-fit: cover;
  border-radius: 8px;
  display: block;
}
</style>
