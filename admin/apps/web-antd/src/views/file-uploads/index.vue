<script setup lang="ts">
import type { UploadChangeParam, UploadFile, UploadProps } from 'ant-design-vue';

import { h, onMounted, reactive, ref } from 'vue';

import {
  deleteFileUploadApi,
  listFileUploadsApi,
  uploadFileApi,
  type FileUploadItem,
} from '#/api/core/file-uploads';

import {
  Button,
  Form,
  Image,
  Input,
  Modal,
  Select,
  Space,
  Table,
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

const loading = ref(false);
const submitting = ref(false);
const openUploadModal = ref(false);
const uploadFileList = ref<UploadFile[]>([]);
const uploadPreview = ref('');
const dataSource = ref<FileUploadItem[]>([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const queryForm = reactive({
  keyword: '',
  module: '',
});

const uploadForm = reactive({
  label: '',
  module: 'general',
});

const uploadProps: UploadProps = {
  beforeUpload: () => false,
  accept: '*',
  maxCount: 1,
};

const columns = [
  {
    title: '预览',
    dataIndex: 'url',
    width: 120,
    customRender: ({ record }: { record: FileUploadItem }) => {
      if (record.mimeType?.startsWith('image/') && record.url) {
        return h(Image, {
          src: record.url,
          width: 72,
          height: 72,
          style: 'object-fit: cover; border-radius: 8px;',
          preview: true,
        });
      }
      return h(Tag, { color: 'blue' }, { default: () => record.mimeType?.split('/')[0] || 'file' });
    },
  },
  {
    title: '名称',
    dataIndex: 'label',
    customRender: ({ record }: { record: FileUploadItem }) =>
      h('div', [
        h('div', { style: 'font-weight: 600;' }, record.label || record.originalFilename || record.fileKey),
        h('div', { style: 'color: rgba(0, 0, 0, 0.45); font-size: 12px; word-break: break-all;' }, record.fileKey),
      ]),
  },
  {
    title: '模块',
    dataIndex: 'module',
    width: 120,
    customRender: ({ record }: { record: FileUploadItem }) => h(Tag, null, { default: () => record.module }),
  },
  {
    title: '文件信息',
    width: 200,
    customRender: ({ record }: { record: FileUploadItem }) =>
      h('div', [
        h('div', record.originalFilename || '-'),
        h('div', { style: 'color: rgba(0, 0, 0, 0.45); font-size: 12px;' }, record.mimeType || '-'),
        h('div', { style: 'color: rgba(0, 0, 0, 0.45); font-size: 12px;' }, formatFileSize(record.size)),
      ]),
  },
  {
    title: '上传者',
    width: 140,
    customRender: ({ record }: { record: FileUploadItem }) => record.uploaderUsername || '-',
  },
  {
    title: '创建时间',
    width: 180,
    customRender: ({ record }: { record: FileUploadItem }) => formatDateTime(record.createdAt),
  },
  {
    title: '操作',
    width: 180,
    fixed: 'right' as const,
    customRender: ({ record }: { record: FileUploadItem }) =>
      h(
        Space,
        { size: 'small' },
        {
          default: () => [
            h(
              Button,
              {
                type: 'link',
                icon: h(DownloadOutlined),
                onClick: () => window.open(record.url, '_blank'),
              },
              { default: () => '打开' },
            ),
            h(
              Button,
              {
                danger: true,
                type: 'link',
                icon: h(DeleteOutlined),
                onClick: () => handleDelete(record),
              },
              { default: () => '删除' },
            ),
          ],
        },
      ),
  },
];

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

async function loadData() {
  loading.value = true
  try {
    const result = await listFileUploadsApi({
      keyword: queryForm.keyword.trim() || undefined,
      module: queryForm.module || undefined,
      page: page.value,
      pageSize: pageSize.value,
    })
    dataSource.value = result.items
    total.value = result.total
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  page.value = 1
  loadData()
}

function handleReset() {
  queryForm.keyword = ''
  queryForm.module = ''
  handleSearch()
}

function openUploadDialog() {
  uploadForm.label = ''
  uploadForm.module = queryForm.module || 'general'
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
    await loadData()
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
      await loadData()
    },
  })
}

function handleTableChange(pagination: { current?: number; pageSize?: number }) {
  page.value = pagination.current || 1
  pageSize.value = pagination.pageSize || 20
  loadData()
}

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="file-upload-page">
    <div class="page-toolbar">
      <Space wrap>
        <Input v-model:value="queryForm.keyword" allow-clear placeholder="按名称、文件名或上传者搜索" style="width: 280px" @press-enter="handleSearch" />
        <Select v-model:value="queryForm.module" allow-clear placeholder="按模块筛选" style="width: 180px" :options="moduleOptions" />
        <Button type="primary" @click="handleSearch">搜索</Button>
        <Button @click="handleReset">重置</Button>
      </Space>
      <Button type="primary" @click="openUploadDialog">
        <template #icon>
          <UploadOutlined />
        </template>
        上传文件
      </Button>
    </div>

    <Table
      :columns="columns"
      :data-source="dataSource"
      :loading="loading"
      :pagination="{ current: page, pageSize, total, showSizeChanger: true, showTotal: (value: number) => `共 ${value} 项` }"
      row-key="id"
      :scroll="{ x: 1200 }"
      @change="handleTableChange"
    />

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
          <Image :src="uploadPreview" width="120" height="120" style="object-fit: cover; border-radius: 8px;" preview />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>

<style scoped>
.file-upload-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
</style>