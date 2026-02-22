<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useVbenVxeGrid } from '#/adapter/vxe-table'
import { Button, Space, Modal, message } from 'ant-design-vue'
import { deletePunchRecordApi, listPunchRecordsApi } from '#/api'

const router = useRouter()

const [Grid, gridApi] = useVbenVxeGrid<any>({
  formOptions: {
    schema: [
      { component: 'Input', fieldName: 'sceneId', label: '场景ID', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'scenicId', label: '景点ID', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'sceneName', label: '场景名称', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'nodeId', label: '打卡点ID', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'nodeName', label: '打卡点名称', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'userId', label: '用户ID', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'username', label: '用户名', componentProps: { allowClear: true } },
      { component: 'RangePicker', fieldName: 'createdAt', label: '时间范围' },
    ],
  },
  gridOptions: {
    columns: [
      { field: 'createdAt', minWidth: 180, title: '服务端时间', sortable: true, formatter: 'formatDateTime' },
      { field: 'scenicId', minWidth: 180, title: '景点ID' },
      { field: 'sceneName', minWidth: 160, title: '场景名称' },
      { field: 'nodeName', minWidth: 160, title: '打卡点名称' },
      { field: 'username', minWidth: 140, title: '用户名' },
      { field: 'source', minWidth: 120, title: '来源' },
      {align: 'left', field: 'actions', minWidth: 160, fixed: 'right', title: '操作', slots: { default: 'actions' } },
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
            nodeId: formValues.nodeId,
            nodeName: formValues.nodeName,
            userId: formValues.userId,
            username: formValues.username,
          }
          if (formValues.createdAt?.length) {
            params.start = formValues.createdAt[0]
            params.end = formValues.createdAt[1]
          }
          return await listPunchRecordsApi(params)
        },
      },
    },
    toolbarConfig: { refresh: true, search: true },
  },
  tableTitle: '打卡记录',
})

function openDetail(row: any) {
  router.push({
    name: 'PunchRecordDetail',
    params: { id: row.id },
  })
}

function handleDelete(row: any) {
  Modal.confirm({
    title: '确认删除该条打卡记录？',
    okType: 'danger',
    onOk: async () => {
      await deletePunchRecordApi(row.id)
      message.success('删除成功')
      gridApi.reload()
    },
  })
}
</script>

<template>
  <div class="p-5">
    <Grid>
      <template #actions="{ row }">
        <Space>
          <Button size="small" type="link" @click="() => openDetail(row)">详情</Button>
          <Button v-access:code="'punch:delete'" size="small" type="link" danger @click="() => handleDelete(row)">删除</Button>
        </Space>
      </template>
    </Grid>
  </div>
</template>
