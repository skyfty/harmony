<script lang="ts" setup>
import CrudPage from '../shared/crud-page.vue';

import { createUser, deleteUser, fetchUsers, updateUser } from '#/api';

const columns = [
  { title: '用户名', dataIndex: 'username', key: 'username' },
  { title: '显示名', dataIndex: 'displayName', key: 'displayName' },
  { title: '邮箱', dataIndex: 'email', key: 'email' },
  { title: '状态', dataIndex: 'status', key: 'status' },
];

const fields = [
  { key: 'username', label: '用户名', required: true },
  { key: 'password', label: '密码', type: 'password' },
  { key: 'displayName', label: '显示名' },
  { key: 'email', label: '邮箱' },
  {
    key: 'status',
    label: '状态',
    type: 'select',
    options: [
      { label: 'active', value: 'active' },
      { label: 'disabled', value: 'disabled' },
    ],
  },
];
</script>

<template>
  <CrudPage
    title="用户管理"
    :columns="columns"
    :fields="fields"
    :list-api="fetchUsers"
    :create-api="createUser"
    :update-api="updateUser"
    :delete-api="deleteUser"
  />
</template>
