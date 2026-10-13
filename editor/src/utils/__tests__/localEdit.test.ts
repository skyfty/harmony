import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLocalEditEnabled, setLocalEditEnabled } from '../localEdit'

class MemoryStorage {
  private readonly entries = new Map<string, string>()

  get length(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.entries.delete(key)
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value)
  }
}

function stubWindowWithStorage(storage: MemoryStorage): void {
  vi.stubGlobal('window', { localStorage: storage as unknown as Storage })
}

describe('local edit mode', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to enabled when no flag has been stored', () => {
    stubWindowWithStorage(new MemoryStorage())
    expect(isLocalEditEnabled()).toBe(true)
  })

  it('stays enabled when the flag is explicitly enabled', () => {
    const storage = new MemoryStorage()
    storage.setItem('localedit', '1')
    stubWindowWithStorage(storage)
    expect(isLocalEditEnabled()).toBe(true)
  })

  it('can be explicitly disabled for hosted login-required deployments', () => {
    const storage = new MemoryStorage()
    stubWindowWithStorage(storage)
    setLocalEditEnabled(false)
    expect(storage.getItem('localedit')).toBe('0')
    expect(isLocalEditEnabled()).toBe(false)
  })

  it('can be re-enabled explicitly', () => {
    const storage = new MemoryStorage()
    storage.setItem('localedit', '0')
    stubWindowWithStorage(storage)
    setLocalEditEnabled(true)
    expect(storage.getItem('localedit')).toBe('1')
    expect(isLocalEditEnabled()).toBe(true)
  })

  it('falls back to enabled when storage access is unavailable', () => {
    const blockedWindow = {}
    Object.defineProperty(blockedWindow, 'localStorage', {
      get() {
        throw new Error('storage blocked')
      },
    })
    vi.stubGlobal('window', blockedWindow)
    expect(isLocalEditEnabled()).toBe(true)
  })
})
