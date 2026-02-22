<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Card, Descriptions, Space } from 'ant-design-vue'
import type { GetPunchRecordResponse } from '#/api'
import { getPunchRecordApi } from '#/api'

const route = useRoute()
const router = useRouter()
const id = String(route.params.id ?? '')

const loading = ref(true)
const record = ref<GetPunchRecordResponse | null>(null)

const travelId = computed(() => {
  const raw = route.query.travelId
  if (typeof raw === 'string') {
    return raw
  }
  return ''
})

async function load() {
  loading.value = true
  try {
    record.value = await getPunchRecordApi(id)
  } finally {
    loading.value = false
  }
}

function goBack() {
  router.back()
}

function goBackToTravelDetail() {
  if (!travelId.value) {
    return
  }
  router.push({
    name: 'TravelRecordDetail',
    params: { id: travelId.value },
  })
}

onMounted(load)
</script>

<template>
  <div class="p-5">
    <Card :loading="loading">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0">打卡记录详情</h3>
        <Space>
          <Button v-if="travelId" type="default" @click="goBackToTravelDetail">返回游历详情</Button>
          <Button type="default" @click="goBack">返回</Button>
        </Space>
      </div>

      <Descriptions bordered :column="1" size="small">
        <Descriptions.Item label="记录ID">{{ record?.id || '-' }}</Descriptions.Item>
        <Descriptions.Item label="服务端时间">{{ record?.createdAt || '-' }}</Descriptions.Item>
        <Descriptions.Item label="客户端时间">{{ record?.clientPunchTime || '-' }}</Descriptions.Item>
        <Descriptions.Item label="行为触发时间">{{ record?.behaviorPunchTime || '-' }}</Descriptions.Item>
        <Descriptions.Item label="场景名称">{{ record?.sceneName || '-' }}</Descriptions.Item>
        <Descriptions.Item label="场景ID">{{ record?.sceneId || '-' }}</Descriptions.Item>
        <Descriptions.Item label="景点ID">{{ record?.scenicId || '-' }}</Descriptions.Item>
        <Descriptions.Item label="打卡点名称">{{ record?.nodeName || '-' }}</Descriptions.Item>
        <Descriptions.Item label="打卡点ID">{{ record?.nodeId || '-' }}</Descriptions.Item>
        <Descriptions.Item label="用户名">{{ record?.username || '-' }}</Descriptions.Item>
        <Descriptions.Item label="用户ID">{{ record?.userId || '-' }}</Descriptions.Item>
        <Descriptions.Item label="来源">{{ record?.source || '-' }}</Descriptions.Item>
        <Descriptions.Item label="路径">{{ record?.path || '-' }}</Descriptions.Item>
        <Descriptions.Item label="来源IP">{{ record?.ip || '-' }}</Descriptions.Item>
        <Descriptions.Item label="User-Agent">{{ record?.userAgent || '-' }}</Descriptions.Item>
      </Descriptions>
    </Card>
  </div>
</template>
