<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { createRole, listRoles, removeRole, updateRole } from '@/services/modules/roles'
import { listPermissions } from '@/services/modules/permissions'
import type {
  PermissionSummary,
  RoleMutationPayload,
  RoleSummary,
} from '@/types'

const roles = ref<RoleSummary[]>([])
const permissions = ref<PermissionSummary[]>([])
const total = ref(0)
const loading = ref(false)
const dialogOpen = ref(false)
const saving = ref(false)
const editingRole = ref<RoleSummary | null>(null)
const errorMessage = ref<string | null>(null)

const query = reactive({
  page: 1,
  pageSize: 10,
  keyword: '',
})

const form = reactive<RoleMutationPayload>({
  name: '',
  code: '',
  description: '',
  permissionIds: [],
})

const headers = [
  { title: '角色名称', value: 'name', width: 180 },
  { title: '标识', value: 'code', width: 160 },
  { title: '描述', value: 'description' },
  { title: '权限', value: 'permissions', sortable: false, width: 280 },
  { title: '操作', value: 'actions', sortable: false, align: 'end' as const, width: 120 },
]

function resetForm(): void {
  form.name = ''
  form.code = ''
  form.description = ''
  form.permissionIds = []
  editingRole.value = null
  errorMessage.value = null
}

async function loadPermissions(): Promise<void> {
  const { data } = await listPermissions({ page: 1, pageSize: 200 })
  permissions.value = data
}

async function loadRoles(): Promise<void> {
  try {
    loading.value = true
    const { data, total: totalCount } = await listRoles({ ...query })
    roles.value = data
    total.value = totalCount
  } catch (error) {
    console.error('Failed to load roles', error)
  } finally {
    loading.value = false
  }
}

function openCreateDialog(): void {
  resetForm()
  dialogOpen.value = true
}

function openEditDialog(role: RoleSummary): void {
  editingRole.value = role
  form.name = role.name
  form.code = role.code
  form.description = role.description ?? ''
  form.permissionIds = [...role.permissions]
  dialogOpen.value = true
}

async function submitForm(): Promise<void> {
  if (!form.name || !form.code) {
    errorMessage.value = '请填写完整的角色信息'
    return
  }
  try {
    saving.value = true
    const payload: RoleMutationPayload = {
      name: form.name,
      code: form.code,
      description: form.description || undefined,
      permissionIds: [...form.permissionIds],
    }
    if (editingRole.value) {
      await updateRole(editingRole.value.id, payload)
    } else {
      await createRole(payload)
    }
    dialogOpen.value = false
    resetForm()
    await loadRoles()
  } catch (error) {
    console.error('Failed to save role', error)
    errorMessage.value = '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

async function handleRemove(role: RoleSummary): Promise<void> {
  if (!confirm(`确定删除角色 ${role.name} 吗？`)) {
    return
  }
  try {
    await removeRole(role.id)
    await loadRoles()
  } catch (error) {
    console.error('Failed to delete role', error)
  }
}

function handlePageChange(page: number): void {
  query.page = page
  void loadRoles()
}

function handlePageSizeChange(size: number): void {
  query.pageSize = size
  query.page = 1
  void loadRoles()
}

function handleSearch(): void {
  query.page = 1
  void loadRoles()
}

onMounted(() => {
  void loadPermissions()
  void loadRoles()
})
</script>

<template>
  <div>
    <v-card elevation="3">
      <v-card-title class="d-flex align-center">
        <span class="text-h6 font-weight-medium">角色管理</span>
        <v-spacer />
        <v-text-field
          v-model="query.keyword"
          density="compact"
          placeholder="搜索角色名称"
          clearable
          prepend-inner-icon="mdi-magnify"
          class="mr-3"
          @keyup.enter="handleSearch"
          @click:clear="handleSearch"
        />
        <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreateDialog">
          新建角色
        </v-btn>
      </v-card-title>
      <v-data-table-server
        :items="roles"
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
        <template #item.permissions="{ item }">
          <v-chip-group column>
            <v-chip
              v-for="permission in item.permissions"
              :key="permission"
              density="comfortable"
              color="primary"
              variant="tonal"
            >
              {{ permission }}
            </v-chip>
          </v-chip-group>
        </template>
        <template #item.actions="{ item }">
          <v-btn icon="mdi-pencil" size="small" variant="text" @click="openEditDialog(item)" />
          <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="handleRemove(item)" />
        </template>
      </v-data-table-server>
    </v-card>

    <v-dialog v-model="dialogOpen" max-width="560">
      <v-card>
        <v-card-title class="text-h6 font-weight-medium">
          {{ editingRole ? '编辑角色' : '新建角色' }}
        </v-card-title>
        <v-card-text>
          <v-text-field v-model="form.name" label="角色名称" required />
          <v-text-field v-model="form.code" label="标识" required />
          <v-textarea v-model="form.description" label="描述" rows="3" auto-grow />
          <v-autocomplete
            v-model="form.permissionIds"
            :items="permissions"
            item-title="name"
            item-value="code"
            multiple
            chips
            label="权限"
          />
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
