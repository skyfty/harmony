import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { toFile } from 'openai/uploads'
import { appConfig } from '@/config/env'
import { getOpenAiClient } from '@/services/openAiClient'

export type TagGenerationSource =
  | { kind: 'image'; promptHint?: string | null }
  | { kind: 'audio'; base64: string; mimeType?: string; filename?: string }
  | { kind: 'text' }

export interface TagGenerationRequest {
  name?: string | null
  description?: string | null
  assetType?: string | null
  source?: TagGenerationSource | null
  extraHints?: string[]
}

export interface TagGenerationResult {
  tags: string[]
  transcript?: string | null
  imagePrompt?: string | null
  modelTraceId: string
}

const FALLBACK_TEXT_MODEL = appConfig.openAi.model || 'gpt-4o-mini'
const IMAGE_MODEL = 'gpt-image-1'
const AUDIO_MODEL = 'whisper-1'

function normalizeTag(tag: string | null | undefined): string | null {
  if (typeof tag !== 'string') {
    return null
  }
  const trimmed = tag.trim()
  if (!trimmed) {
    return null
  }
  return trimmed.length <= 42 ? trimmed : trimmed.slice(0, 42)
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  tags.forEach((tag) => {
    const normalized = normalizeTag(tag?.toString())
    if (!normalized) {
      return
    }
    const key = normalized.toLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    result.push(normalized)
  })
  return result
}

async function transcribeAudio(source: Extract<TagGenerationSource, { kind: 'audio' }>): Promise<string | null> {
  if (!source.base64) {
    return null
  }
  try {
    const buffer = Buffer.from(source.base64, 'base64')
    if (!buffer.byteLength) {
      return null
    }
    const client = getOpenAiClient()
    const file = await toFile(buffer, source.filename ?? `audio-${Date.now().toString(36)}.mp3`, {
      type: source.mimeType || 'audio/mpeg',
    })
    const transcription = await client.audio.transcriptions.create({
      file,
      model: AUDIO_MODEL,
    })
    const transcript = typeof transcription.text === 'string' ? transcription.text.trim() : ''
    return transcript.length ? transcript : null
  } catch (error) {
    console.warn('[aiTagService] Failed to transcribe audio for tag suggestions', error)
    return null
  }
}

async function generateImagePrompt(prompt: string): Promise<string | null> {
  const client = getOpenAiClient()
  try {
    const response = await client.images.generate({
      model: IMAGE_MODEL,
      prompt,
      n: 1,
      size: '256x256',
      response_format: 'b64_json',
      user: 'harmony-ai-tagging',
    })
    const revised = response.data?.[0]?.revised_prompt
    return typeof revised === 'string' && revised.trim().length ? revised.trim() : null
  } catch (error) {
    console.warn('[aiTagService] Failed to call DALL·E for tag suggestions', error)
    return null
  }
}

function buildUserPrompt(request: TagGenerationRequest, transcript: string | null, imagePrompt: string | null): string {
  const segments: string[] = []
  const name = request.name?.trim()
  const description = request.description?.trim()
  const assetType = request.assetType?.trim()

  if (name) {
    segments.push(`资源名称: ${name}`)
  }
  if (description) {
    segments.push(`资源描述: ${description}`)
  }
  if (assetType) {
    segments.push(`资源类型: ${assetType}`)
  }
  if (transcript) {
    segments.push(`音频转写: ${transcript}`)
  }
  if (imagePrompt) {
    segments.push(`图像提示: ${imagePrompt}`)
  }
  if (Array.isArray(request.extraHints) && request.extraHints.length) {
    segments.push(`额外提示: ${request.extraHints.filter(Boolean).join('；')}`)
  }

  if (!segments.length) {
    segments.push('用户未提供资源描述。')
  }

  segments.push('请根据以上信息提取 3-8 个中文标签，每个不超过 6 个汉字或 12 个字符。')
  segments.push('请输出 JSON，格式为 {"tags": ["标签1", "标签2"]}，不得包含除 JSON 以外的任何文字。')

  return segments.join('\n')
}

export async function generateTags(request: TagGenerationRequest): Promise<TagGenerationResult> {
  const baseName = request.name?.trim()
  const baseDescription = request.description?.trim()
  if (!baseName && !baseDescription) {
    throw new Error('需要提供资源名称或描述')
  }

  let transcript: string | null = null
  if (request.source?.kind === 'audio') {
    transcript = await transcribeAudio(request.source)
  }

  let imagePrompt: string | null = null
  const promptForImage = [baseName, baseDescription].filter(Boolean).join('，')
  if ((request.assetType === 'image' || request.source?.kind === 'image') && promptForImage) {
    imagePrompt = await generateImagePrompt(`为以下资源生成便于检索的描述性关键字: ${promptForImage}`)
  }

  const client = getOpenAiClient()
  const model = appConfig.openAi.model || FALLBACK_TEXT_MODEL
  const systemPrompt =
    '你是一名资源管理助手，需要根据提供的资源信息生成适合检索和分类的中文标签。标签应简短、具体、避免重复。'
  const userPrompt = buildUserPrompt(request, transcript, imagePrompt)

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages,
  })

  const content = completion.choices?.[0]?.message?.content ?? ''
  let tags: string[] = []
  try {
    const parsed = JSON.parse(content || '{}') as { tags?: unknown }
    if (Array.isArray(parsed.tags)) {
      tags = parsed.tags.filter((entry): entry is string => typeof entry === 'string')
    }
  } catch (error) {
    console.warn('[aiTagService] Failed to parse AI tag response', error, content)
  }

  const normalized = uniqueTags(tags)
  if (!normalized.length) {
    throw new Error('AI 未能生成有效的标签，请补充描述后重试')
  }

  return {
    tags: normalized,
    transcript,
    imagePrompt,
    modelTraceId: completion.id ?? randomUUID(),
  }
}
