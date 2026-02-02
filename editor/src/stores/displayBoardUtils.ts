import * as THREE from 'three'
import type { Object3D } from 'three'

export const DISPLAY_BOARD_GEOMETRY_EPSILON = 1e-4

export type DisplayBoardDeps = {
  getRuntimeObject: (id: string) => Object3D | null
}

export function isPlaneGeometry(geometry: THREE.BufferGeometry): geometry is THREE.PlaneGeometry {
  return geometry instanceof THREE.PlaneGeometry || geometry.type === 'PlaneGeometry'
}

export function extractPlaneGeometrySize(geometry: THREE.BufferGeometry): { width: number; height: number } | null {
  const parameters = (geometry as unknown as { parameters?: { width?: number; height?: number } }).parameters
  if (Number.isFinite(parameters?.width) && Number.isFinite(parameters?.height)) {
    return { width: parameters!.width!, height: parameters!.height! }
  }

  if (!geometry.boundingBox) {
    geometry.computeBoundingBox()
  }
  const box = geometry.boundingBox
  if (!box) {
    return null
  }

  const width = box.max.x - box.min.x
  const height = box.max.y - box.min.y
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null
  }

  return { width: Math.abs(width), height: Math.abs(height) }
}

export function resolvePlaneGeometrySegments(geometry: THREE.BufferGeometry): { widthSegments: number; heightSegments: number } {
  const parameters = (geometry as unknown as { parameters?: { widthSegments?: number; heightSegments?: number } }).parameters
  const widthSegments = Number.isFinite(parameters?.widthSegments)
    ? Math.max(1, parameters!.widthSegments!)
    : 1
  const heightSegments = Number.isFinite(parameters?.heightSegments)
    ? Math.max(1, parameters!.heightSegments!)
    : 1
  return { widthSegments, heightSegments }
}

export function extractPrimaryTexture(material: THREE.Material | THREE.Material[]): THREE.Texture | null {
  const materials = Array.isArray(material) ? material : [material]
  for (const candidate of materials) {
    if (!candidate) {
      continue
    }
    const typed = candidate as THREE.Material & { map?: THREE.Texture | null }
    if (typed.map) {
      return typed.map
    }
  }
  return null
}

export function resolveDisplayBoardScaleLimits(mesh: THREE.Mesh): { maxWidth: number; maxHeight: number } {
  return {
    maxWidth: resolveScaleComponent(mesh.scale.x),
    maxHeight: resolveScaleComponent(mesh.scale.y),
  }
}

export function resolveScaleComponent(candidate: number): number {
  const magnitude = Math.abs(candidate)
  return magnitude > 1e-3 ? magnitude : 1e-3
}

export function convertWorldSizeToGeometry(
  mesh: THREE.Mesh,
  worldSize: { width: number; height: number },
): { width: number; height: number } {
  const scaleX = resolveScaleComponent(mesh.scale.x)
  const scaleY = resolveScaleComponent(mesh.scale.y)
  return {
    width: worldSize.width / scaleX,
    height: worldSize.height / scaleY,
  }
}

export function fitDisplayBoardMediaWithinLimits(
  limits: { maxWidth: number; maxHeight: number },
  mediaSize: { width: number; height: number },
): { width: number; height: number } {
  const maxWidth = Math.max(limits.maxWidth, 1e-3)
  const maxHeight = Math.max(limits.maxHeight, 1e-3)
  const aspect = mediaSize.width / Math.max(mediaSize.height, 1e-6)

  let width = maxWidth
  let height = width / Math.max(aspect, 1e-6)

  if (height > maxHeight) {
    height = maxHeight
    width = height * aspect
  }

  return {
    width: Math.max(width, 1e-3),
    height: Math.max(height, 1e-3),
  }
}

export function selectDisplayBoardMediaSize(
  props: { intrinsicWidth?: number; intrinsicHeight?: number },
  mediaSize: { width: number; height: number } | null,
): { width: number; height: number } | null {
  if (mediaSize && mediaSize.width > 0 && mediaSize.height > 0) {
    return mediaSize
  }
  const intrinsicWidth = typeof props.intrinsicWidth === 'number' && props.intrinsicWidth > 0 ? props.intrinsicWidth : null
  const intrinsicHeight = typeof props.intrinsicHeight === 'number' && props.intrinsicHeight > 0 ? props.intrinsicHeight : null
  if (!intrinsicWidth || !intrinsicHeight) {
    return null
  }
  return { width: intrinsicWidth, height: intrinsicHeight }
}

export function computeDisplayBoardPlaneSize(
  mesh: THREE.Mesh,
  props: { adaptation?: string; intrinsicWidth?: number; intrinsicHeight?: number; assetId?: string },
  mediaSize: { width: number; height: number } | null,
): { width: number; height: number } | null {
  const { maxWidth, maxHeight } = resolveDisplayBoardScaleLimits(mesh)
  const boardSize = {
    width: Math.max(maxWidth, 1e-3),
    height: Math.max(maxHeight, 1e-3),
  }
  const hasAsset = typeof props.assetId === 'string' && props.assetId.trim().length > 0
  if (!hasAsset) {
    return convertWorldSizeToGeometry(mesh, boardSize)
  }

  const adaptation = props.adaptation === 'fill' ? 'fill' : 'fit'
  if (adaptation === 'fill') {
    return convertWorldSizeToGeometry(mesh, boardSize)
  }

  const source = selectDisplayBoardMediaSize(props, mediaSize)
  if (!source) {
    const fallback = Math.max(Math.min(boardSize.width, boardSize.height), 1e-3)
    return convertWorldSizeToGeometry(mesh, { width: fallback, height: fallback })
  }

  const fitted = fitDisplayBoardMediaWithinLimits({ maxWidth, maxHeight }, source)
  return convertWorldSizeToGeometry(mesh, fitted)
}

export function resolveDisplayBoardMediaSize(
  props: { intrinsicWidth?: number; intrinsicHeight?: number; assetId?: string },
  mesh: THREE.Mesh,
): { width: number; height: number } | null {
  const width = typeof props.intrinsicWidth === 'number' && props.intrinsicWidth > 0 ? props.intrinsicWidth : null
  const height = typeof props.intrinsicHeight === 'number' && props.intrinsicHeight > 0 ? props.intrinsicHeight : null
  if (width && height) {
    return { width, height }
  }

  const texture = extractPrimaryTexture(mesh.material)
  if (!texture || !texture.image) {
    return null
  }

  const image = texture.image as {
    width?: number
    height?: number
    naturalWidth?: number
    naturalHeight?: number
    videoWidth?: number
    videoHeight?: number
  }
  const inferredWidth = image?.naturalWidth ?? image?.videoWidth ?? image?.width ?? 0
  const inferredHeight = image?.naturalHeight ?? image?.videoHeight ?? image?.height ?? 0
  if (inferredWidth > 0 && inferredHeight > 0) {
    return { width: inferredWidth, height: inferredHeight }
  }

  return null
}

export function findDisplayBoardPlaneMesh(root: Object3D): THREE.Mesh | null {
  const stack: Object3D[] = [root]
  while (stack.length) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    if ((current as THREE.Mesh).isMesh) {
      const mesh = current as THREE.Mesh
      if (isPlaneGeometry(mesh.geometry)) {
        return mesh
      }
    }
    if (current.children?.length) {
      stack.push(...current.children)
    }
  }
  return null
}

export function applyDisplayBoardComponentPropsToNode(
  node: any,
  props: any,
  deps: DisplayBoardDeps,
): boolean {
  const runtime = deps.getRuntimeObject(node.id)
  if (!runtime) {
    return false
  }

  const mesh = findDisplayBoardPlaneMesh(runtime)
  if (!mesh) {
    return false
  }

  const normalized = props
  const mediaSize = resolveDisplayBoardMediaSize(normalized, mesh as THREE.Mesh)
  const targetSize = computeDisplayBoardPlaneSize(mesh as THREE.Mesh, normalized, mediaSize)
  if (!targetSize) {
    return false
  }

  const currentSize = extractPlaneGeometrySize(mesh.geometry)
  if (
    currentSize &&
    Math.abs(currentSize.width - targetSize.width) < DISPLAY_BOARD_GEOMETRY_EPSILON &&
    Math.abs(currentSize.height - targetSize.height) < DISPLAY_BOARD_GEOMETRY_EPSILON
  ) {
    return false
  }

  const { widthSegments, heightSegments } = resolvePlaneGeometrySegments(mesh.geometry)
  const nextGeometry = new THREE.PlaneGeometry(
    targetSize.width,
    targetSize.height,
    widthSegments,
    heightSegments,
  )
  const previous = mesh.geometry
  mesh.geometry = nextGeometry
  previous?.dispose?.()
  return true
}

export function refreshDisplayBoardGeometry(node: any, deps: DisplayBoardDeps): void {
  if (!node) {
    return
  }
  const componentState = node.components?.['displayBoard']
  if (!componentState || componentState.enabled === false) {
    return
  }
  applyDisplayBoardComponentPropsToNode(node, componentState.props, deps)
}
