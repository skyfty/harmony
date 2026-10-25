import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveViewerRenderBudget } from '../common/viewerRenderBudget.ts'

const highProfile = {
  quality: 'high' as const,
  pixelRatioCap: 2,
  shadowsEnabled: true,
}

const balancedProfile = {
  quality: 'balanced' as const,
  pixelRatioCap: 2,
  shadowsEnabled: true,
}

const lowProfile = {
  quality: 'low' as const,
  pixelRatioCap: 2,
  shadowsEnabled: true,
}

test('WeChat defaults to a 1x render buffer without an explicit profile', () => {
  assert.deepEqual(resolveViewerRenderBudget({
    basePixelRatio: 2,
    baseShadowsEnabled: true,
    isWeChatMiniProgram: true,
    landscapePixelRatioCap: null,
    profile: null,
    memoryState: 'normal',
  }), {
    pixelRatio: 1,
    shadowsEnabled: true,
  })
})

test('memory pressure overrides high and balanced device profiles', () => {
  for (const memoryState of ['moderate', 'critical'] as const) {
    for (const profile of [highProfile, balancedProfile]) {
      assert.deepEqual(resolveViewerRenderBudget({
        basePixelRatio: 2,
        baseShadowsEnabled: true,
        isWeChatMiniProgram: true,
        landscapePixelRatioCap: 1.5,
        profile,
        memoryState,
      }), {
        pixelRatio: 1,
        shadowsEnabled: false,
      })
    }
  }
})

test('explicit high and balanced profiles can raise quality only while memory is normal', () => {
  assert.deepEqual(resolveViewerRenderBudget({
    basePixelRatio: 2,
    baseShadowsEnabled: true,
    isWeChatMiniProgram: true,
    landscapePixelRatioCap: null,
    profile: highProfile,
    memoryState: 'normal',
  }), {
    pixelRatio: 2,
    shadowsEnabled: true,
  })

  assert.deepEqual(resolveViewerRenderBudget({
    basePixelRatio: 2,
    baseShadowsEnabled: true,
    isWeChatMiniProgram: true,
    landscapePixelRatioCap: null,
    profile: balancedProfile,
    memoryState: 'normal',
  }), {
    pixelRatio: 1.5,
    shadowsEnabled: true,
  })
})

test('low profile and landscape cap can lower quality, while low quality disables shadows', () => {
  assert.deepEqual(resolveViewerRenderBudget({
    basePixelRatio: 2,
    baseShadowsEnabled: true,
    isWeChatMiniProgram: true,
    landscapePixelRatioCap: 0.75,
    profile: lowProfile,
    memoryState: 'normal',
  }), {
    pixelRatio: 0.75,
    shadowsEnabled: false,
  })
})

test('H5 keeps its existing base render ratio when no profile matches', () => {
  assert.deepEqual(resolveViewerRenderBudget({
    basePixelRatio: 2,
    baseShadowsEnabled: true,
    isWeChatMiniProgram: false,
    landscapePixelRatioCap: null,
    profile: null,
    memoryState: 'normal',
  }), {
    pixelRatio: 2,
    shadowsEnabled: true,
  })
})
