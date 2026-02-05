import * as THREE from 'three'
import { Body } from 'cannon-es'

export type ScenePreviewPerfOptions = {
	isWeChatMiniProgram?: boolean
	instancedCulling?: {
		moveThresholdM?: number
		rotThresholdDeg?: number
		maxStaleMs?: number
	}
	nonInteractiveSleep?: {
		enabled?: boolean
		sleepSpeedLimit?: number
		sleepTimeLimit?: number
		visualSyncIntervalMs?: number
	}
	wheelVisuals?: {
		lowSpeedMps?: number
		lowSpeedIntervalMs?: number
	}
}

export type ScenePreviewPerfController = {
	markInstancedCullingDirty(): void
	shouldRunInstancedCulling(camera: THREE.Camera, nowMs?: number): boolean

	applyAggressiveSleepForNonInteractiveDynamic(params: {
		nodeId: string
		body: Body
		isVehicle: boolean
		isProtagonist: boolean
	}): void

	registerProtagonist(nodeId: string, body?: Body | null): void
	clearProtagonist(): void

	shouldSyncNonInteractiveSleepingBody(params: { nodeId: string; body: Body; nowMs?: number }): boolean

	shouldUpdateWheelVisuals(params: {
		nodeId: string | null
		body: Body
		manualActive: boolean
		tourActive: boolean
		nowMs?: number
	}): boolean

	notifyRemovedNode(nodeId: string): void
	reset(): void
}

function toFiniteNumber(value: unknown): number | null {
	const numeric = typeof value === 'number' ? value : Number(value)
	return Number.isFinite(numeric) ? numeric : null
}

export function createScenePreviewPerfController(options: ScenePreviewPerfOptions = {}): ScenePreviewPerfController {
	const isWeChatMiniProgram = options.isWeChatMiniProgram === true

	const instancedMoveThresholdM = Math.max(
		0,
		toFiniteNumber(options.instancedCulling?.moveThresholdM) ?? (isWeChatMiniProgram ? 0.08 : 0.05),
	)
	const instancedRotThresholdDeg = Math.max(
		0,
		toFiniteNumber(options.instancedCulling?.rotThresholdDeg) ?? (isWeChatMiniProgram ? 0.5 : 0.25),
	)
	const instancedRotThresholdRad = (instancedRotThresholdDeg * Math.PI) / 180
	const instancedMaxStaleMs = Math.max(
		0,
		toFiniteNumber(options.instancedCulling?.maxStaleMs) ?? (isWeChatMiniProgram ? 200 : 120),
	)

	const nonInteractiveSleepEnabled = options.nonInteractiveSleep?.enabled !== false
	const nonInteractiveSleepSpeedLimit = Math.max(
		0,
		toFiniteNumber(options.nonInteractiveSleep?.sleepSpeedLimit) ?? (isWeChatMiniProgram ? 0.15 : 0.08),
	)
	const nonInteractiveSleepTimeLimit = Math.max(
		0,
		toFiniteNumber(options.nonInteractiveSleep?.sleepTimeLimit) ?? (isWeChatMiniProgram ? 0.25 : 0.5),
	)
	const nonInteractiveSleepingVisualSyncIntervalMs = Math.max(
		0,
		toFiniteNumber(options.nonInteractiveSleep?.visualSyncIntervalMs) ?? (isWeChatMiniProgram ? 150 : 0),
	)

	const wheelLowSpeedMps = Math.max(0, toFiniteNumber(options.wheelVisuals?.lowSpeedMps) ?? (isWeChatMiniProgram ? 0.4 : 0.2))
	const wheelLowSpeedIntervalMs = Math.max(
		0,
		toFiniteNumber(options.wheelVisuals?.lowSpeedIntervalMs) ?? (isWeChatMiniProgram ? 150 : 0),
	)

	let instancedForceNext = true
	let instancedHasSample = false
	let instancedLastAtMs = 0
	const instancedLastPos = new THREE.Vector3()
	const instancedLastQuat = new THREE.Quaternion()
	const instancedPosScratch = new THREE.Vector3()
	const instancedQuatScratch = new THREE.Quaternion()

	const nonInteractiveDynamicNodeIds = new Set<string>()
	const nonInteractiveSleepingLastSyncAtMs = new Map<string, number>()
	const wheelVisualLastUpdateMs = new Map<string, number>()
	let protagonistNodeId: string | null = null

	function markInstancedCullingDirty(): void {
		instancedForceNext = true
	}

	function shouldRunInstancedCulling(camera: THREE.Camera, nowMs: number = Date.now()): boolean {
		if (!camera) {
			return true
		}

		camera.updateMatrixWorld(true)
		camera.getWorldPosition(instancedPosScratch)
		camera.getWorldQuaternion(instancedQuatScratch)

		if (instancedForceNext || !instancedHasSample) {
			instancedForceNext = false
			instancedHasSample = true
			instancedLastAtMs = nowMs
			instancedLastPos.copy(instancedPosScratch)
			instancedLastQuat.copy(instancedQuatScratch)
			return true
		}

		if (instancedMaxStaleMs > 0 && nowMs - instancedLastAtMs >= instancedMaxStaleMs) {
			instancedLastAtMs = nowMs
			instancedLastPos.copy(instancedPosScratch)
			instancedLastQuat.copy(instancedQuatScratch)
			return true
		}

		const moveThresholdSq = instancedMoveThresholdM * instancedMoveThresholdM
		if (moveThresholdSq > 0 && instancedPosScratch.distanceToSquared(instancedLastPos) >= moveThresholdSq) {
			instancedLastAtMs = nowMs
			instancedLastPos.copy(instancedPosScratch)
			instancedLastQuat.copy(instancedQuatScratch)
			return true
		}

		if (instancedRotThresholdRad > 0) {
			const dot = Math.min(1, Math.abs(instancedLastQuat.dot(instancedQuatScratch)))
			const angle = 2 * Math.acos(dot)
			if (Number.isFinite(angle) && angle >= instancedRotThresholdRad) {
				instancedLastAtMs = nowMs
				instancedLastPos.copy(instancedPosScratch)
				instancedLastQuat.copy(instancedQuatScratch)
				return true
			}
		}

		return false
	}

	function registerProtagonist(nodeId: string, body?: Body | null): void {
		protagonistNodeId = nodeId
		nonInteractiveDynamicNodeIds.delete(nodeId)
		nonInteractiveSleepingLastSyncAtMs.delete(nodeId)
		if (body) {
			try {
				body.allowSleep = false
			} catch {
				// best-effort
			}
		}
	}

	function clearProtagonist(): void {
		protagonistNodeId = null
	}

	function applyAggressiveSleepForNonInteractiveDynamic(params: {
		nodeId: string
		body: Body
		isVehicle: boolean
		isProtagonist: boolean
	}): void {
		const { nodeId, body, isVehicle, isProtagonist } = params
		if (!body) {
			return
		}

		const isDynamic = body.type === Body.DYNAMIC
		if (!isDynamic) {
			nonInteractiveDynamicNodeIds.delete(nodeId)
			nonInteractiveSleepingLastSyncAtMs.delete(nodeId)
			return
		}

		if (isProtagonist) {
			registerProtagonist(nodeId, body)
			return
		}

		if (isVehicle) {
			nonInteractiveDynamicNodeIds.delete(nodeId)
			nonInteractiveSleepingLastSyncAtMs.delete(nodeId)
			return
		}

		if (!nonInteractiveSleepEnabled) {
			nonInteractiveDynamicNodeIds.delete(nodeId)
			nonInteractiveSleepingLastSyncAtMs.delete(nodeId)
			return
		}

		nonInteractiveDynamicNodeIds.add(nodeId)
		try {
			body.allowSleep = true
			body.sleepSpeedLimit = nonInteractiveSleepSpeedLimit
			body.sleepTimeLimit = nonInteractiveSleepTimeLimit
		} catch {
			// best-effort
		}
	}

	function shouldSyncNonInteractiveSleepingBody(params: { nodeId: string; body: Body; nowMs?: number }): boolean {
		const { nodeId, body } = params
		if (nonInteractiveSleepingVisualSyncIntervalMs <= 0) {
			return true
		}
		if (!nonInteractiveDynamicNodeIds.has(nodeId)) {
			nonInteractiveSleepingLastSyncAtMs.delete(nodeId)
			return true
		}

		type SleepStateBody = Body & { sleepState?: number }
		const sleepState = (body as SleepStateBody).sleepState
		const sleeping = typeof sleepState === 'number' ? sleepState !== 0 : false
		if (!sleeping) {
			nonInteractiveSleepingLastSyncAtMs.delete(nodeId)
			return true
		}

		const nowMs = params.nowMs ?? Date.now()
		const last = nonInteractiveSleepingLastSyncAtMs.get(nodeId) ?? 0
		if (nowMs - last < nonInteractiveSleepingVisualSyncIntervalMs) {
			return false
		}
		nonInteractiveSleepingLastSyncAtMs.set(nodeId, nowMs)
		return true
	}

	function shouldUpdateWheelVisuals(params: {
		nodeId: string | null
		body: Body
		manualActive: boolean
		tourActive: boolean
		nowMs?: number
	}): boolean {
		const { nodeId, body, manualActive, tourActive } = params
		if (!nodeId) {
			return true
		}
		if (wheelLowSpeedIntervalMs <= 0) {
			return true
		}
		if (manualActive || tourActive) {
			wheelVisualLastUpdateMs.delete(nodeId)
			return true
		}

		const v = body.velocity as unknown as { x?: number; y?: number; z?: number } | undefined
		const vx = v?.x ?? 0
		const vy = v?.y ?? 0
		const vz = v?.z ?? 0
		const speedSq = vx * vx + vy * vy + vz * vz
		const lowSq = wheelLowSpeedMps * wheelLowSpeedMps
		if (speedSq >= lowSq) {
			wheelVisualLastUpdateMs.delete(nodeId)
			return true
		}

		const nowMs = params.nowMs ?? Date.now()
		const last = wheelVisualLastUpdateMs.get(nodeId) ?? 0
		if (nowMs - last < wheelLowSpeedIntervalMs) {
			return false
		}
		wheelVisualLastUpdateMs.set(nodeId, nowMs)
		return true
	}

	function notifyRemovedNode(nodeId: string): void {
		nonInteractiveDynamicNodeIds.delete(nodeId)
		nonInteractiveSleepingLastSyncAtMs.delete(nodeId)
		wheelVisualLastUpdateMs.delete(nodeId)
		if (protagonistNodeId === nodeId) {
			protagonistNodeId = null
		}
	}

	function reset(): void {
		instancedForceNext = true
		instancedHasSample = false
		instancedLastAtMs = 0
		instancedLastPos.set(0, 0, 0)
		instancedLastQuat.set(0, 0, 0, 1)
		protagonistNodeId = null
		nonInteractiveDynamicNodeIds.clear()
		nonInteractiveSleepingLastSyncAtMs.clear()
		wheelVisualLastUpdateMs.clear()
	}

	return {
		markInstancedCullingDirty,
		shouldRunInstancedCulling,
		applyAggressiveSleepForNonInteractiveDynamic,
		registerProtagonist,
		clearProtagonist,
		shouldSyncNonInteractiveSleepingBody,
		shouldUpdateWheelVisuals,
		notifyRemovedNode,
		reset,
	}
}
