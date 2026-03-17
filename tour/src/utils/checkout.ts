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

export function isProfileCompletionRequiredError(error: unknown): boolean {
  return error instanceof Error && /完善头像和昵称|完善个人资料/.test(error.message)
}

export async function promptBindPhoneBeforeCheckout(): Promise<void> {
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '请先绑定手机号',
      content: '购买和支付前需要先绑定手机号，是否现在前往个人中心绑定？',
      confirmText: '去绑定',
      cancelText: '取消',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })

  if (confirmed) {
    uni.switchTab({ url: '/pages/profile/index' })
  }
}

export async function requestMiniProgramPayment(payParams: MiniPayParams): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    uni.requestPayment({
      ...payParams,
      success: () => resolve(),
      fail: (error) => reject(error),
    })
  })
}

export async function promptCompleteProfileBeforeCheckout(): Promise<void> {
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '请先完善资料',
      content: '购买和支付前需要先完善头像和昵称，是否现在前往编辑？',
      confirmText: '去完善',
      cancelText: '取消',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })

  if (confirmed) {
    uni.navigateTo({ url: '/pages/profile/edit' })
  }
}