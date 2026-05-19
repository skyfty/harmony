import * as THREE from 'three'
import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const BILLBOARD_COMPONENT_TYPE = 'billboard'
const BILLBOARD_RESOLVER_KEY = '__harmonyResolveDisplayBoardMedia'

export interface BillboardComponentProps {
  assetId: string
  intrinsicWidth?: number
  intrinsicHeight?: number
  adaptation: 'fit' | 'fill'
}

type BillboardMediaResolver = (source: string) => Promise<BillboardResolvedMedia | null>

export interface BillboardResolvedMedia {
  url: string
  mimeType?: string | null
  dispose?: () => void
}

function resolvePositiveDimension(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return value > 0 ? value : undefined
}

export function clampBillboardComponentProps(
  props: Partial<BillboardComponentProps> | null | undefined,
): BillboardComponentProps {
  let assetId = typeof props?.assetId === 'string' ? props.assetId.trim() : ''
  if (assetId.startsWith('asset://')) {
    assetId = assetId.slice('asset://'.length)
  }
  const intrinsicWidth = resolvePositiveDimension(props?.intrinsicWidth)
  const intrinsicHeight = resolvePositiveDimension(props?.intrinsicHeight)
  const adaptation: BillboardComponentProps['adaptation'] = props?.adaptation === 'fill' ? 'fill' : 'fit'

  const result: BillboardComponentProps = { assetId, adaptation }
  if (intrinsicWidth !== undefined) {
    result.intrinsicWidth = intrinsicWidth
  }
  if (intrinsicHeight !== undefined) {
    result.intrinsicHeight = intrinsicHeight
  }
  return result
}

export function cloneBillboardComponentProps(props: BillboardComponentProps): BillboardComponentProps {
  const cloned: BillboardComponentProps = {
    assetId: props.assetId,
    adaptation: props.adaptation === 'fill' ? 'fill' : 'fit',
  }
  if (typeof props.intrinsicWidth === 'number') {
    cloned.intrinsicWidth = props.intrinsicWidth
  }
  if (typeof props.intrinsicHeight === 'number') {
    cloned.intrinsicHeight = props.intrinsicHeight
  }
  return cloned
}

type CylinderMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>
type PendingToken = { cancelled: boolean }

const BILLBOARD_BASE_POSITION_ATTRIBUTE = 'billboardBasePosition'

type BillboardShaderMaterial = THREE.ShaderMaterial & {
  uniforms: {
    map: { value: THREE.Texture | null }
    opacity: { value: number }
    cameraWorldPosition: { value: THREE.Vector3 }
  }
}

class BillboardComponent extends Component<BillboardComponentProps> {
  private currentTexture: THREE.Texture | null = null
  private currentCleanup: (() => void) | null = null
  private pending: PendingToken | null = null
  private readonly textureLoader = new THREE.TextureLoader()
  private baseMaterial: THREE.Material | THREE.Material[] | null = null
  private shaderMaterial: BillboardShaderMaterial | null = null

  constructor(context: ComponentRuntimeContext<BillboardComponentProps>) {
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
    this.restoreBaseMaterial()
  }

  private getResolver(): BillboardMediaResolver | null {
    const globalObject = (typeof globalThis !== 'undefined' ? globalThis : window) as
      | (typeof globalThis & { [BILLBOARD_RESOLVER_KEY]?: BillboardMediaResolver | null })
      | undefined
    const candidate = globalObject?.[BILLBOARD_RESOLVER_KEY]
    return typeof candidate === 'function' ? candidate : null
  }

  private async apply(): Promise<void> {
    const object = this.context.getRuntimeObject()
    if (!object || !this.context.isEnabled()) {
      return
    }
    const mesh = this.findCylinderMesh(object)
    if (!mesh) {
      return
    }

    const props = clampBillboardComponentProps(this.context.getProps())
    const assetId = props.assetId.trim()
    if (!assetId) {
      this.resetTexture(mesh)
      this.syncRuntimeMode(mesh)
      return
    }

    if (this.pending) {
      this.pending.cancelled = true
    }

    const resolver = this.getResolver()
    const media = resolver ? await resolver(assetId) : null
    if (!media) {
      this.resetTexture(mesh)
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
      this.applyTextureCropping(mesh, handle.texture, { width: handle.width, height: handle.height }, props.adaptation)
      this.syncRuntimeMode(mesh)
      this.currentCleanup = () => {
        handle.dispose()
        this.disposeTexture()
      }
      this.currentTexture = handle.texture
    } catch (error) {
      console.warn('[BillboardComponent] Failed to load media', error)
      media.dispose?.()
      this.resetTexture(mesh)
      this.syncRuntimeMode(mesh)
    } finally {
      if (this.pending === token) {
        this.pending = null
      }
    }
  }

  onUpdate(): void {
    const object = this.context.getRuntimeObject()
    if (!object) {
      return
    }
    const mesh = this.findCylinderMesh(object)
    if (!mesh) {
      return
    }
    this.syncRuntimeMode(mesh)
    if (!this.shaderMaterial) {
      return
    }
    const cameraWorldPosition = this.context.getFrameState().cameraWorldPosition
    if (!cameraWorldPosition) {
      return
    }
    this.shaderMaterial.uniforms.cameraWorldPosition.value.set(
      cameraWorldPosition.x,
      cameraWorldPosition.y,
      cameraWorldPosition.z,
    )
  }

  private findCylinderMesh(object: Object3D): CylinderMesh | null {
    const stack: Object3D[] = [object]
    while (stack.length) {
      const candidate = stack.pop()
      if (!candidate) {
        continue
      }
      if ((candidate as THREE.Mesh).isMesh) {
        const mesh = candidate as CylinderMesh
        const geometry = mesh.geometry
        if (geometry instanceof THREE.CylinderGeometry || geometry.type === 'CylinderGeometry') {
          return mesh
        }
      }
      if (candidate.children?.length) {
        stack.push(...candidate.children)
      }
    }
    return null
  }

  private resetTexture(mesh?: CylinderMesh): void {
    if (this.pending) {
      this.pending.cancelled = true
    }
    this.pending = null
    this.currentCleanup?.()
    this.currentCleanup = null
    this.disposeTexture()
    if (mesh) {
      this.assignTexture(mesh, null)
      this.syncRuntimeMode(mesh)
    }
  }

  private disposeTexture(): void {
    if (this.currentTexture) {
      this.currentTexture.dispose()
      this.currentTexture = null
    }
  }

  private assignTexture(mesh: CylinderMesh, texture: THREE.Texture | null): void {
    if (this.shaderMaterial) {
      this.shaderMaterial.uniforms.map.value = texture
      this.shaderMaterial.needsUpdate = true
    }
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

  private syncRuntimeMode(mesh: CylinderMesh): void {
    const cameraWorldPosition = this.context.getFrameState().cameraWorldPosition
    if (!this.context.isEnabled() || !cameraWorldPosition || !this.currentTexture) {
      this.restoreBaseMaterial(mesh)
      return
    }
    this.ensureShaderMaterial(mesh)
    if (!this.shaderMaterial) {
      return
    }
    this.shaderMaterial.uniforms.map.value = this.currentTexture
    this.shaderMaterial.uniforms.cameraWorldPosition.value.set(
      cameraWorldPosition.x,
      cameraWorldPosition.y,
      cameraWorldPosition.z,
    )
  }

  private ensureShaderMaterial(mesh: CylinderMesh): void {
    this.ensureGeometryAttribute(mesh)
    if (!this.baseMaterial) {
      this.baseMaterial = mesh.material
    }
    if (!this.shaderMaterial) {
      this.shaderMaterial = this.createShaderMaterial()
    }
    if (mesh.material !== this.shaderMaterial) {
      mesh.material = this.shaderMaterial
    }
  }

  private restoreBaseMaterial(mesh?: CylinderMesh): void {
    if (mesh && this.baseMaterial && mesh.material !== this.baseMaterial) {
      mesh.material = this.baseMaterial
      this.assignTexture(mesh, this.currentTexture)
    }
    if (this.shaderMaterial) {
      this.shaderMaterial.uniforms.map.value = null
      this.shaderMaterial.dispose()
      this.shaderMaterial = null
    }
    if (!mesh) {
      this.baseMaterial = null
    }
  }

  private ensureGeometryAttribute(mesh: CylinderMesh): void {
    const geometry = mesh.geometry
    if (geometry.getAttribute(BILLBOARD_BASE_POSITION_ATTRIBUTE)) {
      return
    }
    const positionAttribute = geometry.getAttribute('position')
    if (!positionAttribute) {
      return
    }
    geometry.setAttribute(
      BILLBOARD_BASE_POSITION_ATTRIBUTE,
      new THREE.Float32BufferAttribute(Array.from(positionAttribute.array as ArrayLike<number>), 3),
    )
  }

  private createShaderMaterial(): BillboardShaderMaterial {
    return new THREE.ShaderMaterial({
      name: 'HarmonyBillboardMaterial',
      uniforms: {
        map: { value: this.currentTexture },
        opacity: { value: 1 },
        cameraWorldPosition: { value: new THREE.Vector3(0, 0, 1) },
      },
      vertexShader: `
        attribute vec3 billboardBasePosition;
        uniform vec3 cameraWorldPosition;
        varying vec2 vUv;

        void main() {
          vec3 objectCenter = vec3(modelMatrix[3].x, modelMatrix[3].y, modelMatrix[3].z);
          vec3 toCamera = cameraWorldPosition - objectCenter;
          toCamera.y = 0.0;

          float facingLengthSq = dot(toCamera, toCamera);
          vec3 forward = facingLengthSq > 1e-6 ? normalize(toCamera) : vec3(0.0, 0.0, 1.0);
          vec3 right = normalize(vec3(forward.z, 0.0, -forward.x));
          vec3 up = vec3(0.0, 1.0, 0.0);

          float scaleX = length(modelMatrix[0].xyz);
          float scaleY = length(modelMatrix[1].xyz);
          float scaleZ = length(modelMatrix[2].xyz);
          vec3 scaledLocal = vec3(
            billboardBasePosition.x * scaleX,
            billboardBasePosition.y * scaleY,
            billboardBasePosition.z * scaleZ
          );

          vec3 worldPosition = objectCenter
            + right * scaledLocal.x
            + up * scaledLocal.y
            + forward * scaledLocal.z;

          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        uniform float opacity;
        varying vec2 vUv;

        void main() {
          vec4 color = texture2D(map, vUv);
          if (color.a <= 0.001) {
            discard;
          }
          gl_FragColor = vec4(color.rgb, color.a * opacity);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    }) as BillboardShaderMaterial
  }

  private applyTextureCropping(
    mesh: CylinderMesh,
    texture: THREE.Texture,
    mediaSize: { width: number; height: number } | null,
    adaptation: BillboardComponentProps['adaptation'],
  ): void {
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.center.set(0.5, 0.5)
    texture.rotation = 0

    if (!mediaSize || adaptation !== 'fill') {
      texture.repeat.set(1, 1)
      texture.offset.set(0, 0)
      texture.needsUpdate = true
      return
    }

    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox()
    }
    const bounds = mesh.geometry.boundingBox
    const width = Math.max((bounds?.max.x ?? 0.5) - (bounds?.min.x ?? -0.5), 1e-3) * Math.max(Math.abs(mesh.scale.x), 1e-3) * Math.PI
    const height = Math.max((bounds?.max.y ?? 0.6) - (bounds?.min.y ?? -0.6), 1e-3) * Math.max(Math.abs(mesh.scale.y), 1e-3)
    const boardAspect = width / Math.max(height, 1e-6)
    const mediaAspect = mediaSize.width / Math.max(mediaSize.height, 1e-6)
    const epsilon = 1e-4

    let repeatX = 1
    let repeatY = 1
    let offsetX = 0
    let offsetY = 0

    if (boardAspect > mediaAspect + epsilon) {
      repeatY = Math.max(1e-3, Math.min(1, mediaAspect / boardAspect))
      offsetY = (1 - repeatY) / 2
    } else if (boardAspect < mediaAspect - epsilon) {
      repeatX = Math.max(1e-3, Math.min(1, boardAspect / mediaAspect))
      offsetX = (1 - repeatX) / 2
    }

    texture.repeat.set(repeatX, repeatY)
    texture.offset.set(offsetX, offsetY)
    texture.needsUpdate = true
  }

  private async loadImage(resolved: BillboardResolvedMedia): Promise<{
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

  private async loadVideo(resolved: BillboardResolvedMedia): Promise<{
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

const billboardComponentDefinition: ComponentDefinition<BillboardComponentProps> = {
  type: BILLBOARD_COMPONENT_TYPE,
  label: 'Billboard',
  icon: 'mdi-billboard',
  order: 46,
  canAttach(node: SceneNode) {
    const type = (node.nodeType ?? '').toLowerCase()
    return type === 'cylinder'
  },
  createDefaultProps(_node: SceneNode) {
    return {
      assetId: '',
      intrinsicWidth: undefined,
      intrinsicHeight: undefined,
      adaptation: 'fit' as const,
    }
  },
  createInstance(context) {
    return new BillboardComponent(context)
  },
}

componentManager.registerDefinition(billboardComponentDefinition)

export function createBillboardComponentState(
  node: SceneNode,
  overrides?: Partial<BillboardComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<BillboardComponentProps> {
  const defaults = billboardComponentDefinition.createDefaultProps(node)
  const merged = clampBillboardComponentProps({
    assetId: overrides?.assetId ?? defaults.assetId,
    intrinsicWidth: overrides?.intrinsicWidth ?? defaults.intrinsicWidth,
    intrinsicHeight: overrides?.intrinsicHeight ?? defaults.intrinsicHeight,
    adaptation: overrides?.adaptation ?? defaults.adaptation,
  })
  return {
    id: options.id ?? '',
    type: BILLBOARD_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { billboardComponentDefinition }

declare global {
  interface GlobalThis {
    [BILLBOARD_RESOLVER_KEY]?: BillboardMediaResolver
  }
}