import { Frustum, Matrix4, Mesh, Sphere, Vector3, type Camera, type Object3D, type Scene, type WebGLRenderer } from 'three'
import { forEachWaterRuntimeHandle } from './components/definitions/waterComponent'

export type WaterRuntimeFrame = {
  renderer: WebGLRenderer | null | undefined
  scene: Scene | null | undefined
  camera: Camera | null | undefined
}

export type WaterRuntime = {
  update: (deltaSeconds: number, frame: WaterRuntimeFrame) => void
  reset: () => void
}

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

  return {
    update: (deltaSeconds: number, frame: WaterRuntimeFrame) => {
      const renderer = frame.renderer ?? null
      const scene = frame.scene ?? null
      const camera = frame.camera ?? null
      if (!renderer || !scene || !camera) {
        return
      }

      const safeDelta = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0
      camera.updateMatrixWorld()
      viewProjection.multiplyMatrices((camera as any).projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(viewProjection)

      forEachWaterRuntimeHandle((handle) => {
        handle.updateTransforms()
        const object = handle.getRenderObject()
        const mode = handle.getEffectiveMode()
        if (!object || !mode) {
          return
        }

        object.updateMatrixWorld(true)
        const geometry = (object as Mesh).geometry
        if (geometry && !geometry.boundingSphere) {
          geometry.computeBoundingSphere()
        }

        if (!isObjectVisibleForCamera(object, camera, scene, frustum, worldSphere, worldPosition)) {
          return
        }

        if (mode === 'dynamic') {
          handle.tickDynamic(safeDelta)
          return
        }

        handle.tickStatic(safeDelta, renderer, scene, camera)
      })
    },
    reset: () => {
      // Water component lifecycle owns registration cleanup.
    },
  }
}
