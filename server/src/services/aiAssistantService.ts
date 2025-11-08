import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { appConfig } from '@/config/env'
import type { AssistantMessagePayload, AssistantResponse } from '@/types/assistant'

const ASSISTANT_UPLOAD_DIR = path.join(appConfig.assetStoragePath, 'assistant')
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function ensureBase64Payload(raw: string): string {
  const trimmed = raw.trim()
  const commaIndex = trimmed.indexOf(',')
  if (commaIndex >= 0) {
    return trimmed.slice(commaIndex + 1)
  }
  return trimmed
}

function resolveExtension(mime: string): string {
  const normalized = mime.toLowerCase()
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'
  if (normalized === 'image/webp') return 'webp'
  return 'bin'
}

async function ensureUploadDirectory(): Promise<void> {
  await mkdir(ASSISTANT_UPLOAD_DIR, { recursive: true })
}

function sanitizeFileName(name: string): string {
  const trimmed = name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return trimmed.length ? trimmed : 'attachment'
}

function buildPublicUrl(fileName: string): string {
  const base = appConfig.assetPublicUrl.endsWith('/') ? appConfig.assetPublicUrl.slice(0, -1) : appConfig.assetPublicUrl
  return `${base}/assistant/${fileName}`
}

async function persistImage(payload: NonNullable<AssistantMessagePayload['image']>): Promise<string | null> {
  if (!payload.base64) {
    return null
  }
  const base64 = ensureBase64Payload(payload.base64)
  const buffer = Buffer.from(base64, 'base64')
  if (!buffer.byteLength) {
    return null
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('上传的截图过大，请压缩后重试')
  }

  await ensureUploadDirectory()
  const extension = resolveExtension(payload.mimeType || 'image/png')
  const safeName = sanitizeFileName(payload.fileName ?? '')
  const fileName = `${Date.now()}-${randomUUID()}-${safeName || 'screenshot'}.${extension}`
  const filePath = path.join(ASSISTANT_UPLOAD_DIR, fileName)
  await writeFile(filePath, buffer)
  return buildPublicUrl(fileName)
}

function buildReplyText(payload: AssistantMessagePayload): string {
  const segments: string[] = []
  const text = payload.text?.trim()
  if (text) {
    segments.push(`我已阅读你的描述：“${text}”。`)
  } else {
    segments.push('我已收到你的请求。')
  }
  if (payload.image) {
    segments.push('场景截图已保存，我会结合画面给出建议。')
  }
  const historySize = payload.context?.length ?? 0
  if (historySize > 0) {
    segments.push(`参考了最近 ${historySize} 条对话，以下是我的建议：`)
  } else {
    segments.push('以下是我的建议：')
  }
  segments.push('可以尝试调整光照与材质参数，或检查节点层级以确保结构清晰。')
  return segments.join(' ')
}

export async function processAssistantMessage(payload: AssistantMessagePayload): Promise<AssistantResponse> {
  const replyId = randomUUID()
  let imageUrl: string | null = null

  if (payload.image) {
    imageUrl = await persistImage(payload.image)
  }

  const reply = buildReplyText(payload)
  const createdAt = new Date().toISOString()

  return {
    id: replyId,
    reply: {
      text: reply,
      createdAt,
      imageUrl,
    },
    suggestions: [
      '尝试使用“导出”功能备份当前场景',
      '对关键节点创建分组以便管理',
    ],
  }
}
