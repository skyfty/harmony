import type { ProjectDirectory } from '@/types/project-directory'
import type { ResourceProvider } from './types'

const ADMIN_TOKEN_STORAGE_KEY = 'harmony_admin_token'

function getApiBase(): string | null {
  const raw = import.meta.env.VITE_ADMIN_API_BASE?.trim()
  if (!raw) {
    return null
  }
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

function buildHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: 'application/json',
  }
  try {
    const token = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
  } catch (error) {
    console.warn('Unable to access localStorage for admin token', error)
  }
  return headers
}

async function loadAdminDirectories(): Promise<ProjectDirectory[]> {
  const apiBase = getApiBase()
  if (!apiBase) {
    console.warn('Admin API base URL is not configured (VITE_ADMIN_API_BASE)')
    return []
  }
  const response = await fetch(`${apiBase}/api/resources/directories`, {
    method: 'GET',
    headers: buildHeaders(),
    credentials: 'include',
  })
  if (!response.ok) {
    console.warn('Failed to load resource directories from admin service', response.status)
    return []
  }
  const payload = (await response.json()) as { data?: unknown }
  const directories = Array.isArray(payload.data) ? (payload.data as ProjectDirectory[]) : []
  return directories
}

export const adminProvider: ResourceProvider = {
  id: 'admin-service',
  name: 'Admin Service',
  url: null,
  includeInPackages: true,
  load: loadAdminDirectories,
}

export function cacheAdminToken(token: string | null): void {
  try {
    if (!token) {
      window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token)
  } catch (error) {
    console.warn('Unable to cache admin token', error)
  }
}
