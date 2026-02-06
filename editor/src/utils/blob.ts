export async function computeBlobHash(blob: Blob, algorithm: 'SHA-256' = 'SHA-256'): Promise<string> {
  const buffer = await blob.arrayBuffer()

  // Prefer SubtleCrypto (browser or Node's global `crypto.webcrypto.subtle`).
  const subtle = (globalThis as any).crypto?.subtle || (globalThis as any).crypto?.webkitSubtle || (globalThis as any).crypto?.webcrypto?.subtle || null
  if (subtle) {
    const hashBuffer = await subtle.digest(algorithm, buffer)
    const hashBytes = Array.from(new Uint8Array(hashBuffer))
    const hex = hashBytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return `sha256-${hex}`
  }

  // If running under Node.js, try to use Node's crypto module.
  const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node)
  if (isNode) {
    try {
      // Dynamic import keeps bundlers happy for browser builds.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodeCrypto = await import('crypto')

      // Prefer the Web Crypto API exposed by Node (`crypto.webcrypto.subtle`) when available.
      const nodeSubtle = (nodeCrypto as any).webcrypto?.subtle
      if (nodeSubtle) {
        const hashBuffer = await nodeSubtle.digest(algorithm, buffer)
        const hashBytes = Array.from(new Uint8Array(hashBuffer))
        const hex = hashBytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
        return `sha256-${hex}`
      }

      // Fall back to Node's synchronous `createHash` implementation.
      const hash = nodeCrypto.createHash('sha256')
      hash.update(Buffer.from(buffer))
      const hex = hash.digest('hex')
      return `sha256-${hex}`
    } catch (err) {
      // If import failed, continue to final error.
    }
  }

  // No available hashing implementation in this environment.
  throw new Error('SubtleCrypto is not available in this environment and no Node.js fallback was found')
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+)?;base64,(.*)$/i.exec(dataUrl.trim())
  if (!match) {
    throw new Error('Invalid data URL')
  }
  const mimeType = match[1] && match[1].length ? match[1] : 'application/octet-stream'
  const base64 = match[2] ?? ''
  if (typeof globalThis.atob !== 'function') {
    throw new Error('Base64 decoding is not supported in this environment')
  }
  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mimeType })
}

export function inferBlobFilename(nameCandidates: Array<string | null | undefined>, fallback: string): string {
  for (const candidate of nameCandidates) {
    if (!candidate) {
      continue
    }
    const trimmed = candidate.trim()
    if (trimmed.length) {
      return trimmed
    }
  }
  return fallback
}

export function stripExtension(value: string): string {
  const match = value.trim().match(/^(.*?)(?:\.[^./\\]+)?$/)
  if (!match) {
    return value
  }
  const core = match[1] ?? value
  return core.length ? core : value
}

export function ensureExtension(name: string, extension: string | null): string {
  if (!extension || !extension.trim().length) {
    return name
  }
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`
  if (name.toLowerCase().endsWith(normalizedExtension.toLowerCase())) {
    return name
  }
  return `${name}${normalizedExtension}`
}

export function extractExtension(name: string | null | undefined): string | null {
  if (!name) {
    return null
  }
  const match = /\.([a-z0-9]+)$/i.exec(name.trim())
  return match ? match[1]!.toLowerCase() : null
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read blob as data URL'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Unexpected reader result type'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(blob)
  })
}
