export interface MiniPayParams {
  appId: string
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'RSA'
  paySign: string
}

export function toCheckoutErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}

export function isPhoneBindingRequiredError(error: unknown): boolean {
  return error instanceof Error && /绑定手机号/.test(error.message)
}

export async function requestMiniProgramPayment(payParams: MiniPayParams): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    uni.requestPayment({
      provider: 'wxpay',
      ...payParams,
      success: () => resolve(),
      fail: (error) => reject(error),
    })
  })
}
