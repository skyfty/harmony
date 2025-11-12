import { apiClient } from '@/api/http'
import type { AuthProfileResponse, LoginRequest, LoginResponse } from '@/types'

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/login', payload)
  return data
}

export async function fetchProfile(): Promise<AuthProfileResponse> {
  const { data } = await apiClient.get<AuthProfileResponse>('/auth/profile')
  return data
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout')
}
