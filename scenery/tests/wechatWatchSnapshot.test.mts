import assert from 'node:assert/strict'
import test from 'node:test'
import { inflateSync } from 'node:zlib'

import {
  WECHAT_WATCH_SNAPSHOT_MAX_EDGE,
  buildWechatWatchSnapshotFilePath,
  buildWechatWatchSnapshotEntrancePath,
  captureWechatWatchSnapshotPixels,
  copyFlippedResampledRgba,
  encodeWechatWatchSnapshotPng,
  hasVisibleWatchSnapshotPixels,
  prepareWechatWatchSnapshotImage,
  promptWechatWatchSnapshotShare,
  removeWechatWatchSnapshotFile,
  resolveWechatWatchSnapshotRuntime,
  resolveWechatWatchSnapshotOutputSize,
  writeWechatWatchSnapshotPngFile,
  type WatchSnapshotRenderer,
  type WechatWatchSnapshotShareRuntime,
} from '../common/utils/wechatWatchSnapshot.ts'

function createPixels(rows: Array<Array<[number, number, number, number]>>): Uint8Array {
  return new Uint8Array(rows.flatMap((row) => row.flat()))
}

test('snapshot dimensions preserve aspect ratio without upscaling past the source', () => {
  assert.deepEqual(resolveWechatWatchSnapshotOutputSize(390, 844), {
    width: 390,
    height: 844,
  })
  assert.deepEqual(resolveWechatWatchSnapshotOutputSize(600, 1500), {
    width: 546,
    height: WECHAT_WATCH_SNAPSHOT_MAX_EDGE,
  })
  assert.deepEqual(resolveWechatWatchSnapshotOutputSize(2400, 1080), {
    width: WECHAT_WATCH_SNAPSHOT_MAX_EDGE,
    height: 614,
  })
  assert.throws(() => resolveWechatWatchSnapshotOutputSize(0, 844), /尺寸无效/)
})

test('copied RGBA rows are vertically flipped before use by Canvas 2D', () => {
  const source = createPixels([
    [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ],
    [
      [0, 0, 255, 255],
      [255, 255, 255, 255],
    ],
  ])
  const flipped = copyFlippedResampledRgba(source, 2, 2, 2, 2)

  assert.deepEqual(Array.from(flipped), [
    0, 0, 255, 255,
    255, 255, 255, 255,
    255, 0, 0, 255,
    0, 255, 0, 255,
  ])
})

test('snapshot pixels must contain visible alpha before an image is encoded', () => {
  assert.equal(hasVisibleWatchSnapshotPixels(new Uint8Array([
    0, 0, 0, 0,
    0, 0, 0, 0,
  ])), false)
  assert.equal(hasVisibleWatchSnapshotPixels(new Uint8Array([
    0, 0, 0, 0,
    12, 24, 36, 255,
  ])), true)
})

test('captures the default framebuffer immediately and always restores the prior target', () => {
  const events: string[] = []
  const previousTarget = { id: 'previous' }
  const sourcePixels = createPixels([
    [
      [1, 2, 3, 255],
      [4, 5, 6, 255],
    ],
    [
      [7, 8, 9, 255],
      [10, 11, 12, 255],
    ],
  ])
  const renderer = {
    getRenderTarget: () => previousTarget,
    setRenderTarget: (target: unknown) => {
      events.push(target === null ? 'target:null' : 'target:previous')
    },
    render: () => {
      events.push('render')
    },
    getContext: () => ({
      drawingBufferWidth: 2,
      drawingBufferHeight: 2,
      readPixels: (
        _x: number,
        _y: number,
        _width: number,
        _height: number,
        _format: number,
        _type: number,
        pixels: Uint8Array,
      ) => {
        events.push('readPixels')
        pixels.set(sourcePixels)
      },
    }),
  } as unknown as WatchSnapshotRenderer

  const frame = captureWechatWatchSnapshotPixels(renderer, {} as never, {} as never)

  assert.deepEqual(events, ['target:null', 'render', 'readPixels', 'target:previous'])
  assert.deepEqual(Array.from(frame.pixels), Array.from(sourcePixels))
  assert.equal(frame.width, 2)
  assert.equal(frame.height, 2)
})

test('restores the prior render target when framebuffer capture fails', () => {
  const events: string[] = []
  const previousTarget = { id: 'previous' }
  const renderer = {
    getRenderTarget: () => previousTarget,
    setRenderTarget: (target: unknown) => {
      events.push(target === null ? 'target:null' : 'target:previous')
    },
    render: () => {
      events.push('render')
    },
    getContext: () => ({
      drawingBufferWidth: 2,
      drawingBufferHeight: 2,
      readPixels: () => {
        throw new Error('read failed')
      },
    }),
  } as unknown as WatchSnapshotRenderer

  assert.throws(
    () => captureWechatWatchSnapshotPixels(renderer, {} as never, {} as never),
    /read failed/,
  )
  assert.deepEqual(events, ['target:null', 'render', 'target:previous'])
})

test('prepares flipped pixels for direct PNG encoding', () => {
  const sourcePixels = createPixels([
    [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ],
    [
      [0, 0, 255, 255],
      [255, 255, 255, 255],
    ],
  ])
  const image = prepareWechatWatchSnapshotImage({
    pixels: sourcePixels,
    sourceWidth: 2,
    sourceHeight: 2,
  })

  assert.deepEqual({
    width: image.width,
    height: image.height,
  }, {
    width: 2,
    height: 2,
  })
  assert.deepEqual(Array.from(image.pixels), [
    0, 0, 255, 255,
    255, 255, 255, 255,
    255, 0, 0, 255,
    0, 255, 0, 255,
  ])
})

test('rejects transparent source frames instead of drawing an empty image', () => {
  assert.throws(() => prepareWechatWatchSnapshotImage({
    pixels: new Uint8Array(16),
    sourceWidth: 2,
    sourceHeight: 2,
  }), /画面为空/)
})

test('encodes resampled RGBA pixels as a valid PNG with top-down rows', () => {
  const encoded = encodeWechatWatchSnapshotPng({
    pixels: new Uint8ClampedArray([
      0, 0, 255, 255,
      255, 255, 255, 255,
      255, 0, 0, 255,
      0, 255, 0, 255,
    ]),
    width: 2,
    height: 2,
  })

  assert.deepEqual(Array.from(encoded.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10])
  const chunks = readPngChunks(encoded)
  assert.deepEqual(chunks.map((chunk) => chunk.type), ['IHDR', 'IDAT', 'IEND'])
  assert.deepEqual(Array.from(chunks[0].data.subarray(0, 8)), [0, 0, 0, 2, 0, 0, 0, 2])
  assert.deepEqual(Array.from(inflateSync(chunks[1].data)), [
    0, 0, 0, 255, 255, 255, 255, 255, 255,
    0, 255, 0, 0, 255, 0, 255, 0, 255,
  ])
  assert.equal(Buffer.from(encoded.subarray(-4)).toString('hex'), 'ae426082')
})

test('writes PNG bytes directly to a controlled WeChat user-data path', async () => {
  let writeOptions: {
    filePath: string
    data: ArrayBuffer
    success: () => void
    fail: (error: unknown) => void
  } | null = null
  const runtime = {
    userDataPath: 'wxfile://usr',
    fs: {
      writeFile: (options: typeof writeOptions) => {
        writeOptions = options
        options!.success()
      },
      unlink: (options: { filePath: string; success: () => void }) => options.success(),
    },
  }
  const png = new Uint8Array([137, 80, 78, 71])

  const filePath = await writeWechatWatchSnapshotPngFile({
    runtime,
    fileName: 'watch-scene.png',
    png,
  })

  assert.equal(filePath, 'wxfile://usr/watch-scene.png')
  assert.equal(writeOptions!.filePath, filePath)
  assert.deepEqual(Array.from(new Uint8Array(writeOptions!.data)), Array.from(png))
})

test('removes obsolete snapshots without blocking a new capture', async () => {
  const removedPaths: string[] = []
  await removeWechatWatchSnapshotFile({
    userDataPath: 'wxfile://usr',
    fs: {
      unlink: (options: { filePath: string; success: () => void }) => {
        removedPaths.push(options.filePath)
        options.success()
      },
    },
  }, 'wxfile://usr/old.png')
  await removeWechatWatchSnapshotFile({
    userDataPath: 'wxfile://usr',
    fs: {
      unlink: (options: { fail: (error: unknown) => void }) => {
        options.fail(new Error('busy'))
      },
    },
  }, 'wxfile://usr/busy.png')

  assert.deepEqual(removedPaths, ['wxfile://usr/old.png'])
})

test('resolves WeChat filesystem capabilities and sanitizes snapshot paths', () => {
  const runtime = {
    env: { USER_DATA_PATH: 'wxfile://usr/' },
    getFileSystemManager: () => ({ writeFile() {}, unlink() {} }),
  }
  const resolved = resolveWechatWatchSnapshotRuntime(runtime)

  assert.ok(resolved)
  assert.equal(
    buildWechatWatchSnapshotFilePath(resolved, '../watch:scene.png'),
    'wxfile://usr/watch_scene.png',
  )
})

test('prompts after saving and opens the native image share menu on confirm', async () => {
  const modalOptions: Array<Record<string, unknown>> = []
  const shareOptions: Array<Record<string, unknown>> = []
  const runtime: WechatWatchSnapshotShareRuntime = {
    showModal(options) {
      modalOptions.push(options)
      options.success({ confirm: true, cancel: false })
    },
    showShareImageMenu(options) {
      shareOptions.push(options)
      options.success()
    },
    showToast() {},
  }

  const result = await promptWechatWatchSnapshotShare({
    runtime,
    filePath: 'wxfile://usr/watch-scene.png',
    entrancePath: '/pages/scenery/index?sceneId=scene-1',
  })

  assert.equal(result, 'opened')
  assert.equal(modalOptions[0].title, '照片已保存')
  assert.equal(modalOptions[0].confirmText, '分享照片')
  assert.equal(modalOptions[0].cancelText, '完成')
  assert.deepEqual(shareOptions[0], {
    path: 'wxfile://usr/watch-scene.png',
    needShowEntrance: true,
    entrancePath: '/pages/scenery/index?sceneId=scene-1',
    success: shareOptions[0].success,
    fail: shareOptions[0].fail,
  })
})

test('does not open the share menu when the confirmation is cancelled', async () => {
  let shareMenuCalls = 0
  const runtime: WechatWatchSnapshotShareRuntime = {
    showModal(options) {
      options.success({ confirm: false, cancel: true })
    },
    showShareImageMenu() {
      shareMenuCalls += 1
    },
    showToast() {},
  }

  const result = await promptWechatWatchSnapshotShare({
    runtime,
    filePath: 'wxfile://usr/watch-scene.png',
    entrancePath: '/pages/scenery/index',
  })

  assert.equal(result, 'dismissed')
  assert.equal(shareMenuCalls, 0)
})

test('keeps the saved-photo success feedback when image sharing is unavailable', async () => {
  const toasts: Array<Record<string, unknown>> = []
  const runtime: WechatWatchSnapshotShareRuntime = {
    showToast(options) {
      toasts.push(options)
    },
  }

  const result = await promptWechatWatchSnapshotShare({
    runtime,
    filePath: 'wxfile://usr/watch-scene.png',
    entrancePath: '/pages/scenery/index',
  })

  assert.equal(result, 'unsupported')
  assert.equal(toasts[0]?.title, '已保存到相册')
  assert.equal(toasts[0]?.icon, 'success')
})

test('sharing failures are reported without affecting the saved photo', async () => {
  const toasts: Array<Record<string, unknown>> = []
  const runtime: WechatWatchSnapshotShareRuntime = {
    showModal(options) {
      options.success({ confirm: true, cancel: false })
    },
    showShareImageMenu(options) {
      options.fail(new Error('share menu unavailable'))
    },
    showToast(options) {
      toasts.push(options)
    },
  }

  const result = await promptWechatWatchSnapshotShare({
    runtime,
    filePath: 'wxfile://usr/watch-scene.png',
    entrancePath: '/pages/scenery/index',
  })

  assert.equal(result, 'failed')
  assert.equal(toasts[0]?.title, '未能打开分享面板，可从相册分享')
  assert.equal(toasts[0]?.icon, 'none')
})

test('builds an encoded entrance path from the current scene page options', () => {
  assert.equal(buildWechatWatchSnapshotEntrancePath({
    route: 'pages/scenery/index',
    options: {
      sceneId: 'scene-1',
      packageUrl: 'https://cdn.example.com/scene package.zip',
      empty: '',
    },
  }), '/pages/scenery/index?sceneId=scene-1&packageUrl=https%3A%2F%2Fcdn.example.com%2Fscene%20package.zip&empty=')
})

function readPngChunks(png: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  const chunks: Array<{ type: string; data: Uint8Array }> = []
  let offset = 8
  while (offset + 12 <= png.length) {
    const length = readUint32Be(png, offset)
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8))
    const data = png.subarray(offset + 8, offset + 8 + length)
    chunks.push({ type, data })
    offset += 12 + length
  }
  return chunks
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  ) >>> 0
}
