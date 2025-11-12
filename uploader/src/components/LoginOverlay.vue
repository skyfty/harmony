<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const username = ref('')
const password = ref('')
const submitting = ref(false)
const errorMessage = ref<string | null>(null)

function validate(): string | null {
  if (!username.value.trim()) {
    return '请输入用户名'
  }
  if (!password.value.trim()) {
    return '请输入密码'
  }
  return null
}

function parseErrorMessage(error: unknown): string {
  if (!error) return '登录失败，请重试'
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const maybeAxios = error as {
      response?: { data?: Record<string, unknown> }
      message?: string
    }
    const payload = maybeAxios.response?.data
    if (payload && typeof payload === 'object') {
      const message = (payload as Record<string, unknown>).message
      const errorText = (payload as Record<string, unknown>).error
      if (typeof message === 'string' && message.trim().length) {
        return message
      }
      if (typeof errorText === 'string' && errorText.trim().length) {
        return errorText
      }
    }
    if (maybeAxios.message && maybeAxios.message.trim().length) {
      return maybeAxios.message
    }
  }
  if (error instanceof Error) return error.message || '登录失败，请检查网络后重试'
  return '登录失败，请检查账号信息'
}

async function handleSubmit(): Promise<void> {
  if (submitting.value) {
    return
  }
  const validationError = validate()
  if (validationError) {
    errorMessage.value = validationError
    return
  }
  submitting.value = true
  errorMessage.value = null
  try {
    await authStore.login({
      username: username.value.trim(),
      password: password.value,
    })
  } catch (error) {
    errorMessage.value = parseErrorMessage(error)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login">
    <form class="login__card" @submit.prevent="handleSubmit">
      <h1 class="login__title">Harmony 资源上传</h1>
      <p class="login__subtitle">请使用管理员账号登录后上传资源</p>
      <label class="login__field">
        <span>用户名</span>
        <input v-model="username" type="text" placeholder="请输入用户名" autocomplete="username" />
      </label>
      <label class="login__field">
        <span>密码</span>
        <input v-model="password" type="password" placeholder="请输入密码" autocomplete="current-password" />
      </label>
      <p v-if="errorMessage" class="login__error">{{ errorMessage }}</p>
      <button class="login__submit" type="submit" :disabled="submitting">
        {{ submitting ? '登录中...' : '登录' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.login {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
}

.login__card {
  width: 100%;
  max-width: 360px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 18px 35px rgba(15, 23, 42, 0.1);
  display: flex;
  flex-direction: column;
  gap: 16px;
  backdrop-filter: blur(8px);
}

.login__title {
  margin: 0;
  font-size: 1.5rem;
  color: #1f2937;
}

.login__subtitle {
  margin: 0 0 8px;
  color: #6b7280;
  font-size: 0.95rem;
}

.login__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: #4b5563;
  font-weight: 500;
}

.login__field input {
  height: 42px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid rgba(99, 102, 241, 0.25);
  background: #fff;
  font-size: 1rem;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.login__field input:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}

.login__error {
  margin: 0;
  color: #f87171;
  font-size: 0.9rem;
}

.login__submit {
  height: 44px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.login__submit:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.login__submit:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 15px rgba(99, 102, 241, 0.3);
}
</style>
