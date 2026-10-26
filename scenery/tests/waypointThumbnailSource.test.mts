import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearWechatWaypointThumbnailFiles,
  isGuideWaypointDestinationDisabled,
  resolveWaypointThumbnailServerUrl,
  resolveWaypointThumbnailFileExtension,
  resolveWaypointThumbnailSourceUrl,
  writeWechatWaypointThumbnailFile,
  type WechatWaypointThumbnailRuntime,
} from '../common/utils/waypointThumbnailSource.ts'

type FakeFileSystem = {
  files: Map<string, ArrayBuffer>
  directories: Set<string>
  mkdirSync: (path: string, recursive?: boolean) => void
  readdirSync: (path: string) => string[]
  unlinkSync: (path: string) => void
  writeFileSync: (path: string, data: ArrayBuffer) => void
}

function createRuntime(options: {
  failWrite?: boolean
  failUnlinkPath?: string
  userDataPath?: string
} = {}): WechatWaypointThumbnailRuntime & { fakeFs: FakeFileSystem } {
  const files = new Map<string, ArrayBuffer>()
  const directories = new Set<string>()
  const fakeFs: FakeFileSystem = {
    files,
    directories,
    mkdirSync(path, recursive) {
      if (recursive) {
        const segments = path.split('/')
        for (let index = 2; index <= segments.length; index += 1) {
          directories.add(segments.slice(0, index).join('/'))
        }
        return
      }
      directories.add(path)
    },
    readdirSync(path) {
      const prefix = `${path.replace(/\/+$/, '')}/`
      const names = new Set<string>()
      for (const filePath of files.keys()) {
        if (filePath.startsWith(prefix)) {
          names.add(filePath.slice(prefix.length))
        }
      }
      return Array.from(names)
    },
    unlinkSync(path) {
      if (path === options.failUnlinkPath) {
        throw new Error('file is busy')
      }
      files.delete(path)
    },
    writeFileSync(path, data) {
      if (options.failWrite) {
        throw new Error('disk full')
      }
      files.set(path, data)
    },
  }
  return {
    fakeFs,
    fs: fakeFs,
    userDataPath: options.userDataPath ?? 'wxfile://usr',
  }
}

test('writes package image bytes to a deterministic WeChat user-data path', () => {
  const runtime = createRuntime()
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe1]).buffer
  const firstPath = writeWechatWaypointThumbnailFile({
    assetId: 'sha256-e6f423917089e45e',
    bytes,
    filename: '20170622055915753.jpg',
    mimeType: 'image/jpeg',
    runtime,
  })
  const secondPath = writeWechatWaypointThumbnailFile({
    assetId: 'sha256-e6f423917089e45e',
    bytes,
    filename: '20170622055915753.jpg',
    mimeType: 'image/jpeg',
    runtime,
  })

  assert.equal(firstPath, 'wxfile://usr/harmony/waypoint-thumbnails/sha256-e6f423917089e45e.jpg')
  assert.equal(secondPath, firstPath)
  assert.equal(runtime.fakeFs.directories.has('wxfile://usr/harmony/waypoint-thumbnails'), true)
  assert.deepEqual(new Uint8Array(runtime.fakeFs.files.get(firstPath)!), new Uint8Array(bytes))
})

test('derives a safe image extension from filename or MIME type', () => {
  assert.equal(resolveWaypointThumbnailFileExtension('photo.JPEG', null), 'jpg')
  assert.equal(resolveWaypointThumbnailFileExtension(null, 'image/png'), 'png')
  assert.equal(resolveWaypointThumbnailFileExtension('../unsafe', 'image/webp'), 'webp')
  assert.equal(resolveWaypointThumbnailFileExtension(null, 'application/octet-stream'), 'bin')
})

test('WeChat never returns a Blob URL to the native image component', () => {
  assert.equal(resolveWaypointThumbnailSourceUrl({
    isWechatMiniProgram: true,
    directUrl: 'https://cdn.example.com/stop.jpg',
  }), 'https://cdn.example.com/stop.jpg')
  assert.equal(resolveWaypointThumbnailSourceUrl({
    isWechatMiniProgram: true,
    directUrl: 'blob:https://mock.by.createObjectURL/stop',
    localFilePath: 'wxfile://usr/harmony/waypoint-thumbnails/stop.jpg',
    objectUrl: 'blob:https://mock.by.createObjectURL/stop',
  }), 'wxfile://usr/harmony/waypoint-thumbnails/stop.jpg')
  assert.equal(resolveWaypointThumbnailSourceUrl({
    isWechatMiniProgram: true,
    objectUrl: 'blob:https://mock.by.createObjectURL/stop',
  }), null)
})

test('H5 keeps the existing object URL behavior', () => {
  assert.equal(resolveWaypointThumbnailSourceUrl({
    isWechatMiniProgram: false,
    objectUrl: 'blob:http://localhost/stop',
  }), 'blob:http://localhost/stop')
})

test('server thumbnails use the configured CDN base instead of a stale resolved host', () => {
  assert.equal(resolveWaypointThumbnailServerUrl({
    assetBaseUrl: 'https://cdn.v.touchmagic.cn/uploads/',
    fileKey: 'PkHRMT0DE7YesplA.jpg',
    resolvedUrl: 'http://v.touchmagic.cn/uploads/PkHRMT0DE7YesplA.jpg',
  }), 'https://cdn.v.touchmagic.cn/uploads/PkHRMT0DE7YesplA.jpg')

  assert.equal(resolveWaypointThumbnailServerUrl({
    assetBaseUrl: 'https://cdn.v.touchmagic.cn/uploads',
    fileKey: null,
    resolvedUrl: 'http://v.touchmagic.cn/uploads/legacy.jpg',
  }), 'https://cdn.v.touchmagic.cn/uploads/legacy.jpg')
})

test('thumbnail failure does not disable a valid guide destination', () => {
  assert.equal(isGuideWaypointDestinationDisabled({
    hasCompatibleActor: true,
    vehicleDrivePromptBusy: false,
  }), false)
  assert.equal(isGuideWaypointDestinationDisabled({
    hasCompatibleActor: false,
    vehicleDrivePromptBusy: false,
  }), true)
  assert.equal(isGuideWaypointDestinationDisabled({
    hasCompatibleActor: true,
    vehicleDrivePromptBusy: true,
  }), true)
})

test('write and cleanup failures remain isolated from other thumbnail files', () => {
  const failingRuntime = createRuntime({ failWrite: true })
  assert.throws(() => writeWechatWaypointThumbnailFile({
    assetId: 'stop-failure',
    bytes: new Uint8Array([1, 2, 3]).buffer,
    mimeType: 'image/png',
    runtime: failingRuntime,
  }), /disk full/)

  let runtime = createRuntime()
  const keepPath = writeWechatWaypointThumbnailFile({
    assetId: 'keep',
    bytes: new Uint8Array([1]).buffer,
    mimeType: 'image/png',
    runtime,
  })
  const removePath = writeWechatWaypointThumbnailFile({
    assetId: 'remove',
    bytes: new Uint8Array([2]).buffer,
    mimeType: 'image/png',
    runtime,
  })
  runtime = createRuntime({ failUnlinkPath: keepPath })
  runtime.fakeFs.files.set(keepPath, new Uint8Array([1]).buffer)
  runtime.fakeFs.files.set(removePath, new Uint8Array([2]).buffer)
  clearWechatWaypointThumbnailFiles(runtime)
  assert.equal(runtime.fakeFs.files.has(keepPath), true)
  assert.equal(runtime.fakeFs.files.has(removePath), false)
})
