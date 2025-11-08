<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useAiAssistantStore } from '@/stores/aiAssistantStore'

const props = defineProps<{
  captureViewportScreenshot?: () => Promise<Blob | null>
}>()

const store = useAiAssistantStore()

const messageInput = ref('')
const localError = ref<string | null>(null)
const screenshotLoading = ref(false)
const scrollerRef = ref<HTMLDivElement | null>(null)

const messages = computed(() => store.messages)
const isAwaitingResponse = computed(() => store.isAwaitingResponse || screenshotLoading.value)
const errorMessage = computed(() => localError.value ?? store.lastError)

function clearLocalError(): void {
  localError.value = null
  store.clearError()
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  const container = scrollerRef.value
  if (!container) {
    return
  }
  container.scrollTop = container.scrollHeight
}

watch(
  () => messages.value.length,
  () => {
    void scrollToBottom()
  },
  { immediate: true },
)

async function handleSendText(): Promise<void> {
  const text = messageInput.value
  if (!text || !text.trim()) {
    return
  }
  try {
    await store.sendMessage({ text })
    messageInput.value = ''
    clearLocalError()
    await scrollToBottom()
  } catch (error) {
    const message = error instanceof Error ? error.message : '发送失败'
    localError.value = message
  }
}

async function handleCaptureScreenshot(): Promise<void> {
  if (!props.captureViewportScreenshot) {
    localError.value = '无法获取场景截图，请稍后重试。'
    return
  }
  if (screenshotLoading.value) {
    return
  }

  screenshotLoading.value = true
  try {
    const blob = await props.captureViewportScreenshot()
    if (!blob) {
      localError.value = '截图失败，请确认视图可用。'
      return
    }
    await store.sendMessage({ text: messageInput.value, imageBlob: blob })
    messageInput.value = ''
    clearLocalError()
    await scrollToBottom()
  } catch (error) {
    const message = error instanceof Error ? error.message : '发送失败'
    localError.value = message
  } finally {
    screenshotLoading.value = false
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    void handleSendText()
  }
}
</script>

<template>
  <div class="ai-chat-panel">
    <div ref="scrollerRef" class="chat-scroll">
      <div v-if="!messages.length" class="chat-empty">
        <v-icon size="28" color="primary">mdi-robot-outline</v-icon>
        <p class="chat-empty-title">与 AI 助手对话</p>
        <p class="chat-empty-subtitle">输入问题或发送当前场景截图，让助手来协助你。</p>
      </div>
      <template v-else>
        <div v-for="message in messages" :key="message.id" class="chat-message" :class="[`role-${message.role}`, { 'has-error': message.status === 'error' }]">
          <div class="message-bubble">
            <div class="message-meta">
              <span class="message-author">{{ message.role === 'user' ? '我' : 'AI 助手' }}</span>
              <span class="message-time">{{ formatTimestamp(message.createdAt) }}</span>
            </div>
            <div v-if="message.text" class="message-text">{{ message.text }}</div>
            <div v-if="message.imageDataUrl || message.imageUrl" class="message-image">
              <img :src="message.imageDataUrl ?? message.imageUrl ?? ''" alt="聊天图片" />
            </div>
            <div v-if="message.status === 'pending' || message.status === 'sending'" class="message-spinner">
              <v-progress-circular indeterminate size="18" color="primary" />
            </div>
            <div v-if="message.status === 'error' && message.error" class="message-error">
              {{ message.error }}
            </div>
          </div>
        </div>
      </template>
    </div>

    <v-divider class="chat-divider" />

    <div class="chat-input">
      <div class="chat-composer">
        <v-textarea
          v-model="messageInput"
          class="chat-textarea"
          placeholder="向 AI 助手提问，或使用 Ctrl+Enter 发送"
          rows="1"
          row-height="18"
          auto-grow
          max-rows="6"
          density="comfortable"
          hide-details
          @keydown="handleKeydown"
        />
        <div class="chat-actions">
          <v-tooltip text="捕获当前场景截图">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                class="chat-action"
                color="primary"
                variant="text"
                density="comfortable"
                size="small"
                :loading="screenshotLoading"
                :disabled="screenshotLoading"
                icon="mdi-camera"
                @click="handleCaptureScreenshot"
              />
            </template>
          </v-tooltip>
          <v-btn
            class="chat-action chat-action--send"
            color="primary"
            variant="elevated"
            density="comfortable"
            size="small"
            :disabled="!messageInput.trim() || isAwaitingResponse"
            @click="handleSendText"
          >
            <v-icon start>mdi-send</v-icon>
            发送
          </v-btn>
        </div>
      </div>
    </div>

    <div v-if="errorMessage" class="chat-error" @click="clearLocalError">
      <v-alert
        type="error"
        density="comfortable"
        :text="errorMessage ?? ''"
        closable
        @click:close="clearLocalError"
      />
    </div>

    <v-progress-linear
      v-if="store.isAwaitingResponse"
      class="chat-progress"
      color="primary"
      height="3"
      indeterminate
    />
  </div>
</template>

<style scoped>
.ai-chat-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 10px 18px 6px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-empty {
  margin: auto;
  text-align: center;
  color: rgba(233, 236, 241, 0.75);
  max-width: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.chat-empty-title {
  font-size: 16px;
  font-weight: 600;
}

.chat-empty-subtitle {
  font-size: 13px;
  line-height: 1.6;
}

.chat-message {
  display: flex;
}

.chat-message.role-user {
  justify-content: flex-end;
}

.chat-message.role-assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 68%;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(25, 31, 40, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 8px;
  backdrop-filter: blur(10px);
}

.role-user .message-bubble {
  background: linear-gradient(140deg, rgba(0, 172, 193, 0.85), rgba(0, 121, 188, 0.85));
  border-color: rgba(0, 172, 193, 0.6);
  color: #f4fbff;
}

.message-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  opacity: 0.8;
}

.message-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.5;
}

.message-image {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.message-image img {
  display: block;
  width: 100%;
  height: auto;
}

.message-spinner {
  display: flex;
  justify-content: flex-end;
}

.message-error {
  font-size: 12px;
  color: #ffb4a9;
}

.chat-divider {
  margin: 0 0 8px;
}

.chat-input {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 12px 10px;
}

.chat-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.chat-textarea {
  background: rgba(19, 23, 31, 0.85);
  border-radius: 12px;
  flex: 1 1 auto;
}

.chat-textarea :deep(textarea) {
  padding: 8px 10px;
  min-height: 36px !important;
}

.chat-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat-action {
  min-width: auto;
  height: 34px;
  font-size: 13px;
}

.chat-action--send {
  min-width: 88px;
  white-space: nowrap;
}

.chat-action :deep(.v-btn__content) {
  gap: 4px;
}

.chat-error {
  padding: 0 12px 8px;
  cursor: pointer;
}

.chat-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
}
</style>
