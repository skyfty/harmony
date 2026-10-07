import assert from 'node:assert/strict'
import test from 'node:test'
import { attachResponseBodyStream } from './responseBodyShim.ts'

/**
 * Stand-in for `@minisheep/mini-program-polyfill-core`'s `Response`: same body
 * bookkeeping as the real polyfill (`_bodyInit`, `_noBody`, `bodyUsed` flag,
 * `arrayBuffer()`), but, like the real one, no `body` property.
 */
class PolyfillLikeResponse {
  bodyUsed = false
  _noBody = false
  _bodyInit: unknown = undefined
  private readonly bytes: Uint8Array

  constructor(bytes?: Uint8Array) {
    this.bytes = bytes ?? new Uint8Array(0)
    if (bytes && bytes.byteLength > 0) {
      this._bodyInit = bytes
    } else {
      this._noBody = true
    }
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this.bodyUsed) {
      throw new TypeError('Already read')
    }
    this.bodyUsed = true
    return this.bytes.buffer.slice(
      this.bytes.byteOffset,
      this.bytes.byteOffset + this.bytes.byteLength,
    ) as ArrayBuffer
  }
}

test('publishes a body stream without consuming the buffered response', async () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5])
  const response = attachResponseBodyStream(new PolyfillLikeResponse(payload))

  // Spark's range fetch only needs `body` to be truthy, then reads arrayBuffer.
  assert.ok((response as { body?: unknown }).body, 'buffered response exposes a body')
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.deepEqual(Array.from(bytes), [1, 2, 3, 4, 5])
})

test('streams the buffered bytes once for getReader consumers', async () => {
  const payload = new Uint8Array([9, 8, 7])
  const response = attachResponseBodyStream(new PolyfillLikeResponse(payload))
  const body = (response as { body: ReadableStream<Uint8Array> }).body

  assert.equal(response, response, 'the response instance is returned as-is')
  assert.equal(body, (response as { body: unknown }).body, 'body is stable per response')

  const reader = body.getReader()
  const first = await reader.read()
  assert.equal(first.done, false)
  assert.deepEqual(Array.from(first.value ?? []), [9, 8, 7])
  const second = await reader.read()
  assert.equal(second.done, true)
  reader.releaseLock()
})

test('leaves empty responses and compliant responses untouched', () => {
  const empty = attachResponseBodyStream(new PolyfillLikeResponse())
  assert.equal((empty as { body?: unknown }).body, undefined)

  const native = {
    body: new ReadableStream<Uint8Array>(),
    async arrayBuffer() {
      return new ArrayBuffer(0)
    },
  }
  assert.equal(attachResponseBodyStream(native), native)
  assert.equal(native.body instanceof ReadableStream, true)
})

test('is a no-op for objects without an arrayBuffer reader', () => {
  const plain = { status: 206 }
  assert.equal(attachResponseBodyStream(plain), plain)
  assert.equal('body' in plain, false)
})
