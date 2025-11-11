<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/authStore'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()

const authStore = useAuthStore()
const loginFormRef = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null)
const formState = reactive({
  username: '',
  password: '',
  rememberPassword: false,
  keepLoggedIn: false,
})

const loginLoading = computed(() => authStore.loginLoading)
const loginError = computed(() => authStore.loginError)

function closeDialog() {
  emit('update:modelValue', false)
  authStore.hideLoginDialog()
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      const defaults = authStore.getLoginDefaults()
      formState.username = defaults.username
      formState.password = defaults.password
      formState.rememberPassword = defaults.rememberPassword
      formState.keepLoggedIn = defaults.keepLoggedIn
    } else if (!formState.rememberPassword) {
      formState.password = ''
    }
  },
  { immediate: true },
)

async function handleSubmit() {
  const form = loginFormRef.value
  if (form) {
    const result = await form.validate()
    if (!result.valid) {
      return
    }
  }
  try {
    await authStore.login({
      username: formState.username.trim(),
      password: formState.password,
      rememberPassword: formState.rememberPassword,
      keepLoggedIn: formState.keepLoggedIn,
    })
    emit('update:modelValue', false)
  } catch (_error) {
    /* error handled by store */
  }
}

const usernameRules = [
  (value: string) => (!!value && value.trim().length > 0) || '请输入用户名',
]
const passwordRules = [
  (value: string) => (!!value && value.trim().length > 0) || '请输入密码',
]
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="420"
    persistent
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-h6">账号登录</v-card-title>
      <v-card-text>
        <v-alert
          v-if="loginError"
          type="error"
          variant="tonal"
          density="comfortable"
          class="mb-4"
        >
          {{ loginError }}
        </v-alert>
        <v-form ref="loginFormRef" @submit.prevent="handleSubmit">
          <v-text-field
            v-model="formState.username"
            label="用户名"
            variant="outlined"
            density="comfortable"
            autocomplete="username"
            :disabled="loginLoading"
            :rules="usernameRules"
            clearable
          />
          <v-text-field
            v-model="formState.password"
            label="密码"
            variant="outlined"
            density="comfortable"
            type="password"
            autocomplete="current-password"
            :disabled="loginLoading"
            :rules="passwordRules"
            clearable
          />
          <div class="login-options">
            <v-checkbox
              v-model="formState.rememberPassword"
              label="记住密码"
              color="primary"
              density="compact"
              :disabled="loginLoading"
              hide-details
            />
            <v-checkbox
              v-model="formState.keepLoggedIn"
              label="保持登录"
              color="primary"
              density="compact"
              :disabled="loginLoading"
              hide-details
            />
          </div>
        </v-form>
      </v-card-text>
      <v-card-actions class="login-actions">
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="loginLoading"
          @click="closeDialog"
        >
          取消
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="loginLoading"
          :disabled="loginLoading"
          @click="handleSubmit"
        >
          登录
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.login-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}

.login-actions {
  padding-inline-end: 20px;
}
</style>
