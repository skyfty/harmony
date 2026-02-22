<script setup lang="ts">
import { useVbenVxeGrid } from '#/adapter/vxe-table'
import { listPunchRecordsApi } from '#/api'

const [Grid] = useVbenVxeGrid<any>({
  formOptions: {
    schema: [
      { component: 'Input', fieldName: 'sceneId', label: '场景ID', componentProps: { allowClear: true } },
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
      { field: 'clientPunchTime', minWidth: 180, title: '客户端时间', sortable: true, formatter: 'formatDateTime' },
      { field: 'behaviorPunchTime', minWidth: 180, title: '行为触发时间', sortable: true, formatter: 'formatDateTime' },
      { field: 'sceneName', minWidth: 160, title: '场景名称' },
      { field: 'sceneId', minWidth: 220, title: '场景ID' },
      { field: 'nodeName', minWidth: 160, title: '打卡点名称' },
      { field: 'nodeId', minWidth: 220, title: '打卡点ID' },
      { field: 'username', minWidth: 140, title: '用户名' },
      { field: 'userId', minWidth: 220, title: '用户ID' },
      { field: 'source', minWidth: 120, title: '来源' },
      { field: 'path', minWidth: 220, title: '路径' },
      { field: 'ip', minWidth: 140, title: '来源IP' },
    ],
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          const params: Record<string, any> = {
            page: page.currentPage,
            pageSize: page.pageSize,
            sceneId: formValues.sceneId,
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
</script>

<template>
  <div class="p-5">
    <Grid />
  </div>
</template>
