import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SPLAT_AUTOTUNE,
  SPLAT_LADDER_FLOOR_LEVEL,
  SPLAT_LOD_LADDER,
  SPLAT_TIER_START_LEVEL,
  createSplatLevelState,
  isSplatPagingStable,
  resolveSplatLevelDecision,
  resolveSplatLevelTuning,
  resolveSplatStartLevel,
  resolveSplatTier,
  resolveSplatTuning,
} from './splatQuality.ts'
import type { SplatLevelState } from './splatQuality.ts'

test('ladder is monotonic: fewer splats and larger render scale as level grows', () => {
  assert.equal(SPLAT_LOD_LADDER.length, 5)
  assert.equal(SPLAT_LADDER_FLOOR_LEVEL, 4)
  for (let i = 1; i < SPLAT_LOD_LADDER.length; i += 1) {
    assert.ok(SPLAT_LOD_LADDER[i].lodSplatCount < SPLAT_LOD_LADDER[i - 1].lodSplatCount)
    assert.ok(SPLAT_LOD_LADDER[i].lodRenderScale > SPLAT_LOD_LADDER[i - 1].lodRenderScale)
  }
  assert.deepEqual(resolveSplatLevelTuning(2), { level: 2, lodSplatCount: 180000, lodRenderScale: 3 })
  assert.equal(resolveSplatLevelTuning(99).level, SPLAT_LADDER_FLOOR_LEVEL)
  assert.equal(resolveSplatLevelTuning(-5).level, 0)
  const tuning = resolveSplatTuning(2)
  assert.equal(tuning.lodSplatCount, 180000)
  assert.equal(tuning.lodRenderScale, 3)
  assert.equal(tuning.maxStdDev, 2)
  assert.equal(tuning.maxPixelRadius, 128)
  assert.equal(tuning.minSortIntervalMs, 400)
  assert.equal(tuning.maxPagedSplats, 1048576)
})

test('resolveSplatTier maps device facts to tiers', () => {
  assert.equal(resolveSplatTier(null), 'balanced')
  assert.equal(resolveSplatTier({}), 'balanced')
  assert.equal(resolveSplatTier({ benchmarkLevel: null, modelLevel: null, memoryMb: null }), 'balanced')

  // safe 优先：低档机 / 低性能分 / 小内存
  assert.equal(resolveSplatTier({ modelLevel: 3 }), 'safe')
  assert.equal(resolveSplatTier({ benchmarkLevel: 1 }), 'safe')
  assert.equal(resolveSplatTier({ benchmarkLevel: 10 }), 'safe')
  assert.equal(resolveSplatTier({ memoryMb: 2048 }), 'safe')
  assert.equal(resolveSplatTier({ modelLevel: 1, memoryMb: 2048 }), 'safe')

  // 未知（-1 / 0 / -2）不能当成低性能
  assert.equal(resolveSplatTier({ benchmarkLevel: -1 }), 'balanced')
  assert.equal(resolveSplatTier({ benchmarkLevel: 0 }), 'balanced')
  assert.equal(resolveSplatTier({ benchmarkLevel: -2 }), 'balanced')

  // high：高档机 / 高性能分 / 大内存且性能分够高
  assert.equal(resolveSplatTier({ modelLevel: 1 }), 'high')
  assert.equal(resolveSplatTier({ benchmarkLevel: 25 }), 'high')
  assert.equal(resolveSplatTier({ benchmarkLevel: 40 }), 'high')
  assert.equal(resolveSplatTier({ memoryMb: 8192, benchmarkLevel: 15 }), 'high')

  // 中间段保持 balanced
  assert.equal(resolveSplatTier({ benchmarkLevel: 11 }), 'balanced')
  assert.equal(resolveSplatTier({ benchmarkLevel: 20 }), 'balanced')
  assert.equal(resolveSplatTier({ memoryMb: 4096 }), 'balanced')
  assert.equal(resolveSplatTier({ memoryMb: 8192 }), 'balanced')
  assert.equal(resolveSplatTier({ modelLevel: 2, benchmarkLevel: 20, memoryMb: 4096 }), 'balanced')
})

test('scene profile quality only shifts the start tier one step more conservative', () => {
  const strongDevice = { modelLevel: 1, benchmarkLevel: 40, memoryMb: 8192 }
  const weakDevice = { modelLevel: 3, benchmarkLevel: 5, memoryMb: 2048 }

  assert.equal(resolveSplatStartLevel(strongDevice), SPLAT_TIER_START_LEVEL.high)
  // 场景标 low 时只在机型档上保守一档，且不会因此锁死最低档
  assert.equal(resolveSplatStartLevel(strongDevice, 'low'), SPLAT_TIER_START_LEVEL.high + 1)
  assert.equal(resolveSplatStartLevel(strongDevice, 'high'), SPLAT_TIER_START_LEVEL.high)
  assert.equal(resolveSplatStartLevel(strongDevice, 'balanced'), SPLAT_TIER_START_LEVEL.high)

  assert.equal(resolveSplatStartLevel(weakDevice), SPLAT_TIER_START_LEVEL.safe)
  assert.equal(resolveSplatStartLevel(weakDevice, 'high'), SPLAT_TIER_START_LEVEL.safe)
  assert.equal(resolveSplatStartLevel(weakDevice, 'balanced'), SPLAT_TIER_START_LEVEL.safe)
  // 已经在下限时再多保守也不会越界
  assert.equal(resolveSplatStartLevel(weakDevice, 'low'), SPLAT_LADDER_FLOOR_LEVEL)

  assert.equal(resolveSplatStartLevel(null), SPLAT_TIER_START_LEVEL.balanced)
  assert.equal(resolveSplatStartLevel(null, 'low'), SPLAT_TIER_START_LEVEL.balanced + 1)
})

test('paging stability gate rejects first window, empty and jumping samples', () => {
  assert.equal(isSplatPagingStable(null, 180000), false)
  assert.equal(isSplatPagingStable(180000, null), false)
  assert.equal(isSplatPagingStable(0, 0), false)
  assert.equal(isSplatPagingStable(180000, 180000), true)
  assert.equal(isSplatPagingStable(100000, 104000), true)
  assert.equal(isSplatPagingStable(100000, 106000), false)
})

function createState(level: number, startLevel = 2, floorLevel = SPLAT_LADDER_FLOOR_LEVEL): SplatLevelState {
  return { level, startLevel, floorLevel, lowStreak: 0, highStreak: 0 }
}

function createInput(state: SplatLevelState, overrides: Partial<Parameters<typeof resolveSplatLevelDecision>[0]> = {}) {
  return {
    state,
    fps: 30,
    frames: 30,
    splatLive: 180000,
    previousSplatLive: 180000,
    sinceLastStepMs: 60000,
    ...overrides,
  }
}

test('steps down after two consecutive low-fps windows', () => {
  let state = createState(2)

  const first = resolveSplatLevelDecision(createInput(state, { fps: 44 }))
  assert.equal(first.transition, null)
  assert.equal(first.state.lowStreak, 1)

  const second = resolveSplatLevelDecision(createInput(first.state, { fps: 41 }))
  assert.ok(second.transition)
  assert.equal(second.transition?.direction, 'down')
  assert.equal(second.transition?.fromLevel, 2)
  assert.equal(second.transition?.toLevel, 3)
  assert.equal(second.transition?.steps, 1)
  assert.equal(second.transition?.reason, `fps<${SPLAT_AUTOTUNE.lowFpsThreshold}x2`)
  assert.equal(second.state.level, 3)
  assert.equal(second.state.lowStreak, 0)
})

test('deep fps drops cross two levels at once and clamp at the floor', () => {
  const first = resolveSplatLevelDecision(createInput(createState(2), { fps: 30 }))
  assert.equal(first.transition, null)

  const deep = resolveSplatLevelDecision(createInput(first.state, { fps: 30 }))
  assert.ok(deep.transition)
  assert.equal(deep.transition?.direction, 'down')
  assert.equal(deep.transition?.fromLevel, 2)
  assert.equal(deep.transition?.toLevel, 4)
  assert.equal(deep.transition?.steps, 2)
  assert.equal(deep.transition?.reason, `fps<${SPLAT_AUTOTUNE.deepFpsThreshold}x2`)

  // 已经在倒数第二档时，深度掉帧只跨到下限
  const nearFloor = resolveSplatLevelDecision(createInput(
    { ...createState(3), lowStreak: 1 },
    { fps: 30 },
  ))
  assert.equal(nearFloor.transition?.toLevel, SPLAT_LADDER_FLOOR_LEVEL)
  assert.equal(nearFloor.transition?.steps, 1)
})

test('never steps down past the floor and never steps up past the start level', () => {
  let state = createState(SPLAT_LADDER_FLOOR_LEVEL)
  for (let i = 0; i < 5; i += 1) {
    const result = resolveSplatLevelDecision(createInput(state, { fps: 20 }))
    state = result.state
    assert.equal(result.transition, null)
  }
  assert.equal(state.level, SPLAT_LADDER_FLOOR_LEVEL)

  let top = createState(SPLAT_TIER_START_LEVEL.balanced, SPLAT_TIER_START_LEVEL.balanced)
  for (let i = 0; i < 8; i += 1) {
    const result = resolveSplatLevelDecision(createInput(top, { fps: 60 }))
    top = result.state
    assert.equal(result.transition, null)
  }
  assert.equal(top.level, SPLAT_TIER_START_LEVEL.balanced)
})

test('steps up after three consecutive high-fps windows when a down step happened', () => {
  let state = createState(3, 2)
  for (let i = 0; i < 2; i += 1) {
    const result = resolveSplatLevelDecision(createInput(state, { fps: 59 }))
    state = result.state
    assert.equal(result.transition, null)
  }
  assert.equal(state.highStreak, 2)

  const third = resolveSplatLevelDecision(createInput(state, { fps: 59 }))
  assert.ok(third.transition)
  assert.equal(third.transition?.direction, 'up')
  assert.equal(third.transition?.fromLevel, 3)
  assert.equal(third.transition?.toLevel, 2)
  assert.equal(third.transition?.steps, 1)
  assert.equal(third.transition?.reason, `fps>${SPLAT_AUTOTUNE.highFpsThreshold}x3`)
  assert.equal(third.state.level, 2)
  assert.equal(third.state.highStreak, 0)
})

test('cooldown blocks repeated steps', () => {
  const state = createState(2)
  const blocked = resolveSplatLevelDecision(createInput(state, {
    fps: 40,
    sinceLastStepMs: SPLAT_AUTOTUNE.stepDownCooldownMs - 1,
  }))
  assert.equal(blocked.transition, null)
  assert.equal(blocked.state.lowStreak, state.lowStreak + 1)

  const ready = resolveSplatLevelDecision(createInput(state, {
    fps: 40,
    sinceLastStepMs: SPLAT_AUTOTUNE.stepDownCooldownMs,
  }))
  assert.equal(ready.transition, null)
  assert.equal(ready.state.lowStreak, state.lowStreak + 1)

  const down = resolveSplatLevelDecision(createInput({ ...state, lowStreak: 2 }, { fps: 40 }))
  assert.ok(down.transition)

  const upBlocked = resolveSplatLevelDecision(createInput(
    { ...state, level: 3, highStreak: 4 },
    { fps: 60, sinceLastStepMs: SPLAT_AUTOTUNE.stepUpCooldownMs - 1 },
  ))
  assert.equal(upBlocked.transition, null)
  assert.equal(upBlocked.state.highStreak, 5)
})

test('frames below the window minimum or unstable paging invalidates the window', () => {
  const state = { ...createState(2), lowStreak: 2 }

  const fewFrames = resolveSplatLevelDecision(createInput(state, {
    fps: 20,
    frames: SPLAT_AUTOTUNE.minFramesPerWindow - 1,
  }))
  assert.equal(fewFrames.transition, null)
  assert.equal(fewFrames.state.lowStreak, 0)

  const loading = resolveSplatLevelDecision(createInput(state, {
    fps: 20,
    splatLive: 250000,
    previousSplatLive: 100000,
  }))
  assert.equal(loading.transition, null)
  assert.equal(loading.state.lowStreak, 0)

  const firstWindow = resolveSplatLevelDecision(createInput(state, {
    fps: 20,
    previousSplatLive: null,
  }))
  assert.equal(firstWindow.transition, null)
  assert.equal(firstWindow.state.lowStreak, 0)

  const missingFps = resolveSplatLevelDecision(createInput(state, { fps: null }))
  assert.equal(missingFps.transition, null)
  assert.equal(missingFps.state.lowStreak, 0)
})

test('mid-band fps resets both streaks', () => {
  const state = { ...createState(3, 2), lowStreak: 2, highStreak: 3 }
  const result = resolveSplatLevelDecision(createInput(state, { fps: 50 }))
  assert.equal(result.transition, null)
  assert.equal(result.state.lowStreak, 0)
  assert.equal(result.state.highStreak, 0)
})

test('createSplatLevelState clamps and seeds streaks', () => {
  const state = createSplatLevelState(SPLAT_TIER_START_LEVEL.balanced)
  assert.equal(state.level, 2)
  assert.equal(state.startLevel, 2)
  assert.equal(state.floorLevel, SPLAT_LADDER_FLOOR_LEVEL)
  assert.equal(state.lowStreak, 0)
  assert.equal(state.highStreak, 0)

  assert.equal(createSplatLevelState(99).level, SPLAT_LADDER_FLOOR_LEVEL)
  assert.equal(createSplatLevelState(Number.NaN).level, SPLAT_TIER_START_LEVEL.balanced)
})
