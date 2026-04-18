import type Koa from 'koa'

declare module 'koa' {
  interface DefaultState {
    user?: {
      id: string
      username: string
      roles: string[]
      permissions: string[]
      accountType?: 'admin' | 'super' | 'user'
      editorSessionId?: string | null
    }
    adminAuthUser?: {
      id: string
      username: string
      roles: string[]
      permissions: string[]
    }
    miniAuthUser?: {
      id: string
      miniAppId?: string
      username?: string
      wxOpenId?: string
    }
  }
}
