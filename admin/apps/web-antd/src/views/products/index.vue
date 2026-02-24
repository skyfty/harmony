<script setup lang="ts">
import type { FormInstance, UploadFile, UploadProps } from 'ant-design-vue';

import { computed, onMounted, reactive, ref } from 'vue';

import { useVbenVxeGrid } from '#/adapter/vxe-table';
import {
  createProductApi,
  deleteProductApi,
  getProductApi,
  listProductCategoriesApi,
  listProductsApi,
  updateProductApi,
} from '#/api';

import { Button, Form, Input, message, Modal, Space, Select, InputNumber, Upload } from 'ant-design-vue';
import { createResourceAssetApi } from '#/api/core/resources';

interface ProductFormModel {
  name: string;
  slug: string;
  categoryId: string;
  price?: number;
  validityDays?: number;
  description: string;
  coverUrl: string;
}

const modalOpen = ref(false);
const submitting = ref(false);
const editingId = ref<null | string>(null);
const productFormRef = ref<FormInstance>();

const productFormModel = reactive<ProductFormModel>({
  name: '',
  slug: '',
  categoryId: '',
  price: undefined,
  validityDays: undefined,
  description: '',
  coverUrl: '',
});

const categoryOptions = ref<Array<{ label: string; value: string }>>([]);
const categoryNameById = ref<Record<string, string>>({});
const imageFileList = ref<UploadFile[]>([]);
const imagePreview = ref('');

const imageUploadProps: UploadProps = {
  beforeUpload: () => false,
  maxCount: 1,
  accept: 'image/*',
};

const modalTitle = computed(() => (editingId.value ? '编辑商品' : '新增商品'));

function resetForm() {
  productFormModel.name = '';
  productFormModel.slug = '';
  productFormModel.categoryId = '';
  productFormModel.price = undefined;
  productFormModel.validityDays = undefined;
  productFormModel.description = '';
  productFormModel.coverUrl = '';
  imageFileList.value = [];
  imagePreview.value = '';
}

function openCreateModal() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

async function openEditModal(row: any) {
  editingId.value = row.id;
  try {
    const data = await getProductApi(row.id);
    productFormModel.name = data.name || '';
    productFormModel.slug = data.slug || '';
    productFormModel.categoryId = data.categoryId || '';
    productFormModel.price = data.price ?? undefined;
    productFormModel.validityDays = data.validityDays ?? undefined;
    productFormModel.description = data.description ?? '';
    productFormModel.coverUrl = data.coverUrl || '';
    imageFileList.value = [];
    imagePreview.value = productFormModel.coverUrl;
    modalOpen.value = true;
  } catch (err) {
    message.error('读取商品信息失败');
  }
}

async function uploadImageIfNeeded() {
  if (!imageFileList.value.length) {
    return productFormModel.coverUrl;
  }
  const origin = (imageFileList.value[0] as any).originFileObj as File;
  if (!origin) {
    return productFormModel.coverUrl;
  }
  const fd = new FormData();
  fd.append('file', origin);
  const res = await createResourceAssetApi(fd);
  return res?.asset?.previewUrl || res?.asset?.thumbnailUrl || res?.asset?.url || productFormModel.coverUrl;
}

async function submitProduct() {
  const form = productFormRef.value;
  if (!form) return;
  await form.validate();
  submitting.value = true;
  try {
    const coverUrl = await uploadImageIfNeeded();
    const payload = {
      name: productFormModel.name.trim(),
      slug: productFormModel.slug.trim(),
      categoryId: productFormModel.categoryId || undefined,
      price: productFormModel.price ?? undefined,
      validityDays: productFormModel.validityDays ?? undefined,
      description: productFormModel.description.trim() || undefined,
      coverUrl: coverUrl || undefined,
    } as any;

    if (editingId.value) {
      await updateProductApi(editingId.value, payload);
      message.success('商品更新成功');
    } else {
      await createProductApi(payload);
      message.success('商品创建成功');
    }
    modalOpen.value = false;
    productGridApi.reload();
  } catch (err) {
    // noop - request client will show errors
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: any) {
  Modal.confirm({
    title: `确认删除商品 “${row.name}” 吗？`,
    content: '删除后不可恢复。',
    okType: 'danger',
    onOk: async () => {
      await deleteProductApi(row.id);
      message.success('商品已删除');
      productGridApi.reload();
    },
  });
}

const [ProductGrid, productGridApi] = useVbenVxeGrid({
  formOptions: {
    schema: [
      {
        component: 'Input',
        fieldName: 'keyword',
        label: '关键字',
        componentProps: { allowClear: true, placeholder: '名称 / Slug' },
      },
      {
        component: 'Select',
        fieldName: 'categoryId',
        label: '分类',
        componentProps: {
          allowClear: true,
          placeholder: '选择分类',
          options: categoryOptions,
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 200, title: '名称' },
      { field: 'slug', minWidth: 180, title: 'Slug' },
      { field: 'coverUrl', minWidth: 120, title: '封面', slots: { default: 'cover' } },
      { field: 'categoryId', minWidth: 140, title: '分类', slots: { default: 'category' } },
      { field: 'price', minWidth: 120, title: '价格' },
      { field: 'validityDays', minWidth: 120, title: '有效期(天)' },
      { field: 'createdAt', minWidth: 180, formatter: 'formatDateTime', title: '创建时间' },
      { field: 'updatedAt', minWidth: 180, formatter: 'formatDateTime', title: '更新时间' },
      { align: 'left', fixed: 'right', minWidth: 160, field: 'actions', slots: { default: 'actions' }, title: '操作' },
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
            categoryId: formValues.categoryId || undefined,
          };
          return await listProductsApi(params);
        },
      },
    },
    toolbarConfig: { custom: true, refresh: true, search: true, zoom: true },
  },
  tableTitle: '商品管理',
});

onMounted(() => {
  (async () => {
    try {
      const categories = await listProductCategoriesApi();
      categoryOptions.value = (categories || [])
        .filter((item) => item.enabled !== false)
        .map((item) => ({ label: item.name, value: item.id }));
      categoryNameById.value = (categories || []).reduce(
        (acc, item) => ({ ...acc, [item.id]: item.name }),
        {} as Record<string, string>,
      );
    } catch (err) {
      // ignore
    }
  })();
});
</script>

<template>
  <div class="p-5">
    <ProductGrid>
      <template #toolbar-actions>
        <Button v-access:code="'product:write'" type="primary" @click="openCreateModal">新增商品</Button>
      </template>

      <template #cover="{ row }">
        <img
          v-if="row.coverUrl"
          :src="row.coverUrl"
          alt="cover"
          style="width: 56px; height: 56px; object-fit: cover; border-radius: 8px"
        />
        <span v-else>-</span>
      </template>

      <template #category="{ row }">
        <span>{{ categoryNameById[row.categoryId] || '-' }}</span>
      </template>

      <template #actions="{ row }">
        <Space>
          <Button v-access:code="'product:write'" size="small" type="link" @click="openEditModal(row)">编辑</Button>
          <Button v-access:code="'product:write'" danger size="small" type="link" @click="handleDelete(row)">删除</Button>
        </Space>
      </template>
    </ProductGrid>

    <Modal :open="modalOpen" :confirm-loading="submitting" :title="modalTitle" ok-text="保存" cancel-text="取消" destroy-on-close @cancel="() => (modalOpen = false)" @ok="submitProduct">
      <Form ref="productFormRef" :label-col="{ span: 6 }" :model="productFormModel" :wrapper-col="{ span: 17 }">
          <Form.Item label="名称" name="name" :rules="[{ required: true, message: '请输入名称' }]">
            <Input v-model:value="productFormModel.name" placeholder="商品名称" />
          </Form.Item>
          <Form.Item label="Slug" name="slug" :rules="[{ required: true, message: '请输入 slug' }, { pattern: /^[a-z0-9-]+$/, message: '只允许小写字母/数字/横杠' }]">
            <Input v-model:value="productFormModel.slug" placeholder="唯一标识(小写英文)" />
          </Form.Item>
          <Form.Item label="分类" name="categoryId" :rules="[{ required: true, message: '请选择商品分类' }]">
            <Select v-model:value="productFormModel.categoryId" :options="categoryOptions" allowClear placeholder="选择商品分类" />
          </Form.Item>
          <Form.Item label="价格" name="price" :rules="[{ type: 'number', min: 0, message: '价格不能小于 0' }]">
            <InputNumber v-model:value="productFormModel.price" style="width:100%" min="0" />
          </Form.Item>
          <Form.Item label="有效期(天)" name="validityDays" :rules="[{ type: 'number', min: 1, message: '有效期必须大于等于 1' }]">
            <InputNumber v-model:value="productFormModel.validityDays" style="width:100%" min="1" />
          </Form.Item>
        <Form.Item label="描述" name="description">
          <Input v-model:value="productFormModel.description" placeholder="详细描述" />
        </Form.Item>
        <Form.Item label="封面上传">
          <Upload v-bind="imageUploadProps" v-model:file-list="imageFileList" list-type="picture-card">
            <div>上传</div>
          </Upload>
        </Form.Item>
        <Form.Item v-if="imagePreview" label="当前封面">
          <img
            :src="imagePreview"
            alt="preview"
            style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px"
          />
        </Form.Item>
      </Form>
    </Modal>
  </div>
</template>
