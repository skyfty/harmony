<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { createUser, listUsers, removeUser, updateUser } from '@/api/modules/users'
import { listRoles } from '@/api/modules/roles'
import type { RoleSummary, UserMutationPayload, UserSummary } from '@/types'

const loading = ref(false)
const users = ref<UserSummary[]>([])
const total = ref(0)
const query = reactive({
  page: 1,
  pageSize: 10,
  keyword: '',
})

const roles = ref<RoleSummary[]>([])
const dialogOpen = ref(false)
const saving = ref(false)
const editingUser = ref<UserSummary | null>(null)
const form = reactive<UserMutationPayload>({
  username: '',
  password: '',
  email: '',
  displayName: '',
  roleIds: [],
  status: 'active',
})
const errorMessage = ref<string | null>(null)

const headers = [
  { title: '用户名', value: 'username', width: 160 },
  { title: '显示名称', value: 'displayName', width: 160 },
  { title: '邮箱', value: 'email', width: 220 },
  { title: '角色', value: 'roles', sortable: false, width: 200 },
  { title: '状态', value: 'status', width: 100 },
  { title: '创建时间', value: 'createdAt', width: 180 },
  { title: '操作', value: 'actions', sortable: false, align: 'end' as const, width: 120 },
]

function resetForm(): void {
  form.username = ''
  form.password = ''
  form.email = ''
  form.displayName = ''
  form.roleIds = []
  form.status = 'active'
  editingUser.value = null
  errorMessage.value = null
}

async function loadUsers(): Promise<void> {
  try {
    loading.value = true
    const { data, total: totalCount } = await listUsers({ ...query })
    users.value = data
    total.value = totalCount
  } catch (error) {
    console.error('Failed to list users', error)
  } finally {
    loading.value = false
  }
}

async function loadRoles(): Promise<void> {
  const { data } = await listRoles({ page: 1, pageSize: 100 })
  roles.value = data
}

function openCreateDialog(): void {
  resetForm()
  dialogOpen.value = true
}

function openEditDialog(user: UserSummary): void {
  editingUser.value = user
  form.username = user.username
  form.password = ''
  form.email = user.email ?? ''
  form.displayName = user.displayName ?? ''
  form.roleIds = user.roles.map((role) => role.id)
  form.status = user.status
  dialogOpen.value = true
  errorMessage.value = null
}

async function submitForm(): Promise<void> {
  if (!form.username || (!editingUser.value && !form.password)) {
    errorMessage.value = '请填写完整的用户信息'
    return
  }
  try {
    saving.value = true
    const payload: UserMutationPayload = {
      username: form.username,
      password: form.password || undefined,
      email: form.email || undefined,
      displayName: form.displayName || undefined,
      roleIds: [...form.roleIds],
      status: form.status,
    }
    if (editingUser.value) {
      await updateUser(editingUser.value.id, payload)
    } else {
      await createUser(payload)
    }
    dialogOpen.value = false
    resetForm()
    await loadUsers()
  } catch (error) {
    console.error('Failed to save user', error)
    errorMessage.value = '保存失败，请检查输入信息'
  } finally {
    saving.value = false
  }
}

async function handleRemove(user: UserSummary): Promise<void> {
  if (!confirm(`确定删除用户 ${user.username} 吗？`)) {
    return
  }
  try {
    await removeUser(user.id)
    await loadUsers()
  } catch (error) {
    console.error('Failed to delete user', error)
  }
}

function handlePageChange(page: number): void {
  query.page = page
  void loadUsers()
}

function handlePageSizeChange(size: number): void {
  query.pageSize = size
  query.page = 1
  void loadUsers()
}

function handleSearch(): void {
  query.page = 1
  void loadUsers()
}

onMounted(() => {
  void loadRoles()
  void loadUsers()
})
</script>

<template>
  <div>
    <v-card elevation="3">
      <v-card-title class="d-flex align-center">
        <span class="text-h6 font-weight-medium">用户管理</span>
        <v-spacer />
        <v-text-field
          v-model="query.keyword"
          density="compact"
          clearable
          placeholder="搜索用户名或邮箱"
          prepend-inner-icon="mdi-magnify"
          class="mr-3"
          @keyup.enter="handleSearch"
          @click:clear="handleSearch"
        />
        <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreateDialog">
          新建用户
        </v-btn>
      </v-card-title>
      <v-data-table-server
        :items="users"
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
        <template #item.roles="{ item }">
          <v-chip-group column>
            <v-chip v-for="role in item.roles" :key="role.id" density="comfortable" color="primary" variant="tonal">
              {{ role.name }}
            </v-chip>
          </v-chip-group>
        </template>
        <template #item.status="{ item }">
          <v-chip :color="item.status === 'active' ? 'success' : 'warning'" size="small" variant="tonal">
            {{ item.status === 'active' ? '启用' : '禁用' }}
          </v-chip>
        </template>
        <template #item.createdAt="{ item }">
          {{ item.createdAt ? new Date(item.createdAt).toLocaleString() : '--' }}
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
          {{ editingUser ? '编辑用户' : '新建用户' }}
        </v-card-title>
        <v-card-text>
          <v-text-field v-model="form.username" label="用户名" required />
          <v-text-field
            v-model="form.password"
            label="密码"
            type="password"
            :hint="editingUser ? '如不修改密码请留空' : ''"
            :persistent-hint="Boolean(editingUser)"
            :required="!editingUser"
          />
          <v-text-field v-model="form.displayName" label="显示名称" />
          <v-text-field v-model="form.email" label="邮箱" type="email" />
          <v-select
            v-model="form.roleIds"
            :items="roles"
            item-title="name"
            item-value="id"
            chips
            multiple
            label="角色"
          />
          <v-select
            v-model="form.status"
            :items="[
              { title: '启用', value: 'active' },
              { title: '禁用', value: 'disabled' },
            ]"
            label="状态"
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
