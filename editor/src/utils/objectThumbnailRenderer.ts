import * as THREE from 'three'
import { disposeMaterialTextures } from '@schema/material'

export function fitThumbnailCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { padding?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) {
    camera.position.set(4, 3, 4)
    camera.lookAt(0, 0, 0)
    return
  }

  const center = box.getCenter(new THREE.Vector3())
  const corners: THREE.Vector3[] = [
    new THREE.Vector3(box.min.x, box.min.y, box.min.z),
    new THREE.Vector3(box.min.x, box.min.y, box.max.z),
    new THREE.Vector3(box.min.x, box.max.y, box.min.z),
    new THREE.Vector3(box.min.x, box.max.y, box.max.z),
    new THREE.Vector3(box.max.x, box.min.y, box.min.z),
    new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    new THREE.Vector3(box.max.x, box.max.y, box.min.z),
    new THREE.Vector3(box.max.x, box.max.y, box.max.z),
  ]

  const forward = new THREE.Vector3(1, 0.32, 1).normalize()
  const worldUp = new THREE.Vector3(0, 1, 0)
  const right = new THREE.Vector3().crossVectors(forward, worldUp)
  if (right.lengthSq() < 1e-6) {
    right.set(1, 0, 0)
  } else {
    right.normalize()
  }
  const up = new THREE.Vector3().crossVectors(right, forward).normalize()

  let halfWidth = 0
  let halfHeight = 0
  let halfDepth = 0
  corners.forEach((corner) => {
    const relative = corner.clone().sub(center)
    halfWidth = Math.max(halfWidth, Math.abs(relative.dot(right)))
    halfHeight = Math.max(halfHeight, Math.abs(relative.dot(up)))
    halfDepth = Math.max(halfDepth, Math.abs(relative.dot(forward)))
  })

  const vFov = THREE.MathUtils.degToRad(camera.fov)
  const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * camera.aspect)
  const distanceForWidth = halfWidth / Math.max(Math.tan(hFov * 0.5), 1e-5)
  const distanceForHeight = halfHeight / Math.max(Math.tan(vFov * 0.5), 1e-5)
  const fitDistance = Math.max(distanceForWidth, distanceForHeight, halfDepth + 0.1)
  const padding = typeof options.padding === 'number' && Number.isFinite(options.padding) ? options.padding : 1.08
  const distance = fitDistance * Math.max(0.1, padding)

  const size = box.getSize(new THREE.Vector3())
  const radius = Math.max(size.length() * 0.5, 0.1)
  camera.position.copy(center.clone().addScaledVector(forward, distance))
  camera.near = Math.max(0.01, distance - radius * 1.5)
  camera.far = Math.max(100, distance + radius * 1.5)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
}

export function disposeThumbnailObject(
  object: THREE.Object3D | null,
  options: { preserveMeshUserDataFlag?: string } = {},
): void {
  if (!object) {
    return
  }
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    if (options.preserveMeshUserDataFlag && (mesh.userData as Record<string, unknown> | undefined)?.[options.preserveMeshUserDataFlag]) {
      return
    }
    mesh.geometry?.dispose?.()
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => {
        disposeMaterialTextures(entry)
        entry?.dispose?.()
      })
      return
    }
    disposeMaterialTextures(material)
    material?.dispose?.()
  })
}

export function renderObjectThumbnailDataUrl(options: {
  object: THREE.Object3D
  width: number
  height: number
  cameraFitPadding?: number
}): string {
  const width = Math.max(1, Math.round(options.width))
  const height = Math.max(1, Math.round(options.height))

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.setPixelRatio(1)
  renderer.setSize(width, height, false)
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  scene.background = null
  const camera = new THREE.PerspectiveCamera(45, width / Math.max(height, 1), 0.1, 1000)

  const ambient = new THREE.AmbientLight(0xffffff, 1.5)
  const directional = new THREE.DirectionalLight(0xffffff, 2)
  directional.position.set(5, 10, 7.5)
  const fill = new THREE.DirectionalLight(0xffffff, 1)
  fill.position.set(-5, 2, -6)

  scene.add(ambient)
  scene.add(directional)
  scene.add(fill)
  scene.add(options.object)

  fitThumbnailCamera(camera, options.object, { padding: options.cameraFitPadding })
  renderer.render(scene, camera)

  const dataUrl = renderer.domElement.toDataURL('image/png')

  scene.remove(options.object)
  scene.remove(ambient)
  scene.remove(directional)
  scene.remove(fill)
  renderer.dispose()
  if (typeof renderer.forceContextLoss === 'function') {
    renderer.forceContextLoss()
  }

  return dataUrl
}