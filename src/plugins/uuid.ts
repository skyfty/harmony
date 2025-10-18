function formatFromBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

function tryNativeRandomUuid(): string | null {
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto
  if (!cryptoRef) {
    return null
  }

  if (typeof cryptoRef.randomUUID === 'function') {
    try {
      return cryptoRef.randomUUID()
    } catch (error) {
      console.warn('crypto.randomUUID failed, falling back to manual UUID generation', error)
    }
  }

  if (typeof cryptoRef.getRandomValues === 'function') {
    const randomBytes = new Uint8Array(16)
    cryptoRef.getRandomValues(randomBytes)
  randomBytes[6] = ((randomBytes[6] ?? 0) & 0x0f) | 0x40
  randomBytes[8] = ((randomBytes[8] ?? 0) & 0x3f) | 0x80
    return formatFromBytes(randomBytes)
  }

  return null
}

function fallbackRandomUuid(): string {
  let timestamp = Date.now()
  let perfCounter = typeof performance === 'object' && typeof performance.now === 'function'
    ? Math.floor(performance.now())
    : 0

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16
    let value = (timestamp + random + perfCounter) % 16 | 0
    timestamp = Math.floor(timestamp / 16)
    perfCounter = Math.floor(perfCounter / 16)
    if (char === 'x') {
      return value.toString(16)
    }
    value = (value & 0x3) | 0x8
    return value.toString(16)
  })
}

export function generateUuid(): string {
  return tryNativeRandomUuid() ?? fallbackRandomUuid()
}
