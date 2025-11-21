import { buildServerApiUrl } from '@/api/serverApiConfig'
import { useAuthStore } from '@/stores/authStore'

export interface SceneEntity {
  id: string
  name: string
  description: string | null
  fileKey: string
  fileUrl: string
  fileSize: number
  fileType: string | null
  originalFilename: string | null
  metadata: Record<string, unknown> | null
  publishedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface PublishScenePayload {
  name: string
  description?: string | null
  metadata?: Record<string, unknown> | null
  file: Blob
  fileName: string
  mimeType?: string | null
}

function parseJsonBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null)
  }
  return response
    .text()
    .catch(() => '')
    .then((text) => {
      if (!text) {
        return null
      }
      try {
        return JSON.parse(text)
      } catch (_error) {
        return null
      }
    })
}

export async function publishScene(payload: PublishScenePayload): Promise<SceneEntity> {
  const authStore = useAuthStore()
  const authorization = authStore.authorizationHeader
  if (!authorization) {
    throw new Error('请先登录后再发布场景')
  }

  const url = buildServerApiUrl('/scenes')
  const formData = new FormData()
  formData.append('name', payload.name)
  if (payload.description !== undefined && payload.description !== null) {
    formData.append('description', payload.description)
  }
  if (payload.metadata !== undefined) {
    formData.append('metadata', payload.metadata ? JSON.stringify(payload.metadata) : 'null')
  }

  const blob = payload.mimeType && payload.file instanceof Blob && payload.file.type !== payload.mimeType
    ? payload.file.slice(0, payload.file.size, payload.mimeType)
    : payload.file
  formData.append('file', blob, payload.fileName)

  const headers = new Headers({ Accept: 'application/json' })
  headers.set('Authorization', authorization)

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
    headers,
    credentials: 'include',
  })

  const body = (await parseJsonBody(response)) as unknown

  if (!response.ok) {
    const message = body && typeof body === 'object' && body !== null && 'message' in body
      ? String((body as { message?: unknown }).message)
      : null
    throw new Error(message || '发布场景失败')
  }

  if (body && typeof body === 'object' && body !== null && 'data' in body) {
    return (body as { data: SceneEntity }).data
  }

  if (body && typeof body === 'object') {
    return body as SceneEntity
  }

  throw new Error('服务器未返回场景数据')
}
