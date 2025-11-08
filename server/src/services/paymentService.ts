import { randomUUID } from 'node:crypto'

interface ProcessPaymentOptions {
  userId: string
  productId: string
  productName: string
  amount: number
  method?: string
  metadata?: Record<string, unknown>
}

export type PaymentStatus = 'success' | 'failed' | 'pending'

export interface PaymentResult {
  status: PaymentStatus
  provider: string
  transactionId?: string
  message?: string
  raw?: Record<string, unknown>
}

/**
 * Placeholder payment processor. Returns a successful result while leaving
 * integration hooks for third-party payment gateways.
 */
export async function processProductPayment(options: ProcessPaymentOptions): Promise<PaymentResult> {
  const { method = 'mock', amount, userId, productId, productName } = options

  // TODO: integrate with real payment gateway. Keep async signature for future IO work.
  await Promise.resolve()

  return {
    status: 'success',
    provider: method,
    transactionId: `MOCK-${randomUUID()}`,
    raw: {
      userId,
      productId,
      productName,
      amount,
      processedAt: new Date().toISOString(),
    },
  }
}
