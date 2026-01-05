import type { Camera, Raycaster, Vector2 } from 'three'

export type NormalizedPointerGuard = {
  setRayFromEvent(event: { clientX: number; clientY: number }): boolean
}

export function createNormalizedPointerGuard(options: {
  getCanvas: () => HTMLCanvasElement | null
  getCamera: () => Camera | null
  raycaster: Raycaster
  pointer: Vector2
}): NormalizedPointerGuard {
  const { getCanvas, getCamera, raycaster, pointer } = options

  return {
    setRayFromEvent(event) {
      const canvas = getCanvas()
      const camera = getCamera()
      if (!canvas || !camera) {
        return false
      }

      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) {
        return false
      }

      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      return true
    },
  }
}
