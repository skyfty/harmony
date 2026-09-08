import * as THREE from 'three'
import {
  collectAnimationClips,
  mergeAnimationClipsWithExternalPrecedence,
  findAnimationClipByName,
  sanitizeAnimationClipName,
} from './runtimeAnimationCatalog'

export interface AnimationRuntimeRegistration {
  nodeId: string
  sourceNodeId: string
  runtimeObject: THREE.Object3D | null
  /**
   * 外部动画资产的 clip。同名 clip 会覆盖模型内置动画（外部优先）；
   * 没有外部 clip 时完全使用内置动画。
   */
  externalClips?: THREE.AnimationClip[]
  defaultClipName: string | null
  autoplay: boolean
  loop: boolean
  timeScale: number
}

export interface AnimationPlaybackOptions {
  loop?: boolean
  timeScale?: number
}

export interface AnimationRuntimePresentation {
  clipName: string | null
  time: number
  duration: number
  loop: boolean
  timeScale: number
  normalizedTime: number | null
}

type AnimationRuntimeController = {
  nodeId: string
  sourceNodeId: string
  runtimeObject: THREE.Object3D
  mixer: THREE.AnimationMixer
  clips: THREE.AnimationClip[]
  defaultClipName: string | null
  autoplay: boolean
  defaultLoop: boolean
  defaultTimeScale: number
  activeAction: THREE.AnimationAction | null
  activeClipName: string | null
  activeLoop: boolean
  activeTimeScale: number
  externalClipSignature: string | null
  skippedClipLogKeys: Set<string>
}

const animationPlayableNodeCache = new WeakMap<THREE.Object3D, Set<string>>()

function collectRuntimeNodeNames(root: THREE.Object3D): Set<string> {
  const cached = animationPlayableNodeCache.get(root)
  if (cached) {
    return cached
  }
  const names = new Set<string>()
  // 与 THREE.PropertyBinding 一致：目标节点可能是 mixer root 自身。
  if (typeof root?.name === 'string' && root.name.trim().length > 0) {
    names.add(root.name.trim())
  }
  root.traverse((object) => {
    const name = object?.name
    if (typeof name === 'string' && name.trim().length > 0) {
      names.add(name.trim())
    }
  })
  animationPlayableNodeCache.set(root, names)
  return names
}

function isAnimationClipPlayable(mixer: THREE.AnimationMixer, clip: THREE.AnimationClip): boolean {
  if (!mixer || !clip) {
    return false
  }
  const root = mixer.getRoot()
  if (!root || !(root as THREE.Object3D).isObject3D) {
    return false
  }
  const tracks = Array.isArray(clip.tracks) ? clip.tracks : []
  if (!tracks.length) {
    return false
  }
  const nodeNames = collectRuntimeNodeNames(root as THREE.Object3D)
  return tracks.every((track) => {
    const rawName = typeof track?.name === 'string' ? track.name : ''
    if (!rawName) {
      return false
    }
    const parsed = THREE.PropertyBinding.parseTrackName(rawName)
    // 空 nodeName 表示目标即 mixer root 本身。GLTF/FBX 骨骼动画通常都会写出节点名；
    // 只有 root 是可动画对象（SkinnedMesh 等）且存在对应 property 时才可能真正绑定，
    // 此处不额外放行，避免"以为能播"的假阳性。
    if (!parsed.nodeName) {
      return false
    }
    return nodeNames.has(parsed.nodeName)
  })
}

function formatAnimationSkipMessage(nodeId: string, clipName: string | null): string {
  const name = clipName || '<未命名>'
  return `[AnimationRuntime] 节点 ${nodeId} 的动画 clip "${name}" 目标节点不在当前模型层级中，已跳过播放（真实模型加载/同步后会重试）`
}

function normalizeAnimationLoop(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 1 || value === '1' || value === 'true') {
    return true
  }
  if (value === 0 || value === '0' || value === 'false') {
    return false
  }
  return fallback
}

function normalizeAnimationTimeScale(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function playAnimationClip(
  mixer: THREE.AnimationMixer,
  clip: THREE.AnimationClip,
  options: AnimationPlaybackOptions = {},
  playbackGuard?: { nodeId: string; skippedClipLogKeys: Set<string> },
): THREE.AnimationAction | null {
  if (!isAnimationClipPlayable(mixer, clip)) {
    const key = `${sanitizeAnimationClipName(clip.name) ?? clip.uuid}`
    if (playbackGuard && !playbackGuard.skippedClipLogKeys.has(key)) {
      playbackGuard.skippedClipLogKeys.add(key)
      console.warn(formatAnimationSkipMessage(playbackGuard.nodeId, sanitizeAnimationClipName(clip.name)))
    }
    return null
  }
  const action = mixer.clipAction(clip)
  action.reset()
  action.enabled = true
  if (options.loop) {
    action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY)
    action.clampWhenFinished = false
  } else {
    action.setLoop(THREE.LoopOnce, 0)
    action.clampWhenFinished = true
  }
  action.timeScale = normalizeAnimationTimeScale(options.timeScale, 1)
  action.play()
  return action
}

export class SceneAnimationRuntimeManager {
  private readonly controllers = new Map<string, AnimationRuntimeController>()

  private invalidatePlayableCache(root: THREE.Object3D | null | undefined): void {
    if (!root) {
      return
    }
    animationPlayableNodeCache.delete(root)
  }

  get(nodeId: string): Readonly<AnimationRuntimeController> | null {
    return this.controllers.get(nodeId) ?? null
  }

  has(nodeId: string): boolean {
    return this.controllers.has(nodeId)
  }

  listMixers(): THREE.AnimationMixer[] {
    return Array.from(this.controllers.values(), (controller) => controller.mixer)
  }

  reset(): void {
    this.controllers.forEach((controller) => {
      try {
        controller.mixer.stopAllAction()
      } catch {
        /* ignore */
      }
      this.invalidatePlayableCache(controller.runtimeObject)
    })
    this.controllers.clear()
  }

  unregister(nodeId: string): void {
    const controller = this.controllers.get(nodeId)
    if (!controller) {
      return
    }
    try {
      controller.mixer.stopAllAction()
    } catch {
      /* ignore */
    }
    this.invalidatePlayableCache(controller.runtimeObject)
    this.controllers.delete(nodeId)
  }

  sync(registration: AnimationRuntimeRegistration): void {
    const builtInClips = registration.runtimeObject ? collectAnimationClips(registration.runtimeObject) : []
    const externalClips = Array.isArray(registration.externalClips)
      ? registration.externalClips.filter((clip): clip is THREE.AnimationClip => Boolean(clip))
      : []
    const clips = mergeAnimationClipsWithExternalPrecedence(builtInClips, externalClips)
    const nextExternalClipSignature = externalClips
      .map((clip) => sanitizeAnimationClipName(clip.name) ?? clip.uuid)
      .join('\u0001')
    if (!registration.runtimeObject || !clips.length) {
      this.unregister(registration.nodeId)
      return
    }

    const existing = this.controllers.get(registration.nodeId) ?? null
    const nextDefaultClipName = sanitizeAnimationClipName(registration.defaultClipName)
    const nextDefaultLoop = normalizeAnimationLoop(registration.loop, true)
    const nextDefaultTimeScale = normalizeAnimationTimeScale(registration.timeScale, 1)

    if (
      existing
      && existing.runtimeObject === registration.runtimeObject
      && existing.sourceNodeId === registration.sourceNodeId
      && existing.externalClipSignature === nextExternalClipSignature
    ) {
      try {
        existing.mixer.stopAllAction()
      } catch {
        /* ignore */
      }
      existing.clips = clips
      existing.defaultClipName = nextDefaultClipName
      existing.autoplay = registration.autoplay
      existing.defaultLoop = nextDefaultLoop
      existing.defaultTimeScale = nextDefaultTimeScale
      existing.activeAction = null
      existing.activeClipName = null
      existing.activeLoop = false
      existing.activeTimeScale = 1
      this.restoreDefaultNodeAnimation(registration.nodeId)
      return
    }

    this.unregister(registration.nodeId)

    const mixer = new THREE.AnimationMixer(registration.runtimeObject)
    const controller: AnimationRuntimeController = {
      nodeId: registration.nodeId,
      sourceNodeId: registration.sourceNodeId,
      runtimeObject: registration.runtimeObject,
      mixer,
      clips,
      defaultClipName: nextDefaultClipName,
      autoplay: registration.autoplay,
      defaultLoop: nextDefaultLoop,
      defaultTimeScale: nextDefaultTimeScale,
      activeAction: null,
      activeClipName: null,
      activeLoop: false,
      activeTimeScale: 1,
      externalClipSignature: nextExternalClipSignature,
      skippedClipLogKeys: new Set<string>(),
    }
    this.controllers.set(registration.nodeId, controller)
    this.restoreDefaultNodeAnimation(registration.nodeId)
  }

  update(deltaSeconds: number): void {
    this.controllers.forEach((controller) => controller.mixer.update(deltaSeconds))
  }

  resolveClip(nodeId: string, requestedClipName: string | null | undefined): THREE.AnimationClip | null {
    const controller = this.controllers.get(nodeId)
    if (!controller) {
      return null
    }
    const requested = findAnimationClipByName(controller.clips, requestedClipName)
    if (requested) {
      return requested
    }
    const defaultClip = findAnimationClipByName(controller.clips, controller.defaultClipName)
    if (defaultClip) {
      return defaultClip
    }
    return controller.clips[0] ?? null
  }

  playNodeAnimation(
    nodeId: string,
    requestedClipName: string | null | undefined,
    options: AnimationPlaybackOptions = {},
  ): THREE.AnimationAction | null {
    const controller = this.controllers.get(nodeId)
    if (!controller) {
      return null
    }
    const clip = this.resolveClip(nodeId, requestedClipName)
    if (!clip) {
      return null
    }
    controller.mixer.stopAllAction()
    const action = playAnimationClip(controller.mixer, clip, options, {
      nodeId,
      skippedClipLogKeys: controller.skippedClipLogKeys,
    })
    if (!action) {
      controller.activeAction = null
      controller.activeClipName = null
      controller.activeLoop = false
      controller.activeTimeScale = 1
      return null
    }
    controller.activeAction = action
    controller.activeClipName = sanitizeAnimationClipName(clip.name)
    controller.activeLoop = Boolean(options.loop)
    controller.activeTimeScale = normalizeAnimationTimeScale(action.timeScale, 1)
    return action
  }

  stopNodeAnimation(nodeId: string, options: { restoreDefault?: boolean } = {}): void {
    const controller = this.controllers.get(nodeId)
    if (!controller) {
      return
    }
    try {
      controller.mixer.stopAllAction()
    } catch {
      /* ignore */
    }
    controller.activeAction = null
    controller.activeClipName = null
    controller.activeLoop = false
    controller.activeTimeScale = 1
    if (options.restoreDefault) {
      this.restoreDefaultNodeAnimation(nodeId)
    }
  }

  restoreDefaultNodeAnimation(nodeId: string): THREE.AnimationAction | null {
    const controller = this.controllers.get(nodeId)
    if (!controller) {
      return null
    }
    if (!controller.autoplay) {
      this.stopNodeAnimation(nodeId)
      return null
    }
    const defaultClip = this.resolveClip(nodeId, controller.defaultClipName)
    if (!defaultClip) {
      this.stopNodeAnimation(nodeId)
      return null
    }
    return this.playNodeAnimation(nodeId, sanitizeAnimationClipName(defaultClip.name), {
      loop: controller.defaultLoop,
      timeScale: controller.defaultTimeScale,
    })
  }

  getPresentation(nodeId: string): AnimationRuntimePresentation | null {
    const controller = this.controllers.get(nodeId)
    const action = controller?.activeAction ?? null
    if (!controller) {
      return null
    }
    const clip = findAnimationClipByName(controller.clips, controller.activeClipName)
      ?? action?.getClip()
      ?? findAnimationClipByName(controller.clips, controller.defaultClipName)
      ?? controller.clips[0]
      ?? null
    if (!clip) {
      return null
    }
    const duration = Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : 0
    const time = action && Number.isFinite(action.time) ? action.time : 0
    const timeScale = action && Number.isFinite(action.timeScale) ? action.timeScale : controller.activeTimeScale
    return {
      clipName: sanitizeAnimationClipName(clip.name),
      time,
      duration,
      loop: action ? controller.activeLoop : controller.defaultLoop,
      timeScale,
      normalizedTime: duration > 0 ? time / duration : null,
    }
  }
}
