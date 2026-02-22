<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Card, Descriptions, Space, Table } from 'ant-design-vue'
import type { GetTravelRecordResponse, PunchRecordItem } from '#/api'
import { getTravelRecordApi, listPunchRecordsApi } from '#/api'

const route = useRoute()
const router = useRouter()
const id = String(route.params.id ?? '')

const loading = ref(true)
const punchLoading = ref(false)
const record = ref<GetTravelRecordResponse | null>(null)
const punchRecords = ref<PunchRecordItem[]>([])

const punchColumns = [
  { title: '打卡时间', key: 'punchTime', width: 200 },
  { title: '打卡位置', key: 'nodeName', width: 180 },
  { title: '打卡点ID', dataIndex: 'nodeId', key: 'nodeId', width: 180 },
  { title: '来源', dataIndex: 'source', key: 'source', width: 120 },
  { title: '操作', key: 'actions', width: 120, fixed: 'right' },
]

function resolvePunchTime(item: PunchRecordItem): string {
  return item.clientPunchTime || item.behaviorPunchTime || item.createdAt || '-'
}

async function loadPunchRecords(): Promise<void> {
  if (!record.value?.sceneId || !record.value?.userId) {
    punchRecords.value = []
    return
  }

  punchLoading.value = true
  try {
    const result = await listPunchRecordsApi({
      page: 1,
      pageSize: 200,
      sceneId: record.value.sceneId,
      userId: record.value.userId,
    })
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

function openPunchDetailInNewTab(item: PunchRecordItem): void {
  if (!item.id) {
    return
  }
  const resolved = router.resolve({
    name: 'PunchRecordDetail',
    params: { id: item.id },
    query: { travelId: id },
  })
  window.open(resolved.href, '_blank')
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
        <h3 style="margin:0">游历记录详情</h3>
        <Space>
          <Button type="default" @click="goBack">返回</Button>
        </Space>
      </div>

      <Descriptions bordered :column="1" size="small">
        <Descriptions.Item label="记录ID">{{ record?.id || '-' }}</Descriptions.Item>
        <Descriptions.Item label="状态">{{ record?.status === 'completed' ? '已完成' : '进行中' }}</Descriptions.Item>
        <Descriptions.Item label="进入时间">{{ record?.enterTime || '-' }}</Descriptions.Item>
        <Descriptions.Item label="离开时间">{{ record?.leaveTime || '-' }}</Descriptions.Item>
        <Descriptions.Item label="停留时长(秒)">{{ record?.durationSeconds ?? '-' }}</Descriptions.Item>
        <Descriptions.Item label="场景名称">{{ record?.sceneName || '-' }}</Descriptions.Item>
        <Descriptions.Item label="场景ID">{{ record?.sceneId || '-' }}</Descriptions.Item>
        <Descriptions.Item label="用户名">{{ record?.username || '-' }}</Descriptions.Item>
        <Descriptions.Item label="用户ID">{{ record?.userId || '-' }}</Descriptions.Item>
        <Descriptions.Item label="来源">{{ record?.source || '-' }}</Descriptions.Item>
        <Descriptions.Item label="路径">{{ record?.path || '-' }}</Descriptions.Item>
        <Descriptions.Item label="来源IP">{{ record?.ip || '-' }}</Descriptions.Item>
        <Descriptions.Item label="User-Agent">{{ record?.userAgent || '-' }}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{{ record?.createdAt || '-' }}</Descriptions.Item>
      </Descriptions>

      <div style="margin-top: 16px;">
        <h4 style="margin:0 0 12px;">场景打卡记录</h4>
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
              <Button type="link" size="small" @click="openPunchDetailInNewTab(row as PunchRecordItem)">查看详情</Button>
            </template>
          </template>
        </Table>
      </div>
    </Card>
  </div>
</template>
