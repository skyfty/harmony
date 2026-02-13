<script setup lang="ts">
import { ref } from 'vue'
import { useVbenVxeGrid } from '#/adapter/vxe-table'
import { Button, Modal, message } from 'ant-design-vue'
import { listLoginLogsApi, deleteLoginLogApi, bulkDeleteLoginLogsApi, exportLoginLogsApi } from '#/api'

const deleting = ref<string | null>(null)

const [Grid, gridApi] = useVbenVxeGrid<any>({
  formOptions: {
    schema: [
      { component: 'Input', fieldName: 'keyword', label: '关键字', componentProps: { placeholder: '用户名 / IP / UA', allowClear: true } },
      { component: 'Input', fieldName: 'username', label: '用户名', componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'ip', label: '来源IP', componentProps: { allowClear: true } },
      { component: 'Select', fieldName: 'success', label: '结果', componentProps: { allowClear: true, options: [{ label: '成功', value: 'true' }, { label: '失败', value: 'false' }] } },
      { component: 'RangePicker', fieldName: 'createdAt', label: '时间范围' },
    ],
  },
  gridOptions: {
    columns: [
      { field: 'createdAt', minWidth: 180, title: '时间', sortable: true, formatter: 'formatDateTime' },
      { field: 'username', minWidth: 140, title: '用户名' },
      { field: 'userId', minWidth: 220, title: '用户ID' },
      { field: 'action', minWidth: 120, title: '动作' },
      { field: 'success', minWidth: 100, title: '结果', slots: { default: 'success' } },
      { field: 'ip', minWidth: 140, title: '来源IP' },
      { field: 'device', minWidth: 160, title: '设备' },
      { field: 'userAgent', minWidth: 260, title: 'User-Agent', slots: { default: 'userAgent' } },
      { field: 'note', minWidth: 180, title: '备注' },
      { field: 'actions', minWidth: 160, fixed: 'right', title: '操作', slots: { default: 'actions' } },
    ],
    pagerConfig: { pageSize: 20 },
    proxyConfig: {
      ajax: {
        query: async ({ page }: any, formValues: Record<string, any>) => {
          const params: any = {
            keyword: formValues.keyword,
            username: formValues.username,
            ip: formValues.ip,
            success: formValues.success,
            page: page.currentPage,
            pageSize: page.pageSize,
          }
          if (formValues.createdAt?.length) {
            params.start = formValues.createdAt[0]
            params.end = formValues.createdAt[1]
          }
          return await listLoginLogsApi(params)
        },
      },
    },
    toolbarConfig: { refresh: true, search: true },
  },
  tableTitle: '登录日志',
})

function handleDelete(row: any) {
  Modal.confirm({
    title: `确认删除该条登录日志？`,
    okType: 'danger',
    onOk: async () => {
      deleting.value = row.id
      await deleteLoginLogApi(row.id)
      message.success('删除成功')
      gridApi.reload()
      deleting.value = null
    },
  })
}

async function handleBulkDelete() {
  const selected = await gridApi.getSelectedRows()
  if (!selected.length) {
    message.warning('请选择要删除的记录')
    return
  }
  Modal.confirm({
    title: `确认删除选中的 ${selected.length} 条记录？`,
    okType: 'danger',
    onOk: async () => {
      const ids = selected.map((r: any) => r.id)
      await bulkDeleteLoginLogsApi(ids)
      message.success('删除成功')
      gridApi.reload()
    },
  })
}

async function handleExport() {
  const form = await gridApi.getFormValues()
  const params: any = {
    keyword: form.keyword,
    username: form.username,
    ip: form.ip,
    success: form.success,
  }
  if (form.createdAt?.length) {
    params.start = form.createdAt[0]
    params.end = form.createdAt[1]
  }
  const blob = await exportLoginLogsApi(params)
  const url = window.URL.createObjectURL(new Blob([blob]))
  const a = document.createElement('a')
  a.href = url
  a.download = `login-logs.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="p-5">
    <Grid>
      <template #toolbar-actions>
        <Button v-access:code="'auth:export'" type="primary" @click="handleExport">导出</Button>
        <Button v-access:code="'auth:delete'" danger @click="handleBulkDelete">批量删除</Button>
      </template>

      <template #success="{ row }">
        <a-tag :color="row.success ? 'success' : 'default'">{{ row.success ? '成功' : '失败' }}</a-tag>
      </template>

      <template #userAgent="{ row }">
        <div style="max-width:420px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ row.userAgent }}</div>
      </template>

      <template #actions="{ row }">
        <a-space>
          <a-button size="small" type="link" @click="() => gridApi.viewRow(row)">查看</a-button>
          <a-button size="small" type="link" danger @click="() => handleDelete(row)">删除</a-button>
        </a-space>
      </template>
    </Grid>
  </div>
</template>
