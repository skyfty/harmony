<script setup lang="ts">
import type { FormInstance, UploadFile, UploadProps } from 'ant-design-vue';

import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

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

const { t } = useI18n();
const modalTitle = computed(() => (editingId.value ? t('page.products.index.modal.edit') : t('page.products.index.modal.create')));

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
    message.error(t('page.products.index.message.readFailed'));
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
      message.success(t('page.products.index.message.updateSuccess'));
    } else {
      await createProductApi(payload);
      message.success(t('page.products.index.message.createSuccess'));
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
    title: t('page.products.index.confirm.delete.title', { name: row.name }),
    content: t('page.products.index.confirm.delete.content'),
    okType: 'danger',
    onOk: async () => {
      await deleteProductApi(row.id);
      message.success(t('page.products.index.message.deleteSuccess'));
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
        label: t('page.products.index.form.keyword.label'),
        componentProps: { allowClear: true, placeholder: t('page.products.index.form.keyword.placeholder') },
      },
      {
        component: 'Select',
        fieldName: 'categoryId',
        label: t('page.products.index.form.categoryId.label'),
        componentProps: {
          allowClear: true,
          placeholder: t('page.products.index.form.categoryId.placeholder'),
          options: categoryOptions,
        },
      },
    ],
  },
  gridOptions: {
    border: true,
    columns: [
      { field: 'name', minWidth: 200, title: t('page.products.index.table.name') },
      { field: 'slug', minWidth: 180, title: t('page.products.index.table.slug') },
      { field: 'coverUrl', minWidth: 120, title: t('page.products.index.table.cover'), slots: { default: 'cover' } },
      { field: 'categoryId', minWidth: 140, title: t('page.products.index.table.category'), slots: { default: 'category' } },
      { field: 'price', minWidth: 120, title: t('page.products.index.table.price') },
      { field: 'validityDays', minWidth: 120, title: t('page.products.index.table.validityDays') },
      { field: 'createdAt', minWidth: 180, formatter: 'formatDateTime', title: t('page.products.index.table.createdAt') },
      { field: 'updatedAt', minWidth: 180, formatter: 'formatDateTime', title: t('page.products.index.table.updatedAt') },
      { align: 'left', fixed: 'right', minWidth: 160, field: 'actions', slots: { default: 'actions' }, title: t('page.products.index.table.actions') },
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
        <Button v-access:code="'product:write'" type="primary" @click="openCreateModal">{{ t('page.products.index.toolbar.create') }}</Button>
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
          <Button v-access:code="'product:write'" size="small" type="link" @click="openEditModal(row)">{{ t('page.products.index.actions.edit') }}</Button>
          <Button v-access:code="'product:write'" danger size="small" type="link" @click="handleDelete(row)">{{ t('page.products.index.actions.delete') }}</Button>
        </Space>
      </template>
    </ProductGrid>

    <Modal :open="modalOpen" :confirm-loading="submitting" :title="modalTitle" :ok-text="t('page.products.index.modal.ok')" :cancel-text="t('page.products.index.modal.cancel')" destroy-on-close @cancel="() => (modalOpen = false)" @ok="submitProduct">
      <Form ref="productFormRef" :label-col="{ span: 6 }" :model="productFormModel" :wrapper-col="{ span: 17 }">
          <Form.Item :label="t('page.products.index.formFields.name.label')" name="name" :rules="[{ required: true, message: t('page.products.index.formFields.name.required') }]">
            <Input v-model:value="productFormModel.name" :placeholder="t('page.products.index.formFields.name.placeholder')" />
          </Form.Item>
          <Form.Item :label="t('page.products.index.formFields.slug.label')" name="slug" :rules="[{ required: true, message: t('page.products.index.formFields.slug.required') }, { pattern: /^[a-z0-9-]+$/, message: t('page.products.index.formFields.slug.pattern') }]">
            <Input v-model:value="productFormModel.slug" :placeholder="t('page.products.index.formFields.slug.placeholder')" />
          </Form.Item>
          <Form.Item :label="t('page.products.index.formFields.categoryId.label')" name="categoryId" :rules="[{ required: true, message: t('page.products.index.formFields.categoryId.required') }]">
            <Select v-model:value="productFormModel.categoryId" :options="categoryOptions" allowClear :placeholder="t('page.products.index.formFields.categoryId.placeholder')" />
          </Form.Item>
          <Form.Item :label="t('page.products.index.formFields.price.label')" name="price" :rules="[{ type: 'number', min: 0, message: t('page.products.index.formFields.price.min') }]">
            <InputNumber v-model:value="productFormModel.price" style="width:100%" min="0" />
          </Form.Item>
          <Form.Item :label="t('page.products.index.formFields.validityDays.label')" name="validityDays" :rules="[{ type: 'number', min: 1, message: t('page.products.index.formFields.validityDays.min') }]">
            <InputNumber v-model:value="productFormModel.validityDays" style="width:100%" min="1" />
          </Form.Item>
        <Form.Item :label="t('page.products.index.formFields.description.label')" name="description">
          <Input.TextArea v-model:value="productFormModel.description" :placeholder="t('page.products.index.formFields.description.placeholder')" rows="4" />
        </Form.Item>
        <Form.Item :label="t('page.products.index.formFields.coverUpload.label')">
          <Upload v-bind="imageUploadProps" v-model:file-list="imageFileList" list-type="picture-card">
            <div>{{ t('page.products.index.formFields.coverUpload.upload') }}</div>
          </Upload>
        </Form.Item>
        <Form.Item v-if="imagePreview" :label="t('page.products.index.formFields.currentCover.label')">
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
