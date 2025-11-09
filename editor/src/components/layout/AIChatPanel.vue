<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useAiAssistantStore } from '@/stores/aiAssistantStore'

defineProps<{
  captureViewportScreenshot?: () => Promise<Blob | null>
}>()

const store = useAiAssistantStore()

const messageInput = ref('')
const localError = ref<string | null>(null)
const scrollerRef = ref<HTMLDivElement | null>(null)
const textareaRef = ref<{ textarea?: HTMLTextAreaElement | null; $el?: HTMLElement | null } | null>(null)
const baseTextareaHeight = ref<number | null>(null)
const isTextareaExpanded = ref(false)

const messages = computed(() => store.messages)
const isAwaitingResponse = computed(() => store.isAwaitingResponse)
const errorMessage = computed(() => localError.value ?? store.lastError)

const activeModelLabel = computed(() => {
  const recent = [...messages.value].reverse()
  const withMetadata = recent.find((entry) => entry.metadata?.model)
  return withMetadata?.metadata?.model ?? 'GPT-4'
})

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

async function updateTextareaState(): Promise<void> {
  await nextTick()
  const instance = textareaRef.value
  const el = instance?.textarea ?? instance?.$el?.querySelector?.('textarea') ?? null
  if (!el) {
    return
  }
  const currentHeight = el.scrollHeight
  if (baseTextareaHeight.value === null) {
    baseTextareaHeight.value = currentHeight
  }
  const baseline = baseTextareaHeight.value ?? currentHeight
  isTextareaExpanded.value = currentHeight > baseline + 2
}

watch(messageInput, () => {
  void updateTextareaState()
})

watch(textareaRef, () => {
  void updateTextareaState()
})

onMounted(() => {
  void updateTextareaState()
})

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

function handleKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    void handleSendText()
  }
}

async function handleApplySceneChange(messageId: string): Promise<void> {
  try {
    await store.applySceneChange(messageId)
    clearLocalError()
    await scrollToBottom()
  } catch (error) {
    const message = error instanceof Error ? error.message : '应用场景变更失败'
    localError.value = message
  }
}

function handleSuggestionClick(text: string): void {
  if (!text) {
    return
  }
  messageInput.value = text
}
</script>

<template>
  <div class="ai-chat-panel">
    <div ref="scrollerRef" class="chat-scroll">
      <div v-if="!messages.length" class="chat-empty">
        <v-icon size="28" color="primary">mdi-robot-outline</v-icon>
        <p class="chat-empty-title">与 AI 助手对话</p>
        <p class="chat-empty-subtitle">输入你的需求或想法，让助手帮助你完成场景创作。</p>
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
            <div v-if="message.suggestions?.length" class="message-suggestions">
              <v-chip
                v-for="suggestion in message.suggestions"
                :key="suggestion"
                class="message-suggestion-chip"
                color="primary"
                variant="tonal"
                size="small"
                @click="handleSuggestionClick(suggestion)"
              >
                {{ suggestion }}
              </v-chip>
            </div>
            <div v-if="message.sceneChange?.description" class="message-change-description">
              {{ message.sceneChange.description }}
            </div>
            <div
              v-if="message.role === 'assistant' && message.sceneChange"
              class="message-change-actions"
            >
              <v-btn
                class="message-change-button"
                color="secondary"
                variant="tonal"
                size="small"
                :loading="message.sceneChangeApplying"
                :disabled="message.sceneChangeApplied || message.sceneChangeApplying"
                @click="handleApplySceneChange(message.id)"
              >
                <template v-if="message.sceneChangeApplied">
                  <v-icon start>mdi-check</v-icon>
                  已应用
                </template>
                <template v-else>
                  <v-icon start>mdi-wrench</v-icon>
                  应用到场景
                </template>
              </v-btn>
              <v-chip
                v-if="message.sceneChangeApplied && !message.sceneChangeApplying"
                class="message-change-status"
                color="success"
                size="x-small"
                label
                variant="flat"
              >
                已同步
              </v-chip>
            </div>
            <div v-if="message.sceneChangeError" class="message-change-error">
              {{ message.sceneChangeError }}
            </div>
          </div>
        </div>
      </template>
    </div>

    <v-divider class="chat-divider" />

    <div class="chat-input">
      <div class="chat-composer" :class="{ 'is-multiline': isTextareaExpanded }">
        <div class="chat-textarea-wrapper">
          <v-textarea
            ref="textareaRef"
            v-model="messageInput"
            class="chat-textarea"
            placeholder="向 AI 助手提问，使用 Ctrl+Enter 快速发送"
            rows="1"
            row-height="18"
            auto-grow
            max-rows="6"
            density="comfortable"
            hide-details
            @keydown="handleKeydown"
          />
        </div>
        <div class="chat-controls">
          <div class="chat-model-info" title="当前使用的大模型">
            <v-icon size="16" color="primary">mdi-robot-outline</v-icon>
            <span class="chat-model-name">{{ activeModelLabel }}</span>
          </div>
          <v-btn
            class="chat-action chat-action--send"
            variant="text"
            density="comfortable"
            size="small"
            icon="mdi-send"
            aria-label="发送消息"
            :disabled="!messageInput.trim() || isAwaitingResponse"
            @click="handleSendText"
          />
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

.message-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.message-suggestion-chip {
  cursor: pointer;
}

.message-change-description {
  font-size: 13px;
  line-height: 1.5;
  opacity: 0.9;
  white-space: pre-wrap;
}

.message-change-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.message-change-button {
  min-width: 128px;
}

.message-change-status {
  font-weight: 600;
}

.message-change-error {
  font-size: 12px;
  color: #ff8a80;
}

.chat-divider {
  margin: 0 0 6px;
}

.chat-input {
  padding: 0px;
}

.chat-composer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(22, 27, 37, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  padding: 2px 4px;
  box-shadow: inset 0 0 0 1px rgba(12, 16, 24, 0.35);
}

.chat-composer.is-multiline {
  padding-bottom: 14px;
}

.chat-textarea-wrapper {
  position: relative;
}

.chat-textarea {
  background: transparent;
}

.chat-textarea :deep(.v-field__overlay) {
  opacity: 0;
}

.chat-textarea :deep(.v-field__outline) {
  display: none;
}

.chat-textarea :deep(.v-field__input) {
  padding: 0;
}

.chat-textarea :deep(textarea) {
  padding: 6px 0 4px;
  min-height: 38px !important;
  line-height: 1.5;
  background: transparent;
  color: inherit;
}

.chat-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.chat-model-info {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(233, 236, 241, 0.8);
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(12, 17, 26, 0.6);
}

.chat-model-name {
  font-weight: 500;
  letter-spacing: 0.02em;
}

.chat-action {
  min-width: auto;
  height: 32px;
  color: var(--v-theme-primary);
}

.chat-action--send {
  padding: 2px;
  transition: transform 0.15s ease;
}

.chat-action--send:hover:not([disabled]) {
  transform: translateY(-1px);
}

.chat-action--send :deep(.v-icon) {
  color: inherit;
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
