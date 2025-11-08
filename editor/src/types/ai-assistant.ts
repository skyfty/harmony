export type AiChatRole = 'user' | 'assistant'

export type AiChatMessageStatus = 'sending' | 'sent' | 'pending' | 'error'

export type AiChatMessage = {
  id: string
  role: AiChatRole
  text?: string
  imageDataUrl?: string
  imageUrl?: string | null
  createdAt: string
  status: AiChatMessageStatus
  error?: string | null
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
}
