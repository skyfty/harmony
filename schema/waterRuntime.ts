import { Frustum, Matrix4, Mesh, Sphere, Vector3, type Camera, type Object3D, type Scene, type WebGLRenderer } from 'three'
import { forEachWaterRuntimeHandle, type WaterRuntimeHandle } from './components/definitions/waterComponent'

export type WaterRuntimeFrame = {
  renderer: WebGLRenderer | null | undefined
  scene: Scene | null | undefined
  camera: Camera | null | undefined
  trace?: (message: string, details?: Record<string, unknown>) => void
}

export type WaterRuntime = {
  update: (deltaSeconds: number, frame: WaterRuntimeFrame) => void
  reset: () => void
}

let waterStaticCaptureCursor = 0
let waterStaticMirrorCapturedOnce = false

function isObjectHierarchyVisible(object: Object3D): boolean {
  let cursor: Object3D | null = object
  while (cursor) {
    if (!cursor.visible) {
      return false
    }
    cursor = cursor.parent
  }
  return true
}

function belongsToScene(object: Object3D, scene: Scene): boolean {
  let cursor: Object3D | null = object
  while (cursor?.parent) {
    cursor = cursor.parent
  }
  return cursor === scene
}

function isObjectVisibleForCamera(
  object: Object3D,
  camera: Camera,
  scene: Scene,
  frustum: Frustum,
  worldSphere: Sphere,
  worldPosition: Vector3,
): boolean {
  if (!isObjectHierarchyVisible(object)) {
    return false
  }
  if (!belongsToScene(object, scene)) {
    return false
  }
  if (!camera.layers.test(object.layers)) {
    return false
  }
  if (object.frustumCulled === false) {
    return true
  }

  const mesh = object as Mesh
  const geometry = mesh.geometry
  const localSphere = geometry?.boundingSphere ?? null
  if (localSphere) {
    worldSphere.copy(localSphere)
    worldSphere.applyMatrix4(object.matrixWorld)
    return frustum.intersectsSphere(worldSphere)
  }

  object.getWorldPosition(worldPosition)
  return frustum.containsPoint(worldPosition)
}

export function createWaterRuntime(): WaterRuntime {
  const frustum = new Frustum()
  const viewProjection = new Matrix4()
  const worldSphere = new Sphere()
  const worldPosition = new Vector3()
  const WATER_RUNTIME_SLOW_UPDATE_MS = 32

  return {
    update: (deltaSeconds: number, frame: WaterRuntimeFrame) => {
      const updateStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
      const renderer = frame.renderer ?? null
      const scene = frame.scene ?? null
      const camera = frame.camera ?? null
      if (!renderer || !scene || !camera) {
        return
      }

      const safeDelta = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0
      let handleCount = 0
      let visibleCount = 0
      let dynamicCount = 0
      let staticCount = 0
      let updateTransformsMs = 0
      let visibilityMs = 0
      let dynamicTickMs = 0
      let staticTickMs = 0

      camera.updateMatrixWorld()
      viewProjection.multiplyMatrices((camera as any).projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(viewProjection)

      const handles: WaterRuntimeHandle[] = []
      forEachWaterRuntimeHandle((handle) => {
        handles.push(handle)
      })

      const captureCandidates = waterStaticMirrorCapturedOnce
        ? []
        : handles.filter((handle) => !handle.hasCapturedStaticMirror?.())
      const captureIndex = captureCandidates.length > 0 ? waterStaticCaptureCursor % captureCandidates.length : -1
      if (captureCandidates.length > 0) {
        waterStaticCaptureCursor = (waterStaticCaptureCursor + 1) % captureCandidates.length
      }

      handles.forEach((handle, _index) => {
        handleCount += 1
        const updateTransformsStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now()
        handle.updateTransforms()
        updateTransformsMs += (typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now()) - updateTransformsStartedAt

        const visibilityStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now()
        const object = handle.getRenderObject()
        const mode = handle.getEffectiveMode()
        if (!object || !mode) {
          visibilityMs += (typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now()) - visibilityStartedAt
          return
        }

        const geometry = (object as Mesh).geometry
        if (geometry && !geometry.boundingSphere) {
          geometry.computeBoundingSphere()
        }

        if (!isObjectVisibleForCamera(object, camera, scene, frustum, worldSphere, worldPosition)) {
          visibilityMs += (typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now()) - visibilityStartedAt
          return
        }
        visibleCount += 1
        visibilityMs += (typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now()) - visibilityStartedAt

        if (mode === 'dynamic') {
          dynamicCount += 1
          const dynamicStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now()
          handle.tickDynamic(safeDelta)
          dynamicTickMs += (typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now()) - dynamicStartedAt
          return
        }

        staticCount += 1
        const staticStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now()
        const captureCandidateIndex = captureCandidates.indexOf(handle)
        const beforeCaptured = handle.hasCapturedStaticMirror?.() === true
        handle.tickStatic(safeDelta, renderer, scene, camera, frame.trace, captureCandidateIndex === captureIndex)
        if (!waterStaticMirrorCapturedOnce && !beforeCaptured && handle.hasCapturedStaticMirror?.() === true) {
          waterStaticMirrorCapturedOnce = true
        }
        staticTickMs += (typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now()) - staticStartedAt
      })

      const totalMs = (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()) - updateStartedAt
      if (frame.trace && totalMs >= WATER_RUNTIME_SLOW_UPDATE_MS) {
        frame.trace('water runtime update', {
          ms: Math.round(totalMs * 10) / 10,
          deltaSeconds: Math.round(safeDelta * 1000) / 1000,
          handleCount,
          visibleCount,
          dynamicCount,
          staticCount,
          updateTransformsMs: Math.round(updateTransformsMs * 10) / 10,
          visibilityMs: Math.round(visibilityMs * 10) / 10,
          dynamicTickMs: Math.round(dynamicTickMs * 10) / 10,
          staticTickMs: Math.round(staticTickMs * 10) / 10,
        })
      }
    },
    reset: () => {
      // Water component lifecycle owns registration cleanup.
    },
  }
}
