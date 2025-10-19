<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

interface LoginForm {
  username: string
  password: string
}

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const form = reactive<LoginForm>({
  username: '',
  password: '',
})

async function handleSubmit(): Promise<void> {
  if (!form.username || !form.password) {
    errorMessage.value = '请输入用户名和密码'
    return
  }
  try {
    loading.value = true
    errorMessage.value = null
    await authStore.login({ ...form })
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : undefined
    await router.push(redirect ? { path: redirect } : { name: 'dashboard' })
  } catch (error) {
    console.error('Login failed', error)
    errorMessage.value = '登录失败，请检查账号和密码'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <v-container fluid class="fill-height login-view">
    <v-row class="fill-height" align="center" justify="center">
      <v-col cols="12" sm="8" md="4">
        <v-card elevation="6" class="pa-6">
          <v-card-title class="text-h5 font-weight-medium mb-2">Harmony 管理后台</v-card-title>
          <v-card-subtitle class="mb-6">请输入账户信息登录系统</v-card-subtitle>
          <v-form @submit.prevent="handleSubmit">
            <v-text-field
              v-model="form.username"
              label="用户名"
              autocomplete="username"
              prepend-inner-icon="mdi-account"
              required
            />
            <v-text-field
              v-model="form.password"
              label="密码"
              type="password"
              autocomplete="current-password"
              prepend-inner-icon="mdi-lock"
              required
            />
            <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
              {{ errorMessage }}
            </v-alert>
            <v-btn type="submit" color="primary" block :loading="loading">
              登录
            </v-btn>
          </v-form>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.login-view {
  background: linear-gradient(135deg, #1e88e5, #43a047);
}
</style>
