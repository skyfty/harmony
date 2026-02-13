<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { UserProjectDocument } from '#/api';
import { getUserProjectApi, listUserProjectCategoriesApi } from '#/api';
import { getUserApi } from '#/api/core/rbac';
import { Button, Card, Descriptions, Table, Tag, Space } from 'ant-design-vue';
import { h } from 'vue';

const route = useRoute();
const router = useRouter();
const userId = String(route.params.userId ?? '');
const projectId = String(route.params.projectId ?? '');

const loading = ref(true);
const project = ref<UserProjectDocument | null>(null);
const owner = ref<any | null>(null);
const categories = ref<any[]>([]);

const categoryName = computed(() => {
  if (!project.value || !project.value.categoryId) return null;
  const found = categories.value.find((c) => c.id === project.value?.categoryId);
  return found ? found.name : project.value.categoryId;
});

async function load() {
  loading.value = true;
  try {
    if (userId) {
      try {
        owner.value = await getUserApi(userId);
      } catch {
        owner.value = null;
      }
    }
    const detail = await getUserProjectApi(userId, projectId);
    project.value = detail.project;
    try {
      categories.value = await listUserProjectCategoriesApi({ userId });
    } catch {
      categories.value = [];
    }
  } finally {
    loading.value = false;
  }
}

function goBack() {
  router.back();
}

onMounted(load);

const sceneColumns = [
  { dataIndex: 'id', key: 'id', title: 'Scene ID' },
  { dataIndex: 'name', key: 'name', title: '名称' },
  { dataIndex: 'sceneJsonUrl', key: 'sceneJsonUrl', title: 'URL' },
];
</script>

<template>
  <div class="p-5">
    <Card>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0">工程详情</h3>
        <Space>
          <Button type="default" @click="goBack">返回</Button>
        </Space>
      </div>

      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="工程ID">{{ project?.id }}</Descriptions.Item>
        <Descriptions.Item label="工程名称">{{ project?.name }}</Descriptions.Item>
        <Descriptions.Item label="用户">{{ owner?.username ?? userId }}</Descriptions.Item>
        <Descriptions.Item label="用户ID">{{ userId }}</Descriptions.Item>
        <Descriptions.Item label="分类">
          <Tag v-if="categoryName" color="blue">{{ categoryName }}</Tag>
          <span v-else class="text-text-secondary">-</span>
        </Descriptions.Item>
        <Descriptions.Item label="场景数">{{ project?.scenes?.length ?? 0 }}</Descriptions.Item>
        <Descriptions.Item label="最后编辑场景ID">{{ project?.lastEditedSceneId ?? '-' }}</Descriptions.Item>
      </Descriptions>

      <div style="margin-top:16px">
        <h4>关联资源（场景）</h4>
        <Table
          :data-source="project?.scenes || []"
          :columns="sceneColumns"
          :row-key="'id'"
          :pagination="false"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'sceneJsonUrl'">
              <a :href="record.sceneJsonUrl" target="_blank">{{ record.sceneJsonUrl }}</a>
            </template>
          </template>
        </Table>
      </div>
    </Card>
  </div>
</template>
