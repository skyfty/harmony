import type { StoredSceneDocument } from '@/types/stored-scene-document'

export type AiChatRole = 'user' | 'assistant'

export type AiChatMessageStatus = 'sending' | 'sent' | 'pending' | 'error'

export type JsonPatchOperation =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; from: string; path: string }
  | { op: 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown }

export type AiAssistantToolDefinition = {
  name: string
  description: string
  parameters?: Record<string, unknown>
  returns?: string
}

export type AiAssistantToolInvocation = {
  tool: string
  args?: Record<string, unknown>
}

export type AiAssistantSceneChange =
  | {
      id: string
      type: 'tool-invocations'
      title?: string
      description?: string
      toolInvocations: AiAssistantToolInvocation[]
      autoApply?: boolean
    }
  | {
      id: string
      type: 'json-patch'
      title?: string
      description?: string
      patch: JsonPatchOperation[]
      autoApply?: boolean
    }

export type AiAssistantResourceDescriptor = {
  modelLibrary?: {
    searchEndpoint: string
    assetDetailEndpoint?: string
    description?: string
  }
}

export type AiAssistantMessageMetadata = {
  model?: string
  systemPrompt?: string
  promptTokenCount?: number
  completionTokenCount?: number
  latencyMs?: number
  toolboxSize?: number
  sceneNodeCount?: number
}

export type AiChatMessage = {
  id: string
  role: AiChatRole
  text?: string
  imageDataUrl?: string
  imageUrl?: string | null
  createdAt: string
  status: AiChatMessageStatus
  error?: string | null
  suggestions?: string[]
  metadata?: AiAssistantMessageMetadata | null
  sceneChange?: AiAssistantSceneChange | null
  sceneChangeApplied?: boolean
  sceneChangeApplying?: boolean
  sceneChangeError?: string | null
}

export type AiAssistantHistoryItem = {
  role: AiChatRole
  text?: string
}

export type AiAssistantAttachmentRequest = {
  base64: string
  mimeType: string
  fileName?: string
}

export type AiAssistantMessageRequest = {
  text?: string
  image?: AiAssistantAttachmentRequest | null
  context?: AiAssistantHistoryItem[]
  scene?: StoredSceneDocument | null
  toolbox?: AiAssistantToolDefinition[]
  resources?: AiAssistantResourceDescriptor
}

export type AiAssistantReplyPayload = {
  text: string
  createdAt: string
  imageUrl?: string | null
  metadata?: Record<string, unknown>
}

export type AiAssistantMessageResponse = {
  id: string
  reply: AiAssistantReplyPayload
  suggestions?: string[]
  change?: AiAssistantSceneChange | null
  metadata?: AiAssistantMessageMetadata | null
}
