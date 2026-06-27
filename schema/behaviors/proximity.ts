import * as THREE from 'three'
import { isPointInsideRegionXZ } from '../core'
import {
	DEFAULT_OBJECT_RADIUS,
	PROXIMITY_EXIT_PADDING,
	PROXIMITY_MIN_DISTANCE,
	PROXIMITY_RADIUS_SCALE,
} from './runtime'

export type BehaviorProximityCandidate = { hasApproach: boolean; hasDepart: boolean }
export type BehaviorProximityState = { inside: boolean; lastDistance: number | null }
export type BehaviorProximityThreshold = { enter: number; exit: number; objectId: string }

export type BehaviorProximityRegionNode = {
	dynamicMesh?: {
		type?: string | null
		vertices?: unknown
	} | null
}

export type BehaviorProximityRuntimeDeps = {
	getCamera: () => THREE.PerspectiveCamera | null
	getObserverNodeId: () => string | null
	resolveObserverPosition: (observerNodeId: string, scratch: THREE.Vector3) => THREE.Vector3 | null
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
	resolveProximityThresholds: (nodeId: string, object: THREE.Object3D) => BehaviorProximityThreshold
	resolveRegionBehaviorContainment: (
		nodeId: string,
		object: THREE.Object3D,
		observerPosition: THREE.Vector3,
	) => { inside: boolean; distance: number } | null
	updateBehaviorProximity: () => void
}

const REGION_TYPES = ['Region', 'Floor', 'Road', 'Water', 'Landform'] as const

export function createBehaviorProximityRuntime(deps: BehaviorProximityRuntimeDeps): BehaviorProximityRuntime {
	const thresholdCache = new Map<string, BehaviorProximityThreshold>()
	const tempBox = new THREE.Box3()
	const tempSphere = new THREE.Sphere()
	const tempRegionObserverPosition = new THREE.Vector3()
	const tempObserverPosition = new THREE.Vector3()
	const tempFocusPosition = new THREE.Vector3()

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
	): { inside: boolean; distance: number } | null {
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
			return { inside: false, distance: Number.POSITIVE_INFINITY }
		}
		const localObserver = object.worldToLocal(tempRegionObserverPosition.copy(observerPosition))
		const inside = isPointInsideRegionXZ({ x: localObserver.x, z: localObserver.z }, vertices)
		const focusPoint = deps.resolveNodeFocusPoint(nodeId, tempFocusPosition) ?? object.getWorldPosition(tempFocusPosition)
		return {
			inside,
			distance: focusPoint.distanceTo(observerPosition),
		}
	}

	function updateBehaviorProximity(): void {
		const camera = deps.getCamera()
		if (!camera || !deps.behaviorProximityCandidates.size) {
			return
		}
		let observerPosition = camera.position
		const observerNodeId = deps.getObserverNodeId()
		if (observerNodeId) {
			const observerPoint = deps.resolveObserverPosition(observerNodeId, tempObserverPosition)
			if (observerPoint) {
				observerPosition = observerPoint
			}
		}
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
			if (regionContainment) {
				if (!state.inside && regionContainment.inside) {
					state.inside = true
					if (candidate.hasApproach) {
						const followUps = deps.triggerBehaviorAction(nodeId, 'approach', {
							payload: {
								distance: regionContainment.distance,
								threshold: 0,
							},
						})
						deps.processBehaviorEvents(followUps)
					}
				} else if (state.inside && !regionContainment.inside) {
					state.inside = false
					if (candidate.hasDepart) {
						const followUps = deps.triggerBehaviorAction(nodeId, 'depart', {
							payload: {
								distance: regionContainment.distance,
								threshold: 0,
							},
						})
						deps.processBehaviorEvents(followUps)
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
			if (!state.inside && distance <= thresholds.enter) {
				state.inside = true
				if (candidate.hasApproach) {
					const followUps = deps.triggerBehaviorAction(nodeId, 'approach', {
						payload: {
							distance,
							threshold: thresholds.enter,
						},
					})
					deps.processBehaviorEvents(followUps)
				}
			} else if (state.inside && distance >= thresholds.exit) {
				state.inside = false
				if (candidate.hasDepart) {
					const followUps = deps.triggerBehaviorAction(nodeId, 'depart', {
						payload: {
							distance,
							threshold: thresholds.exit,
						},
					})
					deps.processBehaviorEvents(followUps)
				}
			}
			state.lastDistance = distance
		})
	}

	return {
		reset: () => {
			thresholdCache.clear()
		},
		removeNode: (nodeId: string) => {
			thresholdCache.delete(nodeId)
		},
		resolveProximityThresholds,
		resolveRegionBehaviorContainment,
		updateBehaviorProximity,
	}
}
