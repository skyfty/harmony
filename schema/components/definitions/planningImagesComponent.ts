import * as THREE from 'three'
import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import {
  componentManager,
  type ComponentDefinition,
  COMPONENT_ARTIFACT_COMPONENT_ID_KEY,
  COMPONENT_ARTIFACT_KEY,
  COMPONENT_ARTIFACT_NODE_ID_KEY,
} from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const PLANNING_IMAGES_COMPONENT_TYPE = 'planningImages'
export const PLANNING_IMAGES_RESOLVER_KEY = '__harmonyResolvePlanningImageMedia'

export interface PlanningImageDisplayEntry {
  id: string
  name: string
  imageHash?: string
  sourceUrl?: string
  mimeType?: string | null
  filename?: string | null
  position: { x: number; y: number; z: number }
  size: { width: number; height: number }
  visible: boolean
  opacity: number
}

export interface PlanningImagesComponentProps {
  images: PlanningImageDisplayEntry[]
}

export interface PlanningImageResolvedMedia {
  url: string
  mimeType?: string | null
  dispose?: () => void
}

export type PlanningImageMediaResolver = (
  image: PlanningImageDisplayEntry,
) => Promise<PlanningImageResolvedMedia | null>

function clampOpacity(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return 1
  }
  return Math.min(1, Math.max(0, numeric))
}

function clampVisible(value: unknown): boolean {
  return value !== false
}

function clampFinite(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function clampPositive(value: unknown, fallback = 1e-3): number {
  return Math.max(1e-3, Math.abs(clampFinite(value, fallback)))
}

function clampString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampEntry(entry: Partial<PlanningImageDisplayEntry> | null | undefined, index: number): PlanningImageDisplayEntry | null {
  const id = clampString(entry?.id) || `planning-image-${index + 1}`
  const imageHash = clampString(entry?.imageHash)
  const sourceUrl = clampString(entry?.sourceUrl)
  if (!imageHash && !sourceUrl) {
    return null
  }
  return {
    id,
    name: clampString(entry?.name) || `Planning Image ${index + 1}`,
    imageHash: imageHash || undefined,
    sourceUrl: sourceUrl || undefined,
    mimeType: clampString(entry?.mimeType) || undefined,
    filename: clampString(entry?.filename) || undefined,
    position: {
      x: clampFinite(entry?.position?.x, 0),
      y: clampFinite(entry?.position?.y, 0),
      z: clampFinite(entry?.position?.z, 0),
    },
    size: {
      width: clampPositive(entry?.size?.width, 1e-3),
      height: clampPositive(entry?.size?.height, 1e-3),
    },
    visible: clampVisible(entry?.visible),
    opacity: clampOpacity(entry?.opacity),
  }
}

export function clampPlanningImagesComponentProps(
  props: Partial<PlanningImagesComponentProps> | null | undefined,
): PlanningImagesComponentProps {
  const rawImages = Array.isArray(props?.images) ? props.images : []
  const images = rawImages
    .map((entry, index) => clampEntry(entry, index))
    .filter((entry): entry is PlanningImageDisplayEntry => Boolean(entry))
  return { images }
}

export function clonePlanningImageDisplayEntry(entry: PlanningImageDisplayEntry): PlanningImageDisplayEntry {
  return {
    id: entry.id,
    name: entry.name,
    imageHash: entry.imageHash,
    sourceUrl: entry.sourceUrl,
    mimeType: entry.mimeType,
    filename: entry.filename,
    position: { ...entry.position },
    size: { ...entry.size },
    visible: entry.visible !== false,
    opacity: clampOpacity(entry.opacity),
  }
}

export function clonePlanningImagesComponentProps(props: PlanningImagesComponentProps): PlanningImagesComponentProps {
  return {
    images: Array.isArray(props.images) ? props.images.map((entry) => clonePlanningImageDisplayEntry(entry)) : [],
  }
}

type PendingBuildToken = { cancelled: boolean }

class PlanningImagesComponent extends Component<PlanningImagesComponentProps> {
  private readonly textureLoader = new THREE.TextureLoader()
  private artifactGroup: THREE.Group | null = null
  private cleanupTasks: Array<() => void> = []
  private pendingBuild: PendingBuildToken | null = null

  constructor(context: ComponentRuntimeContext<PlanningImagesComponentProps>) {
    super(context)
  }

  onRuntimeAttached(_object: Object3D | null): void {
    void this.rebuild()
  }

  onPropsUpdated(): void {
    void this.rebuild()
  }

  onEnabledChanged(): void {
    void this.rebuild()
  }

  onDestroy(): void {
    this.clearRuntimeArtifacts()
    const object = this.context.getRuntimeObject()
    if (object) {
      object.visible = false
    }
  }

  private getResolver(): PlanningImageMediaResolver | null {
    const globalObject = (typeof globalThis !== 'undefined' ? globalThis : window) as
      | (typeof globalThis & { [PLANNING_IMAGES_RESOLVER_KEY]?: PlanningImageMediaResolver | null })
      | undefined
    const candidate = globalObject?.[PLANNING_IMAGES_RESOLVER_KEY]
    return typeof candidate === 'function' ? candidate : null
  }

  private async rebuild(): Promise<void> {
    const object = this.context.getRuntimeObject()
    this.clearRuntimeArtifacts()
    if (!object || !this.context.isEnabled()) {
      if (object) {
        object.visible = false
      }
      return
    }

    const props = clampPlanningImagesComponentProps(this.context.getProps())
    object.visible = true
    if (!props.images.length) {
      return
    }

    const token: PendingBuildToken = { cancelled: false }
    this.pendingBuild = token
    const group = this.createArtifactGroup()
    this.artifactGroup = group
    object.add(group)

    const resolver = this.getResolver()
    await Promise.all(props.images.map(async (entry, index) => {
      try {
        const resolved = await this.resolveMedia(entry, resolver)
        if (!resolved) {
          return
        }
        const texture = await this.textureLoader.loadAsync(resolved.url)
        if (token.cancelled) {
          texture.dispose()
          resolved.dispose?.()
          return
        }

        texture.colorSpace = THREE.SRGBColorSpace
        const material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          map: texture,
          transparent: true,
          opacity: entry.opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        })
        const geometry = new THREE.PlaneGeometry(entry.size.width, entry.size.height)
        const mesh = new THREE.Mesh(geometry, material)
        mesh.name = entry.name || `Planning Image ${index + 1}`
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(entry.position.x, entry.position.y, entry.position.z)
        mesh.visible = entry.visible !== false
        mesh.renderOrder = 100 + index
        this.markArtifact(mesh)
        group.add(mesh)
        this.cleanupTasks.push(() => {
          geometry.dispose()
          material.dispose()
          texture.dispose()
          resolved.dispose?.()
        })
      } catch (error) {
        console.warn('[PlanningImagesComponent] Failed to resolve planning image', entry, error)
      }
    }))
  }

  private async resolveMedia(
    entry: PlanningImageDisplayEntry,
    resolver: PlanningImageMediaResolver | null,
  ): Promise<PlanningImageResolvedMedia | null> {
    if (resolver) {
      const resolved = await resolver(entry)
      if (resolved) {
        return resolved
      }
    }
    const sourceUrl = clampString(entry.sourceUrl)
    if (!sourceUrl) {
      return null
    }
    return {
      url: sourceUrl,
      mimeType: entry.mimeType,
    }
  }

  private createArtifactGroup(): THREE.Group {
    const group = new THREE.Group()
    group.name = 'Planning Images'
    this.markArtifact(group)
    return group
  }

  private markArtifact(object: THREE.Object3D): void {
    object.userData = {
      ...(object.userData ?? {}),
      editorOnly: true,
      [COMPONENT_ARTIFACT_KEY]: true,
      [COMPONENT_ARTIFACT_NODE_ID_KEY]: this.context.nodeId,
      [COMPONENT_ARTIFACT_COMPONENT_ID_KEY]: this.context.componentId,
    }
  }

  private clearRuntimeArtifacts(): void {
    if (this.pendingBuild) {
      this.pendingBuild.cancelled = true
      this.pendingBuild = null
    }
    this.cleanupTasks.splice(0).forEach((dispose) => {
      try {
        dispose()
      } catch (error) {
        console.warn('[PlanningImagesComponent] Failed to dispose planning image resource', error)
      }
    })
    if (this.artifactGroup) {
      this.artifactGroup.parent?.remove(this.artifactGroup)
      this.artifactGroup.clear()
      this.artifactGroup = null
    }
  }
}

const planningImagesComponentDefinition: ComponentDefinition<PlanningImagesComponentProps> = {
  type: PLANNING_IMAGES_COMPONENT_TYPE,
  label: 'Planning Images',
  icon: 'mdi-image-multiple',
  order: 52,
  canAttach(node: SceneNode) {
    const userData = node.userData as Record<string, unknown> | null | undefined
    return node.editorFlags?.editorOnly === true
      && userData?.source === 'planning-conversion'
      && userData?.kind === 'image'
  },
  createDefaultProps(_node: SceneNode) {
    return { images: [] }
  },
  createInstance(context) {
    return new PlanningImagesComponent(context)
  },
}

componentManager.registerDefinition(planningImagesComponentDefinition)

export function createPlanningImagesComponentState(
  node: SceneNode,
  overrides?: Partial<PlanningImagesComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<PlanningImagesComponentProps> {
  const defaults = planningImagesComponentDefinition.createDefaultProps(node)
  const merged = clampPlanningImagesComponentProps({
    images: overrides?.images ?? defaults.images,
  })
  return {
    id: options.id ?? '',
    type: PLANNING_IMAGES_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { planningImagesComponentDefinition }

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface GlobalThis {
    [PLANNING_IMAGES_RESOLVER_KEY]?: PlanningImageMediaResolver
  }
}