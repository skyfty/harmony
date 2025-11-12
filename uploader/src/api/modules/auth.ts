import { apiClient } from '@/api/http'
import type { AuthProfileResponse, LoginRequest, LoginResponse } from '@/types'

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>('/auth/login', payload)
  return response.data
}

export async function fetchProfile(): Promise<AuthProfileResponse> {
  const response = await apiClient.get<AuthProfileResponse>('/auth/profile')
  return response.data
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout')
}
