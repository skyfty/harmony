import * as THREE from 'three'
import { isPointInsideRegionXZ } from '../core'
import {
	DEFAULT_OBJECT_RADIUS,
	PROXIMITY_EXIT_PADDING,
	PROXIMITY_MIN_DISTANCE,
	PROXIMITY_RADIUS_SCALE,
} from './runtime'

export type BehaviorProximityCandidate = { hasApproach: boolean; hasDepart: boolean }
export type BehaviorProximityState = {
	inside: boolean
	lastDistance: number | null
	pendingAction?: 'approach' | 'depart' | null
	pendingSequenceId?: string | null
	rebaselineRequired?: boolean
}
export type BehaviorProximityThreshold = { enter: number; exit: number; objectId: string }
export type BehaviorObserverKind = 'vehicle' | 'character' | 'other' | 'camera'
export type BehaviorObserverCandidate = {
	nodeId: string | null
	kind: Exclude<BehaviorObserverKind, 'camera'>
}
export type BehaviorObserverContext = {
	observerNodeId: string | null
	observerPosition: THREE.Vector3 | null
	kind: BehaviorObserverKind
}
export type BehaviorObserverContextDeps = {
	candidates: readonly BehaviorObserverCandidate[]
	getCamera: () => THREE.PerspectiveCamera | null
	resolveNodePosition: (nodeId: string, scratch: THREE.Vector3) => THREE.Vector3 | null
}

export type BehaviorProximityRegionNode = {
	dynamicMesh?: {
		type?: string | null
		vertices?: unknown
	} | null
}

export type BehaviorProximityRuntimeDeps = {
	resolveObserverContext: () => BehaviorObserverContext | null
	behaviorProximityCandidates: Map<string, BehaviorProximityCandidate>
	behaviorProximityState: Map<string, BehaviorProximityState>
	nodeObjectMap: Map<string, THREE.Object3D>
	resolveRegionNode: (nodeId: string) => BehaviorProximityRegionNode | null
	resolveNodeFocusPoint: (nodeId: string, fallback: THREE.Vector3) => THREE.Vector3 | null
	triggerBehaviorAction: (nodeId: string, action: 'approach' | 'depart', options: { payload: { distance: number; threshold: number } }) => any[]
	processBehaviorEvents: (events: any[]) => void
}

export type BehaviorProximityRuntime = {
	reset: () => void
	removeNode: (nodeId: string) => void
	handleSequenceFinished: (sequenceId: string) => void
	resolveProximityThresholds: (nodeId: string, object: THREE.Object3D) => BehaviorProximityThreshold
	resolveRegionBehaviorContainment: (
		nodeId: string,
		object: THREE.Object3D,
		observerPosition: THREE.Vector3,
	) => { inside: boolean; distance: number } | null
	updateBehaviorProximity: () => void
}

const REGION_TYPES = ['Region', 'Floor', 'Road', 'Water', 'Landform'] as const

export function resolveBehaviorObserverContext(
	deps: BehaviorObserverContextDeps,
	scratch: THREE.Vector3,
): BehaviorObserverContext {
	for (const candidate of deps.candidates) {
		const nodeId = typeof candidate?.nodeId === 'string' ? candidate.nodeId.trim() : ''
		if (!nodeId) {
			continue
		}
		const position = deps.resolveNodePosition(nodeId, scratch)
		if (position) {
			return {
				observerNodeId: nodeId,
				observerPosition: position,
				kind: candidate.kind,
			}
		}
	}
	const camera = deps.getCamera()
	if (camera) {
		scratch.copy(camera.position)
		return {
			observerNodeId: null,
			observerPosition: scratch,
			kind: 'camera',
		}
	}
	return {
		observerNodeId: null,
		observerPosition: null,
		kind: 'camera',
	}
}

export function createBehaviorProximityRuntime(deps: BehaviorProximityRuntimeDeps): BehaviorProximityRuntime {
	const thresholdCache = new Map<string, BehaviorProximityThreshold>()
	const tempBox = new THREE.Box3()
	const tempSphere = new THREE.Sphere()
	const tempRegionObserverPosition = new THREE.Vector3()
	const tempFocusPosition = new THREE.Vector3()
	const tempRegionEdge = new THREE.Vector2()
	const tempRegionPoint = new THREE.Vector2()

	function distanceToRegionBoundary(point: THREE.Vector2, vertices: Array<[number, number]>): number {
		let minimumDistanceSquared = Number.POSITIVE_INFINITY
		for (let index = 0; index < vertices.length; index += 1) {
			const current = vertices[index]
			const next = vertices[(index + 1) % vertices.length]
			if (!current || !next) continue
			tempRegionEdge.set(next[0] - current[0], next[1] - current[1])
			const edgeLengthSquared = tempRegionEdge.lengthSq()
			const projection = edgeLengthSquared > 1e-12
				? THREE.MathUtils.clamp(
					((point.x - current[0]) * tempRegionEdge.x + (point.y - current[1]) * tempRegionEdge.y) / edgeLengthSquared,
					0,
					1,
				)
				: 0
			const closestX = current[0] + tempRegionEdge.x * projection
			const closestY = current[1] + tempRegionEdge.y * projection
			minimumDistanceSquared = Math.min(
				minimumDistanceSquared,
				(point.x - closestX) ** 2 + (point.y - closestY) ** 2,
			)
		}
		return Number.isFinite(minimumDistanceSquared) ? Math.sqrt(minimumDistanceSquared) : 0
	}

	function computeObjectBoundingRadius(object: THREE.Object3D): number {
		tempBox.setFromObject(object)
		const hasFiniteBounds = [
			tempBox.min.x,
			tempBox.min.y,
			tempBox.min.z,
			tempBox.max.x,
			tempBox.max.y,
			tempBox.max.z,
		].every((value) => Number.isFinite(value))
		if (!hasFiniteBounds) {
			return DEFAULT_OBJECT_RADIUS
		}
		tempBox.getBoundingSphere(tempSphere)
		return Number.isFinite(tempSphere.radius) && tempSphere.radius > 0 ? tempSphere.radius : DEFAULT_OBJECT_RADIUS
	}

	function resolveProximityThresholds(nodeId: string, object: THREE.Object3D): BehaviorProximityThreshold {
		const cached = thresholdCache.get(nodeId)
		if (cached && cached.objectId === object.uuid) {
			return cached
		}
		const radius = computeObjectBoundingRadius(object)
		const enter = Math.max(PROXIMITY_MIN_DISTANCE, radius * PROXIMITY_RADIUS_SCALE)
		const exit = enter + PROXIMITY_EXIT_PADDING
		const nextThreshold: BehaviorProximityThreshold = {
			enter,
			exit,
			objectId: object.uuid,
		}
		thresholdCache.set(nodeId, nextThreshold)
		return nextThreshold
	}

	function resolveRegionBehaviorContainment(
		nodeId: string,
		object: THREE.Object3D,
		observerPosition: THREE.Vector3,
	): { inside: boolean; distance: number; boundaryDistance: number } | null {
		const node = deps.resolveRegionNode(nodeId)
		const dynamicMesh = node?.dynamicMesh ?? null
		const regionType = dynamicMesh?.type ?? null
		if (!node || !dynamicMesh || !regionType || !REGION_TYPES.includes(regionType as typeof REGION_TYPES[number])) {
			return null
		}
		const vertices = (Array.isArray(dynamicMesh.vertices) ? dynamicMesh.vertices : [])
			.map((entry) => [Number(entry?.[0]), Number(entry?.[1])] as [number, number])
			.filter(([x, z]) => Number.isFinite(x) && Number.isFinite(z))
		if (vertices.length < 3) {
			return { inside: false, distance: Number.POSITIVE_INFINITY, boundaryDistance: 0 }
		}
		const localObserver = object.worldToLocal(tempRegionObserverPosition.copy(observerPosition))
		tempRegionPoint.set(localObserver.x, localObserver.z)
		const inside = isPointInsideRegionXZ({ x: localObserver.x, z: localObserver.z }, vertices)
		const focusPoint = deps.resolveNodeFocusPoint(nodeId, tempFocusPosition) ?? object.getWorldPosition(tempFocusPosition)
		return {
			inside,
			distance: focusPoint.distanceTo(observerPosition),
			boundaryDistance: distanceToRegionBoundary(tempRegionPoint, vertices),
		}
	}

	function dispatchTransition(
		nodeId: string,
		state: BehaviorProximityState,
		action: 'approach' | 'depart',
		payload: { distance: number; threshold: number },
	): void {
		const followUps = deps.triggerBehaviorAction(nodeId, action, { payload })
		const sequenceId = followUps.find((event) => typeof event?.sequenceId === 'string')?.sequenceId ?? null
		if (sequenceId && !followUps.some((event) => event?.type === 'sequence-complete' || event?.type === 'sequence-error')) {
			state.pendingAction = action
			state.pendingSequenceId = sequenceId
			state.rebaselineRequired = false
		}
		deps.processBehaviorEvents(followUps)
	}

	function updateBehaviorProximity(): void {
		if (!deps.behaviorProximityCandidates.size) {
			return
		}
		const observerContext = deps.resolveObserverContext()
		if (!observerContext || !observerContext.observerPosition) {
			return
		}
		const observerPosition = observerContext.observerPosition
		deps.behaviorProximityCandidates.forEach((candidate, nodeId) => {
			const object = deps.nodeObjectMap.get(nodeId)
			if (!object) {
				return
			}
			const state = deps.behaviorProximityState.get(nodeId)
			if (!state) {
				return
			}
			const regionContainment = resolveRegionBehaviorContainment(nodeId, object, observerPosition)
			if (state.pendingSequenceId) {
				state.lastDistance = regionContainment?.distance ?? state.lastDistance
				return
			}
			if (regionContainment) {
				const safelyInside = regionContainment.inside && regionContainment.boundaryDistance >= PROXIMITY_EXIT_PADDING
				const safelyOutside = !regionContainment.inside && regionContainment.boundaryDistance >= PROXIMITY_EXIT_PADDING
				if (state.rebaselineRequired) {
					state.inside = safelyInside
					state.lastDistance = regionContainment.distance
					state.rebaselineRequired = false
					return
				}
				if (!state.inside && safelyInside) {
					state.inside = true
					if (candidate.hasApproach) {
						dispatchTransition(nodeId, state, 'approach', { distance: regionContainment.distance, threshold: PROXIMITY_EXIT_PADDING })
					}
				} else if (state.inside && safelyOutside) {
					state.inside = false
					if (candidate.hasDepart) {
						dispatchTransition(nodeId, state, 'depart', { distance: regionContainment.distance, threshold: PROXIMITY_EXIT_PADDING })
					}
				}
				state.lastDistance = regionContainment.distance
				return
			}
			const thresholds = resolveProximityThresholds(nodeId, object)
			const focusPoint = deps.resolveNodeFocusPoint(nodeId, tempFocusPosition) ?? object.getWorldPosition(tempFocusPosition)
			const distance = focusPoint.distanceTo(observerPosition)
			if (!Number.isFinite(distance)) {
				return
			}
			if (state.rebaselineRequired) {
				state.inside = distance <= thresholds.enter
				state.lastDistance = distance
				state.rebaselineRequired = false
				return
			}
			if (!state.inside && distance <= thresholds.enter) {
				state.inside = true
				if (candidate.hasApproach) {
					dispatchTransition(nodeId, state, 'approach', { distance, threshold: thresholds.enter })
				}
			} else if (state.inside && distance >= thresholds.exit) {
				state.inside = false
				if (candidate.hasDepart) {
					dispatchTransition(nodeId, state, 'depart', { distance, threshold: thresholds.exit })
				}
			}
			state.lastDistance = distance
		})
	}

	return {
		reset: () => {
			thresholdCache.clear()
			deps.behaviorProximityState.forEach((state) => {
				state.pendingAction = null
				state.pendingSequenceId = null
				state.rebaselineRequired = false
			})
		},
		removeNode: (nodeId: string) => {
			thresholdCache.delete(nodeId)
		},
		handleSequenceFinished: (sequenceId: string) => {
			deps.behaviorProximityState.forEach((state) => {
				if (state.pendingSequenceId !== sequenceId) return
				state.pendingAction = null
				state.pendingSequenceId = null
				state.rebaselineRequired = true
			})
		},
		resolveProximityThresholds,
		resolveRegionBehaviorContainment,
		updateBehaviorProximity,
	}
}
