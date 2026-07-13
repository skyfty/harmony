import type { Context } from 'koa'
import type { MiniPlatformKind } from '@/types/models'

const PLATFORM_HEADER = 'x-mini-platform'
const APP_KEY_HEADER = 'x-mini-app-key'

function normalize(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mapPlatform(value: string): MiniPlatformKind | null {
  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  if (normalized === 'wechat' || normalized === 'mp-weixin') {
    return 'wechat'
  }
  if (normalized === 'douyin' || normalized === 'toutiao' || normalized === 'mp-toutiao') {
    return 'douyin'
  }
  if (normalized === 'xiaohongshu' || normalized === 'xhs' || normalized === 'mp-xhs') {
    return 'xiaohongshu'
  }
  return null
}

export type ResolveMiniPlatformInput = {
  appKey?: string
  platform?: string
}

export type ResolvedMiniPlatformContext = {
  appKey?: string
  platform: MiniPlatformKind
}

export function resolveMiniPlatform(input: ResolveMiniPlatformInput): ResolvedMiniPlatformContext {
  const platform = mapPlatform(normalize(input.platform)) ?? 'wechat'
  const appKey = normalize(input.appKey) || undefined
  return { appKey, platform }
}

export function resolveMiniPlatformFromContext(ctx: Context): ResolvedMiniPlatformContext {
  const query = ctx.query as Record<string, unknown>
  const body = ((ctx.request.body ?? {}) as Record<string, unknown>)
  const headerPlatform = typeof ctx.get === 'function' ? ctx.get(PLATFORM_HEADER) : ''
  const headerAppKey = typeof ctx.get === 'function' ? ctx.get(APP_KEY_HEADER) : ''

  return resolveMiniPlatform({
    platform: normalize(body.platform) || normalize(query.platform) || headerPlatform,
    appKey: normalize(body.appKey) || normalize(query.appKey) || headerAppKey || normalize(ctx.state.miniAuthUser?.appKey),
  })
}
