export type DeviceAdaptationPlatform = 'wechat-miniprogram' | 'h5' | 'ios' | 'android' | 'unknown'
export type DeviceAdaptationQuality = 'low' | 'balanced' | 'high'

export interface DeviceAdaptationConditions {
  platforms?: DeviceAdaptationPlatform[]
  /** Match when reported physical memory is at or below this value (MB). */
  maxMemoryMb?: number
  /** Match when reported logical CPU core count is at or below this value. */
  maxCpuCores?: number
  /** Match when reported device benchmark is at or below this value. */
  maxBenchmarkLevel?: number
  /** Match when WebGL reports a max texture size at or below this value. */
  maxTextureSize?: number
  minSystemVersion?: string
  maxSystemVersion?: string
}

export interface DeviceAdaptationProfile {
  id: string
  name: string
  enabled: boolean
  priority: number
  conditions: DeviceAdaptationConditions
  quality: DeviceAdaptationQuality
  pixelRatioCap: number
  shadowsEnabled: boolean
  lazyLoadMeshes: boolean
}

export interface DeviceAdaptationSettings {
  profiles: DeviceAdaptationProfile[]
  /** Optional explicit profile id. When set, automatic matching is bypassed. */
  manualProfileId: string | null
}

export interface DeviceAdaptationNodeRule {
  profileId: string
  action: 'skip-visual' | 'replace-model' | 'disable-textures' | 'simplify-rendering'
  modelAssetId: string | null
}

export interface DeviceAdaptationComponentProps {
  rules: DeviceAdaptationNodeRule[]
}

export interface DeviceAdaptationSystemInfo {
  platform: DeviceAdaptationPlatform
  memoryMb: number | null
  cpuCores: number | null
  benchmarkLevel: number | null
  maxTextureSize: number | null
  systemVersion: string | null
}

export const DEVICE_ADAPTATION_COMPONENT_TYPE = 'deviceAdaptation'
export const BUILTIN_IOS_DEVICE_PROFILE_ID = 'builtin-ios'
export const BUILTIN_ANDROID_DEVICE_PROFILE_ID = 'builtin-android'

export function isBuiltinDeviceAdaptationProfileId(profileId: string): boolean {
  return profileId === BUILTIN_IOS_DEVICE_PROFILE_ID || profileId === BUILTIN_ANDROID_DEVICE_PROFILE_ID
}

export function removeDeviceAdaptationProfile(
  profiles: readonly DeviceAdaptationProfile[],
  profileId: string,
): DeviceAdaptationProfile[] {
  if (isBuiltinDeviceAdaptationProfileId(profileId)) return profiles.map((profile) => ({ ...profile }))
  return profiles.filter((profile) => profile.id !== profileId).map((profile) => ({ ...profile }))
}

export function resolveDeviceAdaptationPlatform(
  platformValue: unknown,
  systemValue: unknown,
  host: 'wechat-miniprogram' | 'h5' | 'unknown' = 'unknown',
): DeviceAdaptationPlatform {
  const platform = typeof platformValue === 'string' ? platformValue.toLowerCase() : ''
  const system = typeof systemValue === 'string' ? systemValue.toLowerCase() : ''
  const combined = `${platform} ${system}`
  if (/android/.test(combined)) return 'android'
  if (/ios|iphone|ipad|ipod/.test(combined)) return 'ios'
  return host
}

export const BUILTIN_DEVICE_ADAPTATION_PROFILES: DeviceAdaptationProfile[] = [
  {
    id: BUILTIN_IOS_DEVICE_PROFILE_ID,
    name: 'iOS 低配设备',
    enabled: true,
    priority: -100,
    conditions: { platforms: ['ios'], maxMemoryMb: 4096 },
    quality: 'low',
    pixelRatioCap: 1,
    shadowsEnabled: false,
    lazyLoadMeshes: true,
  },
  {
    id: BUILTIN_ANDROID_DEVICE_PROFILE_ID,
    name: 'Android 低配设备',
    enabled: true,
    priority: -100,
    conditions: { platforms: ['android'], maxMemoryMb: 4096 },
    quality: 'low',
    pixelRatioCap: 1,
    shadowsEnabled: false,
    lazyLoadMeshes: true,
  },
]

export const DEFAULT_DEVICE_ADAPTATION_SETTINGS: DeviceAdaptationSettings = {
  profiles: BUILTIN_DEVICE_ADAPTATION_PROFILES.map((profile) => ({ ...profile, conditions: { ...profile.conditions } })),
  manualProfileId: null,
}

function finitePositive(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function normalizeDeviceAdaptationSettings(value: unknown): DeviceAdaptationSettings {
  const source = value && typeof value === 'object' ? value as Partial<DeviceAdaptationSettings> : {}
  const profiles = Array.isArray(source.profiles) ? source.profiles : []
  const seen = new Set<string>()
  const normalizedProfiles: DeviceAdaptationProfile[] = []
  for (const [index, raw] of profiles.entries()) {
    if (!raw || typeof raw !== 'object') continue
    const profile = raw as Partial<DeviceAdaptationProfile>
    const id = typeof profile.id === 'string' ? profile.id.trim() : ''
    const name = typeof profile.name === 'string' ? profile.name.trim() : ''
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    const conditions = profile.conditions && typeof profile.conditions === 'object' ? profile.conditions : {}
    const platforms = Array.isArray(conditions.platforms)
      ? conditions.platforms.filter((platform): platform is DeviceAdaptationPlatform =>
          ['wechat-miniprogram', 'h5', 'ios', 'android', 'unknown'].includes(platform),
        )
      : undefined
    const isBuiltinIos = id === BUILTIN_IOS_DEVICE_PROFILE_ID
    const isBuiltinAndroid = id === BUILTIN_ANDROID_DEVICE_PROFILE_ID
    const builtinProfile = isBuiltinIos || isBuiltinAndroid
      ? BUILTIN_DEVICE_ADAPTATION_PROFILES.find((entry) => entry.id === id)
      : undefined
    normalizedProfiles.push({
      id,
      name,
      enabled: profile.enabled !== false,
      priority: Number.isFinite(Number(profile.priority)) ? Number(profile.priority) : -index,
      conditions: {
        ...(builtinProfile ? { platforms: [...(builtinProfile.conditions.platforms ?? [])] } : platforms?.length ? { platforms } : {}),
        ...(finitePositive(conditions.maxMemoryMb) ? { maxMemoryMb: finitePositive(conditions.maxMemoryMb)! } : {}),
        ...(finitePositive(conditions.maxCpuCores) ? { maxCpuCores: Math.trunc(finitePositive(conditions.maxCpuCores)!) } : {}),
        ...(finitePositive(conditions.maxBenchmarkLevel) ? { maxBenchmarkLevel: finitePositive(conditions.maxBenchmarkLevel)! } : {}),
        ...(finitePositive(conditions.maxTextureSize) ? { maxTextureSize: finitePositive(conditions.maxTextureSize)! } : {}),
        ...(typeof conditions.minSystemVersion === 'string' && conditions.minSystemVersion.trim() ? { minSystemVersion: conditions.minSystemVersion.trim() } : {}),
        ...(typeof conditions.maxSystemVersion === 'string' && conditions.maxSystemVersion.trim() ? { maxSystemVersion: conditions.maxSystemVersion.trim() } : {}),
      },
      quality: profile.quality === 'low' || profile.quality === 'high' ? profile.quality : 'balanced',
      pixelRatioCap: Math.max(0.5, Math.min(2, finitePositive(profile.pixelRatioCap) ?? 1)),
      shadowsEnabled: profile.shadowsEnabled !== false,
      lazyLoadMeshes: profile.lazyLoadMeshes !== false,
    })
  }
  for (const builtinProfile of BUILTIN_DEVICE_ADAPTATION_PROFILES) {
    if (seen.has(builtinProfile.id)) continue
    normalizedProfiles.push({ ...builtinProfile, conditions: { ...builtinProfile.conditions, platforms: [...(builtinProfile.conditions.platforms ?? [])] } })
    seen.add(builtinProfile.id)
  }
  const manualCandidate = typeof source.manualProfileId === 'string' ? source.manualProfileId : ''
  const manualId = normalizedProfiles.some((profile) => profile.id === manualCandidate && profile.enabled)
    ? manualCandidate
    : null
  return { profiles: normalizedProfiles, manualProfileId: manualId }
}

export function normalizeDeviceAdaptationNodeProps(value: unknown): DeviceAdaptationComponentProps {
  const source = value && typeof value === 'object' ? value as Partial<DeviceAdaptationComponentProps> : {}
  const rules = Array.isArray(source.rules) ? source.rules : []
  const seen = new Set<string>()
  return {
    rules: rules.flatMap((raw) => {
      if (!raw || typeof raw !== 'object') return []
      const rule = raw as Partial<DeviceAdaptationNodeRule>
      const profileId = typeof rule.profileId === 'string' ? rule.profileId.trim() : ''
      if (!profileId || seen.has(profileId)) return []
      seen.add(profileId)
      const action = ['skip-visual', 'replace-model', 'disable-textures', 'simplify-rendering'].includes(String(rule.action))
        ? rule.action as DeviceAdaptationNodeRule['action']
        : 'simplify-rendering'
      const modelAssetId = typeof rule.modelAssetId === 'string' && rule.modelAssetId.trim()
        ? rule.modelAssetId.trim()
        : null
      return [{ profileId, action, modelAssetId }]
    }),
  }
}

function matchesLimit(actual: number | null, maximum: number | undefined): boolean {
  return maximum === undefined || (actual !== null && actual <= maximum)
}

function compareSystemVersions(left: string, right: string): number | null {
  const parse = (value: string) => value.match(/\d+/g)?.map(Number) ?? []
  const leftParts = parse(left)
  const rightParts = parse(right)
  if (!leftParts.length || !rightParts.length) return null
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }
  return 0
}

export function matchesDeviceAdaptationProfile(
  profile: DeviceAdaptationProfile,
  info: DeviceAdaptationSystemInfo,
): boolean {
  if (!profile.enabled) return false
  const { conditions } = profile
  if (conditions.platforms?.length && !conditions.platforms.includes(info.platform)) return false
  if (conditions.minSystemVersion) {
    const comparison = info.systemVersion ? compareSystemVersions(info.systemVersion, conditions.minSystemVersion) : null
    if (comparison === null || comparison < 0) return false
  }
  if (conditions.maxSystemVersion) {
    const comparison = info.systemVersion ? compareSystemVersions(info.systemVersion, conditions.maxSystemVersion) : null
    if (comparison === null || comparison > 0) return false
  }
  return matchesLimit(info.memoryMb, conditions.maxMemoryMb)
    && matchesLimit(info.cpuCores, conditions.maxCpuCores)
    && matchesLimit(info.benchmarkLevel, conditions.maxBenchmarkLevel)
    && matchesLimit(info.maxTextureSize, conditions.maxTextureSize)
}

export function resolveDeviceAdaptationProfile(
  settings: unknown,
  info: DeviceAdaptationSystemInfo,
): DeviceAdaptationProfile | null {
  const normalized = normalizeDeviceAdaptationSettings(settings)
  if (normalized.manualProfileId) {
    return normalized.profiles.find((profile) => profile.id === normalized.manualProfileId && profile.enabled) ?? null
  }
  return [...normalized.profiles]
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .find((profile) => matchesDeviceAdaptationProfile(profile, info)) ?? null
}
