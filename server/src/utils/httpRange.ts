import { createReadStream, type Stats } from 'node:fs'
import type { Context } from 'koa'

export type ByteRange = { start: number; end: number }

export function parseSingleByteRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header || !header.trim()) {
    return null
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match || (!match[1] && !match[2]) || size <= 0) {
    return 'invalid'
  }

  let start: number
  let end: number
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return 'invalid'
    }
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
      return 'invalid'
    }
    end = Math.min(end, size - 1)
  }
  return { start, end }
}

export function serveFileWithRange(
  ctx: Context,
  filePath: string,
  fileStat: Stats,
  options: { contentType?: string; cacheControl?: string; attachmentName?: string } = {},
): void {
  const size = fileStat.size
  ctx.set('Accept-Ranges', 'bytes')
  ctx.set('Cache-Control', options.cacheControl ?? 'no-store')
  ctx.type = options.contentType ?? 'application/octet-stream'
  if (options.attachmentName) {
    ctx.attachment(options.attachmentName)
  }

  if (ctx.method === 'HEAD') {
    ctx.status = 200
    ctx.length = size
    ctx.body = null
    return
  }

  const range = parseSingleByteRange(ctx.get('Range'), size)
  if (range === 'invalid') {
    ctx.status = 416
    ctx.set('Content-Range', `bytes */${size}`)
    ctx.length = 0
    ctx.body = null
    return
  }

  if (!range) {
    ctx.status = 200
    ctx.length = size
    ctx.body = createReadStream(filePath)
    return
  }

  ctx.status = 206
  ctx.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
  ctx.length = range.end - range.start + 1
  ctx.body = createReadStream(filePath, { start: range.start, end: range.end })
}