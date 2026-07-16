import { trackAnalyticsEvent } from '@harmony/utils'
import { ensureMiniAuth } from '@/api/mini/session'
import { ensureMiniCapability } from '@/platform/runtime'

export type LocationPermissionState = 'granted' | 'not_requested' | 'denied'

export interface CurrentLocation {
  latitude: number
  longitude: number
}

export interface RealSceneCheckinResult extends CurrentLocation {
  matchedSceneSpotId: string | null
  matchedSceneSpotTitle: string | null
  matchedSceneId: string | null
  matchedDistanceMeters: number | null
}

type RealSceneCheckinEventResponse = {
  success: boolean
  matchedSceneSpotId?: string
  matchedSceneSpotTitle?: string
  matchedSceneId?: string
  matchedDistanceMeters?: number
}

function getLocationValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function getLocationPermissionState(): Promise<LocationPermissionState> {
  if (typeof uni.getSetting !== 'function') {
    return 'granted'
  }

  const setting = await new Promise<{ authSetting: Record<string, boolean | undefined> }>((resolve, reject) => {
    uni.getSetting({
      success: (result) => resolve(result as unknown as { authSetting: Record<string, boolean | undefined> }),
      fail: (error: unknown) => reject(error),
    })
  })

  const locationAuth = setting.authSetting['scope.userLocation']
  if (locationAuth === true) {
    return 'granted'
  }
  if (locationAuth === false) {
    return 'denied'
  }
  return 'not_requested'
}

export async function requestLocationPermission(): Promise<LocationPermissionState> {
  const currentState = await getLocationPermissionState()
  if (currentState === 'granted') {
    return 'granted'
  }

  if (typeof uni.authorize !== 'function') {
    return 'granted'
  }

  try {
    await new Promise<void>((resolve, reject) => {
      uni.authorize({
        scope: 'scope.userLocation',
        success: () => resolve(),
        fail: (error: unknown) => reject(error),
      })
    })
    return 'granted'
  } catch {
    return currentState === 'denied' ? 'denied' : 'not_requested'
  }
}

export async function promptOpenLocationSetting(permissionState: LocationPermissionState): Promise<boolean> {
  if (typeof uni.showModal !== 'function') {
    if (typeof uni.openSetting === 'function') {
      uni.openSetting({})
    }
    return true
  }

  const content =
    permissionState === 'denied'
      ? '你之前关闭了定位权限，请到设置里手动开启后重试。'
      : '需要先允许定位权限，才能获取当前位置并完成实景打卡。'

  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '需要定位权限',
      content,
      confirmText: '去设置',
      cancelText: '取消',
      success: (result) => {
        resolve(Boolean(result.confirm))
        if (result.confirm && typeof uni.openSetting === 'function') {
          uni.openSetting({})
        }
      },
      fail: () => resolve(false),
    })
  })

  return confirmed
}

export async function ensureLocationPermission(): Promise<LocationPermissionState> {
  const state = await getLocationPermissionState()
  if (state === 'granted') {
    return 'granted'
  }
  return await requestLocationPermission()
}

export async function getCurrentLocation(): Promise<CurrentLocation> {
  if (typeof uni.getLocation !== 'function') {
    throw new Error('当前平台不支持定位')
  }

  const result = await new Promise<{ latitude?: number; longitude?: number }>((resolve, reject) => {
    uni.getLocation({
      type: 'gcj02',
      success: (location) => resolve(location as { latitude?: number; longitude?: number }),
      fail: (error: unknown) => reject(error),
    })
  })

  const latitude = getLocationValue(result.latitude)
  const longitude = getLocationValue(result.longitude)
  if (latitude === null || longitude === null) {
    throw new Error('未能获取有效定位')
  }

  return { latitude, longitude }
}

export function formatLocationText(location: CurrentLocation | null | undefined): string {
  if (!location) {
    return ''
  }

  const latitude = getLocationValue(location.latitude)
  const longitude = getLocationValue(location.longitude)
  if (latitude === null || longitude === null) {
    return ''
  }

  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
}

export async function startRealSceneCheckin(
  source: {
    path: string
    sceneId?: string
    sceneSpotId?: string
    metadata?: Record<string, unknown>
  },
  options?: {
    permissionGranted?: boolean
  },
): Promise<RealSceneCheckinResult> {
  await ensureMiniAuth()
  const capabilityEnabled = await ensureMiniCapability('locationPicker')
  if (!capabilityEnabled) {
    throw new Error('当前平台暂不支持定位')
  }

  const permission = options?.permissionGranted === true ? 'granted' : await requestLocationPermission()
  if (permission !== 'granted') {
    throw new Error(permission === 'denied' ? '定位权限已关闭' : '需要授予定位权限')
  }

  const location = await getCurrentLocation()
  const response = (await trackAnalyticsEvent({
    eventType: 'real_scene_location',
    sceneId: source.sceneId,
    sceneSpotId: source.sceneSpotId,
    source: 'tour-miniapp',
    path: source.path,
    latitude: location.latitude,
    longitude: location.longitude,
    metadata: source.metadata,
  })) as RealSceneCheckinEventResponse

  return {
    ...location,
    matchedSceneSpotId: typeof response?.matchedSceneSpotId === 'string' ? response.matchedSceneSpotId : null,
    matchedSceneSpotTitle: typeof response?.matchedSceneSpotTitle === 'string' ? response.matchedSceneSpotTitle : null,
    matchedSceneId: typeof response?.matchedSceneId === 'string' ? response.matchedSceneId : null,
    matchedDistanceMeters: typeof response?.matchedDistanceMeters === 'number' ? response.matchedDistanceMeters : null,
  }
}
