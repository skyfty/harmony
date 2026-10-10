import { describe, expect, it } from 'vitest'
import {
  BUILTIN_ANDROID_DEVICE_PROFILE_ID,
  BUILTIN_IOS_DEVICE_PROFILE_ID,
  isBuiltinDeviceAdaptationProfileId,
  normalizeDeviceAdaptationNodeProps,
  normalizeDeviceAdaptationSettings,
  removeDeviceAdaptationProfile,
  resolveDeviceAdaptationPlatform,
  resolveDeviceAdaptationProfile,
  type DeviceAdaptationSystemInfo,
} from '@schema/deviceAdaptation'

const lowEnd: DeviceAdaptationSystemInfo = {
  platform: 'wechat-miniprogram',
  memoryMb: 2048,
  cpuCores: 4,
  benchmarkLevel: 20,
  maxTextureSize: 4096,
  systemVersion: 'iOS 17.2.1',
}

describe('device adaptation profiles', () => {
  it('chooses the highest-priority matching profile', () => {
    const settings = normalizeDeviceAdaptationSettings({
      profiles: [
        { id: 'broad', name: 'Broad', priority: 1, conditions: { maxMemoryMb: 4096 } },
        { id: 'wechat-low', name: 'WeChat low', priority: 5, conditions: { platforms: ['wechat-miniprogram'], maxMemoryMb: 3072 } },
      ],
    })
    expect(resolveDeviceAdaptationProfile(settings, lowEnd)?.id).toBe('wechat-low')
  })

  it('does not treat missing measurements as satisfying numeric limits', () => {
    const settings = normalizeDeviceAdaptationSettings({
      profiles: [{ id: 'low', name: 'Low', conditions: { maxMemoryMb: 3072 } }],
    })
    expect(resolveDeviceAdaptationProfile(settings, { ...lowEnd, memoryMb: null })).toBeNull()
  })

  it('prefers an explicit enabled manual profile over automatic matching', () => {
    const settings = normalizeDeviceAdaptationSettings({
      manualProfileId: 'manual',
      profiles: [
        { id: 'manual', name: 'Manual', enabled: true, quality: 'high' },
        { id: 'automatic', name: 'Automatic', conditions: { maxMemoryMb: 4096 } },
      ],
    })
    expect(resolveDeviceAdaptationProfile(settings, lowEnd)?.id).toBe('manual')
  })

  it('compares dotted operating-system versions numerically', () => {
    const settings = normalizeDeviceAdaptationSettings({
      profiles: [{ id: 'old-ios', name: 'Old iOS', conditions: { platforms: ['ios'], maxSystemVersion: '17.10' } }],
    })
    expect(resolveDeviceAdaptationProfile(settings, { ...lowEnd, platform: 'ios', systemVersion: '17.2.1' })?.id).toBe('old-ios')
    expect(resolveDeviceAdaptationProfile(settings, { ...lowEnd, platform: 'ios', systemVersion: null })?.id).not.toBe('old-ios')
  })

  it('adds the built-in iOS and Android profiles while preserving custom profiles', () => {
    const normalized = normalizeDeviceAdaptationSettings({
      profiles: [{ id: 'custom', name: 'Custom', conditions: { maxMemoryMb: 2048 } }],
    })
    expect(normalized.profiles.map((profile) => profile.id)).toEqual(expect.arrayContaining([
      'custom', BUILTIN_IOS_DEVICE_PROFILE_ID, BUILTIN_ANDROID_DEVICE_PROFILE_ID,
    ]))
    expect(normalizeDeviceAdaptationSettings(normalized).profiles).toEqual(normalized.profiles)
  })

  it('keeps built-in rules bound to their OS and prevents their removal', () => {
    const normalized = normalizeDeviceAdaptationSettings({
      profiles: [{ id: BUILTIN_IOS_DEVICE_PROFILE_ID, name: 'Renamed', conditions: { platforms: ['android'] } }],
    })
    const ios = normalized.profiles.find((profile) => profile.id === BUILTIN_IOS_DEVICE_PROFILE_ID)
    expect(ios?.conditions.platforms).toEqual(['ios'])
    expect(ios?.conditions.maxMemoryMb).toBe(4096)
    expect(ios?.name).toBe('Renamed')
    expect(isBuiltinDeviceAdaptationProfileId(BUILTIN_IOS_DEVICE_PROFILE_ID)).toBe(true)
    expect(removeDeviceAdaptationProfile(normalized.profiles, BUILTIN_IOS_DEVICE_PROFILE_ID)).toEqual(normalized.profiles)
  })

  it('resolves the operating system before falling back to the host platform', () => {
    expect(resolveDeviceAdaptationPlatform('devtools', 'iOS 17.2', 'wechat-miniprogram')).toBe('ios')
    expect(resolveDeviceAdaptationPlatform('android', 'Android 14', 'wechat-miniprogram')).toBe('android')
    expect(resolveDeviceAdaptationPlatform('devtools', '', 'wechat-miniprogram')).toBe('wechat-miniprogram')
  })
})

describe('device adaptation node rules', () => {
  it('keeps the skip-subtree action verbatim', () => {
    const props = normalizeDeviceAdaptationNodeProps({
      rules: [{ profileId: BUILTIN_IOS_DEVICE_PROFILE_ID, action: 'skip-subtree' }],
    })
    expect(props.rules).toEqual([
      { profileId: BUILTIN_IOS_DEVICE_PROFILE_ID, action: 'skip-subtree', modelAssetId: null },
    ])
  })

  it('keeps every supported action and coerces unknown ones', () => {
    const actions = ['skip-visual', 'skip-subtree', 'replace-model', 'disable-textures', 'simplify-rendering']
    const props = normalizeDeviceAdaptationNodeProps({
      rules: [
        ...actions.map((action, index) => ({ profileId: `profile-${index}`, action })),
        { profileId: 'unknown', action: 'nuke-everything' },
      ],
    })
    expect(props.rules.map((rule) => rule.action)).toEqual([...actions, 'simplify-rendering'])
  })

  it('deduplicates rules that target the same profile', () => {
    const props = normalizeDeviceAdaptationNodeProps({
      rules: [
        { profileId: BUILTIN_IOS_DEVICE_PROFILE_ID, action: 'skip-subtree' },
        { profileId: BUILTIN_IOS_DEVICE_PROFILE_ID, action: 'disable-textures' },
        { profileId: '   ', action: 'skip-visual' },
      ],
    })
    expect(props.rules).toEqual([
      { profileId: BUILTIN_IOS_DEVICE_PROFILE_ID, action: 'skip-subtree', modelAssetId: null },
    ])
  })
})
