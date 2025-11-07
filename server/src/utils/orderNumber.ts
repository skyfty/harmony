import { customAlphabet } from 'nanoid'

const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789', 8)

export function generateOrderNumber(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const datePart = `${year}${month}${day}`
  return `ORD-${datePart}-${nanoid()}`
}
