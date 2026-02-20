import type Koa from 'koa'

declare module 'koa' {
  interface DefaultState {
    user?: {
      id: string
      username: string
      roles: string[]
      permissions: string[]
      accountType?: 'admin' | 'super' | 'user'
    }
    adminAuthUser?: {
      id: string
      username: string
      roles: string[]
      permissions: string[]
    }
    miniAuthUser?: {
      id: string
      username?: string
      wxOpenId?: string
    }
  }
}
