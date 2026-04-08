<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Button, Card, Descriptions, Space } from 'ant-design-vue'
import type { GetPunchRecordResponse } from '#/api'
import { getPunchRecordApi } from '#/api'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
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
        <h3 style="margin:0">{{ t('page.punchRecords.detail.title') }}</h3>
        <Space>
          <Button v-if="travelId" type="default" @click="goBackToTravelDetail">{{ t('page.punchRecords.detail.buttons.backToTravelDetail') }}</Button>
          <Button type="default" @click="goBack">{{ t('page.punchRecords.detail.buttons.back') }}</Button>
        </Space>
      </div>

      <Descriptions bordered :column="1" size="small">
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.id')">{{ record?.id || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.createdAt')">{{ record?.createdAt || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.clientPunchTime')">{{ record?.clientPunchTime || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.behaviorPunchTime')">{{ record?.behaviorPunchTime || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.sceneName')">{{ record?.sceneName || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.vehicleName')">{{ record?.vehicleName || record?.vehicleIdentifier || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.sceneId')">{{ record?.sceneId || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.scenicId')">{{ record?.scenicId || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.nodeName')">{{ record?.nodeName || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.nodeId')">{{ record?.nodeId || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.username')">{{ record?.username || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.userId')">{{ record?.userId || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.source')">{{ record?.source || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.path')">{{ record?.path || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.ip')">{{ record?.ip || '-' }}</Descriptions.Item>
        <Descriptions.Item :label="t('page.punchRecords.detail.fields.userAgent')">{{ record?.userAgent || '-' }}</Descriptions.Item>
      </Descriptions>
    </Card>
  </div>
</template>
