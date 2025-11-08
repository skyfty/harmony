export type AssistantMessageRole = 'user' | 'assistant'

export type AssistantContextMessage = {
  role: AssistantMessageRole
  text?: string
}

export type AssistantImagePayload = {
  base64: string
  mimeType: string
  fileName?: string
}

export type AssistantMessagePayload = {
  text?: string
  image?: AssistantImagePayload | null
  context?: AssistantContextMessage[]
}

export type AssistantReply = {
  text: string
  createdAt: string
  imageUrl?: string | null
}

export type AssistantResponse = {
  id: string
  reply: AssistantReply
  suggestions?: string[]
}
