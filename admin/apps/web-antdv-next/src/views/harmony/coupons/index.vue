<script lang="ts" setup>
import CrudPage from '../shared/crud-page.vue';

import { createCoupon, deleteCoupon, fetchCoupons, updateCoupon } from '#/api';

const columns = [
  { title: '名称', dataIndex: 'name', key: 'name' },
  { title: '有效期', dataIndex: 'validUntil', key: 'validUntil' },
  { title: '说明', dataIndex: 'description', key: 'description' },
];

const fields = [
  { key: 'name', label: '名称', required: true },
  { key: 'description', label: '描述', required: true, type: 'textarea' },
  { key: 'validUntil', label: '有效期', required: true, type: 'date' },
];
</script>

<template>
  <CrudPage
    title="卡券管理"
    :columns="columns"
    :fields="fields"
    :list-api="fetchCoupons"
    :create-api="createCoupon"
    :update-api="updateCoupon"
    :delete-api="deleteCoupon"
  />
</template>
