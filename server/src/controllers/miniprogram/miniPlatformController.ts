import type { Context } from 'koa'
import { buildMiniRuntimeConfig } from '@/services/miniPlatformRuntimeConfigService'
import { miniBindPhone, miniLoginWithOpenId } from '@/services/miniAuthService'
import { ensureMiniCheckoutUser } from '@/controllers/miniprogram/utils'
import {
  getMiniPlatformAuthProvider,
  getMiniPlatformPaymentProvider,
  getMiniPlatformPrivacyProvider,
} from '@/services/miniPlatformProviders'
import { resolveMiniPlatformFromContext } from '@/services/platformResolver'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function getMiniRuntimeConfigHandler(ctx: Context): Promise<void> {
  const resolved = resolveMiniPlatformFromContext(ctx)
  const response = await buildMiniRuntimeConfig(resolved.appKey, resolved.platform)
  ctx.body = response
}

export async function createMiniPlatformLoginHandler(ctx: Context): Promise<void> {
  const resolved = resolveMiniPlatformFromContext(ctx)
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  const code = normalizeString(body.code)
  if (!code) {
    ctx.throw(400, 'code is required')
  }

  const provider = getMiniPlatformAuthProvider(resolved.platform)
  const identity = await provider.exchangeCode({ appKey: resolved.appKey, code })
  const session = await miniLoginWithOpenId({
    appKey: identity.appKey ?? resolved.appKey ?? '',
    platform: resolved.platform,
    miniAppId: identity.miniAppId ?? '',
    openId: identity.openId,
    unionId: identity.unionId,
    displayName: normalizeString(body.displayName) || undefined,
    avatarUrl: normalizeString(body.avatarUrl) || undefined,
  })

  ctx.body = {
    ...session,
    appKey: identity.appKey ?? resolved.appKey,
    platform: resolved.platform,
  }
}

export async function bindMiniPlatformPhoneHandler(ctx: Context): Promise<void> {
  const resolved = resolveMiniPlatformFromContext(ctx)
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  const code = normalizeString(body.code)
  if (!code) {
    ctx.throw(400, 'code is required')
  }
  const provider = getMiniPlatformAuthProvider(resolved.platform)
  if (!provider.exchangePhoneCode) {
    ctx.throw(409, `Phone binding is not available for ${resolved.platform}`)
  }
  const phone = await provider.exchangePhoneCode({ appKey: resolved.appKey, code })
  const session = await miniBindPhone({
    userId: ctx.state.miniAuthUser?.id ?? '',
    phoneNumber: phone.phoneNumber,
    purePhoneNumber: phone.purePhoneNumber,
    countryCode: phone.countryCode,
    appKey: resolved.appKey,
    platform: resolved.platform,
  })
  ctx.body = {
    ...session,
    appKey: resolved.appKey,
    platform: resolved.platform,
  }
}

export async function createMiniPlatformPaymentHandler(ctx: Context): Promise<void> {
  const resolved = resolveMiniPlatformFromContext(ctx)
  const body = (ctx.request.body ?? {}) as Record<string, unknown>
  const checkoutUser = await ensureMiniCheckoutUser(ctx)
  const provider = getMiniPlatformPaymentProvider(resolved.platform)
  const result = await provider.createPayment({
    appKey: resolved.appKey,
    orderNumber: normalizeString(body.orderNumber),
    description: normalizeString(body.description),
    amount: Number(body.amount ?? 0),
    openId: checkoutUser.wxOpenId,
    attach: normalizeString(body.attach) || undefined,
  })
  ctx.body = {
    appKey: resolved.appKey,
    platform: resolved.platform,
    ...result,
  }
}

export async function acceptMiniPlatformPrivacyConsentHandler(ctx: Context): Promise<void> {
  const resolved = resolveMiniPlatformFromContext(ctx)
  const provider = getMiniPlatformPrivacyProvider(resolved.platform)
  ctx.body = await provider.acceptConsent({
    appKey: resolved.appKey,
    userId: ctx.state.miniAuthUser?.id,
    payload: (ctx.request.body ?? {}) as Record<string, unknown>,
  })
}
