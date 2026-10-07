import assert from 'node:assert/strict'
import test from 'node:test'
import { createWechatWorkerFacade, terminateWechatSharedWorker } from './wechatSharedWorker.ts'

type FakeWxWorker = {
  onMessage(callback: (event: unknown) => void): void
  postMessage(message: unknown): void
  terminate(): void
}

/**
 * Spark runs two scope-less workers (sort + LOD) on top of one physical WeChat
 * worker. Both key their pending RPCs by id, so replies have to be routed back
 * to the facade that issued the request instead of to "whoever posted last".
 */
function installFakeWxWorker(): {
  posted: Array<Record<string, unknown>>
  deliver: (payload: unknown) => void
  restore: () => void
} {
  const posted: Array<Record<string, unknown>> = []
  let listener: ((event: unknown) => void) | null = null
  const scope = globalThis as { wx?: unknown }
  const previousWx = scope.wx
  scope.wx = {
    createWorker(_path: string): FakeWxWorker {
      return {
        onMessage(callback: (event: unknown) => void) {
          listener = callback
        },
        postMessage(message: unknown) {
          posted.push(message as Record<string, unknown>)
        },
        terminate() {},
      }
    },
  }
  return {
    posted,
    deliver(payload: unknown) {
      assert.ok(listener, 'the fake worker must have registered an onMessage listener')
      ;(listener as (event: unknown) => void)({ data: payload })
    },
    restore() {
      scope.wx = previousWx
      terminateWechatSharedWorker()
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object', 'expected an object payload')
  return value as Record<string, unknown>
}

test('scope-less worker replies reach the facade that issued the RPC', () => {
  const fake = installFakeWxWorker()
  try {
    const sortWorker = createWechatWorkerFacade('blob:sort')
    const lodWorker = createWechatWorkerFacade('blob:lod')
    const sortReplies: unknown[] = []
    const lodReplies: unknown[] = []
    sortWorker.onMessage((event: { data: unknown }) => sortReplies.push(event.data))
    lodWorker.onMessage((event: { data: unknown }) => lodReplies.push(event.data))

    lodWorker.postMessage({ id: 1, name: 'newLodTree', args: { capacity: 100 } })
    sortWorker.postMessage({ id: 2, name: 'sortSplats32', args: {} })

    assert.equal(fake.posted.length, 2)
    const lodRequest = asRecord(fake.posted[0])
    const sortRequest = asRecord(fake.posted[1])
    assert.notEqual(lodRequest.id, 1, 'ids must be namespaced so replies are routable')
    assert.notEqual(sortRequest.id, 2, 'ids must be namespaced so replies are routable')

    // Simulate the worker echoing both replies on the shared channel.
    fake.deliver({ id: lodRequest.id, result: 'lod-tree' })
    fake.deliver({ id: sortRequest.id, result: 'sorted' })

    assert.deepEqual(lodReplies, [{ id: 1, result: 'lod-tree' }])
    assert.deepEqual(sortReplies, [{ id: 2, result: 'sorted' }])
  } finally {
    fake.restore()
  }
})

test('DOM-style onmessage assignment receives scope-less worker replies', () => {
  const fake = installFakeWxWorker()
  try {
    // Spark's SplatWorker subscribes with `worker.onmessage = handler`.
    const sortWorker = createWechatWorkerFacade('blob:sort-onmessage')
    const lodWorker = createWechatWorkerFacade('blob:lod-onmessage')
    const sortReplies: unknown[] = []
    const lodReplies: unknown[] = []
    sortWorker.onmessage = (event) => sortReplies.push(event.data)
    lodWorker.onmessage = (event) => lodReplies.push(event.data)

    lodWorker.postMessage({ id: 1, name: 'newLodTree', args: { capacity: 100 } })
    sortWorker.postMessage({ id: 2, name: 'sortSplats32', args: {} })
    const lodRequest = asRecord(fake.posted[0])
    const sortRequest = asRecord(fake.posted[1])

    fake.deliver({ id: lodRequest.id, result: 'lod-tree' })
    fake.deliver({ id: sortRequest.id, result: 'sorted' })

    assert.deepEqual(lodReplies, [{ id: 1, result: 'lod-tree' }])
    assert.deepEqual(sortReplies, [{ id: 2, result: 'sorted' }])

    // Replacing the handler must not keep the previous one subscribed.
    const replacement: unknown[] = []
    sortWorker.onmessage = (event) => replacement.push(event.data)
    fake.deliver({ status: { loaded: 1, total: 1 } })
    assert.equal(sortReplies.length, 1)
    assert.deepEqual(replacement, [{ status: { loaded: 1, total: 1 } }])
  } finally {
    fake.restore()
  }
})

test('progress messages do not consume the id routing for the terminal reply', () => {
  const fake = installFakeWxWorker()
  try {
    // Spark's loadPackedSplats emits {id,status} progress first and then the
    // {id,result} reply; both carry the same namespaced id.
    const worker = createWechatWorkerFacade('blob:status-then-result')
    const received: Array<Record<string, unknown>> = []
    worker.onmessage = (event) => received.push(event.data as Record<string, unknown>)

    worker.postMessage({ id: 8, name: 'loadPackedSplats', args: { fileBytes: new Uint8Array(4) } })
    const request = asRecord(fake.posted[0])

    fake.deliver({ id: request.id, status: { loaded: 4, total: 4 } })
    fake.deliver({ id: request.id, result: { lodSplats: { numSplats: 1 } } })

    assert.deepEqual(received, [
      { id: 8, status: { loaded: 4, total: 4 } },
      { id: 8, result: { lodSplats: { numSplats: 1 } } },
    ])
  } finally {
    fake.restore()
  }
})
