/**
 * Validation for the HTTP byte-range responses Spark relies on when it streams
 * a RAD splat file.
 *
 * Spark's pager issues `Range: bytes=<start>-<end>` requests and assumes every
 * answer is an exact 206 for that range. The mini-program fetch polyfill and
 * the CDN in front of the origin both have failure modes that produce a
 * plausible-looking answer instead of an error:
 *
 * - a short/truncated read returns fewer bytes with a valid-looking
 *   `Content-Range`,
 * - a proxy that ignores `Range` returns `200` with the whole file,
 * - a proxy that mislabels the range returns a `Content-Range` starting
 *   somewhere else.
 *
 * Any of those would otherwise be handed to Spark, which either mis-decodes
 * the chunk or throws a misleading `Failed to fetch "<url>": 206 Partial
 * Content`. Validating here keeps the failure honest and cheap.
 *
 * This module is intentionally dependency-free so it can be unit tested
 * without a WeChat runtime, Three.js or Spark.
 */

export type RangeResponseLike = {
  status: number
  headers: {
    get(name: string): string | null
  }
}

export type ParsedByteRange = {
  start: number
  end: number
}

/** Parse a single closed byte range such as `bytes=0-65535`. */
export function parseByteRangeHeader(rangeHeader: string | null | undefined): ParsedByteRange | null {
  const match = /^bytes\s*=\s*(\d+)-(\d+)$/i.exec((rangeHeader ?? '').trim())
  if (!match) {
    return null
  }
  const start = Number(match[1])
  const end = Number(match[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) {
    return null
  }
  return { start, end }
}

/**
 * Throw unless `response` satisfies the byte range requested by `rangeHeader`.
 *
 * Requests that are not a single closed range are ignored: Spark only ever
 * issues those, and other callers share the same fetch wrapper.
 */
export function validateRadRangeResponse(
  rangeHeader: string | null | undefined,
  response: RangeResponseLike,
): void {
  const requested = parseByteRangeHeader(rangeHeader)
  if (!requested) {
    return
  }

  const contentRangeHeader = response.headers.get('Content-Range')
  const contentRange = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec((contentRangeHeader ?? '').trim())
  const total = contentRange ? Number(contentRange[3]) : Number.NaN
  const actualStart = contentRange ? Number(contentRange[1]) : Number.NaN
  const actualEnd = contentRange ? Number(contentRange[2]) : Number.NaN
  const actualLength = Number.isSafeInteger(actualStart) && Number.isSafeInteger(actualEnd) && actualEnd >= actualStart
    ? actualEnd - actualStart + 1
    : -1
  // A range that runs past the end of the file legitimately stops at the last
  // byte; anything shorter than that means the read was cut short.
  const expectedEnd = Number.isSafeInteger(total) && total > 0
    ? Math.min(requested.end, total - 1)
    : requested.end
  const declaredLength = Number(response.headers.get('Content-Length'))
  const declaresLength = Number.isFinite(declaredLength) && declaredLength > 0

  const valid = response.status === 206
    && Boolean(contentRange)
    && actualStart === requested.start
    && actualEnd === expectedEnd
    && actualLength > 0
    && (!declaresLength || declaredLength === actualLength)

  if (!valid) {
    throw new Error(
      `Invalid RAD byte-range response (${response.status}, ${rangeHeader ?? 'no Range'}, ${contentRangeHeader ?? 'no Content-Range'})`,
    )
  }
}
