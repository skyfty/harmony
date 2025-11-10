import { defineStore } from 'pinia'
import { ref } from 'vue'
import { executeToolInvocations, getAgentToolboxDefinitions } from '@/ai/agentToolbox'
import { sendAssistantMessage } from '@/api/aiAssistant'
import { useSceneStore } from '@/stores/sceneStore'
import type {
  AiAssistantMessageRequest,
  AiAssistantSceneChange,
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

  const MODEL_LIBRARY_RESOURCE = {
    searchEndpoint: '/api/library/models/search',
    assetDetailEndpoint: '/api/library/models/{assetId}',
    description: '提供网格、贴图、材质等资产的查询接口，便于根据关键字检索可用资源。',
  } as const

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
      suggestions: undefined,
      metadata: null,
      sceneChange: null,
      sceneChangeApplied: false,
      sceneChangeApplying: false,
      sceneChangeError: null,
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
      suggestions: [],
      metadata: null,
      sceneChange: null,
      sceneChangeApplied: false,
      sceneChangeApplying: false,
      sceneChangeError: null,
    }

    messages.value.push(assistantPlaceholder)
    isAwaitingResponse.value = true
    lastError.value = null

    const sceneStore = useSceneStore()
    let sceneSnapshot: ReturnType<typeof sceneStore.createSceneDocumentSnapshot> | null = null
    try {
      sceneSnapshot = sceneStore.createSceneDocumentSnapshot()
    } catch (error) {
      console.warn('[AiAssistantStore] Failed to capture scene snapshot', error)
    }

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
      scene: sceneSnapshot,
      toolbox: getAgentToolboxDefinitions(),
      resources: {
        modelLibrary: {
          searchEndpoint: MODEL_LIBRARY_RESOURCE.searchEndpoint,
          assetDetailEndpoint: MODEL_LIBRARY_RESOURCE.assetDetailEndpoint,
          description: MODEL_LIBRARY_RESOURCE.description,
        },
      },
    }

    try {
      const response = await sendAssistantMessage(payload)
      updateMessageStatus(userMessage, 'sent')
      Object.assign(assistantPlaceholder, {
        text: response.reply.text,
        createdAt: response.reply.createdAt ?? new Date().toISOString(),
        imageUrl: response.reply.imageUrl ?? null,
        suggestions: response.suggestions ?? [],
        metadata: response.metadata ?? null,
        sceneChange: response.change ?? null,
        sceneChangeApplied: false,
        sceneChangeApplying: false,
        sceneChangeError: null,
      })
      updateMessageStatus(assistantPlaceholder, 'sent')
      lastError.value = null
      if (assistantPlaceholder.sceneChange?.autoApply) {
        try {
          await applySceneChangeInternal(assistantPlaceholder.sceneChange, assistantPlaceholder)
        } catch (error) {
          console.warn('[AiAssistantStore] Auto apply change failed', error)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '发送失败'
      updateMessageStatus(userMessage, 'error', message)
      if (assistantPlaceholder.status === 'pending') {
        assistantPlaceholder.text = 'AI 助手回复失败'
        assistantPlaceholder.suggestions = []
        assistantPlaceholder.sceneChange = null
        assistantPlaceholder.metadata = null
      }
      updateMessageStatus(assistantPlaceholder, 'error', message)
      lastError.value = message
      throw error instanceof Error ? error : new Error(message)
    } finally {
      isAwaitingResponse.value = false
    }
  }

  async function applySceneChangeInternal(change: AiAssistantSceneChange, message: AiChatMessage): Promise<void> {
    const sceneStore = useSceneStore()
    message.sceneChangeApplying = true
    message.sceneChangeError = null
    try {
      if (change.type === 'tool-invocations') {
        await executeToolInvocations(change.toolInvocations, sceneStore)
      } else if (change.type === 'json-patch') {
        throw new Error('暂不支持 JSON Patch 变更应用。')
      } else {
        throw new Error('未知的场景变更类型。')
      }
      message.sceneChangeApplied = true
    } catch (error) {
      const messageText = error instanceof Error ? error.message : '应用场景变更失败'
      message.sceneChangeError = messageText
      throw error instanceof Error ? error : new Error(messageText)
    } finally {
      message.sceneChangeApplying = false
    }
  }

  async function applySceneChange(messageId: string): Promise<void> {
    const message = messages.value.find((entry) => entry.id === messageId)
    if (!message || message.role !== 'assistant') {
      throw new Error('只能对 AI 回复执行场景变更。')
    }
    if (!message.sceneChange) {
      throw new Error('该回复中没有可应用的场景变更。')
    }
    if (message.sceneChangeApplied) {
      return
    }
    if (message.sceneChangeApplying) {
      return
    }
    await applySceneChangeInternal(message.sceneChange, message)
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
    applySceneChange,
    clearError,
    clearConversation,
  }
})
