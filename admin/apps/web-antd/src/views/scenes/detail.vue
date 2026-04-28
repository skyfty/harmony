<script setup lang="ts">
import type { TableColumnsType } from 'ant-design-vue';
import type { SceneItem, ScenePackageResourceSummary, ScenePackageSceneSummary } from '#/api';

import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { getSceneApi } from '#/api';
import { formatFileSize } from '#/utils/format';

import { Alert, Button, Card, Col, Descriptions, InputNumber, Row, Space, Statistic, Table, Tag } from 'ant-design-vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

const id = String(route.params.id ?? '');
const loading = ref(true);
const scene = ref<null | SceneItem>(null);
const unitPriceCnyPerGb = ref(0.24);
const downloadCount = ref(1);

const currencyFormatter = new Intl.NumberFormat('zh-CN', {
  currency: 'CNY',
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: 'currency',
});

const metadata = computed(() => scene.value?.metadata ?? null);

const packageGb = computed(() => bytesToGb(scene.value?.fileSize));
const resourceGb = computed(() => bytesToGb(metadata.value?.manifestResourceBytes));

const packageCost = computed(() => calculateCost(packageGb.value));
const resourceCost = computed(() => calculateCost(resourceGb.value));

const breakdownRows = computed(() => {
  const breakdown = metadata.value?.breakdown ?? {};
  return [
    { key: 'localAssetBytes', label: t('page.scenes.detail.breakdown.localAssetBytes'), value: breakdown.localAssetBytes ?? 0 },
    { key: 'embeddedAssetBytes', label: t('page.scenes.detail.breakdown.embeddedAssetBytes'), value: breakdown.embeddedAssetBytes ?? 0 },
    { key: 'planningImageBytes', label: t('page.scenes.detail.breakdown.planningImageBytes'), value: breakdown.planningImageBytes ?? 0 },
    { key: 'terrainBytes', label: t('page.scenes.detail.breakdown.terrainBytes'), value: breakdown.terrainBytes ?? 0 },
    { key: 'sidecarBytes', label: t('page.scenes.detail.breakdown.sidecarBytes'), value: breakdown.sidecarBytes ?? 0 },
    { key: 'sceneDocumentBytes', label: t('page.scenes.detail.breakdown.sceneDocumentBytes'), value: breakdown.sceneDocumentBytes ?? 0 },
    { key: 'manifestBytes', label: t('page.scenes.detail.breakdown.manifestBytes'), value: breakdown.manifestBytes ?? 0 },
    { key: 'projectBytes', label: t('page.scenes.detail.breakdown.projectBytes'), value: breakdown.projectBytes ?? 0 },
    { key: 'otherBytes', label: t('page.scenes.detail.breakdown.otherBytes'), value: breakdown.otherBytes ?? 0 },
  ].filter((item) => item.value > 0);
});

const largestResources = computed<ScenePackageResourceSummary[]>(() => metadata.value?.largestResources ?? []);
const sceneSummaries = computed<ScenePackageSceneSummary[]>(() => metadata.value?.sceneSummaries ?? []);

const breakdownColumns: TableColumnsType<(typeof breakdownRows.value)[number]> = [
  { dataIndex: 'label', key: 'label', title: t('page.scenes.detail.tables.breakdown.type') },
  {
    key: 'value',
    title: t('page.scenes.detail.tables.breakdown.size'),
    width: 180,
  },
];

const resourceColumns: TableColumnsType<ScenePackageResourceSummary> = [
  { dataIndex: 'logicalId', key: 'logicalId', title: t('page.scenes.detail.tables.resources.logicalId'), width: 220 },
  { dataIndex: 'resourceType', key: 'resourceType', title: t('page.scenes.detail.tables.resources.resourceType'), width: 140 },
  { dataIndex: 'path', key: 'path', title: t('page.scenes.detail.tables.resources.path'), width: 320 },
  { key: 'size', title: t('page.scenes.detail.tables.resources.size'), width: 140 },
];

const sceneColumns: TableColumnsType<ScenePackageSceneSummary> = [
  { dataIndex: 'name', key: 'name', title: t('page.scenes.detail.tables.scenes.name'), width: 180 },
  { dataIndex: 'sceneId', key: 'sceneId', title: t('page.scenes.detail.tables.scenes.sceneId'), width: 220 },
  { dataIndex: 'nodeCount', key: 'nodeCount', title: t('page.scenes.detail.tables.scenes.nodeCount'), width: 120 },
  { dataIndex: 'checkpointTotal', key: 'checkpointTotal', title: t('page.scenes.detail.tables.scenes.checkpointTotal'), width: 140 },
  { key: 'totalBytes', title: t('page.scenes.detail.tables.scenes.totalBytes'), width: 160 },
];

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function bytesToGb(value: unknown): number {
  return safeNumber(value) / 1024 ** 3;
}

function calculateCost(gb: number): number {
  return gb * safeNumber(unitPriceCnyPerGb.value) * Math.max(1, Math.floor(safeNumber(downloadCount.value) || 1));
}

function formatCurrency(value: number): string {
  return currencyFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString('zh-CN') : '-';
}

function formatGb(value: number): string {
  return `${value.toFixed(4)} GB`;
}

function formatResourceType(value: string): string {
  const key = `page.scenes.detail.resourceTypes.${value}`;
  const translated = t(key);
  return translated === key ? value : translated;
}

function sceneTotalBytes(row: ScenePackageSceneSummary): number {
  return safeNumber(row.sceneDocumentBytes) + safeNumber(row.sidecarBytes) + safeNumber(row.resourceBytes);
}

async function load() {
  loading.value = true;
  try {
    scene.value = await getSceneApi(id);
  } finally {
    loading.value = false;
  }
}

function goBack() {
  router.back();
}

onMounted(load);
</script>

<template>
  <div class="p-5">
    <Card :loading="loading">
      <div class="scene-detail-header">
        <h3>{{ t('page.scenes.detail.title') }}</h3>
        <Space>
          <Button type="default" @click="goBack">{{ t('page.scenes.detail.buttons.back') }}</Button>
        </Space>
      </div>

      <Alert
        v-if="!metadata"
        class="scene-detail-alert"
        type="warning"
        show-icon
        :message="t('page.scenes.detail.noMetadata')"
      />

      <Row :gutter="16" class="scene-detail-stats">
        <Col :xs="24" :sm="12" :lg="6">
          <Statistic :title="t('page.scenes.detail.stats.packageSize')" :value="formatFileSize(scene?.fileSize)" />
        </Col>
        <Col :xs="24" :sm="12" :lg="6">
          <Statistic :title="t('page.scenes.detail.stats.resourceSize')" :value="formatFileSize(metadata?.manifestResourceBytes)" />
        </Col>
        <Col :xs="24" :sm="12" :lg="6">
          <Statistic :title="t('page.scenes.detail.stats.sceneCount')" :value="metadata?.sceneCount ?? '-'" />
        </Col>
        <Col :xs="24" :sm="12" :lg="6">
          <Statistic :title="t('page.scenes.detail.stats.nodeCount')" :value="metadata?.nodeCountTotal ?? '-'" />
        </Col>
      </Row>

      <Descriptions bordered :column="1" size="small" class="scene-detail-section">
        <Descriptions.Item :label="t('page.scenes.detail.fields.id')">{{ scene?.id || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.scenes.detail.fields.name')">{{ scene?.name || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.scenes.detail.fields.fileUrl')">
          <a v-if="scene?.fileUrl" :href="scene.fileUrl" target="_blank" rel="noopener noreferrer">{{ scene.fileUrl }}</a>
          <span v-else>-</span>
        </Descriptions.Item>
        <Descriptions.Item :label="t('page.scenes.detail.fields.fileSize')">{{ formatFileSize(scene?.fileSize) }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.scenes.detail.fields.uncompressedEntryBytes')">{{ formatFileSize(metadata?.uncompressedEntryBytes) }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.scenes.detail.fields.resourceCount')">{{ formatNumber(metadata?.resourceCount) }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.scenes.detail.fields.checkpointTotal')">{{ scene?.checkpointTotal ?? 0 }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.scenes.detail.fields.zipEntryCount')">{{ formatNumber(metadata?.zipEntryCount) }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.scenes.detail.fields.generatedAt')">{{ metadata?.generatedAt || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.scenes.detail.fields.createdAt')">{{ scene?.createdAt || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.scenes.detail.fields.updatedAt')">{{ scene?.updatedAt || '-' }}</Descriptions.Item>
      </Descriptions>

      <div class="scene-detail-cost scene-detail-section">
        <div class="scene-detail-cost-controls">
          <Space wrap>
            <span>{{ t('page.scenes.detail.cost.unitPrice') }}</span>
            <InputNumber v-model:value="unitPriceCnyPerGb" :min="0" :precision="4" :step="0.01" />
            <span>{{ t('page.scenes.detail.cost.downloadCount') }}</span>
            <InputNumber v-model:value="downloadCount" :min="1" :precision="0" :step="100" />
          </Space>
        </div>
        <Row :gutter="16">
          <Col :xs="24" :md="8">
            <Statistic :title="t('page.scenes.detail.cost.packageTraffic')" :value="formatGb(packageGb)" />
          </Col>
          <Col :xs="24" :md="8">
            <Statistic :title="t('page.scenes.detail.cost.packageCost')" :value="formatCurrency(packageCost)" />
          </Col>
          <Col :xs="24" :md="8">
            <Statistic :title="t('page.scenes.detail.cost.resourceCost')" :value="formatCurrency(resourceCost)" />
          </Col>
        </Row>
      </div>

      <div class="scene-detail-section">
        <h4>{{ t('page.scenes.detail.tables.breakdown.title') }}</h4>
        <Table :columns="breakdownColumns" :data-source="breakdownRows" :pagination="false" row-key="key" size="small">
          <template #bodyCell="{ column, record: row }">
            <template v-if="column.key === 'value'">
              {{ formatFileSize(row.value) }}
            </template>
          </template>
        </Table>
      </div>

      <div class="scene-detail-section">
        <h4>{{ t('page.scenes.detail.tables.resources.title') }}</h4>
        <Table :columns="resourceColumns" :data-source="largestResources" :pagination="false" row-key="path" size="small" :scroll="{ x: 820 }">
          <template #bodyCell="{ column, record: row }">
            <template v-if="column.key === 'resourceType'">
              <Tag>{{ formatResourceType(row.resourceType) }}</Tag>
            </template>
            <template v-else-if="column.key === 'size'">
              {{ formatFileSize(row.size) }}
            </template>
          </template>
        </Table>
      </div>

      <div class="scene-detail-section">
        <h4>{{ t('page.scenes.detail.tables.scenes.title') }}</h4>
        <Table :columns="sceneColumns" :data-source="sceneSummaries" :pagination="false" row-key="sceneId" size="small" :scroll="{ x: 820 }">
          <template #bodyCell="{ column, record: row }">
            <template v-if="column.key === 'name'">
              {{ row.name || row.sceneId }}
            </template>
            <template v-else-if="column.key === 'totalBytes'">
              {{ formatFileSize(sceneTotalBytes(row)) }}
            </template>
          </template>
        </Table>
      </div>
    </Card>
  </div>
</template>

<style scoped>
.scene-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.scene-detail-header h3 {
  margin: 0;
}

.scene-detail-alert,
.scene-detail-section,
.scene-detail-stats {
  margin-top: 16px;
}

.scene-detail-cost {
  padding: 12px 0;
}

.scene-detail-cost-controls {
  margin-bottom: 12px;
}

.scene-detail-section h4 {
  margin: 0 0 12px;
}
</style>