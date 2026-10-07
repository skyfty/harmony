/**
 * Give an individual `Response` the `body` stream Spark expects.
 *
 * Spark's RAD pager rejects every byte-range answer with
 * `Failed to fetch "<url>": 206 Partial Content` when `response.body` is
 * missing, even though the status and the `Content-Range` are correct. The
 * WeChat fetch polyfill (`@minisheep/mini-program-polyfill-core`) implements
 * `bodyUsed`, `headers`, `ok`, `status`, `statusText`, `type`, `url` and the
 * body readers, but no `body` property at all.
 *
 * The shim is deliberately applied per response instead of to
 * `Response.prototype`: the polyfill's `Response` constructor cannot read a
 * stream body — `new Response(stream)` falls through to
 * `_bodyText = '[object ReadableStream]'` — so a global `body` getter would
 * push every other fetch consumer (for example three's `FileLoader`, which
 * rebuilds `new Response(response.body.getReader())`) down that broken path.
 *
 * The stream is created lazily and never consumes the body by itself, so the
 * `await response.arrayBuffer()` that Spark runs right after checking
 * `response.body` keeps working.
 *
 * This module is dependency-free so it can be unit tested without a WeChat
 * runtime, Three.js or Spark.
 */

type BufferedResponseLike = {
  body?: unknown
  _noBody?: boolean
  _bodyInit?: unknown
  arrayBuffer?: () => Promise<ArrayBuffer>
}

type StreamControllerLike = {
  enqueue(chunk: unknown): void
  close(): void
  error(reason?: unknown): void
}

type StreamSourceLike = {
  pull?(controller: StreamControllerLike): void | Promise<void>
}

type ReadableStreamConstructorLike = new (source: StreamSourceLike) => unknown

const BODY_STREAM_KEY = '__harmonyResponseBodyStream'

/**
 * Attach a lazily read `body` stream to `response` when the runtime omitted it.
 * Responses that already expose a body, that have no readable body, or that
 * come from a runtime without a `ReadableStream` implementation are returned
 * unchanged.
 */
export function attachResponseBodyStream<T extends object>(response: T): T {
  const target = response as unknown as BufferedResponseLike & Record<string, unknown>
  if (target.body) {
    return response
  }
  if (typeof target.arrayBuffer !== 'function') {
    return response
  }
  // Polyfill responses flag an intentionally empty body; keep `body === null`
  // there so a genuinely empty answer still fails loudly instead of streaming
  // zero bytes into the decoder.
  const usesPolyfillBodyFields = '_noBody' in target || '_bodyInit' in target
  if (usesPolyfillBodyFields && (target._noBody === true || target._bodyInit === undefined || target._bodyInit === null)) {
    return response
  }

  const ReadableStreamConstructor = (globalThis as { ReadableStream?: unknown }).ReadableStream
  if (typeof ReadableStreamConstructor !== 'function') {
    return response
  }

  try {
    Object.defineProperty(target, 'body', {
      configurable: true,
      enumerable: false,
      get(this: BufferedResponseLike & Record<string, unknown>) {
        const cached = this[BODY_STREAM_KEY]
        if (cached) {
          return cached
        }
        const stream = createBodyStream(ReadableStreamConstructor as ReadableStreamConstructorLike, this)
        try {
          Object.defineProperty(this, BODY_STREAM_KEY, {
            value: stream,
            enumerable: false,
            configurable: true,
            writable: true,
          })
        } catch {
          // A frozen response instance cannot cache the stream; callers still
          // receive an equivalent stream per access.
        }
        return stream
      },
    })
  } catch {
    return response
  }
  return response
}

/**
 * The polyfill buffers the whole body before `fetch` resolves, so there is
 * nothing to stream incrementally: publish it as a single chunk and close.
 */
function createBodyStream(
  ReadableStreamConstructor: ReadableStreamConstructorLike,
  response: BufferedResponseLike,
): unknown {
  let started = false
  return new ReadableStreamConstructor({
    async pull(controller: StreamControllerLike) {
      if (started) {
        return
      }
      started = true
      try {
        const buffer = await response.arrayBuffer!()
        const bytes = new Uint8Array(buffer)
        if (bytes.byteLength > 0) {
          controller.enqueue(bytes)
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}
