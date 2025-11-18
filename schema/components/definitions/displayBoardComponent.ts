import * as THREE from 'three'
import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const DISPLAY_BOARD_COMPONENT_TYPE = 'displayBoard'
const DISPLAY_BOARD_RESOLVER_KEY = '__harmonyResolveDisplayBoardMedia'

export interface DisplayBoardComponentProps {
  assetId: string
  intrinsicWidth?: number
  intrinsicHeight?: number
}

type DisplayBoardMediaResolver = (source: string) => Promise<DisplayBoardResolvedMedia | null>

export interface DisplayBoardResolvedMedia {
  url: string
  mimeType?: string | null
  dispose?: () => void
}

export function clampDisplayBoardComponentProps(
  props: Partial<DisplayBoardComponentProps> | null | undefined,
): DisplayBoardComponentProps {
  const legacyUrl = typeof (props as { url?: unknown })?.url === 'string'
    ? ((props as { url?: string }).url ?? '').trim()
    : ''
  let assetId = typeof props?.assetId === 'string' && props.assetId.trim().length
    ? props.assetId.trim()
    : legacyUrl
  if (assetId.startsWith('asset://')) {
    assetId = assetId.slice('asset://'.length)
  }
  const intrinsicWidth = Number.isFinite(props?.intrinsicWidth) && (props?.intrinsicWidth ?? 0) > 0
    ? props!.intrinsicWidth!
    : undefined
  const intrinsicHeight = Number.isFinite(props?.intrinsicHeight) && (props?.intrinsicHeight ?? 0) > 0
    ? props!.intrinsicHeight!
    : undefined
  const result: DisplayBoardComponentProps = { assetId }
  if (intrinsicWidth !== undefined) {
    result.intrinsicWidth = intrinsicWidth
  }
  if (intrinsicHeight !== undefined) {
    result.intrinsicHeight = intrinsicHeight
  }
  return result
}

export function cloneDisplayBoardComponentProps(props: DisplayBoardComponentProps): DisplayBoardComponentProps {
  const cloned: DisplayBoardComponentProps = {
    assetId: props.assetId,
  }
  if (typeof props.intrinsicWidth === 'number') {
    cloned.intrinsicWidth = props.intrinsicWidth
  }
  if (typeof props.intrinsicHeight === 'number') {
    cloned.intrinsicHeight = props.intrinsicHeight
  }
  return cloned
}

type PlaneMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>

type PendingToken = { cancelled: boolean }

class DisplayBoardComponent extends Component<DisplayBoardComponentProps> {
  private currentTexture: THREE.Texture | null = null
  private currentCleanup: (() => void) | null = null
  private pending: PendingToken | null = null
  private readonly textureLoader = new THREE.TextureLoader()

  constructor(context: ComponentRuntimeContext<DisplayBoardComponentProps>) {
    super(context)
  }

  onRuntimeAttached(_object: Object3D | null): void {
    void this.apply()
  }

  onPropsUpdated(): void {
    void this.apply()
  }

  onEnabledChanged(enabled: boolean): void {
    if (!enabled) {
      this.resetTexture()
    }
    void this.apply()
  }

  onDestroy(): void {
    this.resetTexture()
  }

  private getResolver(): DisplayBoardMediaResolver | null {
    const globalObject = (typeof globalThis !== 'undefined' ? globalThis : window) as
      | (typeof globalThis & { [DISPLAY_BOARD_RESOLVER_KEY]?: DisplayBoardMediaResolver | null })
      | undefined
    const candidate = globalObject?.[DISPLAY_BOARD_RESOLVER_KEY]
    return typeof candidate === 'function' ? candidate : null
  }

  private async apply(): Promise<void> {
    const object = this.context.getRuntimeObject()
    if (!object || !this.context.isEnabled()) {
      return
    }
    const mesh = this.findPlaneMesh(object)
    if (!mesh) {
      return
    }

    const props = clampDisplayBoardComponentProps(this.context.getProps())
    const intrinsic = this.getIntrinsicSize(props)

    const assetId = props.assetId.trim()

    if (!assetId) {
      this.resetTexture(mesh)
      this.updateGeometry(mesh, props, intrinsic)
      return
    }

    if (intrinsic) {
      // Apply stored intrinsic dimensions immediately so the plane updates before media finishes loading.
      this.updateGeometry(mesh, props, intrinsic)
    }

    if (this.pending) {
      this.pending.cancelled = true
    }

    const resolver = this.getResolver()
    const media = resolver ? await resolver(assetId) : null
    if (!media) {
      this.resetTexture(mesh)
      this.updateGeometry(mesh, props, intrinsic)
      return
    }

    const token: PendingToken = { cancelled: false }
    this.pending = token

    try {
      const handle = media.mimeType && this.isVideoType(media.mimeType, media.url)
        ? await this.loadVideo(media)
        : await this.loadImage(media)

      if (token.cancelled) {
        handle.dispose()
        return
      }

      this.currentCleanup?.()
      this.assignTexture(mesh, handle.texture)
      this.updateGeometry(mesh, props, { width: handle.width, height: handle.height })
      this.currentCleanup = () => {
        handle.dispose()
        this.disposeTexture()
      }
      this.currentTexture = handle.texture
    } catch (error) {
      console.warn('[DisplayBoardComponent] Failed to load media', error)
      resolved?.dispose?.()
      this.resetTexture(mesh)
      this.updateGeometry(mesh, props, intrinsic)
    } finally {
      if (this.pending === token) {
        this.pending = null
      }
    }
  }

  private async loadVideo(resolved: string): Promise<{
    texture: THREE.Texture
    width: number
    height: number
    dispose: () => void
  }> {
    if (typeof document === 'undefined') {
      throw new Error('Video playback is not supported in this environment')
    }
    const video = document.createElement('video')
    video.src = resolved
    video.crossOrigin = 'anonymous'
    video.playsInline = true
    video.muted = true
    video.loop = true
    await new Promise<void>((resolve, reject) => {
      const handleLoaded = () => {
        cleanup()
        resolve()
      }
      const handleError = () => {
        cleanup()
        reject(new Error('Failed to load video source'))
      }
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', handleLoaded)
        video.removeEventListener('error', handleError)
      }
      video.addEventListener('loadedmetadata', handleLoaded, { once: true })
      video.addEventListener('error', handleError, { once: true })
    })
    try {
      await video.play()
    } catch (_error) {
      /* autoplay may be blocked; ignore */
    }
    const texture = new THREE.VideoTexture(video)
    texture.colorSpace = THREE.SRGBColorSpace
    const width = video.videoWidth || 1
    const height = video.videoHeight || 1
    const dispose = () => {
      texture.dispose()
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    return { texture, width, height, dispose }
  }

  private isVideoType(mimeType: string, url: string): boolean {
    const normalized = mimeType.toLowerCase()
    if (normalized.startsWith('video/')) {
      return true
    }
    if (normalized === 'application/octet-stream') {
      return this.hasVideoExtension(url)
    }
    return false
  }

  private hasVideoExtension(url: string): boolean {
    const lower = url.toLowerCase()
    return ['.mp4', '.webm', '.ogv', '.mov', '.m4v'].some((ext) => lower.includes(ext))
  }

  private resetTexture(mesh?: PlaneMesh): void {
    if (this.pending) {
      this.pending.cancelled = true
    }
    this.pending = null
    this.currentCleanup?.()
    this.currentCleanup = null
    this.disposeTexture()
    if (mesh) {
      this.assignTexture(mesh, null)
    }
  }

  private disposeTexture(): void {
    if (this.currentTexture) {
      this.currentTexture.dispose()
      this.currentTexture = null
    }
  }

  private assignTexture(mesh: PlaneMesh, texture: THREE.Texture | null): void {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      if (!material) {
        return
      }
      const typed = material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial | THREE.MeshPhongMaterial
      if ('map' in typed) {
        typed.map = texture
      }
      typed.needsUpdate = true
    })
  }

  private updateGeometry(
    mesh: PlaneMesh,
    props: DisplayBoardComponentProps,
    mediaSize: { width: number; height: number } | null,
  ): void {
    const { widthSegments, heightSegments } = this.resolveGeometrySegments(mesh.geometry)
    const targetSize = this.computeTargetSize(mesh, props, mediaSize)
    if (!targetSize) {
      return
    }
    const previous = mesh.geometry
    const geometry = new THREE.PlaneGeometry(targetSize.width, targetSize.height, widthSegments, heightSegments)
    mesh.geometry = geometry
    previous?.dispose?.()
  }

  private computeTargetSize(
    mesh: PlaneMesh,
    props: DisplayBoardComponentProps,
    mediaSize: { width: number; height: number } | null,
  ): { width: number; height: number } | null {
    const { maxWidth, maxHeight } = this.resolveScaleLimits(mesh)
    const intrinsic = this.getIntrinsicSize(props)
    const sourceSize = mediaSize && mediaSize.width > 0 && mediaSize.height > 0
      ? mediaSize
      : intrinsic

    if (!sourceSize || sourceSize.width <= 0 || sourceSize.height <= 0) {
      const fallback = Math.min(maxWidth, maxHeight)
      return this.convertWorldSizeToGeometry(mesh, { width: fallback, height: fallback })
    }

    const aspect = sourceSize.width / Math.max(sourceSize.height, 1e-6)
    let width = maxWidth
    let height = width / Math.max(aspect, 1e-6)
    if (height > maxHeight) {
      height = maxHeight
      width = height * aspect
    }
    width = Math.max(1e-3, width)
    height = Math.max(1e-3, height)
    return this.convertWorldSizeToGeometry(mesh, { width, height })
  }

  private resolveScaleLimits(mesh: PlaneMesh): { maxWidth: number; maxHeight: number } {
    return {
      maxWidth: this.resolveScaleComponent(mesh.scale.x),
      maxHeight: this.resolveScaleComponent(mesh.scale.y),
    }
  }

  private resolveScaleComponent(value: number | undefined): number {
    const magnitude = Math.abs(value ?? 1)
    return magnitude > 1e-3 ? magnitude : 1e-3
  }

  private convertWorldSizeToGeometry(
    mesh: PlaneMesh,
    worldSize: { width: number; height: number },
  ): { width: number; height: number } {
    const scaleX = this.resolveScaleComponent(mesh.scale.x)
    const scaleY = this.resolveScaleComponent(mesh.scale.y)
    return {
      width: worldSize.width / scaleX,
      height: worldSize.height / scaleY,
    }
  }

  private resolveGeometrySegments(geometry: THREE.BufferGeometry): { widthSegments: number; heightSegments: number } {
    const parameters = (geometry as unknown as { parameters?: { widthSegments?: number; heightSegments?: number } }).parameters
    const widthSegments = Number.isFinite(parameters?.widthSegments) ? Math.max(1, parameters!.widthSegments!) : 1
    const heightSegments = Number.isFinite(parameters?.heightSegments) ? Math.max(1, parameters!.heightSegments!) : 1
    return { widthSegments, heightSegments }
  }

  private findPlaneMesh(object: Object3D): PlaneMesh | null {
    const stack: Object3D[] = [object]
    while (stack.length) {
      const candidate = stack.pop()
      if (!candidate) {
        continue
      }
      if ((candidate as THREE.Mesh).isMesh) {
        const mesh = candidate as PlaneMesh
        const geometry = mesh.geometry
        if (this.isPlaneGeometry(geometry)) {
          return mesh
        }
      }
      if (candidate.children?.length) {
        stack.push(...candidate.children)
      }
    }
    return null
  }

  private isPlaneGeometry(geometry: THREE.BufferGeometry): geometry is THREE.PlaneGeometry {
    return geometry instanceof THREE.PlaneGeometry || geometry.type === 'PlaneGeometry'
  }

  private async loadImage(resolved: string): Promise<{
    texture: THREE.Texture
    width: number
    height: number
    dispose: () => void
  }> {
    const texture = await this.textureLoader.loadAsync(resolved)
    texture.colorSpace = THREE.SRGBColorSpace
    const image = texture.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number }
    const width = image?.naturalWidth ?? image?.width ?? 1
    const height = image?.naturalHeight ?? image?.height ?? 1
    const dispose = () => {
      texture.dispose()
    }
    return { texture, width, height, dispose }
  }

  private isLikelyDirectUrl(value: string): boolean {
    const lower = value.toLowerCase()
    return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('data:')
  }

  private getIntrinsicSize(props: DisplayBoardComponentProps): { width: number; height: number } | null {
    const width = typeof props.intrinsicWidth === 'number' && props.intrinsicWidth > 0 ? props.intrinsicWidth : null
    const height = typeof props.intrinsicHeight === 'number' && props.intrinsicHeight > 0 ? props.intrinsicHeight : null
    if (!width || !height) {
      return null
    }
    return { width, height }
  }
}

const displayBoardComponentDefinition: ComponentDefinition<DisplayBoardComponentProps> = {
  type: DISPLAY_BOARD_COMPONENT_TYPE,
  label: 'Display Board',
  icon: 'mdi-monitor',
  order: 45,
  canAttach(node: SceneNode) {
    const type = (node.nodeType ?? '').toLowerCase()
    return type === 'plane'
  },
  createDefaultProps(_node: SceneNode) {
    return {
      assetId: '',
      intrinsicWidth: undefined,
      intrinsicHeight: undefined,
    }
  },
  createInstance(context) {
    return new DisplayBoardComponent(context)
  },
}

componentManager.registerDefinition(displayBoardComponentDefinition)

export function createDisplayBoardComponentState(
  node: SceneNode,
  overrides?: Partial<DisplayBoardComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<DisplayBoardComponentProps> {
  const defaults = displayBoardComponentDefinition.createDefaultProps(node)
  const merged = clampDisplayBoardComponentProps({
    assetId: overrides?.assetId ?? defaults.assetId,
    intrinsicWidth: overrides?.intrinsicWidth ?? defaults.intrinsicWidth,
    intrinsicHeight: overrides?.intrinsicHeight ?? defaults.intrinsicHeight,
  })
  return {
    id: options.id ?? '',
    type: DISPLAY_BOARD_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { displayBoardComponentDefinition }

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface GlobalThis {
    [DISPLAY_BOARD_RESOLVER_KEY]?: DisplayBoardMediaResolver | null
  }
}
