import OpenAI from 'openai'
import { appConfig } from '@/config/env'

let cachedClient: OpenAI | null = null

export function getOpenAiClient(): OpenAI {
  if (!appConfig.openAi.apiKey) {
    throw new Error('OpenAI API key 未配置')
  }
  if (!cachedClient) {
    cachedClient = new OpenAI({
      apiKey: appConfig.openAi.apiKey,
      baseURL: appConfig.openAi.baseUrl,
      organization: appConfig.openAi.organization,
      project: appConfig.openAi.project,
    })
  }
  return cachedClient
}
