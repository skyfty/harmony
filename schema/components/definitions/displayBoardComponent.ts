import * as THREE from 'three'
import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const DISPLAY_BOARD_COMPONENT_TYPE = 'displayBoard'
export const DISPLAY_BOARD_DEFAULT_MAX_WIDTH = 0.5
export const DISPLAY_BOARD_DEFAULT_MAX_HEIGHT = 0.5
export const DISPLAY_BOARD_DEFAULT_BACKGROUND_COLOR = '#FFFFFF'

const DISPLAY_BOARD_RESOLVER_KEY = '__harmonyResolveDisplayBoardMedia'

export interface DisplayBoardComponentProps {
  maxWidth: number
  maxHeight: number
  backgroundColor: string
  url: string
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
  const maxWidth = Number.isFinite(props?.maxWidth) && (props?.maxWidth ?? 0) > 0
    ? Math.min(100, props!.maxWidth!)
    : DISPLAY_BOARD_DEFAULT_MAX_WIDTH
  const maxHeight = Number.isFinite(props?.maxHeight) && (props?.maxHeight ?? 0) > 0
    ? Math.min(100, props!.maxHeight!)
    : DISPLAY_BOARD_DEFAULT_MAX_HEIGHT
  const backgroundColor = typeof props?.backgroundColor === 'string' && props.backgroundColor.trim().length
    ? props.backgroundColor.trim()
    : DISPLAY_BOARD_DEFAULT_BACKGROUND_COLOR
  const url = typeof props?.url === 'string' ? props.url.trim() : ''
  return { maxWidth, maxHeight, backgroundColor, url }
}

export function cloneDisplayBoardComponentProps(props: DisplayBoardComponentProps): DisplayBoardComponentProps {
  return {
    maxWidth: props.maxWidth,
    maxHeight: props.maxHeight,
    backgroundColor: props.backgroundColor,
    url: props.url,
  }
}

type PlaneMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>

type PendingToken = { cancelled: boolean }

class DisplayBoardComponent extends Component<DisplayBoardComponentProps> {
  private currentTexture: THREE.Texture | null = null
  private currentCleanup: (() => void) | null = null
  private pending: PendingToken | null = null
  private readonly textureLoader = new THREE.TextureLoader()
  private readonly tempColor = new THREE.Color(DISPLAY_BOARD_DEFAULT_BACKGROUND_COLOR)

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
    this.applyBackgroundColor(mesh, props.backgroundColor)

    const source = props.url.trim()

    if (!source) {
      this.resetTexture(mesh)
      this.updateGeometry(mesh, props, null)
      return
    }

    if (this.pending) {
      this.pending.cancelled = true
    }

    const resolver = this.getResolver()
    const resolved = resolver ? await resolver(source) : { url: source }
    if (!resolved) {
      this.resetTexture(mesh)
      this.updateGeometry(mesh, props, null)
      return
    }

    const token: PendingToken = { cancelled: false }
    this.pending = token

    try {
      const handle = resolved.mimeType && this.isVideoType(resolved.mimeType, resolved.url)
        ? await this.loadVideo(resolved)
        : await this.loadImage(resolved)

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
      resolved.dispose?.()
      this.resetTexture(mesh)
      this.updateGeometry(mesh, props, null)
    } finally {
      if (this.pending === token) {
        this.pending = null
      }
    }
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
    const targetSize = this.computeTargetSize(props, mediaSize)
    if (!targetSize) {
      return
    }
    const previous = mesh.geometry
    const geometry = new THREE.PlaneGeometry(targetSize.width, targetSize.height, widthSegments, heightSegments)
    mesh.geometry = geometry
    previous?.dispose?.()
  }

  private computeTargetSize(
    props: DisplayBoardComponentProps,
    mediaSize: { width: number; height: number } | null,
  ): { width: number; height: number } | null {
    const maxWidth = Math.max(1e-3, props.maxWidth)
    const maxHeight = Math.max(1e-3, props.maxHeight)
    if (!mediaSize || mediaSize.width <= 0 || mediaSize.height <= 0) {
      const base = Math.min(maxWidth, maxHeight)
      return { width: base, height: base }
    }

    const aspect = mediaSize.width / mediaSize.height
    let width = maxWidth
    let height = width / Math.max(aspect, 1e-6)
    if (height > maxHeight) {
      height = maxHeight
      width = height * aspect
    }
    width = Math.max(1e-3, width)
    height = Math.max(1e-3, height)
    return { width, height }
  }

  private resolveGeometrySegments(geometry: THREE.BufferGeometry): { widthSegments: number; heightSegments: number } {
    const parameters = (geometry as unknown as { parameters?: { widthSegments?: number; heightSegments?: number } }).parameters
    const widthSegments = Number.isFinite(parameters?.widthSegments) ? Math.max(1, parameters!.widthSegments!) : 1
    const heightSegments = Number.isFinite(parameters?.heightSegments) ? Math.max(1, parameters!.heightSegments!) : 1
    return { widthSegments, heightSegments }
  }

  private applyBackgroundColor(mesh: PlaneMesh, color: string): void {
    try {
      this.tempColor.set(color)
    } catch (_error) {
      this.tempColor.set(DISPLAY_BOARD_DEFAULT_BACKGROUND_COLOR)
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materials.forEach((material) => {
      if (!material) {
        return
      }
      const typed = material as THREE.Material & { color?: THREE.Color }
      if (typed.color) {
        typed.color.copy(this.tempColor)
        typed.needsUpdate = true
      }
    })
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

  private async loadImage(resolved: DisplayBoardResolvedMedia): Promise<{
    texture: THREE.Texture
    width: number
    height: number
    dispose: () => void
  }> {
    const texture = await this.textureLoader.loadAsync(resolved.url)
    texture.colorSpace = THREE.SRGBColorSpace
    const image = texture.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number }
    const width = image?.naturalWidth ?? image?.width ?? 1
    const height = image?.naturalHeight ?? image?.height ?? 1
    const dispose = () => {
      texture.dispose()
      resolved.dispose?.()
    }
    return { texture, width, height, dispose }
  }

  private async loadVideo(resolved: DisplayBoardResolvedMedia): Promise<{
    texture: THREE.Texture
    width: number
    height: number
    dispose: () => void
  }> {
    if (typeof document === 'undefined') {
      throw new Error('Video playback is not supported in this environment')
    }
    const video = document.createElement('video')
    video.src = resolved.url
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
      resolved.dispose?.()
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
}

const displayBoardComponentDefinition: ComponentDefinition<DisplayBoardComponentProps> = {
  type: DISPLAY_BOARD_COMPONENT_TYPE,
  label: 'Display Board',
  icon: 'mdi-monitor',
  order: 45,
  inspector: [
    {
      id: 'layout',
      label: 'Layout',
      fields: [
        { kind: 'number', key: 'maxWidth', label: 'Max Width (m)', min: 0.01, step: 0.05 },
        { kind: 'number', key: 'maxHeight', label: 'Max Height (m)', min: 0.01, step: 0.05 },
      ],
    },
    {
      id: 'appearance',
      label: 'Appearance',
      fields: [
        { kind: 'text', key: 'backgroundColor', label: 'Background Color' },
        { kind: 'text', key: 'url', label: 'Media URL' },
      ],
    },
  ],
  canAttach(node: SceneNode) {
    const type = (node.nodeType ?? '').toLowerCase()
    return type === 'plane'
  },
  createDefaultProps(_node: SceneNode) {
    return {
      maxWidth: DISPLAY_BOARD_DEFAULT_MAX_WIDTH,
      maxHeight: DISPLAY_BOARD_DEFAULT_MAX_HEIGHT,
      backgroundColor: DISPLAY_BOARD_DEFAULT_BACKGROUND_COLOR,
      url: '',
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
    maxWidth: overrides?.maxWidth ?? defaults.maxWidth,
    maxHeight: overrides?.maxHeight ?? defaults.maxHeight,
    backgroundColor: overrides?.backgroundColor ?? defaults.backgroundColor,
    url: overrides?.url ?? defaults.url,
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
