import assert from 'node:assert/strict'
import test from 'node:test'
import { parseByteRangeHeader, validateRadRangeResponse } from './radRangeResponse.ts'

type FakeResponse = {
  status: number
  headers: { get(name: string): string | null }
}

function createResponse(
  status: number,
  headers: Record<string, string | null>,
): FakeResponse {
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  )
  return {
    status,
    headers: {
      get(name: string) {
        return normalized.get(name.toLowerCase()) ?? null
      },
    },
  }
}

test('parses single closed byte ranges and rejects anything else', () => {
  assert.deepEqual(parseByteRangeHeader('bytes=0-65535'), { start: 0, end: 65535 })
  assert.deepEqual(parseByteRangeHeader(' Bytes= 2-5 '), { start: 2, end: 5 })
  assert.equal(parseByteRangeHeader('bytes=0-0,2-3'), null)
  assert.equal(parseByteRangeHeader('bytes=7-'), null)
  assert.equal(parseByteRangeHeader('bytes=-500'), null)
  assert.equal(parseByteRangeHeader('bytes=5-4'), null)
  assert.equal(parseByteRangeHeader(undefined), null)
})

test('accepts an exact 206 answer and ignores non-range requests', () => {
  const response = createResponse(206, {
    'Content-Range': 'bytes 0-65535/131752776',
    'Content-Length': '65536',
  })
  assert.doesNotThrow(() => validateRadRangeResponse('bytes=0-65535', response))
  assert.doesNotThrow(() => validateRadRangeResponse(null, createResponse(200, {})))
  assert.doesNotThrow(() => validateRadRangeResponse('bytes=abc', createResponse(200, {})))
})

test('accepts a range that legitimately stops at the end of the file', () => {
  const response = createResponse(206, {
    'Content-Range': 'bytes 131752000-131752775/131752776',
    'Content-Length': '776',
  })
  assert.doesNotThrow(() => validateRadRangeResponse('bytes=131752000-131756000', response))
})

test('rejects short reads, misaligned ranges and wrong status codes', () => {
  const shortRead = createResponse(206, {
    'Content-Range': 'bytes 0-32767/131752776',
    'Content-Length': '32768',
  })
  assert.throws(
    () => validateRadRangeResponse('bytes=0-65535', shortRead),
    /Invalid RAD byte-range response \(206, bytes=0-65535, bytes 0-32767\/131752776\)/,
  )

  const midFileShortRead = createResponse(206, {
    'Content-Range': 'bytes 1310720-1310720/131752776',
    'Content-Length': '1',
  })
  assert.throws(() => validateRadRangeResponse('bytes=1310720-1376255', midFileShortRead))

  const wrongStart = createResponse(206, {
    'Content-Range': 'bytes 100-200/131752776',
    'Content-Length': '101',
  })
  assert.throws(() => validateRadRangeResponse('bytes=0-100', wrongStart))

  const overRead = createResponse(206, {
    'Content-Range': 'bytes 0-70000/131752776',
    'Content-Length': '70001',
  })
  assert.throws(() => validateRadRangeResponse('bytes=0-65535', overRead))

  const ignoredRange = createResponse(200, { 'Content-Length': '131752776' })
  assert.throws(() => validateRadRangeResponse('bytes=0-65535', ignoredRange))

  const missingContentRange = createResponse(206, { 'Content-Length': '1' })
  assert.throws(() => validateRadRangeResponse('bytes=0-0', missingContentRange))

  const mismatchedLength = createResponse(206, {
    'Content-Range': 'bytes 0-65535/131752776',
    'Content-Length': '65535',
  })
  assert.throws(() => validateRadRangeResponse('bytes=0-65535', mismatchedLength))
})
