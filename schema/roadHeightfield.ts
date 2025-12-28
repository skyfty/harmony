import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { SceneNode, SceneNodeComponentState, RoadDynamicMesh } from '@harmony/schema'

import type { RigidbodyComponentProps, RigidbodyPhysicsShape } from './components'
import { ROAD_COMPONENT_TYPE, type RoadComponentProps } from './components/definitions/roadComponent'
import { resolveRoadLocalHeightSampler } from './roadMesh'

export type RoadHeightfieldBodiesEntry = { signature: string; bodies: CANNON.Body[] }

export type RoadHeightfieldBuildParams = {
	roadNode: SceneNode
	rigidbodyComponent: SceneNodeComponentState<RigidbodyComponentProps>
	roadObject: THREE.Object3D
	groundNode: SceneNode
	world: CANNON.World
	createBody: (
		node: SceneNode,
		component: SceneNodeComponentState<RigidbodyComponentProps>,
		shapeDefinition: RigidbodyPhysicsShape | null,
		object: THREE.Object3D,
	) => { body: CANNON.Body } | null
	maxSegments?: number
}

export function isRoadDynamicMesh(value: SceneNode['dynamicMesh'] | null | undefined): value is RoadDynamicMesh {
	return Boolean(value && (value as any).type === 'Road')
}

const ROAD_PHYSICS_MIN_SEGMENT_LENGTH = 0.25
const ROAD_PHYSICS_MIN_ROWS = 4
const ROAD_PHYSICS_MAX_ROWS = 96
const ROAD_PHYSICS_MIN_COLUMNS = 2
const ROAD_PHYSICS_MAX_COLUMNS = 48
const ROAD_PHYSICS_BASE_CELL_SIZE = 0.75

const ROAD_PHYSICS_SURFACE_Y_OFFSET = 0.01
const ROAD_PHYSICS_SHOULDER_WIDTH = 0.35
const ROAD_PHYSICS_SHOULDER_GAP = 0.02
const ROAD_PHYSICS_SLOPE_MAX_GRADE = 0.8
const ROAD_PHYSICS_SLOPE_MIN_DELTA_Y = 0.03

const roadPhysicsVecA = new THREE.Vector3()
const roadPhysicsVecB = new THREE.Vector3()
const roadPhysicsForward = new THREE.Vector3()
const roadPhysicsRight = new THREE.Vector3()
const roadPhysicsUp = new THREE.Vector3(0, 1, 0)
const roadPhysicsBasis = new THREE.Matrix4()
const roadPhysicsBodyQuat = new THREE.Quaternion()

function smoothHeightSeries(values: number[], passes: number, minimums: number[]): number[] {
	const count = values.length
	if (count <= 2 || minimums.length !== count) {
		return values
	}
	const iterations = Math.max(0, Math.min(12, Math.trunc(passes)))
	if (iterations === 0) {
		return values
	}
	let working = values.slice()
	for (let pass = 0; pass < iterations; pass += 1) {
		const next = working.slice()
		for (let i = 1; i < count - 1; i += 1) {
			const prev = working[i - 1] ?? 0
			const current = working[i] ?? 0
			const nextValue = working[i + 1] ?? 0
			const averaged = (prev + current * 2 + nextValue) / 4
			const floorValue = minimums[i] ?? 0
			next[i] = Math.max(floorValue, averaged)
		}
		working = next
	}
	return working
}

function clampHeightSeriesSlope(values: number[], minimums: number[], maxDeltaY: number): number[] {
	const count = values.length
	if (count <= 2 || minimums.length !== count) {
		return values
	}
	const delta = Number.isFinite(maxDeltaY) ? Math.max(0, maxDeltaY) : 0
	if (delta <= 0) {
		return values
	}
	const working = values.slice()
	for (let i = 1; i < count; i += 1) {
		const previous = working[i - 1] ?? 0
		const current = working[i] ?? 0
		const floorValue = minimums[i] ?? 0
		const upper = previous + delta
		const clamped = Math.min(current, upper)
		working[i] = Math.max(floorValue, clamped)
	}
	for (let i = count - 2; i >= 0; i -= 1) {
		const next = working[i + 1] ?? 0
		const current = working[i] ?? 0
		const floorValue = minimums[i] ?? 0
		const upper = next + delta
		const clamped = Math.min(current, upper)
		working[i] = Math.max(floorValue, clamped)
	}
	return working
}

function computeHeightSmoothingPasses(divisions: number, strengthFactor = 1.0): number {
	if (!Number.isFinite(divisions) || divisions <= 0) {
		return 3
	}
	const factor = Math.max(0.1, Math.min(5, Number.isFinite(strengthFactor) ? strengthFactor : 1.0))
	const suggested = Math.round((divisions / 12) * factor)
	return Math.max(3, Math.min(12, suggested))
}

export function buildRoadHeightfieldBodies(params: RoadHeightfieldBuildParams): RoadHeightfieldBodiesEntry | null {
	const {
		roadNode: node,
		rigidbodyComponent,
		roadObject: object,
		groundNode,
		world,
		createBody,
		maxSegments = 256,
	} = params

	if (!isRoadDynamicMesh(node.dynamicMesh)) {
		return null
	}
	const props = rigidbodyComponent.props as RigidbodyComponentProps
	if (props.bodyType !== 'STATIC') {
		return null
	}
	const sampler = resolveRoadLocalHeightSampler(node, groundNode)
	if (!sampler) {
		return null
	}

	const roadComponent = (node.components?.[ROAD_COMPONENT_TYPE] as SceneNodeComponentState<RoadComponentProps> | undefined) ?? undefined
	const roadProps = (roadComponent?.props as Partial<RoadComponentProps> | undefined) ?? undefined
	const samplingDensityFactor =
		typeof roadProps?.samplingDensityFactor === 'number' && Number.isFinite(roadProps.samplingDensityFactor)
			? Math.max(0.1, Math.min(5, roadProps.samplingDensityFactor))
			: 1.0
	const smoothingStrengthFactor =
		typeof roadProps?.smoothingStrengthFactor === 'number' && Number.isFinite(roadProps.smoothingStrengthFactor)
			? Math.max(0.1, Math.min(5, roadProps.smoothingStrengthFactor))
			: 1.0
	const minClearance =
		typeof roadProps?.minClearance === 'number' && Number.isFinite(roadProps.minClearance)
			? Math.max(0, Math.min(2, roadProps.minClearance))
			: 0.01

	const width = Number.isFinite(node.dynamicMesh.width) ? Math.max(0.2, node.dynamicMesh.width) : 2
	const shouldersEnabled = roadProps?.shoulders === true
	const shoulderWidth =
		typeof roadProps?.shoulderWidth === 'number' && Number.isFinite(roadProps.shoulderWidth) && roadProps.shoulderWidth > 0.01
			? roadProps.shoulderWidth
			: ROAD_PHYSICS_SHOULDER_WIDTH
	const envelopeHalfWidth = shouldersEnabled
		? Math.max(width * 0.5, width * 0.5 + ROAD_PHYSICS_SHOULDER_GAP + shoulderWidth)
		: Math.max(width * 0.5, 0.05)

	const vertices = Array.isArray(node.dynamicMesh.vertices) ? node.dynamicMesh.vertices : []
	const rawSegments = Array.isArray(node.dynamicMesh.segments) ? node.dynamicMesh.segments : []
	const segments = rawSegments.length
		? rawSegments
		: vertices.length >= 2
			? Array.from({ length: vertices.length - 1 }, (_unused, index) => ({ a: index, b: index + 1 }))
			: []

	if (!vertices.length || segments.length === 0) {
		return null
	}

	const baseCell = Math.max(0.15, Math.min(2, ROAD_PHYSICS_BASE_CELL_SIZE / samplingDensityFactor))
	let signatureHash = 0
	const signatureParts: string[] = [
		`w:${Math.round(width * 1000)}`,
		`ehw:${Math.round(envelopeHalfWidth * 1000)}`,
		`sd:${samplingDensityFactor.toFixed(2)}`,
		`ss:${smoothingStrengthFactor.toFixed(2)}`,
		`mc:${Math.round(minClearance * 1000)}`,
		`v:${vertices.length}`,
		`s:${segments.length}`,
	]

	const bodies: CANNON.Body[] = []

	for (let segIndex = 0; segIndex < Math.min(segments.length, Math.max(0, Math.trunc(maxSegments))); segIndex += 1) {
		const seg = segments[segIndex] as any
		const a = Math.trunc(Number(seg?.a))
		const b = Math.trunc(Number(seg?.b))
		if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0 || a >= vertices.length || b >= vertices.length) {
			continue
		}
		const va = vertices[a] as any
		const vb = vertices[b] as any
		const ax = Number(va?.[0])
		const az = Number(va?.[1])
		const bx = Number(vb?.[0])
		const bz = Number(vb?.[1])
		if (![ax, az, bx, bz].every((n) => Number.isFinite(n))) {
			continue
		}

		roadPhysicsVecA.set(ax, 0, az)
		roadPhysicsVecB.set(bx, 0, bz)
		roadPhysicsForward.copy(roadPhysicsVecB).sub(roadPhysicsVecA)
		roadPhysicsForward.y = 0
		const segmentLength = roadPhysicsForward.length()
		if (!Number.isFinite(segmentLength) || segmentLength < ROAD_PHYSICS_MIN_SEGMENT_LENGTH) {
			continue
		}
		roadPhysicsForward.normalize()
		roadPhysicsRight.set(-roadPhysicsForward.z, 0, roadPhysicsForward.x)
		if (roadPhysicsRight.lengthSq() < 1e-8) {
			roadPhysicsRight.set(1, 0, 0)
		} else {
			roadPhysicsRight.normalize()
		}

		const midX = (ax + bx) * 0.5
		const midZ = (az + bz) * 0.5

		const rows = Math.max(ROAD_PHYSICS_MIN_ROWS, Math.min(ROAD_PHYSICS_MAX_ROWS, Math.ceil(segmentLength / baseCell)))
		const elementSize = segmentLength / rows
		const columns = Math.max(
			ROAD_PHYSICS_MIN_COLUMNS,
			Math.min(ROAD_PHYSICS_MAX_COLUMNS, Math.ceil((envelopeHalfWidth * 2) / elementSize)),
		)
		const widthActual = columns * elementSize
		const depthActual = rows * elementSize

		const maxDeltaY = Math.max(
			ROAD_PHYSICS_SLOPE_MIN_DELTA_Y,
			(depthActual / Math.max(1, rows)) * ROAD_PHYSICS_SLOPE_MAX_GRADE,
		)

		const clearance = ROAD_PHYSICS_SURFACE_Y_OFFSET + minClearance
		const heights: number[] = []
		const minimums: number[] = []
		const halfWidth = widthActual * 0.5
		for (let i = 0; i <= rows; i += 1) {
			const s = i * elementSize - depthActual * 0.5
			const cx = midX + roadPhysicsForward.x * s
			const cz = midZ + roadPhysicsForward.z * s
			const lx = cx + roadPhysicsRight.x * halfWidth
			const lz = cz + roadPhysicsRight.z * halfWidth
			const rx = cx - roadPhysicsRight.x * halfWidth
			const rz = cz - roadPhysicsRight.z * halfWidth
			const centerY = sampler(cx, cz)
			const leftY = sampler(lx, lz)
			const rightY = sampler(rx, rz)
			const envelope =
				Math.max(
					Number.isFinite(centerY) ? centerY : 0,
					Number.isFinite(leftY) ? leftY : 0,
					Number.isFinite(rightY) ? rightY : 0,
				) + clearance
			heights.push(envelope)
			minimums.push(envelope)
			const normalized = Math.round(envelope * 1000)
			signatureHash = (signatureHash * 31 + normalized) >>> 0
		}

		const smoothed = smoothHeightSeries(heights, computeHeightSmoothingPasses(rows, smoothingStrengthFactor), minimums)
		const clamped = clampHeightSeriesSlope(smoothed, minimums, maxDeltaY)

		const matrix: number[][] = []
		for (let column = 0; column <= columns; column += 1) {
			const columnValues: number[] = []
			for (let row = rows; row >= 0; row -= 1) {
				columnValues.push(clamped[row] ?? 0)
			}
			matrix.push(columnValues)
		}

		const shapeDefinition: RigidbodyPhysicsShape = {
			kind: 'heightfield',
			matrix,
			elementSize,
			width: widthActual,
			depth: depthActual,
			offset: [-widthActual * 0.5, -depthActual * 0.5, 0],
			scaleNormalized: false,
		}

		const segmentObject = new THREE.Object3D()
		segmentObject.position.set(midX, 0, midZ)
		segmentObject.quaternion.identity()
		segmentObject.scale.set(1, 1, 1)
		segmentObject.updateMatrixWorld(true)
		object.updateMatrixWorld(true)
		segmentObject.applyMatrix4(object.matrixWorld)
		segmentObject.updateMatrixWorld(true)

		// Desired body basis: +X=right, +Y=up, +Z=-forward.
		roadPhysicsBasis.makeBasis(roadPhysicsRight, roadPhysicsUp, roadPhysicsForward.clone().multiplyScalar(-1))
		roadPhysicsBodyQuat.setFromRotationMatrix(roadPhysicsBasis)
		segmentObject.quaternion.copy(roadPhysicsBodyQuat)
		segmentObject.updateMatrixWorld(true)

		const entry = createBody(node, rigidbodyComponent, shapeDefinition, segmentObject)
		if (!entry) {
			continue
		}
		world.addBody(entry.body)
		bodies.push(entry.body)
	}

	const signature = `${signatureParts.join('|')}|h:${signatureHash.toString(16)}|b:${bodies.length}`
	return { signature, bodies }
}
