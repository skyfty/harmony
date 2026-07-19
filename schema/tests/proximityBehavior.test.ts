import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
	createBehaviorProximityRuntime,
	type BehaviorProximityCandidate,
	type BehaviorProximityState,
} from '../behaviors/proximity.ts'

function createDistanceRuntime() {
	const target = new THREE.Object3D()
	const observer = new THREE.Vector3(2.5, 0, 0)
	const candidates = new Map<string, BehaviorProximityCandidate>([['target', { hasApproach: true, hasDepart: true }]])
	const states = new Map<string, BehaviorProximityState>([['target', { inside: false, lastDistance: null }]])
	const objects = new Map<string, THREE.Object3D>([['target', target]])
	const triggered: Array<{ nodeId: string; action: 'approach' | 'depart' }> = []
	let sequence = 0
	const runtime = createBehaviorProximityRuntime({
		resolveObserverContext: () => ({ observerNodeId: 'observer', observerPosition: observer, kind: 'character' }),
		behaviorProximityCandidates: candidates,
		behaviorProximityState: states,
		nodeObjectMap: objects,
		resolveRegionNode: () => null,
		resolveNodeFocusPoint: (_nodeId, fallback) => fallback.copy(target.position),
		triggerBehaviorAction: (nodeId, action) => {
			triggered.push({ nodeId, action })
			sequence += 1
			return [{ type: 'control-node-switch', sequenceId: `sequence-${sequence}` }]
		},
		processBehaviorEvents: () => undefined,
	})
	return { observer, states, triggered, runtime }
}

test('holds proximity transitions while an approach sequence is pending', () => {
	const { observer, states, triggered, runtime } = createDistanceRuntime()
	runtime.updateBehaviorProximity()
	assert.deepEqual(triggered.map((entry) => entry.action), ['approach'])

	observer.x = 10
	runtime.updateBehaviorProximity()
	assert.deepEqual(triggered.map((entry) => entry.action), ['approach'])

	runtime.handleSequenceFinished('sequence-1')
	runtime.updateBehaviorProximity()
	assert.deepEqual(triggered.map((entry) => entry.action), ['approach'])
	assert.equal(states.get('target')?.inside, false)

	observer.x = 2.5
	runtime.updateBehaviorProximity()
	assert.deepEqual(triggered.map((entry) => entry.action), ['approach', 'approach'])
})

test('dispatches depart after a completed approach when the observer clearly leaves', () => {
	const { observer, triggered, runtime } = createDistanceRuntime()
	runtime.updateBehaviorProximity()
	runtime.handleSequenceFinished('sequence-1')
	runtime.updateBehaviorProximity()

	observer.x = 10
	runtime.updateBehaviorProximity()
	assert.deepEqual(triggered.map((entry) => entry.action), ['approach', 'depart'])
})

test('applies a boundary deadband to region proximity', () => {
	const target = new THREE.Object3D()
	const observer = new THREE.Vector3(0.25, 0, 5)
	const state: BehaviorProximityState = { inside: false, lastDistance: null }
	const triggered: string[] = []
	const runtime = createBehaviorProximityRuntime({
		resolveObserverContext: () => ({ observerNodeId: 'observer', observerPosition: observer, kind: 'character' }),
		behaviorProximityCandidates: new Map([['region', { hasApproach: true, hasDepart: true }]]),
		behaviorProximityState: new Map([['region', state]]),
		nodeObjectMap: new Map([['region', target]]),
		resolveRegionNode: () => ({ dynamicMesh: { type: 'Region', vertices: [[0, 0], [10, 0], [10, 10], [0, 10]] } }),
		resolveNodeFocusPoint: (_nodeId, fallback) => fallback.copy(target.position),
		triggerBehaviorAction: (_nodeId, action) => {
			triggered.push(action)
			return []
		},
		processBehaviorEvents: () => undefined,
	})

	runtime.updateBehaviorProximity()
	assert.deepEqual(triggered, [])
	observer.x = 2
	runtime.updateBehaviorProximity()
	assert.deepEqual(triggered, ['approach'])
	observer.x = 11
	runtime.updateBehaviorProximity()
	assert.deepEqual(triggered, ['approach', 'depart'])
})
