<template>
  <view class="page">
    <PageHeader :title="pageTitle" />
    <view class="hero">
      <text class="hero-title">{{ pageTitle }}</text>
      <text class="hero-subtitle">{{ pageSubtitle }}</text>
    </view>

    <view class="content-card">
      <view v-if="loading" class="state">
        <text class="state-text">正在加载协议内容...</text>
      </view>
      <view v-else-if="errorMessage" class="state state-error">
        <text class="state-text">{{ errorMessage }}</text>
        <button class="retry" @tap="loadPolicy">重新加载</button>
      </view>
      <template v-else>
        <view v-for="(paragraph, index) in paragraphs" :key="index" class="paragraph">
          <text class="paragraph-text">{{ paragraph }}</text>
        </view>
      </template>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'

import PageHeader from '@/components/PageHeader.vue'
import { getMiniAppPolicy, type MiniPolicyFile, type MiniPolicyKind } from '@/api/mini'
import { miniRequest } from '@harmony/utils'
import { applyLightNavigationBar } from '@/utils/safeArea'

type PolicyPageState = {
  title: string
  subtitle: string
  kind: MiniPolicyKind
}

const POLICY_PAGE_MAP: Record<MiniPolicyKind, PolicyPageState> = {
  'user-service-agreement': {
    title: '用户服务协议',
    subtitle: '请仔细阅读本协议，了解服务范围、使用规则与双方权利义务。',
    kind: 'user-service-agreement',
  },
  'privacy-policy': {
    title: '隐私政策',
    subtitle: '我们会说明收集、使用、存储和保护个人信息的方式。',
    kind: 'privacy-policy',
  },
}

const currentKind = ref<MiniPolicyKind>('privacy-policy')
const pageState = computed(() => POLICY_PAGE_MAP[currentKind.value] || POLICY_PAGE_MAP['privacy-policy'])
const pageTitle = computed(() => pageState.value.title)
const pageSubtitle = computed(() => pageState.value.subtitle)
const loading = ref(true)
const errorMessage = ref('')
const paragraphs = ref<string[]>([])

const appKey = String(import.meta.env.VITE_MINI_APP_KEY ?? '').trim()

function normalizeParagraphs(policy: MiniPolicyFile): string[] {
  if (Array.isArray(policy.paragraphs) && policy.paragraphs.length) {
    return policy.paragraphs
  }
  return String(policy.content || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
}

async function loadPolicy() {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await getMiniAppPolicy(currentKind.value, appKey || undefined)
    const fileUrl = String(response.policy?.fileUrl || '').trim()
    if (fileUrl) {
      try {
        const file = await getFileContent(fileUrl)
        paragraphs.value = normalizeParagraphs(file)
        return
      } catch {
        // fall back to the inline content returned by the API
      }
    }
    const fallback = response.policy
    paragraphs.value = String(fallback?.content || '')
      .replace(/\r\n/g, '\n')
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .filter(Boolean)
  } catch (error) {
    const fallbackText = error instanceof Error ? error.message : '协议加载失败'
    errorMessage.value = fallbackText
    paragraphs.value = []
  } finally {
    loading.value = false
  }
}

async function getFileContent(fileUrl: string): Promise<MiniPolicyFile> {
  return await miniRequest<MiniPolicyFile>(fileUrl, {
    method: 'GET',
    auth: false,
  })
}

onShow(() => {
  applyLightNavigationBar()
})

onLoad((options) => {
  const kind = String(options?.kind || 'privacy-policy') as MiniPolicyKind
  currentKind.value = POLICY_PAGE_MAP[kind] ? kind : 'privacy-policy'
  void loadPolicy()
})

</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  background:
    radial-gradient(circle at top, rgba(31, 122, 236, 0.12), transparent 34%),
    linear-gradient(180deg, #f7fbff 0%, #f8f8f8 40%, #f4f7fb 100%);
  padding-bottom: 24px;
}

.hero {
  padding: 10px 16px 12px;
}

.hero-title {
  display: block;
  font-size: 20px;
  font-weight: 800;
  color: #162034;
}

.hero-subtitle {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: #65748b;
  line-height: 1.7;
}

.content-card {
  margin: 0 16px;
  padding: 16px 16px 20px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(31, 122, 236, 0.08);
  border-radius: 18px;
  box-shadow: 0 16px 40px rgba(31, 122, 236, 0.08);
}

.paragraph {
  margin-bottom: 14px;
}

.paragraph:last-child {
  margin-bottom: 0;
}

.paragraph-text {
  display: block;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.9;
  color: #1f2937;
}

.state {
  padding: 24px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.state-error .state-text {
  color: #d14343;
}

.state-text {
  font-size: 13px;
  color: #65748b;
  text-align: center;
}

.retry {
  height: 36px;
  line-height: 36px;
  padding: 0 16px;
  border-radius: 999px;
  background: #1f7aec;
  color: #ffffff;
  font-size: 13px;
}
</style>
