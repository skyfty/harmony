import { buildServerApiUrl } from '@/api/serverApiConfig'
import { useAuthStore } from '@/stores/authStore'

type ApiEnvelope<T> = {
  code: number
  data: T
  message: string
}

function isApiEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate.code === 'number' && 'data' in candidate && typeof candidate.message === 'string'
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as unknown
  if (isApiEnvelope<T>(payload)) {
    return payload.data
  }
  return payload as T
}

function createAuthorizedHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra)
  const authorization = useAuthStore().authorizationHeader
  if (authorization) {
    headers.set('Authorization', authorization)
  }
  return headers
}

export type TerrainImageryProviderSummary = {
  id: string
  label: string
  attribution: string | null
  minZoom: number
  maxZoom: number
  supportsProjectedCrs: string[]
}

export type TerrainImageryFetchPlanTile = {
  z: number
  x: number
  y: number
  url: string
  drawLeft: number
  drawTop: number
  drawWidth: number
  drawHeight: number
}

export type TerrainImageryFetchPlan = {
  provider: TerrainImageryProviderSummary
  projectedCrs: string
  sourceBounds: {
    west: number
    south: number
    east: number
    north: number
  }
  geographicBounds: {
    west: number
    south: number
    east: number
    north: number
  }
  width: number
  height: number
  zoom: number
  tileSize: number
  tiles: TerrainImageryFetchPlanTile[]
}

export async function fetchTerrainImageryProviders(): Promise<TerrainImageryProviderSummary[]> {
  const response = await fetch(buildServerApiUrl('/terrain-imagery/providers'), {
    method: 'GET',
    credentials: 'include',
    headers: createAuthorizedHeaders({ Accept: 'application/json' }),
  })
  if (!response.ok) {
    throw new Error('Failed to load terrain imagery providers.')
  }
  const payload = await parseJsonResponse<{ providers: TerrainImageryProviderSummary[] }>(response)
  return Array.isArray(payload.providers) ? payload.providers : []
}

export async function fetchTerrainImageryPlan(payload: {
  providerId?: string | null
  projectedCrs: string
  sourceBounds: {
    west: number
    south: number
    east: number
    north: number
  }
  maxOutputSize?: number | null
}): Promise<TerrainImageryFetchPlan> {
  const response = await fetch(buildServerApiUrl('/terrain-imagery/fetch-plan'), {
    method: 'POST',
    credentials: 'include',
    headers: createAuthorizedHeaders({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || 'Failed to create terrain imagery fetch plan.')
  }
  return await parseJsonResponse<TerrainImageryFetchPlan>(response)
}

export async function fetchTerrainImageryTileBlob(url: string): Promise<Blob> {
  const response = await fetch(buildServerApiUrl(url), {
    method: 'GET',
    credentials: 'include',
    headers: createAuthorizedHeaders(),
  })
  if (!response.ok) {
    throw new Error(`Failed to load terrain imagery tile (${response.status}).`)
  }
  return await response.blob()
}
