import type { MiniPaymentAction } from '@mini-platform/core'
import { getMiniPlatformAdapter } from '@/platform/adapter'
import { ensureMiniCapability } from '@/platform/runtime'

export interface MiniPayParams {
  appId: string
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'RSA'
  paySign: string
}

export type MiniPayRequest = MiniPaymentAction | MiniPayParams

export function toCheckoutErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

export function isPhoneBindingRequiredError(error: unknown): boolean {
  return error instanceof Error && /绑定手机号/.test(error.message)
}

export async function requestMiniProgramPayment(payParams: MiniPayRequest): Promise<void> {
  if (!await ensureMiniCapability('payment')) {
    throw new Error('当前平台暂未开放支付功能')
  }
  await getMiniPlatformAdapter().requestPayment(payParams as MiniPaymentAction | Record<string, unknown>)
}
