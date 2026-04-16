import * as THREE from 'three'
import type { FloorDynamicMesh, SceneMaterial, SceneMaterialTextureRef } from '@schema'
import { createFloorGroup } from '@schema/floorMesh'
import { applyMaterialOverrides, type MaterialTextureAssignmentOptions } from '@schema/material'
import { buildFloorNodeMaterialsFromPreset } from '@/utils/floorPresetNodeMaterials'
import type { FloorPresetData } from '@/utils/floorPreset'

const FLOOR_PRESET_RECT_SIZE_METERS = 10

type RenderFloorPresetThumbnailOptions = {
  preset: FloorPresetData
  sharedMaterials: readonly SceneMaterial[]
  resolveTexture: (ref: SceneMaterialTextureRef) => Promise<THREE.Texture | null>
  width: number
  height: number
}

function buildFloorPresetThumbnailDefinition(preset: FloorPresetData): FloorDynamicMesh {
  const half = FLOOR_PRESET_RECT_SIZE_METERS * 0.5
  return {
    type: 'Floor',
    vertices: [
      [-half, -half] as [number, number],
      [-half, half] as [number, number],
      [half, half] as [number, number],
      [half, -half] as [number, number],
    ],
    topBottomMaterialConfigId: preset.materialConfig.topBottomMaterialConfigId,
    sideMaterialConfigId: preset.materialConfig.sideMaterialConfigId,
    smooth: preset.floorProps.smooth,
    thickness: preset.floorProps.thickness,
    sideUvScale: {
      x: preset.floorProps.sideUvScale.x,
      y: preset.floorProps.sideUvScale.y,
    },
  }
}

function disposeObject(object: THREE.Object3D | null): void {
  if (!object) {
    return
  }
  object.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh
    if (!mesh?.isMesh) {
      return
    }
    mesh.geometry?.dispose?.()
    const material = mesh.material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry?.dispose?.())
    } else {
      material?.dispose?.()
    }
  })
}

function fitCamera(camera: THREE.PerspectiveCamera, object: THREE.Object3D): void {
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
  const margin = 1.08
  const distance = fitDistance * margin

  const size = box.getSize(new THREE.Vector3())
  const radius = Math.max(size.length() * 0.5, 0.1)
  const cameraPosition = center.clone().addScaledVector(forward, distance)
  camera.position.copy(cameraPosition)
  camera.near = Math.max(0.01, distance - radius * 1.5)
  camera.far = Math.max(100, distance + radius * 1.5)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
}

export async function renderFloorPresetThumbnailDataUrl(options: RenderFloorPresetThumbnailOptions): Promise<string | null> {
  const width = Math.max(1, Math.round(options.width))
  const height = Math.max(1, Math.round(options.height))

  const definition = buildFloorPresetThumbnailDefinition(options.preset)
  const group = createFloorGroup(definition)

  const nodeMaterials = buildFloorNodeMaterialsFromPreset(options.preset, options.sharedMaterials)
  const materialOverrideOptions: MaterialTextureAssignmentOptions = {
    resolveTexture: options.resolveTexture,
  }
  if (nodeMaterials.length > 0) {
    applyMaterialOverrides(group, nodeMaterials, materialOverrideOptions)
  }

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
  scene.add(group)

  fitCamera(camera, group)
  renderer.render(scene, camera)

  const dataUrl = renderer.domElement.toDataURL('image/png')

  scene.remove(group)
  scene.remove(ambient)
  scene.remove(directional)
  scene.remove(fill)
  disposeObject(group)

  renderer.dispose()
  if (typeof renderer.forceContextLoss === 'function') {
    renderer.forceContextLoss()
  }

  return dataUrl
}
