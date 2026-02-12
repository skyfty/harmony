<script lang="ts" setup>
import CrudPage from '../shared/crud-page.vue';

import { createProduct, deleteProduct, fetchProducts, updateProduct } from '#/api';

const columns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '类型', dataIndex: 'type', key: 'type' },
  { title: '价格', dataIndex: 'price', key: 'price' },
  { title: '有效期(天)', dataIndex: 'validityDays', key: 'validityDays' },
];

const fields = [
  { key: 'name', label: '名称', required: true },
  { key: 'slug', label: '唯一标识', required: true },
  { key: 'type', label: '类型', required: true },
  { key: 'price', label: '价格', required: true, type: 'number' },
  { key: 'validityDays', label: '有效期(天)', type: 'number' },
  { key: 'summary', label: '简介', type: 'textarea' },
  { key: 'description', label: '描述', type: 'textarea' },
];
</script>

<template>
  <CrudPage
    title="道具管理"
    :columns="columns"
    :fields="fields"
    :list-api="fetchProducts"
    :create-api="createProduct"
    :update-api="updateProduct"
    :delete-api="deleteProduct"
  />
</template>
