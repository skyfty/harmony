import { defineStore } from 'pinia'
import { ref } from 'vue'
import { sendAssistantMessage } from '@/api/aiAssistant'
import type {
  AiAssistantMessageRequest,
  AiChatMessage,
  AiChatMessageStatus,
  AiAssistantHistoryItem,
} from '@/types/ai-assistant'
import { generateUuid } from '@/utils/uuid'

const MAX_CONTEXT_MESSAGES = 12

async function blobToBase64(blob: Blob): Promise<{ base64: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取图片数据'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const base64 = result.includes(',') ? result.split(',')[1] ?? '' : result
      resolve({ base64, dataUrl: result })
    }
    reader.readAsDataURL(blob)
  })
}

function sanitizeText(text: string | undefined): string | undefined {
  if (!text) {
    return undefined
  }
  const trimmed = text.trim()
  return trimmed.length ? trimmed : undefined
}

export const useAiAssistantStore = defineStore('ai-assistant', () => {
  const messages = ref<AiChatMessage[]>([])
  const isAwaitingResponse = ref(false)
  const lastError = ref<string | null>(null)

  function buildContextHistory(): AiAssistantHistoryItem[] {
    const history = messages.value.filter((entry) => entry.status === 'sent')
    const recent = history.slice(-MAX_CONTEXT_MESSAGES)
    return recent.map((entry) => ({
      role: entry.role,
      text: entry.text,
    }))
  }

  function updateMessageStatus(message: AiChatMessage, status: AiChatMessageStatus, error?: string | null) {
    message.status = status
    message.error = error ?? null
  }

  async function sendMessage(options: { text?: string; imageBlob?: Blob | null }): Promise<void> {
    const text = sanitizeText(options.text)
    const imageBlob = options.imageBlob ?? null

    if (!text && !imageBlob) {
      return
    }

    let dataUrl: string | undefined
    let base64: string | undefined

    if (imageBlob) {
      try {
        const converted = await blobToBase64(imageBlob)
        dataUrl = converted.dataUrl
        base64 = converted.base64
      } catch (error) {
        const message = error instanceof Error ? error.message : '截图处理失败'
        lastError.value = message
        throw error instanceof Error ? error : new Error(message)
      }
    }

    const createdAt = new Date().toISOString()
    const userMessage: AiChatMessage = {
      id: generateUuid(),
      role: 'user',
      text,
      imageDataUrl: dataUrl,
      createdAt,
      status: 'sending',
      error: null,
    }

    messages.value.push(userMessage)

    const assistantPlaceholder: AiChatMessage = {
      id: generateUuid(),
      role: 'assistant',
      text: undefined,
      imageUrl: null,
      createdAt,
      status: 'pending',
      error: null,
    }

    messages.value.push(assistantPlaceholder)
    isAwaitingResponse.value = true
    lastError.value = null

    const payload: AiAssistantMessageRequest = {
      text,
      image: base64 && imageBlob
        ? {
            base64,
            mimeType: imageBlob.type || 'image/png',
            fileName: imageBlob instanceof File ? imageBlob.name : `screenshot-${userMessage.id}.png`,
          }
        : undefined,
      context: buildContextHistory(),
    }

    try {
      const response = await sendAssistantMessage(payload)
      updateMessageStatus(userMessage, 'sent')
      Object.assign(assistantPlaceholder, {
        text: response.reply.text,
        createdAt: response.reply.createdAt ?? new Date().toISOString(),
        imageUrl: response.reply.imageUrl ?? null,
      })
      updateMessageStatus(assistantPlaceholder, 'sent')
      lastError.value = null
    } catch (error) {
      const message = error instanceof Error ? error.message : '发送失败'
      updateMessageStatus(userMessage, 'error', message)
      if (assistantPlaceholder.status === 'pending') {
        assistantPlaceholder.text = 'AI 助手回复失败'
      }
      updateMessageStatus(assistantPlaceholder, 'error', message)
      lastError.value = message
      throw error instanceof Error ? error : new Error(message)
    } finally {
      isAwaitingResponse.value = false
    }
  }

  function clearError(): void {
    lastError.value = null
  }

  function clearConversation(): void {
    messages.value = []
    isAwaitingResponse.value = false
    lastError.value = null
  }

  return {
    messages,
    isAwaitingResponse,
    lastError,
    sendMessage,
    clearError,
    clearConversation,
  }
})
