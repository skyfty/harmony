<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useVbenVxeGrid } from '#/adapter/vxe-table'
import { Button, Modal, Space, message } from 'ant-design-vue'
import { deleteTravelRecordApi, listTravelRecordsApi } from '#/api'

const router = useRouter()

const [Grid, gridApi] = useVbenVxeGrid<any>({
  formOptions: {
    schema: [
      { component: 'Input', fieldName: 'sceneId', label: '场景ID', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'scenicId', label: '景点ID', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'sceneName', label: '场景名称', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'userId', label: '用户ID', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'username', label: '用户名', componentProps: { allowClear: true } },
      {
        component: 'Select',
        fieldName: 'status',
        label: '状态',
        componentProps: {
          allowClear: true,
          options: [
            { label: '进行中', value: 'active' },
            { label: '已完成', value: 'completed' },
          ],
        },
      },
      { component: 'RangePicker', fieldName: 'enterTimeRange', label: '进入时间范围' },
    ],
  },
  gridOptions: {
    columns: [
      { field: 'enterTime', minWidth: 180, title: '进入时间', sortable: true, formatter: 'formatDateTime' },
      { field: 'leaveTime', minWidth: 180, title: '离开时间', sortable: true, formatter: 'formatDateTime' },
      { field: 'durationSeconds', minWidth: 120, title: '停留(秒)' },
      { field: 'scenicTitle', minWidth: 220, title: '景点名称', slots: { default: 'scenicTitle' } },
      { field: 'sceneName', minWidth: 160, title: '场景名称' },
      { field: 'username', minWidth: 140, title: '用户名' },
      {
        field: 'status',
        minWidth: 120,
        title: '状态',
        formatter: (params: { cellValue?: string }) => (params.cellValue === 'completed' ? '已完成' : '进行中'),
      },
      { align: 'left', field: 'actions', minWidth: 160, fixed: 'right', title: '操作', slots: { default: 'actions' } },
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
  tableTitle: '游历记录',
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
    title: '确认删除该条游历记录？',
    okType: 'danger',
    onOk: async () => {
      await deleteTravelRecordApi(row.id)
      message.success('删除成功')
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
          <Button size="small" type="link" @click="() => openDetail(row)">详情</Button>
          <Button v-access:code="'travel:delete'" size="small" type="link" danger @click="() => handleDelete(row)">删除</Button>
        </Space>
      </template>
    </Grid>
  </div>
</template>
