<script lang="ts" setup>
import CrudPage from '../shared/crud-page.vue';

import { createScenic, deleteScenic, fetchScenics, updateScenic } from '#/api';

const columns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '位置', dataIndex: 'location', key: 'location' },
  { title: '简介', dataIndex: 'intro', key: 'intro' },
  { title: 'URL', dataIndex: 'url', key: 'url' },
];

const fields = [
  { key: 'name', label: '名称', required: true },
  { key: 'location', label: '位置' },
  { key: 'intro', label: '简介', type: 'textarea' },
  { key: 'url', label: 'URL' },
  { key: 'description', label: '描述', type: 'textarea' },
];
</script>

<template>
  <CrudPage
    title="景区管理"
    :columns="columns"
    :fields="fields"
    :list-api="fetchScenics"
    :create-api="createScenic"
    :update-api="updateScenic"
    :delete-api="deleteScenic"
  />
</template>
