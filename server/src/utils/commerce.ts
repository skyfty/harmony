export function isZeroAmount(value: unknown): boolean {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') {
    return false
  }
  const amount = Number(value)
  return Number.isFinite(amount) && amount === 0
}

export function isFreeProductPrice(price: unknown): boolean {
  return isZeroAmount(price)
}

export function isFreeOrderRecord(order: {
  totalAmount?: unknown
  paymentProvider?: unknown
}): boolean {
  return isZeroAmount(order.totalAmount) || order.paymentProvider === 'free'
}
