import * as THREE from 'three'

import { createPrimitiveMesh, type GeometryType, type LightNodeType } from '@schema'

export type ViewportPlacementTab = 'geometry' | 'light' | 'other'

type GeometryPlacementItem = {
  id: string
  label: string
  tab: 'geometry'
  geometryType: GeometryType
  thumbnailSvg: string
}

type LightPlacementItem = {
  id: string
  label: string
  tab: 'light'
  lightType: LightNodeType
  icon: string
}

type OtherPlacementItem = {
  id: string
  label: string
  tab: 'other'
  kind: 'guideboard' | 'view-point' | 'protagonist'
  icon: string
}

export type ViewportPlacementItem = GeometryPlacementItem | LightPlacementItem | OtherPlacementItem

export const VIEWPORT_PLACEMENT_TABS: Array<{ value: ViewportPlacementTab; label: string; icon: string }> = [
  { value: 'geometry', label: 'Geometry', icon: 'mdi-shape-outline' },
  { value: 'light', label: 'Light', icon: 'mdi-lightbulb-outline' },
  { value: 'other', label: 'Other', icon: 'mdi-dots-grid' },
]

export const VIEWPORT_GEOMETRY_ITEMS: GeometryPlacementItem[] = [
  {
    id: 'geometry-box',
    label: 'Box',
    tab: 'geometry',
    geometryType: 'Box',
    thumbnailSvg: '<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="9" width="24" height="24" rx="3" fill="currentColor" opacity="0.94"/><path d="M12 14h18" stroke="#fff" stroke-width="1.6" opacity="0.45"/><path d="M14 30h14" stroke="#fff" stroke-width="1.6" opacity="0.25"/></svg>',
  },
  {
    id: 'geometry-capsule',
    label: 'Capsule',
    tab: 'geometry',
    geometryType: 'Capsule',
    thumbnailSvg: '<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><rect x="14" y="7" width="14" height="28" rx="7" fill="currentColor" opacity="0.94"/></svg>',
  },
  {
    id: 'geometry-circle',
    label: 'Circle',
    tab: 'geometry',
    geometryType: 'Circle',
    thumbnailSvg: '<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><circle cx="21" cy="21" r="12" fill="currentColor" opacity="0.94"/></svg>',
  },
  {
    id: 'geometry-cylinder',
    label: 'Cylinder',
    tab: 'geometry',
    geometryType: 'Cylinder',
    thumbnailSvg: '<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><ellipse cx="21" cy="11" rx="10" ry="4.5" fill="currentColor" opacity="0.94"/><path d="M11 11v18c0 2.5 4.5 4.5 10 4.5s10-2 10-4.5V11" fill="currentColor" opacity="0.7"/><ellipse cx="21" cy="29" rx="10" ry="4.5" fill="currentColor" opacity="0.94"/></svg>',
  },
  {
    id: 'geometry-dodecahedron',
    label: 'Dodecahedron',
    tab: 'geometry',
    geometryType: 'Dodecahedron',
    thumbnailSvg: '<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><path d="M21 8l9 4 4 9-4 9-9 4-9-4-4-9 4-9 9-4z" fill="currentColor" opacity="0.92"/></svg>',
  },
  {
    id: 'geometry-icosahedron',
    label: 'Icosahedron',
    tab: 'geometry',
    geometryType: 'Icosahedron',
    thumbnailSvg: '<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><path d="M21 7l11 8-4 14H14l-4-14 11-8z" fill="currentColor" opacity="0.92"/></svg>',
  },
  {
    id: 'geometry-lathe',
    label: 'Lathe',
    tab: 'geometry',
    geometryType: 'Lathe',
    thumbnailSvg: '<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><path d="M18 9c6 0 8 4 8 8s-2 5-2 8 2 6 2 8h-8c1.5-2.2 2-4.7 2-8s-0.5-5.8-2-8c-1.3-1.9-2-4.1-2-8h2z" fill="currentColor" opacity="0.94"/></svg>',
  },
  {
    id: 'geometry-octahedron',
    label: 'Octahedron',
    tab: 'geometry',
    geometryType: 'Octahedron',
    thumbnailSvg: '<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><path d="M21 8l10 13-10 13-10-13L21 8z" fill="currentColor" opacity="0.92"/></svg>',
  },
  {
    id: 'geometry-plane',
    label: 'Plane',
    tab: 'geometry',
    geometryType: 'Plane',
    thumbnailSvg: '<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="14" width="26" height="14" rx="2" fill="currentColor" opacity="0.94" transform="skewX(-18)"/></svg>',
  },
  {
    id: 'geometry-ring',
    label: 'Ring',
    tab: 'geometry',
    geometryType: 'Ring',
    thumbnailSvg: '<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><circle cx="21" cy="21" r="12" fill="currentColor" opacity="0.94"/><circle cx="21" cy="21" r="6" fill="#fff" opacity="0.96"/></svg>',
  },
  {
    id: 'geometry-sphere',
    label: 'Sphere',
    tab: 'geometry',
    geometryType: 'Sphere',
    thumbnailSvg: '<svg width="42" height="42" viewBox="0 0 42 42" xmlns="http://www.w3.org/2000/svg"><circle cx="21" cy="21" r="12" fill="currentColor" opacity="0.94"/><path d="M9 21h24" stroke="#fff" stroke-width="1.4" opacity="0.32"/><ellipse cx="21" cy="21" rx="5" ry="12" stroke="#fff" stroke-width="1.4" opacity="0.32" fill="none"/></svg>',
  },
]

export const VIEWPORT_LIGHT_ITEMS: LightPlacementItem[] = [
  { id: 'light-ambient', label: 'Ambient Light', tab: 'light', lightType: 'Ambient', icon: 'mdi-white-balance-sunny' },
  { id: 'light-directional', label: 'Directional Light', tab: 'light', lightType: 'Directional', icon: 'mdi-arrow-top-right-thin-circle-outline' },
  { id: 'light-point', label: 'Point Light', tab: 'light', lightType: 'Point', icon: 'mdi-lightbulb-on-outline' },
  { id: 'light-spot', label: 'Spot Light', tab: 'light', lightType: 'Spot', icon: 'mdi-flashlight' },
  { id: 'light-hemisphere', label: 'Hemisphere Light', tab: 'light', lightType: 'Hemisphere', icon: 'mdi-weather-sunset-up' },
]

export const VIEWPORT_OTHER_ITEMS: OtherPlacementItem[] = [
  { id: 'other-guideboard', label: 'Guideboard', tab: 'other', kind: 'guideboard', icon: 'mdi-sign-direction' },
  { id: 'other-view-point', label: 'View Point', tab: 'other', kind: 'view-point', icon: 'mdi-map-marker-radius-outline' },
  { id: 'other-protagonist', label: 'Protagonist', tab: 'other', kind: 'protagonist', icon: 'mdi-account-outline' },
]

const LIGHT_PREVIEW_COLOR = 0xf8c14f
const VIEW_POINT_PREVIEW_COLOR = 0xff8a65
const previewBounds = new THREE.Box3()

function setPreviewMaterialState(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) {
      return
    }
    mesh.castShadow = false
    mesh.receiveShadow = false
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      if (!material) {
        return
      }
      material.transparent = true
      material.opacity = 0.8
      material.depthWrite = false
    })
  })
}

function groundPreviewObject(object: THREE.Object3D): void {
  object.updateMatrixWorld(true)
  previewBounds.setFromObject(object)
  if (!Number.isFinite(previewBounds.min.y)) {
    return
  }
  object.position.y -= previewBounds.min.y
  object.updateMatrixWorld(true)
}

function createLightPreview(lightType: LightNodeType): THREE.Object3D {
  const group = new THREE.Group()
  group.name = `${lightType} Light Preview`

  if (lightType === 'Ambient') {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 18, 14),
      new THREE.MeshBasicMaterial({ color: LIGHT_PREVIEW_COLOR }),
    )
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 18, 14),
      new THREE.MeshBasicMaterial({ color: LIGHT_PREVIEW_COLOR, transparent: true, opacity: 0.25 }),
    )
    group.add(halo, core)
    return group
  }

  if (lightType === 'Directional') {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.9, 10),
      new THREE.MeshBasicMaterial({ color: LIGHT_PREVIEW_COLOR }),
    )
    shaft.rotation.z = Math.PI * -0.5
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.34, 12),
      new THREE.MeshBasicMaterial({ color: LIGHT_PREVIEW_COLOR }),
    )
    head.rotation.z = Math.PI * -0.5
    head.position.x = 0.58
    group.add(shaft, head)
    return group
  }

  if (lightType === 'Point') {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 18, 14),
      new THREE.MeshBasicMaterial({ color: LIGHT_PREVIEW_COLOR }),
    )
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.035, 10, 24),
      new THREE.MeshBasicMaterial({ color: LIGHT_PREVIEW_COLOR }),
    )
    ring.rotation.x = Math.PI * 0.5
    group.add(ring, bulb)
    return group
  }

  if (lightType === 'Spot') {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.86, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: LIGHT_PREVIEW_COLOR, wireframe: true }),
    )
    cone.position.y = -0.35
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.2, 0.24, 12),
      new THREE.MeshBasicMaterial({ color: LIGHT_PREVIEW_COLOR }),
    )
    group.add(cone, head)
    return group
  }

  const upper = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
    new THREE.MeshBasicMaterial({ color: LIGHT_PREVIEW_COLOR }),
  )
  const lower = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 18, 14, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
    new THREE.MeshBasicMaterial({ color: 0x6db7ff }),
  )
  group.add(upper, lower)
  return group
}

function createGuideboardPreview(): THREE.Object3D {
  const root = new THREE.Group()
  root.name = 'Guideboard Preview'

  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  )
  board.position.y = 1.1
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.05, 1.2, 10),
    new THREE.MeshBasicMaterial({ color: 0x59636e }),
  )
  post.position.y = 0.6
  root.add(board, post)
  return root
}

function createViewPointPreview(): THREE.Object3D {
  const markerMesh = createPrimitiveMesh('Sphere', { color: VIEW_POINT_PREVIEW_COLOR, doubleSided: true })
  markerMesh.name = 'View Point Helper'
  markerMesh.castShadow = false
  markerMesh.receiveShadow = false
  markerMesh.renderOrder = 1000
  markerMesh.userData = {
    ...(markerMesh.userData ?? {}),
    editorOnly: true,
    ignoreGridSnapping: true,
    viewPoint: true,
  }
  const root = new THREE.Group()
  root.name = 'View Point Preview'
  root.add(markerMesh)
  return root
}

function createProtagonistPreview(): THREE.Object3D {
  const capsuleMesh = createPrimitiveMesh('Capsule', { color: 0xffffff, doubleSided: true })
  capsuleMesh.name = 'Protagonist Visual'
  capsuleMesh.castShadow = false
  capsuleMesh.receiveShadow = false
  capsuleMesh.position.y = 1
  const root = new THREE.Group()
  root.name = 'Protagonist Preview'
  root.add(capsuleMesh)
  return root
}

export function buildViewportPlacementPreview(item: ViewportPlacementItem): THREE.Object3D {
  let preview: THREE.Object3D

  if (item.tab === 'geometry') {
    preview = createPrimitiveMesh(item.geometryType, { doubleSided: true })
  } else if (item.tab === 'light') {
    preview = createLightPreview(item.lightType)
  } else if (item.kind === 'guideboard') {
    preview = createGuideboardPreview()
  } else if (item.kind === 'view-point') {
    preview = createViewPointPreview()
  } else {
    preview = createProtagonistPreview()
  }

  preview.position.set(0, 0, 0)
  preview.rotation.set(0, 0, 0)
  preview.scale.set(1, 1, 1)
  preview.updateMatrixWorld(true)

  groundPreviewObject(preview)
  setPreviewMaterialState(preview)

  return preview
}

export function getViewportPlacementKey(item: ViewportPlacementItem): string {
  return item.id
}