<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useVbenVxeGrid } from '#/adapter/vxe-table'
import { Button, Space, Modal, message, Tooltip } from 'ant-design-vue'
import { EyeOutlined, DeleteOutlined } from '@ant-design/icons-vue'
import { deletePunchRecordApi, listPunchRecordsApi } from '#/api'

const router = useRouter()
const { t } = useI18n()

const [Grid, gridApi] = useVbenVxeGrid<any>({
  formOptions: {
    schema: [
      { component: 'Input', fieldName: 'sceneId', label: t('page.punchRecords.index.form.sceneId'), componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'scenicId', label: t('page.punchRecords.index.form.scenicId'), componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'sceneName', label: t('page.punchRecords.index.form.sceneName'), componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'nodeId', label: t('page.punchRecords.index.form.nodeId'), componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'nodeName', label: t('page.punchRecords.index.form.nodeName'), componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'userId', label: t('page.punchRecords.index.form.userId'), componentProps: { allowClear: true } },
      { component: 'Input', fieldName: 'username', label: t('page.punchRecords.index.form.username'), componentProps: { allowClear: true } },
      { component: 'RangePicker', fieldName: 'createdAt', label: t('page.punchRecords.index.form.createdAt') },
    ],
  },
  gridOptions: {
    columns: [
      { field: 'createdAt', minWidth: 180, title: t('page.punchRecords.index.table.createdAt'), sortable: true, formatter: 'formatDateTime' },
      { field: 'scenicTitle', minWidth: 220, title: t('page.punchRecords.index.table.scenicTitle'), slots: { default: 'scenicTitle' } },
      { field: 'sceneName', minWidth: 160, title: t('page.punchRecords.index.table.sceneName') },
      { field: 'vehicleName', minWidth: 180, title: t('page.punchRecords.index.table.vehicleName'), slots: { default: 'vehicleName' } },
      { field: 'nodeName', minWidth: 160, title: t('page.punchRecords.index.table.nodeName') },
      { field: 'username', minWidth: 140, title: t('page.punchRecords.index.table.username') },
      { field: 'source', minWidth: 120, title: t('page.punchRecords.index.table.source') },
      {align: 'left', field: 'actions', minWidth: 160, fixed: 'right', title: t('page.punchRecords.index.table.actions'), slots: { default: 'actions' } },
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
})

function openDetail(row: any) {
  router.push({
    name: 'PunchRecordDetail',
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
    title: t('page.punchRecords.index.confirm.delete.title'),
    okType: 'danger',
    onOk: async () => {
      await deletePunchRecordApi(row.id)
      message.success(t('page.punchRecords.index.message.deleteSuccess'))
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
      <template #vehicleName="{ row }">
        {{ row.vehicleName || row.vehicleIdentifier || '-' }}
      </template>
      <template #actions="{ row }">
        <Space>
          <Tooltip :title="t('page.punchRecords.index.actions.detail')">
            <Button size="small" type="text" @click="() => openDetail(row)">
              <EyeOutlined />
            </Button>
          </Tooltip>
          <Tooltip :title="t('page.punchRecords.index.actions.delete')">
            <Button v-access:code="'punch:delete'" size="small" type="text" danger @click="() => handleDelete(row)">
              <DeleteOutlined />
            </Button>
          </Tooltip>
        </Space>
      </template>
    </Grid>
  </div>
</template>
