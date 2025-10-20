<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'

interface AccountFormState {
  displayName: string
  email: string
  organization: string
  phone: string
  language: string
  timezone: string
  bio: string
}

interface PasswordFormState {
  currentPassword: string
  newPassword: string
  confirmPassword: string
  enableTwoFactor: boolean
  autoLogoutMinutes: number
}

interface NotificationToggle {
  id: string
  title: string
  description: string
  enabled: boolean
}

const authStore = useAuthStore()

const activeTab = ref<'account' | 'security' | 'notification'>('account')

const snackbar = reactive({
  visible: false,
  color: 'success',
  text: '',
})

const timezoneOptions = [
  'Asia/Shanghai (UTC+08:00)',
  'Asia/Tokyo (UTC+09:00)',
  'Asia/Singapore (UTC+08:00)',
  'UTC (UTC+00:00)',
  'America/Los_Angeles (UTC-07:00)',
]

const languageOptions = [
  { label: '简体中文', value: 'zh-CN' },
  { label: 'English', value: 'en-US' },
  { label: '日本語', value: 'ja-JP' },
]

const baseAccountForm = computed<AccountFormState>(() => ({
  displayName: authStore.user?.displayName || authStore.user?.username || '',
  email: authStore.user?.email || '',
  organization: 'Harmony Studio',
  phone: '',
  language: 'zh-CN',
  timezone: 'Asia/Shanghai (UTC+08:00)',
  bio: '',
}))

const accountForm = reactive<AccountFormState>({ ...baseAccountForm.value })

const passwordForm = reactive<PasswordFormState>({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
  enableTwoFactor: true,
  autoLogoutMinutes: 30,
})

const notificationToggles = reactive<NotificationToggle[]>([
  {
    id: 'activity-updates',
    title: '系统活动提醒',
    description: '当有新的用户、角色或资源变更时通知我',
    enabled: true,
  },
  {
    id: 'security-alerts',
    title: '安全告警',
    description: '异常登录、2FA 变更等关键安全事件',
    enabled: true,
  },
  {
    id: 'weekly-digest',
    title: '每周摘要',
    description: '汇总本周的活跃用户、资源上传与使用情况',
    enabled: false,
  },
  {
    id: 'maintenance',
    title: '维护计划',
    description: '服务升级、停机维护等计划性通知',
    enabled: true,
  },
])

const isSavingAccount = ref(false)
const isSavingSecurity = ref(false)

const avatarPreview = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

function showSnackbar(message: string, color: 'success' | 'info' | 'error' = 'success'): void {
  snackbar.text = message
  snackbar.color = color
  snackbar.visible = true
}

function resetAccountForm(): void {
  Object.assign(accountForm, baseAccountForm.value)
  avatarPreview.value = null
}

function triggerAvatarPicker(): void {
  fileInputRef.value?.click()
}

function onAvatarSelected(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      avatarPreview.value = reader.result
    }
  }
  reader.readAsDataURL(file)
}

async function submitAccountForm(): Promise<void> {
  try {
    isSavingAccount.value = true
    await new Promise((resolve) => setTimeout(resolve, 600))
    showSnackbar('账户信息已保存')
  } finally {
    isSavingAccount.value = false
  }
}

async function submitPasswordForm(): Promise<void> {
  if (!passwordForm.newPassword || passwordForm.newPassword !== passwordForm.confirmPassword) {
    showSnackbar('请确认新密码填写正确', 'error')
    return
  }
  try {
    isSavingSecurity.value = true
    await new Promise((resolve) => setTimeout(resolve, 600))
    Object.assign(passwordForm, {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
      enableTwoFactor: passwordForm.enableTwoFactor,
      autoLogoutMinutes: passwordForm.autoLogoutMinutes,
    })
    showSnackbar('安全设置已更新')
  } finally {
    isSavingSecurity.value = false
  }
}

watch(
  () => authStore.user,
  () => {
    Object.assign(accountForm, baseAccountForm.value)
    avatarPreview.value = null
  },
  { immediate: true },
)
</script>

<template>
  <div class="settings-page">
    <v-card class="settings-card" elevation="1">
      <v-tabs v-model="activeTab" class="settings-tabs" show-arrows>
        <v-tab value="account" prepend-icon="mdi-account-circle-outline">账户信息</v-tab>
        <v-tab value="security" prepend-icon="mdi-shield-check-outline">安全设置</v-tab>
        <v-tab value="notification" prepend-icon="mdi-bell-outline">通知偏好</v-tab>
      </v-tabs>

      <v-divider />

      <v-window v-model="activeTab" class="pa-6">
        <v-window-item value="account">
          <v-row>
            <v-col cols="12" md="4">
              <v-card variant="tonal" class="pa-6 h-100">
                <div class="text-subtitle-1 font-weight-medium mb-4">账户头像</div>
                <div class="d-flex flex-column align-center gap-4">
                  <v-avatar size="120" color="primary" variant="tonal">
                    <template v-if="avatarPreview">
                      <v-img :src="avatarPreview" alt="avatar" cover />
                    </template>
                    <template v-else>
                      <span class="text-h5 text-uppercase">{{ accountForm.displayName?.slice(0, 2) || 'HA' }}</span>
                    </template>
                  </v-avatar>
                  <div class="text-caption text-medium-emphasis text-center">
                    推荐使用方形图片，尺寸不小于 240x240 像素。
                  </div>
                  <div class="d-flex flex-wrap gap-3">
                    <v-btn color="primary" variant="flat" @click="triggerAvatarPicker">上传图片</v-btn>
                    <v-btn variant="tonal" color="secondary" @click="resetAccountForm">重置</v-btn>
                  </div>
                  <input ref="fileInputRef" type="file" accept="image/*" class="d-none" @change="onAvatarSelected">
                </div>
              </v-card>
            </v-col>

            <v-col cols="12" md="8">
              <v-card variant="tonal" class="pa-6">
                <div class="text-subtitle-1 font-weight-medium mb-4">个人资料</div>
                <v-form @submit.prevent="submitAccountForm">
                  <v-row>
                    <v-col cols="12" md="6">
                      <v-text-field
                        v-model="accountForm.displayName"
                        label="显示名称"
                        placeholder="请输入显示名称"
                        required
                      />
                    </v-col>
                    <v-col cols="12" md="6">
                      <v-text-field
                        v-model="accountForm.organization"
                        label="所属组织"
                        placeholder="Harmony Studio"
                      />
                    </v-col>
                    <v-col cols="12" md="6">
                      <v-text-field
                        v-model="accountForm.email"
                        label="联系邮箱"
                        type="email"
                        placeholder="name@example.com"
                      />
                    </v-col>
                    <v-col cols="12" md="6">
                      <v-text-field
                        v-model="accountForm.phone"
                        label="联系电话"
                        placeholder="(+86) 123-4567-8901"
                      />
                    </v-col>
                    <v-col cols="12" md="6">
                      <v-select
                        v-model="accountForm.language"
                        :items="languageOptions"
                        item-title="label"
                        item-value="value"
                        label="界面语言"
                      />
                    </v-col>
                    <v-col cols="12" md="6">
                      <v-select
                        v-model="accountForm.timezone"
                        :items="timezoneOptions"
                        label="时区"
                      />
                    </v-col>
                    <v-col cols="12">
                      <v-textarea
                        v-model="accountForm.bio"
                        label="个人简介"
                        rows="3"
                        placeholder="介绍一下自己或负责的业务范围"
                      />
                    </v-col>
                    <v-col cols="12" class="d-flex gap-3 mt-2">
                      <v-btn type="submit" color="primary" :loading="isSavingAccount">
                        保存更改
                      </v-btn>
                      <v-btn variant="tonal" color="secondary" @click="resetAccountForm">
                        取消
                      </v-btn>
                    </v-col>
                  </v-row>
                </v-form>
              </v-card>
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item value="security">
          <v-row>
            <v-col cols="12" md="7">
              <v-card variant="tonal" class="pa-6 h-100">
                <div class="text-subtitle-1 font-weight-medium mb-4">密码与身份验证</div>
                <v-form @submit.prevent="submitPasswordForm">
                  <v-text-field
                    v-model="passwordForm.currentPassword"
                    label="当前密码"
                    type="password"
                    autocomplete="current-password"
                    class="mb-4"
                  />
                  <v-text-field
                    v-model="passwordForm.newPassword"
                    label="新密码"
                    type="password"
                    autocomplete="new-password"
                    class="mb-4"
                  />
                  <v-text-field
                    v-model="passwordForm.confirmPassword"
                    label="确认新密码"
                    type="password"
                    autocomplete="new-password"
                    class="mb-4"
                  />
                  <v-switch
                    v-model="passwordForm.enableTwoFactor"
                    label="启用双重身份验证"
                    inset
                    color="primary"
                    class="mb-4"
                  />
                  <v-select
                    v-model="passwordForm.autoLogoutMinutes"
                    :items="[15, 30, 60, 120]"
                    label="自动登出时间 (分钟)"
                    class="mb-4"
                  />
                  <div class="text-caption text-medium-emphasis mb-6">
                    建议定期更新密码，并保持 2FA 开启以提升账户安全性。
                  </div>
                  <v-btn type="submit" color="primary" :loading="isSavingSecurity">
                    更新安全设置
                  </v-btn>
                </v-form>
              </v-card>
            </v-col>

            <v-col cols="12" md="5">
              <v-card variant="tonal" class="pa-6 h-100">
                <div class="text-subtitle-1 font-weight-medium mb-4">登录日志预览</div>
                <v-list density="compact" lines="two">
                  <v-list-item title="上海 · Chromium 浏览器">
                    <template #prepend>
                      <v-avatar size="36" color="primary" variant="tonal">
                        <v-icon icon="mdi-monitor" />
                      </v-avatar>
                    </template>
                    <template #subtitle>
                      5 分钟前 · IP 124.65.23.8
                    </template>
                  </v-list-item>
                  <v-list-item title="移动端 · Harmony App">
                    <template #prepend>
                      <v-avatar size="36" color="secondary" variant="tonal">
                        <v-icon icon="mdi-cellphone" />
                      </v-avatar>
                    </template>
                    <template #subtitle>
                      昨天 19:12 · IP 221.5.32.18
                    </template>
                  </v-list-item>
                  <v-list-item title="成都 · Firefox 浏览器">
                    <template #prepend>
                      <v-avatar size="36" color="info" variant="tonal">
                        <v-icon icon="mdi-laptop" />
                      </v-avatar>
                    </template>
                    <template #subtitle>
                      3 天前 · IP 110.86.54.9
                    </template>
                  </v-list-item>
                </v-list>
                <div class="text-caption text-medium-emphasis mt-4">
                  如果发现异常登录，可以立即重置密码并联系系统管理员。
                </div>
              </v-card>
            </v-col>
          </v-row>
        </v-window-item>

        <v-window-item value="notification">
          <v-row>
            <v-col cols="12" md="8">
              <v-card variant="tonal" class="pa-6">
                <div class="text-subtitle-1 font-weight-medium mb-4">通知渠道</div>
                <div class="d-flex flex-wrap gap-4 mb-6">
                  <v-chip color="primary" variant="elevated" size="large" prepend-icon="mdi-email-outline">
                    邮件
                  </v-chip>
                  <v-chip color="success" variant="elevated" size="large" prepend-icon="mdi-chat-processing-outline">
                    企业 IM
                  </v-chip>
                  <v-chip color="info" variant="elevated" size="large" prepend-icon="mdi-cellphone-message">
                    移动推送
                  </v-chip>
                </div>

                <v-divider class="mb-6" />

                <v-list density="comfortable" lines="three" class="notification-list">
                  <v-list-item
                    v-for="item in notificationToggles"
                    :key="item.id"
                  >
                    <template #prepend>
                      <v-avatar size="40" color="primary" variant="tonal">
                        <v-icon icon="mdi-bell-ring" />
                      </v-avatar>
                    </template>
                    <v-list-item-title class="font-weight-medium">
                      {{ item.title }}
                    </v-list-item-title>
                    <v-list-item-subtitle>
                      {{ item.description }}
                    </v-list-item-subtitle>
                    <template #append>
                      <v-switch v-model="item.enabled" color="primary" inset />
                    </template>
                  </v-list-item>
                </v-list>
              </v-card>
            </v-col>

            <v-col cols="12" md="4">
              <v-card variant="tonal" class="pa-6 h-100">
                <div class="text-subtitle-1 font-weight-medium mb-4">推送规则</div>
                <ul class="notification-guideline">
                  <li>保障安全类通知实时送达，避免漏报。</li>
                  <li>将批量资源导入、批量审批类通知设为汇总推送，减少打扰。</li>
                  <li>针对特定项目可配置单独通知频率，以满足业务场景。</li>
                </ul>
                <v-btn class="mt-6" variant="tonal" color="primary">
                  管理消息模板
                </v-btn>
              </v-card>
            </v-col>
          </v-row>
        </v-window-item>
      </v-window>
    </v-card>

    <v-snackbar v-model="snackbar.visible" :color="snackbar.color" timeout="2200" rounded>
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>

<style scoped lang="scss">
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.settings-card {
  border-radius: 18px;
  overflow: hidden;
  background: rgba(var(--v-theme-surface), 0.95);
  box-shadow: 0 18px 35px rgba(15, 23, 42, 0.08);
}

.settings-tabs {
  padding-inline: 1.5rem;
  padding-block: 0.75rem;
}

.notification-list {
  background: transparent;
}

.notification-guideline {
  margin: 0;
  padding-inline-start: 1.2rem;
  color: rgba(var(--v-theme-on-surface), 0.72);
  line-height: 1.6;
}

@media (max-width: 960px) {
  .settings-card {
    border-radius: 12px;
  }
}
</style>
