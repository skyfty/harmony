export type AuthUserRole = {
  id: string
  name: string
  code: string
  description?: string
}

export type SessionUser = {
  id: string
  username: string
  displayName?: string
  email?: string
  status: 'active' | 'disabled'
  roles: AuthUserRole[]
  createdAt: string
  updatedAt: string
  avatarUrl?: string | null
}

export type AuthSessionResponse = {
  token?: string
  user: SessionUser
  permissions: string[]
}
