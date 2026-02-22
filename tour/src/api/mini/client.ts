import * as harmonyUtils from '@harmony/utils'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'

type HttpRequestOptions = {
  method?: HttpMethod
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  timeoutMs?: number
}

type RequestErrorKind = 'auth' | 'network' | 'server' | 'business' | 'unknown'

const requestMiniApi = (typeof harmonyUtils.httpRequest === 'function' ? harmonyUtils.httpRequest : undefined) as
  | (<R>(target: string, options?: HttpRequestOptions) => Promise<R>)
  | undefined

type MiniApiEnvelope<T> = {
  code: number
  data: T
  message: string
}

export class MiniApiError extends Error {
  kind: RequestErrorKind
  status?: number
  code?: number

  constructor(message: string, options: { kind: RequestErrorKind; status?: number; code?: number }) {
    super(message)
    this.name = 'MiniApiError'
    this.kind = options.kind
    this.status = options.status
    this.code = options.code
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const GET_RETRY_LIMIT = 2
const GET_RETRY_BASE_DELAY_MS = 250
const inFlightGetRequests = new Map<string, Promise<unknown>>()

const resolveBaseUrl =
  typeof harmonyUtils.getBaseUrl === 'function' ? harmonyUtils.getBaseUrl : () => 'http://localhost:4000/api/mini'

const resolveApiOrigin = typeof harmonyUtils.getApiOrigin === 'function'
  ? harmonyUtils.getApiOrigin
  : () => {
      const base = resolveBaseUrl()
      const match = base.match(/^(https?:\/\/[^/]+)/)
      return match ? match[1] : base
    }

const readAuthToken = typeof harmonyUtils.getAuthToken === 'function' ? harmonyUtils.getAuthToken : () => undefined

const HttpErrorClass = harmonyUtils.HttpError as
  | (new (message: string, status: number, data: unknown) => Error & { status: number; data: unknown })
  | undefined

function isMiniApiEnvelope<T>(value: unknown): value is MiniApiEnvelope<T> {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return typeof candidate.code === 'number' && 'data' in candidate && typeof candidate.message === 'string'
}

function isAbsoluteUrl(target: string): boolean {
  return target.startsWith('http://') || target.startsWith('https://')
}

function resolveRequestTarget(path: string): string {
  if (isAbsoluteUrl(path)) {
    return path
  }

  if (path.startsWith('/mini-auth/')) {
    return `${resolveApiOrigin()}/api${path}`
  }

  const base = resolveBaseUrl()
  return `${base}${path}`
}

function buildQueryString(query?: Record<string, string | number | boolean | null | undefined>): string {
  if (!query) return ''

  const params = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)])

  if (!params.length) return ''
  const usp = new URLSearchParams(params)
  const text = usp.toString()
  return text ? `?${text}` : ''
}

async function requestWithUni<R>(target: string, options: HttpRequestOptions): Promise<R> {
  const method = options.method === 'PATCH' ? 'POST' : (options.method ?? 'GET')
  const extraHeaders = options.method === 'PATCH' ? { 'X-HTTP-Method-Override': 'PATCH' } : {}
  return await new Promise<R>((resolve, reject) => {
    uni.request({
      url: `${target}${buildQueryString(options.query)}`,
      method,
      data: options.body as any,
      timeout: options.timeoutMs ?? 20000,
      header: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
        ...extraHeaders,
        ...(readAuthToken() ? { Authorization: `Bearer ${readAuthToken()}` } : {}),
      },
      success: (response: { statusCode?: number; data?: unknown }) => {
        const statusCode = response.statusCode ?? 0
        if (statusCode >= 200 && statusCode < 300) {
          resolve(response.data as R)
          return
        }
        const message =
          typeof (response.data as { message?: unknown } | undefined)?.message === 'string'
            ? ((response.data as { message: string }).message)
            : `HTTP ${statusCode}`
        if (HttpErrorClass) {
          reject(new HttpErrorClass(message, statusCode, response.data))
          return
        }
        reject(new Error(message))
      },
      fail: (error: unknown) => {
        reject(error)
      },
    })
  })
}

async function requestWithFetch<R>(target: string, options: HttpRequestOptions): Promise<R> {
  const response = await fetch(`${target}${buildQueryString(options.query)}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
      ...(readAuthToken() ? { Authorization: `Bearer ${readAuthToken()}` } : {}),
    },
    ...(options.body === undefined
      ? {}
      : {
          body: JSON.stringify(options.body),
        }),
  })

  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : await response.text()
  if (response.ok) {
    return data as R
  }

  const message = typeof (data as { message?: unknown } | undefined)?.message === 'string'
    ? ((data as { message: string }).message)
    : `HTTP ${response.status}`
  if (HttpErrorClass) {
    throw new HttpErrorClass(message, response.status, data)
  }
  throw new Error(message)
}

async function requestRaw<R>(target: string, options: HttpRequestOptions): Promise<R> {
  if (requestMiniApi) {
    return await requestMiniApi<R>(target, options)
  }

  if (typeof uni !== 'undefined' && typeof uni.request === 'function') {
    return await requestWithUni<R>(target, options)
  }

  return await requestWithFetch<R>(target, options)
}

function stringifyQuery(query?: Record<string, string | number | boolean | null | undefined>): string {
  if (!query) return ''
  const entries = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify(entries)
}

function buildGetRequestKey(target: string, options: HttpRequestOptions): string {
  return `${target}::${stringifyQuery(options.query)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function mapRequestError(error: unknown): MiniApiError {
  if (error instanceof MiniApiError) {
    return error
  }

  if (HttpErrorClass && error instanceof HttpErrorClass) {
    if (error.status === 401) {
      return new MiniApiError(error.message || 'Unauthorized', { kind: 'auth', status: error.status })
    }
    if (RETRYABLE_STATUS.has(error.status)) {
      return new MiniApiError(error.message || 'Server unavailable', { kind: 'server', status: error.status })
    }
    return new MiniApiError(error.message || 'Request failed', { kind: 'unknown', status: error.status })
  }

  if (error instanceof Error) {
    return new MiniApiError(error.message || 'Network error', { kind: 'network' })
  }

  return new MiniApiError('Network error', { kind: 'network' })
}

async function executeWithRetry<T>(target: string, options: HttpRequestOptions): Promise<T> {
  const method = options.method ?? 'GET'
  const maxAttempts = method === 'GET' ? GET_RETRY_LIMIT + 1 : 1
  let attempt = 0

  while (attempt < maxAttempts) {
    try {
      const payload = await requestRaw<MiniApiEnvelope<T> | T>(target, {
        ...options,
        headers: {
          ...(options.headers ?? {}),
        },
      })

      if (!isMiniApiEnvelope<T>(payload)) {
        return payload as T
      }

      if (payload.code !== 0) {
        throw new MiniApiError(payload.message || 'API request failed', {
          kind: 'business',
          code: payload.code,
        })
      }

      return payload.data
    } catch (rawError) {
      const error = mapRequestError(rawError)
      attempt += 1
      const shouldRetry =
        method === 'GET' &&
        attempt < maxAttempts &&
        (error.kind === 'network' || error.kind === 'server')

      if (!shouldRetry) {
        throw error
      }

      const backoff = GET_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
      await sleep(backoff)
    }
  }

  throw new MiniApiError('Request failed', { kind: 'unknown' })
}

export async function miniRequest<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const target = resolveRequestTarget(path)

  if (method === 'GET') {
    const requestKey = buildGetRequestKey(target, options)
    const inFlight = inFlightGetRequests.get(requestKey) as Promise<T> | undefined
    if (inFlight) {
      return await inFlight
    }

    const pending = executeWithRetry<T>(target, { ...options, method: 'GET' })
    inFlightGetRequests.set(requestKey, pending)

    try {
      return await pending
    } finally {
      inFlightGetRequests.delete(requestKey)
    }
  }

  return await executeWithRetry<T>(target, options)
}
