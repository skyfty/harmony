<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { createPermission, listPermissions, removePermission, updatePermission } from '@/api/modules/permissions'
import type { PagedResponse, PermissionMutationPayload, PermissionSummary } from '@/types'

const permissions = ref<PermissionSummary[]>([])
const total = ref(0)
const loading = ref(false)
const dialogOpen = ref(false)
const saving = ref(false)
const editing = ref<PermissionSummary | null>(null)
const errorMessage = ref<string | null>(null)

const query = reactive({
  page: 1,
  pageSize: 10,
  keyword: '',
})

const form = reactive<PermissionMutationPayload>({
  name: '',
  code: '',
  description: '',
  group: '',
})

const headers = [
  { title: '权限名称', value: 'name', width: 200 },
  { title: '编码', value: 'code', width: 220 },
  { title: '分组', value: 'group', width: 160 },
  { title: '描述', value: 'description' },
  { title: '操作', value: 'actions', sortable: false, align: 'end' as const, width: 120 },
]

async function loadPermissions(): Promise<void> {
  try {
    loading.value = true
    const { data, total: totalCount }: PagedResponse<PermissionSummary> = await listPermissions({ ...query })
    permissions.value = data
    total.value = totalCount
  } catch (error) {
    console.error('Failed to fetch permissions', error)
  } finally {
    loading.value = false
  }
}

function openCreateDialog(): void {
  form.name = ''
  form.code = ''
  form.description = ''
  form.group = ''
  editing.value = null
  dialogOpen.value = true
  errorMessage.value = null
}

function openEditDialog(permission: PermissionSummary): void {
  editing.value = permission
  form.name = permission.name
  form.code = permission.code
  form.description = permission.description ?? ''
  form.group = permission.group ?? ''
  dialogOpen.value = true
  errorMessage.value = null
}

async function submitForm(): Promise<void> {
  if (!form.name || !form.code) {
    errorMessage.value = '请填写权限名称和编码'
    return
  }
  const payload: PermissionMutationPayload = {
    name: form.name,
    code: form.code,
    description: form.description || undefined,
    group: form.group || undefined,
  }
  try {
    saving.value = true
    if (editing.value) {
      await updatePermission(editing.value.id, payload)
    } else {
      await createPermission(payload)
    }
    dialogOpen.value = false
    await loadPermissions()
  } catch (error) {
    console.error('Failed to save permission', error)
    errorMessage.value = '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

async function handleRemove(permission: PermissionSummary): Promise<void> {
  if (!confirm(`确定删除权限 ${permission.name} 吗？`)) {
    return
  }
  try {
    await removePermission(permission.id)
    await loadPermissions()
  } catch (error) {
    console.error('Failed to delete permission', error)
  }
}

function handlePageChange(page: number): void {
  query.page = page
  void loadPermissions()
}

function handlePageSizeChange(size: number): void {
  query.pageSize = size
  query.page = 1
  void loadPermissions()
}

function handleSearch(): void {
  query.page = 1
  void loadPermissions()
}

onMounted(() => {
  void loadPermissions()
})
</script>

<template>
  <div>
    <v-card elevation="3">
      <v-card-title class="d-flex align-center">
        <span class="text-h6 font-weight-medium">权限管理</span>
        <v-spacer />
        <v-text-field
          v-model="query.keyword"
          density="compact"
          prepend-inner-icon="mdi-magnify"
          placeholder="搜索权限"
          clearable
          class="mr-3"
          @keyup.enter="handleSearch"
          @click:clear="handleSearch"
        />
        <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreateDialog">
          新建权限
        </v-btn>
      </v-card-title>
      <v-data-table-server
        :items="permissions"
        :items-length="total"
        :loading="loading"
        :page="query.page"
        :items-per-page="query.pageSize"
        :headers="headers"
        item-value="id"
        class="elevation-0"
        @update:page="handlePageChange"
        @update:items-per-page="handlePageSizeChange"
      >
        <template #item.actions="{ item }">
          <v-btn icon="mdi-pencil" size="small" variant="text" @click="openEditDialog(item)" />
          <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="handleRemove(item)" />
        </template>
      </v-data-table-server>
    </v-card>

    <v-dialog v-model="dialogOpen" max-width="520">
      <v-card>
        <v-card-title class="text-h6 font-weight-medium">
          {{ editing ? '编辑权限' : '新建权限' }}
        </v-card-title>
        <v-card-text>
          <v-text-field v-model="form.name" label="权限名称" required />
          <v-text-field v-model="form.code" label="编码" required />
          <v-text-field v-model="form.group" label="分组" />
          <v-textarea v-model="form.description" label="描述" rows="3" auto-grow />
          <v-alert v-if="errorMessage" type="error" density="compact" class="mt-4">
            {{ errorMessage }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialogOpen = false">取消</v-btn>
          <v-btn color="primary" :loading="saving" @click="submitForm">
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
