<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import type { UserProjectDocument } from '#/api';
import { getProjectApi, listProjectCategoriesApi } from '#/api';
import { getUserApi } from '#/api/core/rbac';
import { Button, Card, Descriptions, Table, Tag, Space } from 'ant-design-vue';

const route = useRoute();
const router = useRouter();
const userId = String(route.params.userId ?? '');
const projectId = String(route.params.projectId ?? '');

const loading = ref(true);
const project = ref<UserProjectDocument | null>(null);
const owner = ref<any | null>(null);
const categories = ref<any[]>([]);
const { t } = useI18n();

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
    const detail = await getProjectApi(userId, projectId);
    project.value = detail.project;
    try {
      categories.value = await listProjectCategoriesApi();
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
  { dataIndex: 'id', key: 'id', title: t('page.userProjects.detail.scenes.columns.id') },
  { dataIndex: 'name', key: 'name', title: t('page.userProjects.detail.scenes.columns.name') },
  { dataIndex: 'sceneJsonUrl', key: 'sceneJsonUrl', title: t('page.userProjects.detail.scenes.columns.url') },
];
</script>

<template>
  <div class="p-5">
    <Card :loading="loading">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0">{{ t('page.userProjects.detail.title') }}</h3>
        <Space>
          <Button type="default" @click="goBack">{{ t('page.userProjects.detail.button.back') }}</Button>
        </Space>
      </div>

      <Descriptions bordered :column="1" size="small">
        <Descriptions.Item :label="t('page.userProjects.detail.fields.id')">{{ project?.id }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.userProjects.detail.fields.name')">{{ project?.name }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.userProjects.detail.fields.user')">{{ owner?.username ?? userId }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.userProjects.detail.fields.userId')">{{ userId }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.userProjects.detail.fields.category')">
          <Tag v-if="categoryName" color="blue">{{ categoryName }}</Tag>
          <span v-else class="text-text-secondary">-</span>
        </Descriptions.Item>
        <Descriptions.Item :label="t('page.userProjects.detail.fields.sceneCount')">{{ project?.scenes?.length ?? 0 }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.userProjects.detail.fields.lastEditedSceneId')">{{ project?.lastEditedSceneId ?? '-' }}</Descriptions.Item>
      </Descriptions>

      <div style="margin-top:16px">
        <h4>{{ t('page.userProjects.detail.scenes.title') }}</h4>
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
