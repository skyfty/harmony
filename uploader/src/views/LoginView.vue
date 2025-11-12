<template>
  <v-main class="d-flex align-center justify-center" style="min-height: 100vh">
    <v-container max-width="480" class="py-12">
      <v-card elevation="8" rounded="lg">
        <v-toolbar color="primary" dark>
          <v-toolbar-title>资源上传登录</v-toolbar-title>
        </v-toolbar>
        <v-card-text class="pt-6">
          <v-form @submit.prevent="handleSubmit">
            <v-text-field
              v-model="form.username"
              label="账号"
              prepend-icon="mdi-account"
              autocomplete="username"
              required
            />
            <v-text-field
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              label="密码"
              prepend-icon="mdi-lock"
              :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
              @click:append-inner="showPassword = !showPassword"
              autocomplete="current-password"
              required
            />
            <div class="d-flex align-center justify-space-between mb-4">
              <v-checkbox
                v-model="form.remember"
                hide-details
                label="记住密码"
              />
              <v-btn
                :loading="loading"
                type="submit"
                color="primary"
                variant="flat"
              >
                登录
              </v-btn>
            </div>
          </v-form>
          <v-alert
            v-if="errorMessage"
            type="error"
            variant="tonal"
            density="comfortable"
            class="mt-2"
          >
            {{ errorMessage }}
          </v-alert>
        </v-card-text>
      </v-card>
    </v-container>
  </v-main>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRoute, useRouter } from 'vue-router'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const loading = ref(false)
const errorMessage = ref<string | null>(null)
const showPassword = ref(false)

const form = reactive({
  username: '',
  password: '',
  remember: true,
})

function applyDefaultCredentials(): void {
  const remembered = authStore.restoreRemembered()
  if (remembered) {
    form.username = remembered.username
    form.password = remembered.password
    form.remember = true
    return
  }
  const fallbackUsername = (import.meta.env.VITE_DEFAULT_USERNAME as string | undefined) ?? ''
  const fallbackPassword = (import.meta.env.VITE_DEFAULT_PASSWORD as string | undefined) ?? ''
  form.username = fallbackUsername
  form.password = fallbackPassword
  form.remember = Boolean(fallbackUsername && fallbackPassword)
}

onMounted(() => {
  applyDefaultCredentials()
  if (authStore.isAuthenticated) {
    router.replace({ name: 'uploader' })
  }
})

async function handleSubmit(): Promise<void> {
  if (!form.username || !form.password) {
    errorMessage.value = '请输入账号和密码'
    return
  }
  loading.value = true
  errorMessage.value = null
  try {
    await authStore.login({ username: form.username.trim(), password: form.password, remember: form.remember })
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    router.replace(redirect || '/')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '登录失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>
