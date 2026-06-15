import type * as THREE from 'three'
import type { BehaviorEventResolution, BehaviorRuntimeEvent } from './runtime'

export type ApplyBehaviorVisibilityChangeDeps = {
	getObject: (nodeId: string) => THREE.Object3D | null | undefined
	getNode: (nodeId: string) => { visible?: boolean | null } | null | undefined
	syncObject: (object: THREE.Object3D) => void
	updateBehaviorVisibility: (nodeId: string, visible: boolean) => void
}

export function applyBehaviorVisibilityChange(
	nodeId: string,
	visible: boolean,
	deps: ApplyBehaviorVisibilityChangeDeps,
): void {
	const object = deps.getObject(nodeId)
	if (object) {
		object.visible = visible
		deps.syncObject(object)
	}
	const node = deps.getNode(nodeId)
	if (node) {
		node.visible = visible
	}
	deps.updateBehaviorVisibility(nodeId, visible)
}

export type DispatchPerformBehaviorEventDeps = {
	warnMissingTarget: (message: string) => void
	triggerBehaviorAction: (
		nodeId: string,
		action: 'perform',
		context: { payload: { sourceNodeId: string } },
		options?: { sequenceId?: string },
	) => BehaviorRuntimeEvent[]
	processBehaviorEvents: (events: BehaviorRuntimeEvent[]) => void
}

export function dispatchPerformBehaviorEvent(
	event: Extract<BehaviorRuntimeEvent, { type: 'trigger-behavior' }>,
	deps: DispatchPerformBehaviorEventDeps,
): void {
	const targetNodeId = event.targetNodeId || event.nodeId
	if (!targetNodeId) {
		deps.warnMissingTarget('缺少目标节点')
		return
	}
	const sequenceId = event.targetSequenceId && event.targetSequenceId.trim().length ? event.targetSequenceId : undefined
	const followUps = deps.triggerBehaviorAction(
		targetNodeId,
		'perform',
		{
			payload: {
				sourceNodeId: event.nodeId,
			},
		},
		sequenceId ? { sequenceId } : {},
	)
	deps.processBehaviorEvents(followUps)
}

export type HandleBehaviorDelayEventDeps<TTimer> = {
	activeBehaviorDelayTimers: Map<string, TTimer>
	clearDelayTimer: (token: string) => void
	resolveBehaviorToken: (token: string, resolution: BehaviorEventResolution) => void
	scheduleTimeout: (callback: () => void, delayMs: number) => TTimer
}

export function handleBehaviorDelayEvent<TTimer>(
	event: Extract<BehaviorRuntimeEvent, { type: 'delay' }>,
	deps: HandleBehaviorDelayEventDeps<TTimer>,
): void {
	deps.clearDelayTimer(event.token)
	const durationMs = Math.max(0, event.seconds) * 1000
	const handle = deps.scheduleTimeout(() => {
		deps.activeBehaviorDelayTimers.delete(event.token)
		deps.resolveBehaviorToken(event.token, { type: 'continue' })
	}, durationMs)
	deps.activeBehaviorDelayTimers.set(event.token, handle)
}

export type HandleBehaviorStopAnimationEventDeps = {
	isCharacterControllerAnimationNode: (nodeId: string) => boolean
	getBehaviorOverrideTokens: (nodeId: string) => string[]
	stopBehaviorAnimation: (token: string) => void
	scheduleCharacterControllerAnimationResync: (nodeId: string) => void
	stopNodeAnimation: (nodeId: string, options: { restoreDefault: boolean }) => void
}

export function handleBehaviorStopAnimationEvent(
	event: Extract<BehaviorRuntimeEvent, { type: 'stop-animation' }>,
	deps: HandleBehaviorStopAnimationEventDeps,
): void {
	const targetNodeId = event.targetNodeId || event.nodeId
	if (!targetNodeId) {
		return
	}
	if (deps.isCharacterControllerAnimationNode(targetNodeId)) {
		const overrideTokens = deps.getBehaviorOverrideTokens(targetNodeId)
		if (overrideTokens.length) {
			overrideTokens.forEach((token) => {
				deps.stopBehaviorAnimation(token)
			})
		} else {
			deps.scheduleCharacterControllerAnimationResync(targetNodeId)
		}
		deps.stopNodeAnimation(targetNodeId, { restoreDefault: false })
		return
	}
	deps.stopNodeAnimation(targetNodeId, { restoreDefault: true })
}

export type HandleBehaviorPlayAnimationEventDeps = {
	getController: (nodeId: string) => { mixer: THREE.AnimationMixer } | null | undefined
	resolveClip: (nodeId: string, clipName: string | null) => THREE.AnimationClip | null | undefined
	playNodeAnimation: (
		nodeId: string,
		clipName: string | null,
		options: { loop: boolean },
	) => THREE.AnimationAction | null
	stopBehaviorAnimation: (token: string) => void
	isCharacterControllerAnimationNode: (nodeId: string) => boolean
	acquireCharacterControllerBehaviorOverride: (nodeId: string, token: string | undefined) => void
	releaseCharacterControllerBehaviorOverride: (token: string) => void
	restartDefaultAnimation: (nodeId: string) => void
	resolveBehaviorToken: (token: string, resolution: BehaviorEventResolution) => void
	activeBehaviorAnimations: Map<string, () => void>
	warnNoTarget: () => void
	warnTargetUnavailable: (targetNodeId: string) => void
	warnClipNotFound: (targetNodeId: string, clipName: string | null) => void
	warnFailedToStart: () => void
	warnFailedToStop: (error: unknown) => void
}

export function handleBehaviorPlayAnimationEvent(
	event: Extract<BehaviorRuntimeEvent, { type: 'play-animation' }>,
	deps: HandleBehaviorPlayAnimationEventDeps,
): void {
	const targetNodeId = event.targetNodeId || event.nodeId
	if (!targetNodeId) {
		if (event.token) {
			deps.resolveBehaviorToken(event.token, { type: 'fail', message: 'Animation target missing' })
		}
		deps.warnNoTarget()
		return
	}
	const controller = deps.getController(targetNodeId)
	if (!controller) {
		if (event.token) {
			deps.resolveBehaviorToken(event.token, { type: 'fail', message: 'Animation target not available' })
		}
		deps.warnTargetUnavailable(targetNodeId)
		return
	}
	const clip = deps.resolveClip(targetNodeId, event.clipName)
	if (!clip) {
		if (event.token) {
			deps.resolveBehaviorToken(event.token, {
				type: 'fail',
				message: event.clipName ? `Animation clip "${event.clipName}" not found` : 'No animation clips available',
			})
		}
		deps.warnClipNotFound(targetNodeId, event.clipName)
		return
	}
	const action = deps.playNodeAnimation(targetNodeId, event.clipName, { loop: Boolean(event.loop) })
	if (!action) {
		if (event.token) {
			deps.resolveBehaviorToken(event.token, { type: 'fail', message: 'Unable to start animation.' })
		}
		deps.warnFailedToStart()
		return
	}
	const token = event.token
	if (token) {
		deps.stopBehaviorAnimation(token)
	}
	const isCharacterControlledTarget = deps.isCharacterControllerAnimationNode(targetNodeId)
	if (isCharacterControlledTarget) {
		deps.acquireCharacterControllerBehaviorOverride(targetNodeId, token)
	}
	if (!token) {
		return
	}
	if (event.loop) {
		deps.resolveBehaviorToken(token, { type: 'continue' })
		return
	}
	if (!Number.isFinite(clip.duration) || clip.duration <= 0) {
		deps.resolveBehaviorToken(token, { type: 'continue' })
		return
	}
	const mixer = controller.mixer
	const onFinished = (payload: THREE.Event & { action?: THREE.AnimationAction }) => {
		if (payload.action !== action) {
			return
		}
		mixer.removeEventListener('finished', onFinished)
		deps.activeBehaviorAnimations.delete(token)
		deps.releaseCharacterControllerBehaviorOverride(token)
		if (!isCharacterControlledTarget) {
			deps.restartDefaultAnimation(targetNodeId)
		}
		deps.resolveBehaviorToken(token, { type: 'continue' })
	}
	const cancel = () => {
		mixer.removeEventListener('finished', onFinished)
		try {
			action.stop()
		} catch (error) {
			deps.warnFailedToStop(error)
		}
		deps.releaseCharacterControllerBehaviorOverride(token)
		if (!isCharacterControlledTarget) {
			deps.restartDefaultAnimation(targetNodeId)
		}
	}
	deps.activeBehaviorAnimations.set(token, cancel)
	mixer.addEventListener('finished', onFinished)
}
