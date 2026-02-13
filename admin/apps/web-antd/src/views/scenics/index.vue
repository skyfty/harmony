<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Button, Card, Table } from 'ant-design-vue';
import { listScenicsApi } from '#/api/core/scenics';

const router = useRouter();
const route = useRoute();

const data = ref([] as any[]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await listScenicsApi({ page: 1, pageSize: 50 });
    data.value = res.items || [];
  } finally {
    loading.value = false;
  }
}

function goToDetail(row: any) {
  router.push({ name: 'ScenicsDetail', params: { id: row.id } });
}

onMounted(load);

const columns = [
  { dataIndex: 'id', key: 'id', title: 'ID' },
  { dataIndex: 'name', key: 'name', title: '名称' },
  { dataIndex: 'category', key: 'category', title: '分类' },
  { dataIndex: 'updatedAt', key: 'updatedAt', title: '更新时间' },
  {
    dataIndex: 'actions',
    key: 'actions',
    title: '操作',
    slots: { customRender: 'actions' },
  },
];
</script>

<template>
  <div class="p-5">
    <Card>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0">场景管理</h3>
        <Button type="primary" @click="() => router.push({ name: 'ScenicsCreate' })">新建场景</Button>
      </div>

      <Table :data-source="data" :columns="columns" :row-key="'id'" :loading="loading">
        <template #actions="{ record }">
          <a @click.prevent="goToDetail(record)">详情</a>
        </template>
      </Table>
    </Card>
  </div>
</template>
