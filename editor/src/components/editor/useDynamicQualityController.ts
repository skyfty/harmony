import type * as THREE from 'three'
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { clampToRange } from '../../utils/math'

export type DynamicQualityControllerDeps = {
  getRenderer: () => THREE.WebGLRenderer | null
  getComposer: () => EffectComposer | null
  getViewportSize: () => { width: number; height: number }
  updateFxaaResolution: (width: number, height: number) => void
  getFallbackDirectionalLight: () => THREE.DirectionalLight | null
  areShadowsEnabled: () => boolean
  applyRendererShadowSetting: () => void
}

export type DynamicQualityController = ReturnType<typeof useDynamicQualityController>

const MIN_BASE_PIXEL_RATIO = 0.65
const MAX_BASE_PIXEL_RATIO = 1.25
const MIN_INTERACTIVE_PIXEL_RATIO = 0.35
const INTERACTION_RESTORE_DELAY_MS = 180

export function useDynamicQualityController(deps: DynamicQualityControllerDeps) {
  const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const preferredBasePixelRatio = clampToRange(devicePixelRatio, MIN_BASE_PIXEL_RATIO, MAX_BASE_PIXEL_RATIO)

  let normalPixelRatio = preferredBasePixelRatio
  let targetInteractivePixelRatio = preferredBasePixelRatio
  let interactionRestoreTimer: number | null = null
  let isInteractiveQuality = false
  let savedShadowEnabled: boolean | null = null

  function applyPixelRatioToRenderer(value: number) {
    const renderer = deps.getRenderer()
    const composer = deps.getComposer()
    if (!renderer) {
      return
    }
    try {
      renderer.setPixelRatio(value)
      composer?.setPixelRatio(value)
      const { width, height } = deps.getViewportSize()
      deps.updateFxaaResolution(width, height)
    } catch (error) {
      console.warn('Failed to apply viewport pixel ratio', error)
    }
  }

  function applyInteractiveQuality(enabled: boolean) {
    if (enabled === isInteractiveQuality) {
      return
    }
    const renderer = deps.getRenderer()
    if (!renderer) {
      return
    }
    isInteractiveQuality = enabled
    const fallbackLight = deps.getFallbackDirectionalLight()

    if (enabled) {
      applyPixelRatioToRenderer(targetInteractivePixelRatio)
      if (savedShadowEnabled === null) {
        savedShadowEnabled = renderer.shadowMap.enabled
      }
      renderer.shadowMap.enabled = false
      if (fallbackLight) {
        fallbackLight.castShadow = false
      }
      return
    }

    applyPixelRatioToRenderer(normalPixelRatio)
    if (savedShadowEnabled !== null) {
      renderer.shadowMap.enabled = savedShadowEnabled
    } else {
      deps.applyRendererShadowSetting()
    }
    if (fallbackLight) {
      fallbackLight.castShadow = deps.areShadowsEnabled()
    }
    savedShadowEnabled = null
  }

  function beginInteractiveQuality() {
    if (interactionRestoreTimer !== null) {
      window.clearTimeout(interactionRestoreTimer)
      interactionRestoreTimer = null
    }
    applyInteractiveQuality(true)
  }

  function scheduleEndInteractiveQuality() {
    if (interactionRestoreTimer !== null) {
      window.clearTimeout(interactionRestoreTimer)
    }
    interactionRestoreTimer = window.setTimeout(() => {
      interactionRestoreTimer = null
      applyInteractiveQuality(false)
    }, INTERACTION_RESTORE_DELAY_MS)
  }

  function clampBasePixelRatio(value: number): number {
    return clampToRange(value, MIN_BASE_PIXEL_RATIO, preferredBasePixelRatio)
  }

  function clampInteractivePixelRatioValue(value: number, baseLimit = normalPixelRatio): number {
    const effectiveMax = Math.min(baseLimit, preferredBasePixelRatio)
    return clampToRange(value, MIN_INTERACTIVE_PIXEL_RATIO, effectiveMax)
  }

  function setBasePixelRatio(target: number) {
    const clamped = clampBasePixelRatio(target)
    if (Math.abs(clamped - normalPixelRatio) <= 0.01) {
      return
    }
    normalPixelRatio = clamped
    if (!isInteractiveQuality) {
      applyPixelRatioToRenderer(normalPixelRatio)
    }
  }

  function setInteractivePixelRatio(target: number) {
    const clamped = clampInteractivePixelRatioValue(target, normalPixelRatio)
    if (Math.abs(clamped - targetInteractivePixelRatio) <= 0.01) {
      return
    }
    targetInteractivePixelRatio = clamped
    if (isInteractiveQuality) {
      applyPixelRatioToRenderer(targetInteractivePixelRatio)
    }
  }

  function resetDynamicQualityState() {
    const baseTarget = clampBasePixelRatio(preferredBasePixelRatio)
    setBasePixelRatio(baseTarget)
    const interactiveTarget = clampInteractivePixelRatioValue(baseTarget, baseTarget)
    setInteractivePixelRatio(interactiveTarget)
  }

  function getCurrentPixelRatio(): number {
    return isInteractiveQuality ? targetInteractivePixelRatio : normalPixelRatio
  }

  function applyCurrentPixelRatio() {
    applyPixelRatioToRenderer(getCurrentPixelRatio())
  }

  function cancelInteractiveQualityTimer() {
    if (interactionRestoreTimer !== null) {
      window.clearTimeout(interactionRestoreTimer)
      interactionRestoreTimer = null
    }
  }

  function setInteractiveQualityMode(enabled: boolean) {
    cancelInteractiveQualityTimer()
    applyInteractiveQuality(enabled)
  }

  return {
    beginInteractiveQuality,
    scheduleEndInteractiveQuality,
    resetDynamicQualityState,
    applyCurrentPixelRatio,
    getCurrentPixelRatio,
    cancelInteractiveQualityTimer,
    setInteractiveQualityMode,
  }
}
