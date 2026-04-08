<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { TableColumnsType } from 'ant-design-vue'
import { Button, Card, Descriptions, Space, Table } from 'ant-design-vue'
import type { GetTravelRecordResponse, PunchRecordItem } from '#/api'
import { getTravelRecordApi, listPunchRecordsApi } from '#/api'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const id = String(route.params.id ?? '')

const loading = ref(true)
const punchLoading = ref(false)
const record = ref<GetTravelRecordResponse | null>(null)
const punchRecords = ref<PunchRecordItem[]>([])

const dedupedNodeAchievementCount = computed(() => {
  const nodeIds = new Set<string>()
  for (const item of punchRecords.value) {
    const nodeId = normalizeQueryValue(item.nodeId)
    if (nodeId) {
      nodeIds.add(nodeId)
    }
  }
  return nodeIds.size
})

const displayAchievementCount = computed(() => {
  const apiCount = Number(record.value?.achievementCount)
  if (Number.isFinite(apiCount) && apiCount >= 0) {
    return apiCount
  }
  return dedupedNodeAchievementCount.value
})

const punchColumns: TableColumnsType<PunchRecordItem> = [
  { title: t('page.travelRecords.detail.punchTable.punchTime'), key: 'punchTime', width: 200 },
  { title: t('page.travelRecords.detail.punchTable.nodeName'), key: 'nodeName', width: 180 },
  { title: t('page.travelRecords.detail.punchTable.nodeId'), dataIndex: 'nodeId', key: 'nodeId', width: 180 },
  { title: t('page.travelRecords.detail.punchTable.source'), dataIndex: 'source', key: 'source', width: 120 },
  { title: t('page.travelRecords.detail.punchTable.actions'), key: 'actions', width: 120, fixed: 'right' as const },
]

function resolvePunchTime(item: PunchRecordItem): string {
  return item.clientPunchTime || item.behaviorPunchTime || item.createdAt || '-'
}

function normalizeQueryValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number') {
    return String(value)
  }
  if (value && typeof value === 'object') {
    const oid = (value as { $oid?: unknown }).$oid
    if (typeof oid === 'string') {
      return oid.trim()
    }
  }
  return ''
}

async function loadPunchRecords(): Promise<void> {
  const scenicId = normalizeQueryValue(record.value?.scenicId)
  const userId = normalizeQueryValue((record.value as { userId?: unknown } | null)?.userId)
  if (!scenicId) {
    punchRecords.value = []
    return
  }

  punchLoading.value = true
  try {
    const params: Parameters<typeof listPunchRecordsApi>[0] = {
      page: 1,
      pageSize: 200,
      scenicId,
    }

    if (userId) {
      params.userId = userId
    }


    const result = await listPunchRecordsApi(params)
    punchRecords.value = Array.isArray(result.items) ? result.items : []
  } finally {
    punchLoading.value = false
  }
}

async function load() {
  loading.value = true
  try {
    record.value = await getTravelRecordApi(id)
    await loadPunchRecords()
  } finally {
    loading.value = false
  }
}

function openPunchDetail(item: PunchRecordItem): void {
  if (!item.id) {
    return
  }
  router.push({
    name: 'PunchRecordDetail',
    params: { id: item.id },
    query: { travelId: id },
  })
}

function goBack() {
  router.back()
}

onMounted(load)
</script>

<template>
  <div class="p-5">
    <Card :loading="loading">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0">{{ t('page.travelRecords.detail.title') }}</h3>
        <Space>
          <Button type="default" @click="goBack">{{ t('page.travelRecords.detail.buttons.back') }}</Button>
        </Space>
      </div>

      <Descriptions bordered :column="1" size="small">
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.id')">{{ record?.id || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.status')">{{ record?.status === 'completed' ? t('page.travelRecords.detail.status.completed') : t('page.travelRecords.detail.status.active') }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.enterTime')">{{ record?.enterTime || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.leaveTime')">{{ record?.leaveTime || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.durationSeconds')">{{ record?.durationSeconds ?? '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.achievementCount')">{{ displayAchievementCount }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.sceneName')">{{ record?.sceneName || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.vehicleName')">{{ record?.vehicleName || record?.vehicleIdentifier || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.sceneCheckpointTotal')">{{ record?.sceneCheckpointTotal ?? 0 }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.sceneId')">{{ record?.sceneId || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.scenicId')">{{ record?.scenicId || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.username')">{{ record?.username || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.userId')">{{ record?.userId || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.source')">{{ record?.source || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.path')">{{ record?.path || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.ip')">{{ record?.ip || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.userAgent')">{{ record?.userAgent || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.travelRecords.detail.fields.createdAt')">{{ record?.createdAt || '-' }}</Descriptions.Item>
      </Descriptions>

      <div style="margin-top: 16px;">
        <h4 style="margin:0 0 12px;">{{ t('page.travelRecords.detail.punchTable.title') }}</h4>
        <Table
          :columns="punchColumns"
          :data-source="punchRecords"
          :loading="punchLoading"
          :pagination="false"
          row-key="id"
          :scroll="{ x: 880 }"
        >
          <template #bodyCell="{ column, record: row }">
            <template v-if="column.key === 'punchTime'">
              {{ resolvePunchTime(row as PunchRecordItem) }}
            </template>
            <template v-else-if="column.key === 'nodeName'">
              {{ (row as PunchRecordItem).nodeName || (row as PunchRecordItem).nodeId || '-' }}
            </template>
            <template v-else-if="column.key === 'actions'">
              <Button type="link" size="small" @click="openPunchDetail(row as PunchRecordItem)">{{ t('page.travelRecords.detail.buttons.viewPunchDetail') }}</Button>
            </template>
          </template>
        </Table>
      </div>
    </Card>
  </div>
</template>
