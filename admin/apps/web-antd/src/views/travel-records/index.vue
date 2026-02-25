<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useVbenVxeGrid } from '#/adapter/vxe-table'
import { Button, Modal, Space, message } from 'ant-design-vue'
import { deleteTravelRecordApi, listTravelRecordsApi } from '#/api'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const { t } = useI18n()

const [Grid, gridApi] = useVbenVxeGrid<any>({
  formOptions: {
    schema: [
      { component: 'Input', fieldName: 'sceneId', label: t('page.travelRecords.index.form.sceneId'), componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'scenicId', label: t('page.travelRecords.index.form.scenicId'), componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'sceneName', label: t('page.travelRecords.index.form.sceneName'), componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'userId', label: t('page.travelRecords.index.form.userId'), componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'username', label: t('page.travelRecords.index.form.username'), componentProps: { allowClear: true } },
      {
        component: 'Select',
        fieldName: 'status',
        label: t('page.travelRecords.index.form.status'),
        componentProps: {
          allowClear: true,
          options: [
            { label: t('page.travelRecords.index.status.active'), value: 'active' },
            { label: t('page.travelRecords.index.status.completed'), value: 'completed' },
          ],
        },
      },
      { component: 'RangePicker', fieldName: 'enterTimeRange', label: t('page.travelRecords.index.form.enterTimeRange') },
    ],
  },
  gridOptions: {
    columns: [
      { field: 'enterTime', minWidth: 180, title: t('page.travelRecords.index.table.enterTime'), sortable: true, formatter: 'formatDateTime' },
      { field: 'leaveTime', minWidth: 180, title: t('page.travelRecords.index.table.leaveTime'), sortable: true, formatter: 'formatDateTime' },
      { field: 'durationSeconds', minWidth: 120, title: t('page.travelRecords.index.table.durationSeconds') },
      { field: 'scenicTitle', minWidth: 220, title: t('page.travelRecords.index.table.scenicTitle'), slots: { default: 'scenicTitle' } },
      { field: 'sceneName', minWidth: 160, title: t('page.travelRecords.index.table.sceneName') },
      { field: 'sceneCheckpointTotal', minWidth: 140, title: t('page.travelRecords.index.table.sceneCheckpointTotal') },
      { field: 'username', minWidth: 140, title: t('page.travelRecords.index.table.username') },
      {
        field: 'status',
        minWidth: 120,
        title: t('page.travelRecords.index.table.status'),
        formatter: (params: { cellValue?: string }) => (params.cellValue === 'completed' ? t('page.travelRecords.index.status.completed') : t('page.travelRecords.index.status.active')),
      },
      { align: 'left', field: 'actions', minWidth: 160, fixed: 'right', title: t('page.travelRecords.index.table.actions'), slots: { default: 'actions' } },
    ],
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          const params: Record<string, any> = {
            page: page.currentPage,
            pageSize: page.pageSize,
            sceneId: formValues.sceneId,
            scenicId: formValues.scenicId,
            sceneName: formValues.sceneName,
            userId: formValues.userId,
            username: formValues.username,
            status: formValues.status,
          }
          if (formValues.enterTimeRange?.length) {
            params.start = formValues.enterTimeRange[0]
            params.end = formValues.enterTimeRange[1]
          }
          return await listTravelRecordsApi(params)
        },
      },
    },
    toolbarConfig: { refresh: true, search: true },
  },
})

function openDetail(row: any) {
  router.push({
    name: 'TravelRecordDetail',
    params: { id: row.id },
  })
}

function openScenicDetail(row: any) {
  if (!row?.scenicId) {
    return
  }
  router.push({
    name: 'SceneSpotDetail',
    params: { id: row.scenicId },
  })
}

function handleDelete(row: any) {
  Modal.confirm({
    title: t('page.travelRecords.index.confirm.delete.title'),
    okType: 'danger',
    onOk: async () => {
      await deleteTravelRecordApi(row.id)
      message.success(t('page.travelRecords.index.message.deleteSuccess'))
      gridApi.reload()
    },
  })
}
</script>

<template>
  <div class="p-5">
    <Grid>
      <template #scenicTitle="{ row }">
        <Button type="link" size="small" @click="() => openScenicDetail(row)">
          {{ row.scenicTitle || row.scenicId || '-' }}
        </Button>
      </template>
      <template #actions="{ row }">
        <Space>
          <Button size="small" type="link" @click="() => openDetail(row)">{{ t('page.travelRecords.index.actions.detail') }}</Button>
          <Button v-access:code="'travel:delete'" size="small" type="link" danger @click="() => handleDelete(row)">{{ t('page.travelRecords.index.actions.delete') }}</Button>
        </Space>
      </template>
    </Grid>
  </div>
</template>
