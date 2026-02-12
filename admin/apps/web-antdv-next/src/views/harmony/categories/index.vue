<script lang="ts" setup>
import CrudPage from '../shared/crud-page.vue';

import { createCategory, deleteCategory, fetchCategories, updateCategory } from '#/api';

const columns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '描述', dataIndex: 'description', key: 'description' },
  { title: '层级', dataIndex: 'depth', key: 'depth' },
];

const fields = [
  { key: 'name', label: '分类名称', required: true },
  { key: 'description', label: '分类描述', type: 'textarea' },
  { key: 'parentId', label: '父级分类ID' },
];
</script>

<template>
  <CrudPage
    title="分类管理"
    :columns="columns"
    :fields="fields"
    :list-api="fetchCategories"
    :create-api="createCategory"
    :update-api="updateCategory"
    :delete-api="deleteCategory"
  />
</template>
