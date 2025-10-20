<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

interface LoginForm {
  username: string
  password: string
  remember: boolean
}

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const isPasswordVisible = ref(false)
const form = reactive<LoginForm>({
  username: '',
  password: '',
  remember: true,
})

async function handleSubmit(): Promise<void> {
  if (!form.username || !form.password) {
    errorMessage.value = '请输入用户名和密码'
    return
  }
  try {
    loading.value = true
    errorMessage.value = null
    await authStore.login({ username: form.username, password: form.password })
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
  <div class="login-layout">
    <div class="login-illustration d-none d-lg-flex">
      <div class="login-illustration__inner">
        <div class="text-h3 text-white mb-4">Harmony Admin Center</div>
        <p class="text-body-1 text-white text-opacity-80 mb-6">
          统一管理用户、角色、权限与资源。通过可视化仪表盘快速洞察运行状况，保障业务稳定。
        </p>
        <div class="login-illustration__metrics">
          <div>
            <div class="text-h4 text-white">98.4%</div>
            <div class="text-caption text-white text-opacity-80">系统可用性</div>
          </div>
          <div>
            <div class="text-h4 text-white">342</div>
            <div class="text-caption text-white text-opacity-80">本月自动化任务</div>
          </div>
          <div>
            <div class="text-h4 text-white">24/7</div>
            <div class="text-caption text-white text-opacity-80">运维监控</div>
          </div>
        </div>
      </div>
    </div>

    <div class="login-card-wrapper">
      <v-card class="login-card" elevation="12">
        <v-card-text>
          <div class="login-card__brand mb-8">
            <div class="login-card__logo">HA</div>
            <div>
              <div class="text-subtitle-1 font-weight-medium">Harmony 管理后台</div>
              <div class="text-caption text-medium-emphasis">请登录以继续操作</div>
            </div>
          </div>

          <v-form class="login-form" @submit.prevent="handleSubmit">
            <v-text-field
              v-model="form.username"
              label="用户名"
              autocomplete="username"
              prepend-inner-icon="mdi-account"
              hide-details="auto"
              variant="outlined"
              density="comfortable"
              class="mb-4"
            />

            <v-text-field
              v-model="form.password"
              :type="isPasswordVisible ? 'text' : 'password'"
              label="密码"
              autocomplete="current-password"
              prepend-inner-icon="mdi-lock"
              :append-inner-icon="isPasswordVisible ? 'mdi-eye-off' : 'mdi-eye'"
              @click:append-inner="isPasswordVisible = !isPasswordVisible"
              hide-details="auto"
              variant="outlined"
              density="comfortable"
              class="mb-2"
            />

            <div class="d-flex align-center justify-space-between mb-4 flex-wrap gap-3">
              <v-checkbox
                v-model="form.remember"
                :label="form.remember ? '保持登录状态' : '记住账户'"
                color="primary"
                density="compact"
                hide-details
              />
              <v-btn variant="text" density="compact" color="primary">忘记密码？</v-btn>
            </div>

            <v-alert
              v-if="errorMessage"
              type="error"
              variant="tonal"
              density="comfortable"
              class="mb-4"
            >
              {{ errorMessage }}
            </v-alert>

            <v-btn type="submit" color="primary" block :loading="loading" size="large" class="mb-3">
              登录
            </v-btn>

            <div class="text-caption text-medium-emphasis text-center">
              登录即代表你同意 <a href="javascript:void(0)" class="text-primary">服务协议</a> 与 <a href="javascript:void(0)" class="text-primary">隐私政策</a>
            </div>
          </v-form>
        </v-card-text>
      </v-card>
    </div>
  </div>
</template>

<style scoped lang="scss">
.login-layout {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  background: radial-gradient(circle at 20% 20%, rgba(79, 70, 229, 0.45), transparent 45%),
    radial-gradient(circle at 80% 0%, rgba(16, 185, 129, 0.35), transparent 55%),
    linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 64, 175, 0.85));
  position: relative;
}

.login-illustration {
  position: relative;
  overflow: hidden;
  padding: 4rem 5rem;
  align-items: center;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.85), rgba(29, 78, 216, 0.95));

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image: radial-gradient(circle at 25% 25%, rgba(255, 255, 255, 0.25), transparent 50%);
    mix-blend-mode: screen;
  }

  &__inner {
    position: relative;
    z-index: 1;
    max-inline-size: 420px;
  }

  &__metrics {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2rem;
  }
}

.login-card-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: clamp(2rem, 6vw, 4rem);
}

.login-card {
  width: min(420px, 95vw);
  border-radius: 20px;
  backdrop-filter: blur(16px);
  box-shadow: 0 30px 70px rgba(15, 23, 42, 0.35);
}

.login-card__brand {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.login-card__logo {
  inline-size: 52px;
  block-size: 52px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, rgba(79, 70, 229, 1), rgba(14, 165, 233, 1));
  color: #fff;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.login-form {
  display: flex;
  flex-direction: column;
}

@media (min-width: 992px) {
  .login-layout {
    grid-template-columns: 1.2fr minmax(0, 1fr);
  }
}

@media (max-width: 600px) {
  .login-card {
    border-radius: 16px;
  }
}
</style>
