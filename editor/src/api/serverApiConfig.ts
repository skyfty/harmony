export interface ServerApiConfig {
  baseUrl: string
  prefix: string
}

const DEFAULT_PREFIX = '/api'

type RuntimeConfig = {
  serverApiBaseUrl?: string
  serverApiPrefix?: string
} | undefined

function readRuntimeConfig(): RuntimeConfig {
  return (window as any)?.__HARMONY_RUNTIME_CONFIG__ as RuntimeConfig
}

function pickFirstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return ''
}

export function readServerApiConfig(): ServerApiConfig {
  const runtime = readRuntimeConfig()
  const baseCandidate = pickFirstNonEmpty(runtime?.serverApiBaseUrl, import.meta.env?.VITE_SERVER_API_BASE_URL as string | undefined)
  const prefixCandidate = pickFirstNonEmpty(runtime?.serverApiPrefix, import.meta.env?.VITE_SERVER_API_PREFIX as string | undefined, DEFAULT_PREFIX)

  const normalizedBase = baseCandidate.endsWith('/') ? baseCandidate.slice(0, -1) : baseCandidate
  const normalizedPrefix = prefixCandidate.startsWith('/') ? prefixCandidate : `/${prefixCandidate}`

  return {
    baseUrl: normalizedBase,
    prefix: normalizedPrefix,
  }
}

export function buildServerApiUrl(path: string): string {
  const { baseUrl, prefix } = readServerApiConfig()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const apiPath = normalizedPath.startsWith(prefix) ? normalizedPath : `${prefix}${normalizedPath}`
  return baseUrl ? `${baseUrl}${apiPath}` : apiPath
}
