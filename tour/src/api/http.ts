export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS' | 'HEAD'

export type HttpRequestOptions = {
  method?: HttpMethod
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  timeoutMs?: number
}

function buildQueryString(query: HttpRequestOptions['query']): string {
  if (!query) return ''
  const params = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)])

  if (params.length === 0) return ''
  const usp = new URLSearchParams(params)
  const qs = usp.toString()
  return qs ? `?${qs}` : ''
}

export class HttpError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.data = data
  }
}

export async function httpRequest<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const qs = buildQueryString(options.query)

  const requestData: string | AnyObject | ArrayBuffer | undefined = (() => {
    const body = options.body
    if (body === undefined || body === null) {
      return undefined
    }
    if (typeof body === 'string') {
      return body
    }
    if (body instanceof ArrayBuffer) {
      return body
    }
    if (typeof body === 'object') {
      return body as AnyObject
    }
    return String(body)
  })()

  const response = await new Promise<UniApp.RequestSuccessCallbackResult>((resolve, reject) => {
    uni.request({
      url: `${url}${qs}`,
      method,
      ...(requestData === undefined ? {} : { data: requestData }),
      header: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
      timeout: options.timeoutMs ?? 15000,
      success: resolve,
      fail: reject,
    })
  })

  const statusCode = response.statusCode ?? 0
  const data = response.data

  if (statusCode >= 200 && statusCode < 300) {
    return data as T
  }

  const message = typeof (data as any)?.message === 'string' ? (data as any).message : `HTTP ${statusCode}`
  throw new HttpError(message, statusCode, data)
}
