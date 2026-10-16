import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureAssetBlobDownloader, configureAssetDownloadHostMirrors, fetchAssetBlob } from '@schema/assetCache'
import { ASSET_DOWNLOAD_HOST_MIRRORS } from '@schema/assetDownloadMirrors'

/**
 * 候选回退语义（CDN 镜像 → 源站）：
 * - 任一候选失败（网络错误 / HTTP 错误）都要继续尝试下一个候选；
 * - 仅显式取消（AbortError）立即中断，不再消耗剩余候选。
 */

const ORIGIN_URL = 'https://v.touchmagic.cn/uploads/slowroads/tree_01.49d91079.treebin'
const CDN_URL = 'https://cdn.v.touchmagic.cn/uploads/slowroads/tree_01.49d91079.treebin'

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): string[] {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    calls.push(url)
    return await handler(url, init)
  }))
  return calls
}

describe('asset download candidate fallback', () => {
  afterEach(() => {
    configureAssetDownloadHostMirrors(null)
    configureAssetBlobDownloader(null)
    vi.unstubAllGlobals()
  })

  it('falls back to the origin when the CDN candidate network-fails', async () => {
    configureAssetDownloadHostMirrors(ASSET_DOWNLOAD_HOST_MIRRORS)
    const calls = stubFetch((url) => {
      if (url === CDN_URL) {
        throw new TypeError('Failed to fetch')
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    })

    const payload = await fetchAssetBlob(ORIGIN_URL, new AbortController(), () => {})
    expect(payload.bytes?.byteLength).toBe(3)
    expect(calls).toEqual([CDN_URL, ORIGIN_URL])
  })

  it('falls back to the origin when the CDN candidate returns an HTTP error', async () => {
    configureAssetDownloadHostMirrors(ASSET_DOWNLOAD_HOST_MIRRORS)
    const calls = stubFetch((url) => {
      if (url === CDN_URL) {
        return new Response('forbidden', { status: 403 })
      }
      return new Response(new Uint8Array([4, 5]), { status: 200 })
    })

    const payload = await fetchAssetBlob(ORIGIN_URL, new AbortController(), () => {})
    expect(payload.bytes?.byteLength).toBe(2)
    expect(calls).toEqual([CDN_URL, ORIGIN_URL])
  })

  it('does not consume remaining candidates after an explicit abort', async () => {
    configureAssetDownloadHostMirrors(ASSET_DOWNLOAD_HOST_MIRRORS)
    const controller = new AbortController()
    const calls = stubFetch((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })

    const pending = fetchAssetBlob(ORIGIN_URL, controller, () => {})
    controller.abort()

    await expect(pending).rejects.toHaveProperty('name', 'AbortError')
    expect(calls).toEqual([CDN_URL])
  })

  it('downloads directly from the origin when no mirrors are configured', async () => {
    const calls = stubFetch(() => new Response(new Uint8Array([7]), { status: 200 }))

    const payload = await fetchAssetBlob(ORIGIN_URL, new AbortController(), () => {})
    expect(payload.bytes?.byteLength).toBe(1)
    expect(calls).toEqual([ORIGIN_URL])
  })
})
