import * as THREE from 'three'
import type { GuideRouteDynamicMesh } from './core'

export type GuideRouteRenderOptions = {
  segmentThickness?: number
  segmentHeight?: number
  displayMode?: 'surface' | 'editor-overlay'
}

const DEFAULT_SEGMENT_THICKNESS = 0.4
const DEFAULT_SEGMENT_HEIGHT = 0.05
const EDITOR_OVERLAY_SEGMENT_THICKNESS = 0.7
const EDITOR_OVERLAY_SEGMENT_HEIGHT = 0.12
const EDITOR_OVERLAY_SEGMENT_RENDER_ORDER = 10010
const EDITOR_OVERLAY_SEGMENT_COLOR = 0xa8efff
const EDITOR_OVERLAY_SEGMENT_OPACITY = 0.42

export const GUIDE_ROUTE_EDITOR_RENDER_OPTIONS: Readonly<GuideRouteRenderOptions> = {
  displayMode: 'editor-overlay',
  segmentThickness: EDITOR_OVERLAY_SEGMENT_THICKNESS,
  segmentHeight: EDITOR_OVERLAY_SEGMENT_HEIGHT,
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, numeric))
}

function clearGroupContent(group: THREE.Group) {
  while (group.children.length) {
    const child = group.children.pop()!
    child.removeFromParent()
    child.traverse((entry) => {
      const mesh = entry as THREE.Mesh
      if ((mesh as any)?.isMesh) {
        const geometry = (mesh as any).geometry as THREE.BufferGeometry | undefined
        const material = (mesh as any).material as THREE.Material | THREE.Material[] | undefined
        geometry?.dispose?.()
        if (Array.isArray(material)) {
          material.forEach((m) => m?.dispose?.())
        } else {
          material?.dispose?.()
        }
      }
    })
  }
}

function sanitizeVertices(mesh: GuideRouteDynamicMesh): THREE.Vector3[] {
  const raw = Array.isArray(mesh.vertices) ? mesh.vertices : []
  const out: THREE.Vector3[] = []
  for (const entry of raw) {
    const v = (entry as { x?: unknown; y?: unknown; z?: unknown } | null | undefined) ?? undefined
    const x = typeof v?.x === 'number' && Number.isFinite(v.x) ? v.x : 0
    const y = typeof v?.y === 'number' && Number.isFinite(v.y) ? v.y : 0
    const z = typeof v?.z === 'number' && Number.isFinite(v.z) ? v.z : 0
    const vec = new THREE.Vector3(x, y, z)
    const prev = out[out.length - 1]
    if (prev && prev.distanceToSquared(vec) <= 1e-10) {
      continue
    }
    out.push(vec)
  }
  return out
}

function ensureSegmentsMesh(
  count: number,
  thickness: number,
  editorOverlay: boolean,
): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = editorOverlay
    ? createGuideRouteEditorOverlayMaterial()
    : new THREE.MeshStandardMaterial({ color: 0x3f464f, roughness: 0.62, metalness: 0.08 })
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(0, count))
  mesh.name = 'GuideRouteSegments'
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = !editorOverlay
  mesh.renderOrder = editorOverlay ? EDITOR_OVERLAY_SEGMENT_RENDER_ORDER : 0
  // Each instance uses matrix scaling; base geometry is unit cube.
  ;(mesh as any).userData = { ...(mesh as any).userData, guideRoute: true, thickness }
  if (editorOverlay) {
    applyGuideRouteEditorOverlay(mesh)
  }
  return mesh
}

function createGuideRouteEditorOverlayMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial()
  material.userData.guideRouteEditorOverlay = true
  return material
}

/**
 * Editor guide routes are a viewport annotation, not a scene surface. Keep
 * their material independent from node material overrides so material-only
 * scene patches cannot restore depth testing and let terrain/road meshes cover
 * the route again.
 */
export function applyGuideRouteEditorOverlay(mesh: THREE.Mesh): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  let material = materials.length === 1 && materials[0] instanceof THREE.MeshBasicMaterial
    && materials[0].userData?.guideRouteEditorOverlay === true
    ? materials[0]
    : null
  if (!material) {
    material = createGuideRouteEditorOverlayMaterial()
    mesh.material = material
  }

  material.color.setHex(EDITOR_OVERLAY_SEGMENT_COLOR)
  material.depthTest = false
  material.depthWrite = false
  material.transparent = true
  material.opacity = EDITOR_OVERLAY_SEGMENT_OPACITY
  material.toneMapped = false
  material.fog = false
  material.needsUpdate = true

  mesh.visible = true
  mesh.frustumCulled = false
  mesh.renderOrder = Math.max(mesh.renderOrder, EDITOR_OVERLAY_SEGMENT_RENDER_ORDER)
  mesh.userData.overrideMaterial = true
  mesh.userData.guideRouteEditorOverlay = true
}

function updateSegmentsInstances(mesh: THREE.InstancedMesh, vertices: THREE.Vector3[], width: number, height: number) {
  const segmentCount = Math.max(0, vertices.length - 1)
  const up = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3()
  const mid = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const matrix = new THREE.Matrix4()

  for (let i = 0; i < segmentCount; i += 1) {
    const a = vertices[i]!
    const b = vertices[i + 1]!
    dir.copy(b).sub(a)
    const length = dir.length()
    if (!(length > 1e-6)) {
      // Collapse degenerate segments.
      scale.set(0, 0, 0)
      mid.copy(a)
      quat.identity()
    } else {
      dir.multiplyScalar(1 / length)
      // Rotate unit Z axis to the segment direction.
      quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
      mid.copy(a).add(b).multiplyScalar(0.5)
      scale.set(width, height, length)
    }
    matrix.compose(mid, quat, scale)
    mesh.setMatrixAt(i, matrix)
  }

  mesh.count = segmentCount
  mesh.instanceMatrix.needsUpdate = true
  void up
}

function rebuildGuideRouteGroup(group: THREE.Group, definition: GuideRouteDynamicMesh, options: GuideRouteRenderOptions = {}) {
  clearGroupContent(group)

  const vertices = sanitizeVertices(definition)
  const editorOverlay = options.displayMode === 'editor-overlay'
  const thickness = clampNumber(
    options.segmentThickness,
    0.02,
    2.5,
    editorOverlay ? EDITOR_OVERLAY_SEGMENT_THICKNESS : DEFAULT_SEGMENT_THICKNESS,
  )
  const segmentHeight = clampNumber(
    options.segmentHeight,
    0.01,
    0.5,
    editorOverlay ? EDITOR_OVERLAY_SEGMENT_HEIGHT : DEFAULT_SEGMENT_HEIGHT,
  )
  const segments = ensureSegmentsMesh(Math.max(0, vertices.length - 1), thickness, editorOverlay)
  updateSegmentsInstances(segments, vertices, thickness, segmentHeight)

  group.add(segments)
}

export function createGuideRouteRenderGroup(
  definition: GuideRouteDynamicMesh,
  options: GuideRouteRenderOptions = {},
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'GuideRoute'
  rebuildGuideRouteGroup(group, definition, options)
  return group
}

export function createGuideRouteGroup(
  definition: GuideRouteDynamicMesh,
  options: GuideRouteRenderOptions = {},
): THREE.Group {
  return createGuideRouteRenderGroup(definition, options)
}

export function updateGuideRouteGroup(
  object: THREE.Object3D,
  definition: GuideRouteDynamicMesh,
  options: GuideRouteRenderOptions = {},
): boolean {
  const group = object as THREE.Group
  if (!(group as any)?.isGroup) {
    return false
  }
  rebuildGuideRouteGroup(group, definition, options)
  return true
}
