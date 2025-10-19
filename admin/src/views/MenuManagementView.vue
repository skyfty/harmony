<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { createMenu, listMenus, removeMenu, updateMenu } from '@/services/modules/menus'
import type { MenuItem, MenuMutationPayload } from '@/types'

const menus = ref<MenuItem[]>([])
const selected = ref<string | null>(null)
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

const form = reactive<MenuMutationPayload>({
  name: '',
  icon: '',
  routeName: '',
  order: 0,
  permission: '',
  parentId: null,
})

const currentMenu = computed(() => findMenuById(selected.value, menus.value))
const menuOptions = computed(() => flattenMenuOptions(menus.value))

function findMenuById(id: string | null, items: MenuItem[]): MenuItem | null {
  if (!id) {
    return null
  }
  for (const item of items) {
    if (item.id === id) {
      return item
    }
    if (item.children?.length) {
      const match = findMenuById(id, item.children)
      if (match) {
        return match
      }
    }
  }
  return null
}

function mapMenusToTree(items: MenuItem[]): MenuItem[] {
  return items.map((item) => ({
    ...item,
    children: item.children ? mapMenusToTree(item.children) : undefined,
  }))
}

function flattenMenuOptions(items: MenuItem[], depth = 0, acc: Array<{ id: string; name: string }> = []): Array<{ id: string; name: string }> {
  items.forEach((item) => {
    const prefix = depth ? `${'— '.repeat(depth)}` : ''
    acc.push({ id: item.id, name: `${prefix}${item.name}` })
    if (item.children?.length) {
      flattenMenuOptions(item.children, depth + 1, acc)
    }
  })
  return acc
}

async function loadMenus(): Promise<void> {
  try {
    loading.value = true
    const data = await listMenus()
    menus.value = mapMenusToTree(data)
  } catch (error) {
    console.error('Failed to load menus', error)
  } finally {
    loading.value = false
  }
}

function resetForm(): void {
  form.name = ''
  form.icon = ''
  form.routeName = ''
  form.order = 0
  form.permission = ''
  form.parentId = null
  selected.value = null
  errorMessage.value = null
}

function populateForm(menu: MenuItem): void {
  form.name = menu.name
  form.icon = menu.icon ?? ''
  form.routeName = menu.routeName ?? ''
  form.order = menu.order ?? 0
  form.permission = menu.permission ?? ''
  form.parentId = findParentId(menu.id, menus.value)
}

function findParentId(id: string, items: MenuItem[], parentId: string | null = null): string | null {
  for (const item of items) {
    if (item.id === id) {
      return parentId
    }
    if (item.children?.length) {
      const result = findParentId(id, item.children, item.id)
      if (result !== null) {
        return result
      }
    }
  }
  return null
}

async function handleSubmit(): Promise<void> {
  if (!form.name) {
    errorMessage.value = '请填写菜单名称'
    return
  }
  const payload: MenuMutationPayload = {
    name: form.name,
    icon: form.icon || undefined,
    routeName: form.routeName || undefined,
    order: form.order,
    permission: form.permission || undefined,
    parentId: form.parentId ?? null,
  }
  try {
    saving.value = true
    if (selected.value) {
      await updateMenu(selected.value, payload)
    } else {
      await createMenu(payload)
    }
    await loadMenus()
    if (!selected.value) {
      resetForm()
    }
  } catch (error) {
    console.error('Failed to save menu', error)
    errorMessage.value = '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

async function handleRemove(): Promise<void> {
  if (!selected.value) {
    return
  }
  if (!confirm('确定删除当前菜单及其子菜单吗？')) {
    return
  }
  try {
    await removeMenu(selected.value)
    resetForm()
    await loadMenus()
  } catch (error) {
    console.error('Failed to remove menu', error)
  }
}

watch(
  () => selected.value,
  (menuId) => {
    if (!menuId) {
      resetForm()
      return
    }
    const menu = findMenuById(menuId, menus.value)
    if (menu) {
      populateForm(menu)
    }
  },
)

onMounted(() => {
  void loadMenus()
})
</script>

<template>
  <v-row>
    <v-col cols="12" md="4">
      <v-card elevation="3">
        <v-card-title class="text-h6 font-weight-medium">菜单结构</v-card-title>
        <v-divider class="my-2" />
        <v-treeview
          v-model:selected="selected"
          :items="menus"
          item-title="name"
          item-value="id"
          selectable
          activatable
          open-on-click
          :loading="loading"
        />
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="resetForm">新建顶级菜单</v-btn>
        </v-card-actions>
      </v-card>
    </v-col>
    <v-col cols="12" md="8">
      <v-card elevation="3">
        <v-card-title class="text-h6 font-weight-medium">
          {{ selected ? '编辑菜单' : '新建菜单' }}
        </v-card-title>
        <v-card-text>
          <v-text-field v-model="form.name" label="菜单名称" required />
          <v-text-field v-model="form.icon" label="图标 (mdi-*)" />
          <v-text-field v-model="form.routeName" label="路由名称" />
          <v-text-field v-model.number="form.order" type="number" label="排序" />
          <v-text-field v-model="form.permission" label="权限编码" />
          <v-select
            v-model="form.parentId"
            :items="menuOptions"
            item-title="name"
            item-value="id"
            label="父级菜单"
            clearable
          />
          <v-alert v-if="errorMessage" type="error" density="compact">
            {{ errorMessage }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn variant="text" color="error" :disabled="!selected" @click="handleRemove">
            删除
          </v-btn>
          <v-spacer />
          <v-btn color="primary" :loading="saving" @click="handleSubmit">
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-col>
  </v-row>
</template>
