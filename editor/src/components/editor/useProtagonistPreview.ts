import * as THREE from 'three'
import type { Ref } from 'vue'

export type ProtagonistPreviewController = {
  render: () => void
  dispose: () => void
}

type Options = {
  getScene: () => THREE.Scene | null
  getRenderer: () => THREE.WebGLRenderer | null
  getTransformControls: () => { visible: boolean } | null
  objectMap: Map<string, THREE.Object3D>
  protagonistPreviewNodeId: Ref<string | null>
  showProtagonistPreview: Ref<boolean>
  widthPx: number
  heightPx: number
  marginPx: number
}

export function useProtagonistPreview(options: Options): ProtagonistPreviewController {
  const cameraOffset = new THREE.Vector3(0, 0.35, 0)
  const worldPosition = new THREE.Vector3()
  const target = new THREE.Vector3()
  const offsetTarget = new THREE.Vector3()
  const direction = new THREE.Vector3(0, 0, -1)
  const previewViewportState = new THREE.Vector4()
  const previewScissorState = new THREE.Vector4()
  const previewRenderSize = new THREE.Vector2()

  let previewCamera: THREE.PerspectiveCamera | null = null

  const ensureCamera = () => {
    if (previewCamera) {
      return
    }
    previewCamera = new THREE.PerspectiveCamera(
      55,
      options.widthPx / options.heightPx,
      0.1,
      2000,
    )
    previewCamera.name = 'ProtagonistPreviewCamera'
  }

  const syncCamera = (): boolean => {
    const scene = options.getScene()
    const renderer = options.getRenderer()
    if (!scene || !renderer) {
      return false
    }

    const nodeId = options.protagonistPreviewNodeId.value
    if (!nodeId) {
      return false
    }

    const nodeObject = options.objectMap.get(nodeId)
    if (!nodeObject) {
      return false
    }

    ensureCamera()
    if (!previewCamera) {
      return false
    }

    nodeObject.updateWorldMatrix(true, false)
    nodeObject.getWorldPosition(worldPosition)

    const cameraQuaternion = previewCamera.quaternion
    nodeObject.getWorldQuaternion(cameraQuaternion)

    offsetTarget.copy(cameraOffset).applyQuaternion(cameraQuaternion)
    previewCamera.position.copy(worldPosition).add(offsetTarget)

    target.copy(worldPosition)
    direction.set(1, 0, 0).applyQuaternion(cameraQuaternion)
    target.add(direction)

    previewCamera.lookAt(target)
    previewCamera.near = 0.1
    previewCamera.far = 2000
    previewCamera.updateMatrixWorld()

    return true
  }

  const render = () => {
    const scene = options.getScene()
    const renderer = options.getRenderer()
    if (!scene || !renderer || !options.showProtagonistPreview.value) {
      return
    }

    if (!syncCamera() || !previewCamera) {
      return
    }

    const transformControls = options.getTransformControls()
    const previousTransformVisible = transformControls?.visible ?? false
    if (transformControls) {
      transformControls.visible = false
    }

    renderer.getSize(previewRenderSize)

    const previewWidth = Math.round(Math.min(options.widthPx, previewRenderSize.x))
    const previewHeight = Math.round(Math.min(options.heightPx, previewRenderSize.y))
    const previewX = Math.round(Math.max(0, previewRenderSize.x - previewWidth - options.marginPx))
    const previewY = Math.round(options.marginPx)

    renderer.getViewport(previewViewportState)
    renderer.getScissor(previewScissorState)

    const previousScissorTest = renderer.getScissorTest()
    const previousAutoClear = renderer.autoClear

    renderer.clearDepth()
    renderer.setViewport(previewX, previewY, previewWidth, previewHeight)
    renderer.setScissor(previewX, previewY, previewWidth, previewHeight)
    renderer.setScissorTest(true)
    renderer.autoClear = false

    previewCamera.aspect = previewWidth / previewHeight
    previewCamera.updateProjectionMatrix()

    renderer.render(scene, previewCamera)

    renderer.setViewport(previewViewportState)
    renderer.setScissor(previewScissorState)
    renderer.setScissorTest(previousScissorTest)
    renderer.autoClear = previousAutoClear

    if (transformControls) {
      transformControls.visible = previousTransformVisible
    }
  }

  const dispose = () => {
    previewCamera = null
  }

  return {
    render,
    dispose,
  }
}
