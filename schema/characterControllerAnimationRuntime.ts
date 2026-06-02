import type { PhysicsContactEvent } from '@harmony/physics-core'
import type { SceneNode, SceneNodeComponentState } from './core'
import { SceneAnimationRuntimeManager } from './sceneAnimationRuntime'
import {
	ANIMATION_COMPONENT_TYPE,
	type AnimationComponentProps,
} from './components/definitions/animationComponent'
import {
	CHARACTER_CONTROLLER_COMPONENT_TYPE,
	clampCharacterControllerComponentProps,
	type CharacterControllerComponentProps,
} from './components/definitions/characterControllerComponent'
import {
	chooseCharacterControlClipName,
	resolveCharacterControlMovementMagnitude,
} from './characterControlRuntime'

export type CharacterControllerAnimationRuntimeEntry = {
	nodeId: string
	props: CharacterControllerComponentProps
	behaviorOverrideTokens: Set<string>
	lastAutoClipName: string | null
	lastAutoLoop: boolean | null
	lastGrounded: boolean | null
	jumpPhase: 'start' | 'loop' | 'land' | null
	jumpStartAtMs: number | null
	landAtMs: number | null
	forceResync: boolean
}

export type CharacterControllerAnimationInputState = {
	moveX: number
	moveZ: number
	jump: boolean
	sprint: boolean
	crouch: boolean
	interact: boolean
	locallyControlled?: boolean
}

export type CharacterControllerAnimationRuntimeHost = {
	nodeAnimationRuntime: SceneAnimationRuntimeManager
	iterNodes: () => Iterable<[string, SceneNode]>
	resolveNode: (nodeId: string) => SceneNode | null
	resolveInput: (nodeId: string) => CharacterControllerAnimationInputState
	resolveGroundContacts: (nodeId: string) => readonly PhysicsContactEvent[] | null | undefined
}

const CHARACTER_JUMP_START_FALLBACK_MS = 180
const CHARACTER_JUMP_LOOP_FALLBACK_MS = 500
const CHARACTER_JUMP_LAND_FALLBACK_MS = 160

function resolveAnimationComponentForNode(node: SceneNode | null | undefined): SceneNodeComponentState<AnimationComponentProps> | null {
	const component = node?.components?.[ANIMATION_COMPONENT_TYPE] as SceneNodeComponentState<AnimationComponentProps> | undefined
	if (!component || component.enabled === false) {
		return null
	}
	return component
}

function resolveCharacterControllerComponentForNode(node: SceneNode | null | undefined): SceneNodeComponentState<CharacterControllerComponentProps> | null {
	const component = node?.components?.[CHARACTER_CONTROLLER_COMPONENT_TYPE] as SceneNodeComponentState<CharacterControllerComponentProps> | undefined
	if (!component || component.enabled === false) {
		return null
	}
	return component
}

export class CharacterControllerAnimationRuntimeManager {
	private readonly entries = new Map<string, CharacterControllerAnimationRuntimeEntry>()
	private readonly overrideNodeIdByToken = new Map<string, string>()

	has(nodeId: string): boolean {
		return this.entries.has(nodeId)
	}

	getBehaviorOverrideTokens(nodeId: string): string[] {
		const entry = this.entries.get(nodeId)
		return entry ? Array.from(entry.behaviorOverrideTokens) : []
	}

	clear(): void {
		this.entries.clear()
		this.overrideNodeIdByToken.clear()
	}

	acquireBehaviorOverride(nodeId: string, token: string | null | undefined): void {
		if (!token) {
			return
		}
		const entry = this.entries.get(nodeId)
		if (!entry) {
			return
		}
		this.releaseBehaviorOverride(token)
		entry.behaviorOverrideTokens.add(token)
		this.overrideNodeIdByToken.set(token, nodeId)
	}

	releaseBehaviorOverride(token: string | null | undefined): void {
		if (!token) {
			return
		}
		const nodeId = this.overrideNodeIdByToken.get(token)
		this.overrideNodeIdByToken.delete(token)
		if (!nodeId) {
			return
		}
		const entry = this.entries.get(nodeId)
		if (!entry) {
			return
		}
		if (entry.behaviorOverrideTokens.delete(token)) {
			this.scheduleResync(nodeId)
		}
	}

	scheduleResync(nodeId: string): void {
		const entry = this.entries.get(nodeId)
		if (!entry) {
			return
		}
		entry.forceResync = true
		entry.lastAutoClipName = null
		entry.lastAutoLoop = null
	}

	refresh(host: CharacterControllerAnimationRuntimeHost): void {
		const nextEntries = new Map<string, CharacterControllerAnimationRuntimeEntry>()
		for (const [nodeId, node] of host.iterNodes()) {
			const component = resolveCharacterControllerComponentForNode(node)
			if (!component) {
				continue
			}
			const previous = this.entries.get(nodeId) ?? null
			nextEntries.set(nodeId, {
				nodeId,
				props: clampCharacterControllerComponentProps(component.props),
				behaviorOverrideTokens: previous?.behaviorOverrideTokens ?? new Set<string>(),
				lastAutoClipName: previous?.lastAutoClipName ?? null,
				lastAutoLoop: previous?.lastAutoLoop ?? null,
				lastGrounded: previous?.lastGrounded ?? null,
				jumpPhase: previous?.jumpPhase ?? null,
				jumpStartAtMs: previous?.jumpStartAtMs ?? null,
				landAtMs: previous?.landAtMs ?? null,
				forceResync: true,
			})
		}
		this.entries.clear()
		nextEntries.forEach((entry, nodeId) => {
			this.entries.set(nodeId, entry)
		})
		Array.from(this.overrideNodeIdByToken.entries()).forEach(([token, nodeId]) => {
			if (!this.entries.has(nodeId)) {
				this.overrideNodeIdByToken.delete(token)
			}
		})
	}

	update(host: CharacterControllerAnimationRuntimeHost, nowMs: number): void {
		if (!this.entries.size) {
			return
		}
		this.entries.forEach((entry, nodeId) => {
			if (entry.behaviorOverrideTokens.size > 0) {
				return
			}
			const node = host.resolveNode(nodeId)
			const animationComponent = resolveAnimationComponentForNode(node)
			if (!animationComponent || !host.nodeAnimationRuntime.has(nodeId)) {
				entry.lastAutoClipName = null
				entry.lastAutoLoop = null
				return
			}
			const input = host.resolveInput(nodeId)
			const moveX = input.locallyControlled ? input.moveX : 0
			const moveZ = input.locallyControlled ? input.moveZ : 0
			const movementMagnitude = resolveCharacterControlMovementMagnitude(moveX, moveZ)
			const jumpPressed = input.locallyControlled ? input.jump : false
			const groundedState = this.resolveGroundedState(host, nodeId)
			const grounded = groundedState.grounded
			const previousGrounded = entry.lastGrounded

			if (jumpPressed) {
				entry.jumpPhase = 'start'
				entry.jumpStartAtMs = nowMs
				entry.landAtMs = null
			}

			if (entry.jumpPhase === 'start') {
				const startClipName = chooseCharacterControlClipName(entry.props, movementMagnitude, {
					moveX,
					moveZ,
					sprinting: input.locallyControlled ? input.sprint : false,
					crouching: input.locallyControlled ? input.crouch : false,
					interacting: input.locallyControlled ? input.interact : false,
					jumpPhase: 'start',
				})
				const startDurationMs = this.resolveClipDurationMs(host, nodeId, startClipName)
				const maxStartMs = Math.max(0, Math.min(startDurationMs ?? CHARACTER_JUMP_START_FALLBACK_MS, CHARACTER_JUMP_START_FALLBACK_MS))
				const elapsedMs = entry.jumpStartAtMs != null ? nowMs - entry.jumpStartAtMs : Number.POSITIVE_INFINITY
				if (elapsedMs >= maxStartMs) {
					entry.jumpPhase = groundedState.hasAuthority
						? (grounded ? null : 'loop')
						: 'loop'
				}
			}

			if (groundedState.hasAuthority) {
				if (entry.jumpPhase !== 'land' && previousGrounded === false && grounded) {
					entry.jumpPhase = 'land'
					entry.landAtMs = nowMs
				} else if (!grounded && entry.jumpPhase !== 'start') {
					entry.jumpPhase = 'loop'
				} else if (grounded && entry.jumpPhase === 'loop' && previousGrounded === true) {
					entry.jumpPhase = null
				}
			} else if (entry.jumpPhase === 'loop') {
				const elapsedMs = entry.jumpStartAtMs != null ? nowMs - entry.jumpStartAtMs : Number.POSITIVE_INFINITY
				if (elapsedMs >= CHARACTER_JUMP_LOOP_FALLBACK_MS || (!jumpPressed && movementMagnitude <= 0.05)) {
					entry.jumpPhase = null
				}
			}

			if (entry.jumpPhase === 'land') {
				const landClipName = chooseCharacterControlClipName(entry.props, movementMagnitude, {
					moveX,
					moveZ,
					sprinting: input.locallyControlled ? input.sprint : false,
					crouching: input.locallyControlled ? input.crouch : false,
					interacting: input.locallyControlled ? input.interact : false,
					jumpPhase: 'land',
				})
				const landDurationMs = this.resolveClipDurationMs(host, nodeId, landClipName)
				const maxLandMs = Math.max(0, Math.min(landDurationMs ?? CHARACTER_JUMP_LAND_FALLBACK_MS, CHARACTER_JUMP_LAND_FALLBACK_MS))
				const elapsedMs = entry.landAtMs != null ? nowMs - entry.landAtMs : Number.POSITIVE_INFINITY
				if (elapsedMs >= maxLandMs) {
					entry.jumpPhase = grounded ? null : 'loop'
					entry.landAtMs = null
				}
			}

			const desiredClipName = chooseCharacterControlClipName(entry.props, movementMagnitude, {
				moveX,
				moveZ,
				sprinting: input.locallyControlled ? input.sprint : false,
				crouching: input.locallyControlled ? input.crouch : false,
				interacting: input.locallyControlled ? input.interact : false,
				jumpPhase: entry.jumpPhase,
			})
			if (!desiredClipName) {
				if (entry.lastAutoClipName !== null || entry.forceResync) {
					host.nodeAnimationRuntime.restoreDefaultNodeAnimation(nodeId)
					entry.lastAutoClipName = null
					entry.lastAutoLoop = null
					entry.forceResync = false
				}
				entry.lastGrounded = grounded
				return
			}

			const shouldLoop = entry.jumpPhase !== 'start' && entry.jumpPhase !== 'land'
			if (entry.forceResync || entry.lastAutoClipName !== desiredClipName || entry.lastAutoLoop !== shouldLoop) {
				host.nodeAnimationRuntime.playNodeAnimation(nodeId, desiredClipName, {
					loop: shouldLoop,
					timeScale: animationComponent.props.timeScale,
				})
				entry.lastAutoClipName = desiredClipName
				entry.lastAutoLoop = shouldLoop
				entry.forceResync = false
			}
			entry.lastGrounded = grounded
		})
	}

	private resolveClipDurationMs(
		host: CharacterControllerAnimationRuntimeHost,
		nodeId: string,
		clipName: string | null,
	): number | null {
		if (!clipName) {
			return null
		}
		const controller = host.nodeAnimationRuntime.get(nodeId)
		const clip = controller?.clips.find((entry) => entry.name === clipName) ?? host.nodeAnimationRuntime.resolveClip(nodeId, clipName)
		if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0) {
			return null
		}
		return clip.duration * 1000
	}

	private resolveGroundedState(
		host: CharacterControllerAnimationRuntimeHost,
		nodeId: string,
	): { hasAuthority: boolean; grounded: boolean } {
		const contacts = host.resolveGroundContacts(nodeId)
		if (contacts) {
			return {
				hasAuthority: true,
				grounded: contacts.some((contact) => Math.abs(contact.normal[1] ?? 0) >= 0.5),
			}
		}
		return {
			hasAuthority: false,
			grounded: false,
		}
	}
}
