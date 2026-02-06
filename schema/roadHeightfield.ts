import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { SceneNode, SceneNodeComponentState, RoadDynamicMesh } from './index'

import type { RigidbodyComponentProps, RigidbodyPhysicsShape } from './components'
import { ROAD_COMPONENT_TYPE, clampRoadProps, type RoadComponentProps } from './components/definitions/roadComponent'
import { resolveRoadLocalHeightSampler } from './roadMesh'
import { buildGroundHeightfieldData } from './groundHeightfield'
import { buildRoadCornerBezierCurvePath } from './roadCurvePath'
import { buildRoadGraph, type RoadGraph } from './roadGraph'

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

export function buildRoadHeightfieldBodies(params: RoadHeightfieldBuildParams): RoadHeightfieldBodiesEntry | null {
	const {
		roadNode,
		rigidbodyComponent,
		roadObject,
		groundNode,
		createBody,
		maxSegments,
	} = params

	if (!isRoadDynamicMesh(roadNode.dynamicMesh)) {
		return null
	}
	const definition = roadNode.dynamicMesh
	if ((rigidbodyComponent.props as RigidbodyComponentProps | undefined)?.bodyType !== 'STATIC') {
		return null
	}

	const roadState = roadNode.components?.[ROAD_COMPONENT_TYPE] as
		| SceneNodeComponentState<RoadComponentProps>
		| undefined
	const roadProps = clampRoadProps(roadState?.props as Partial<RoadComponentProps> | null | undefined)
	const roadWidth = Math.max(0.01, Number.isFinite(roadProps.width) ? roadProps.width : 2)
	const samplingDensityFactor = roadProps.samplingDensityFactor ?? 1.0
	const smoothingStrengthFactor = roadProps.smoothingStrengthFactor ?? 1.0
	const minClearance = roadProps.minClearance ?? 0.01
	const junctionSmoothing = roadProps.junctionSmoothing ?? 0

	const heightSampler = resolveRoadLocalHeightSampler(roadNode, groundNode)
	if (!heightSampler) {
		return null
	}

	const graph = buildRoadGraph(definition)
	if (!graph) {
		return null
	}
	const curves = buildRoadCurvesFromGraph(junctionSmoothing, graph)
	if (!curves.length) {
		return null
	}

	roadObject.updateMatrixWorld(true)

	const desiredTileLength = clampNumber(roadWidth * 8, 2, 16, 8)
	const targetRows = 192
	const elementSize = Math.max(1e-4, desiredTileLength / targetRows)
	const maxBodies = typeof maxSegments === 'number' && Number.isFinite(maxSegments)
		? Math.max(1, Math.trunc(maxSegments))
		: 128

	let totalBodies = 0
	const bodies: CANNON.Body[] = []
	let signatureHash = 0

	for (const descriptor of curves) {
		if (totalBodies >= maxBodies) {
			break
		}
		const curve = descriptor.curve
		const length = curve.getLength()
		if (!(length > 1e-6)) {
			continue
		}
		const divisions = computeRoadDivisionsForCurve(curve, length, samplingDensityFactor, junctionSmoothing)
		if (divisions < 2) {
			continue
		}
		const { heights: smoothedHeights, minimums } = buildSmoothedHeightSeries({
			curve,
			divisions,
			width: roadWidth,
			heightSampler,
			minClearance,
			smoothingStrengthFactor,
		})
		// Feed the signature with the final smoothed heights so edits invalidate correctly.
		smoothedHeights.forEach((value) => {
			const normalized = Math.round((Number.isFinite(value) ? value : 0) * 1000)
			signatureHash = (signatureHash * 31 + normalized) >>> 0
		})

		const stepDistance = length / divisions
		const divisionsPerTile = Math.max(1, Math.round(desiredTileLength / stepDistance))
		let startIndex = 0
		const p0 = new THREE.Vector3()
		const p1 = new THREE.Vector3()
		const forward = new THREE.Vector3()
		const centerPoint = new THREE.Vector3()
		while (startIndex < divisions && totalBodies < maxBodies) {
			let endIndex = Math.min(divisions, startIndex + divisionsPerTile)
			const startU = startIndex / divisions
			let endU = endIndex / divisions
			let headingDelta = computeHeadingDeltaRad(curve, startU, endU)
			// Reduce tile length on bends so the collider aligns to the curved road surface.
			while (endIndex - startIndex > 1 && headingDelta > ROAD_TILE_MAX_HEADING_DELTA_RAD) {
				endIndex = startIndex + Math.max(1, Math.ceil((endIndex - startIndex) * 0.5))
				endU = endIndex / divisions
				headingDelta = computeHeadingDeltaRad(curve, startU, endU)
			}
			curve.getPoint(startU, p0)
			curve.getPoint(endU, p1)
			forward.copy(p1).sub(p0)
			const forwardLen = Math.hypot(forward.x, forward.z)
			let yaw = 0
			if (forwardLen > ROAD_EPSILON) {
				yaw = Math.atan2(forward.x, forward.z)
			} else {
				const midU = (startU + endU) * 0.5
				const tangent = curve.getTangent(midU)
				yaw = Math.atan2(tangent.x, tangent.z)
			}
			centerPoint.copy(p0).add(p1).multiplyScalar(0.5)
			const tileLength = Math.max((endIndex - startIndex) * stepDistance, forwardLen)
			const heightDelta = computeHeightDelta(smoothedHeights, startIndex, endIndex)
			const isStraightEnough = headingDelta <= ROAD_STRAIGHT_MAX_HEADING_DELTA_RAD
			const isFlatEnough = heightDelta <= ROAD_FLAT_MAX_HEIGHT_DELTA
			const tileObject = new THREE.Object3D()
			tileObject.rotation.set(0, yaw, 0)
			let shape: RigidbodyPhysicsShape | null = null
			if (isStraightEnough && isFlatEnough) {
				const avgHeight = computeHeightAverage(smoothedHeights, startIndex, endIndex)
				const thickness = ROAD_BOX_THICKNESS
				tileObject.position.set(centerPoint.x, avgHeight - thickness * 0.5, centerPoint.z)
				shape = {
					kind: 'box',
					halfExtents: [roadWidth * 0.5, thickness * 0.5, tileLength * 0.5],
					offset: [0, 0, 0],
					applyScale: false,
				}
			} else {
				tileObject.position.set(centerPoint.x, 0, centerPoint.z)
				const rows = Math.max(2, Math.ceil(tileLength / elementSize))
				const columns = Math.max(2, Math.ceil(roadWidth / elementSize))
				shape = buildHeightfieldShapeFromSeries({
					startIndex,
					endIndex,
					rows,
					columns,
					elementSize,
					heights: smoothedHeights,
					minimums,
				})
				if (!shape) {
					startIndex = endIndex
					continue
				}
			}
			roadObject.add(tileObject)
			tileObject.updateMatrixWorld(true)
			const bodyResult = createBody(roadNode, rigidbodyComponent, shape, tileObject)
			roadObject.remove(tileObject)
			if (bodyResult?.body) {
				bodies.push(bodyResult.body)
				totalBodies += 1
			}
			startIndex = endIndex
		}
	}

	if (!bodies.length) {
		return null
	}

	const groundData = groundNode && (groundNode.dynamicMesh as any)?.type === 'Ground'
		? buildGroundHeightfieldData(groundNode, groundNode.dynamicMesh as any)
		: null
	const groundSignature = groundData?.signature ?? 'none'
	const signature = buildRoadHeightfieldSignature({
		definition,
		roadNode,
		groundNode,
		groundSignature,
		roadWidth,
		samplingDensityFactor,
		smoothingStrengthFactor,
		minClearance,
		junctionSmoothing,
		elementSize,
		desiredTileLength,
		bodyCount: bodies.length,
		heightHash: signatureHash,
	})

	return { signature, bodies }
}

const ROAD_SURFACE_Y_OFFSET = 0.01
const ROAD_EPSILON = 1e-6
const ROAD_MIN_DIVISIONS = 4
const ROAD_MAX_DIVISIONS = 256
const ROAD_DIVISION_DENSITY = 8

const ROAD_HEIGHT_SMOOTHING_MIN_PASSES = 3
const ROAD_HEIGHT_SMOOTHING_MAX_PASSES = 12

const ROAD_HEIGHT_SLOPE_MAX_GRADE = 0.8
const ROAD_HEIGHT_SLOPE_MIN_DELTA_Y = 0.03

// Hybrid collision tuning:
// - Straight + near-flat tiles use a thin box collider (cheap).
// - Curved/undulating tiles fall back to segmented heightfields (accurate).
// - Tile length is adaptively reduced on bends to keep chord approximation tight.
const ROAD_TILE_MAX_HEADING_DELTA_RAD = (8 * Math.PI) / 180
const ROAD_STRAIGHT_MAX_HEADING_DELTA_RAD = (2 * Math.PI) / 180
const ROAD_FLAT_MAX_HEIGHT_DELTA = 0.02
const ROAD_BOX_THICKNESS = 0.2

function normalizeAngleRad(angle: number): number {
	if (!Number.isFinite(angle)) {
		return 0
	}
	let value = angle
	while (value > Math.PI) {
		value -= Math.PI * 2
	}
	while (value < -Math.PI) {
		value += Math.PI * 2
	}
	return value
}

function computeHeadingDeltaRad(curve: THREE.Curve<THREE.Vector3>, startU: number, endU: number): number {
	const t0 = curve.getTangent(Math.max(0, Math.min(1, startU)))
	t0.y = 0
	const t1 = curve.getTangent(Math.max(0, Math.min(1, endU)))
	t1.y = 0
	const a0 = Math.atan2(t0.x, t0.z)
	const a1 = Math.atan2(t1.x, t1.z)
	return Math.abs(normalizeAngleRad(a1 - a0))
}

function computeHeightDelta(values: number[], startIndex: number, endIndex: number): number {
	if (!values.length) {
		return 0
	}
	const i0 = Math.max(0, Math.min(values.length - 1, startIndex))
	const i1 = Math.max(i0, Math.min(values.length - 1, endIndex))
	let min = Number.POSITIVE_INFINITY
	let max = Number.NEGATIVE_INFINITY
	for (let i = i0; i <= i1; i += 1) {
		const v = values[i]
		const value = typeof v === 'number' && Number.isFinite(v) ? v : 0
		if (value < min) {
			min = value
		}
		if (value > max) {
			max = value
		}
	}
	if (!Number.isFinite(min) || !Number.isFinite(max)) {
		return 0
	}
	return max - min
}

function computeHeightAverage(values: number[], startIndex: number, endIndex: number): number {
	if (!values.length) {
		return 0
	}
	const i0 = Math.max(0, Math.min(values.length - 1, startIndex))
	const i1 = Math.max(i0, Math.min(values.length - 1, endIndex))
	let sum = 0
	let count = 0
	for (let i = i0; i <= i1; i += 1) {
		const v = values[i]
		const value = typeof v === 'number' && Number.isFinite(v) ? v : 0
		sum += value
		count += 1
	}
	return count ? sum / count : 0
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
	return Math.max(min, Math.min(max, numeric))
}

function computeRoadDivisions(length: number, samplingDensityFactor = 1.0): number {
	if (!Number.isFinite(length) || length <= ROAD_EPSILON) {
		return 0
	}
	const densityFactor = clampNumber(samplingDensityFactor, 0.1, 10, 1.0)
	return Math.max(
		ROAD_MIN_DIVISIONS,
		Math.min(ROAD_MAX_DIVISIONS, Math.ceil(length * ROAD_DIVISION_DENSITY * densityFactor)),
	)
}

function computeCornerMinSegments(junctionSmoothing = 0): number {
	const smoothing = clampNumber(junctionSmoothing, 0, 1, 0)
	const suggested = Math.round(12 + 12 * smoothing)
	return Math.max(6, Math.min(48, suggested))
}

function computeRoadDivisionsForCurve(
	curve: THREE.Curve<THREE.Vector3>,
	length: number,
	samplingDensityFactor = 1.0,
	junctionSmoothing = 0,
): number {
	let divisions = computeRoadDivisions(length, samplingDensityFactor)
	if (!(divisions > 0)) {
		return 0
	}
	const curves = (curve as any)?.curves
	if (!Array.isArray(curves) || !curves.length) {
		return divisions
	}
	const cornerMinSegments = computeCornerMinSegments(junctionSmoothing)
	for (const segment of curves as Array<THREE.Curve<THREE.Vector3>>) {
		const isQuadratic = Boolean((segment as any)?.isQuadraticBezierCurve3)
		if (!isQuadratic) {
			continue
		}
		const cornerLength = segment.getLength()
		if (!Number.isFinite(cornerLength) || cornerLength <= ROAD_EPSILON) {
			continue
		}
		const requiredTotal = Math.ceil((cornerMinSegments * length) / cornerLength)
		if (Number.isFinite(requiredTotal)) {
			divisions = Math.max(divisions, requiredTotal)
		}
	}
	return Math.max(ROAD_MIN_DIVISIONS, Math.min(ROAD_MAX_DIVISIONS, divisions))
}

function computeHeightSmoothingPasses(divisions: number, strengthFactor = 1.0): number {
	if (!Number.isFinite(divisions) || divisions <= 0) {
		return ROAD_HEIGHT_SMOOTHING_MIN_PASSES
	}
	const factor = clampNumber(strengthFactor, 0.1, 5, 1.0)
	const suggested = Math.round((divisions / 12) * factor)
	return Math.max(ROAD_HEIGHT_SMOOTHING_MIN_PASSES, Math.min(ROAD_HEIGHT_SMOOTHING_MAX_PASSES, suggested))
}

function smoothHeightSeries(values: number[], passes: number, minimums: number[]): number[] {
	const count = values.length
	if (count <= 2 || minimums.length !== count) {
		return values.slice()
	}
	const iterations = Math.max(0, Math.min(12, Math.trunc(passes)))
	if (iterations === 0) {
		return values.slice()
	}
	let working = values.slice()
	for (let pass = 0; pass < iterations; pass += 1) {
		const next = working.slice()
		for (let i = 1; i < count - 1; i += 1) {
			const smoothed = (working[i - 1]! + working[i]! + working[i + 1]!) / 3
			next[i] = Math.max(minimums[i]!, smoothed)
		}
		next[0] = Math.max(minimums[0]!, next[0]!)
		next[count - 1] = Math.max(minimums[count - 1]!, next[count - 1]!)
		working = next
	}
	return working
}

function clampHeightSeriesSlope(values: number[], minimums: number[], maxDeltaY: number): number[] {
	const count = values.length
	if (count <= 2 || minimums.length !== count) {
		return values.slice()
	}
	const delta = Number.isFinite(maxDeltaY) ? Math.max(0, maxDeltaY) : 0
	if (delta <= 0) {
		return values.slice()
	}
	const working = values.slice()
	for (let i = 1; i < count; i += 1) {
		working[i] = Math.max(minimums[i]!, Math.min(working[i]!, working[i - 1]! + delta))
	}
	for (let i = count - 2; i >= 0; i -= 1) {
		working[i] = Math.max(minimums[i]!, Math.min(working[i]!, working[i + 1]! + delta))
	}
	return working
}

// Removed unused SanitizedRoadSegment type
// Removed unused road graph helpers: RoadBuildData, sanitizeRoadVertices, buildAdjacencyMap, collectRoadPaths
// Removed unused `collectRoadBuildData` helper.

type RoadCurveDescriptor = { curve: THREE.Curve<THREE.Vector3> }

function buildRoadCurvesFromGraph(smoothing: number, graph: RoadGraph): RoadCurveDescriptor[] {
	const junctionSmoothing = Math.max(0, Math.min(1, Number.isFinite(smoothing) ? smoothing : 0))
	const curves: RoadCurveDescriptor[] = []
	for (const edge of graph.edges) {
		const points = edge.indices
			.map((idx) => graph.vertices[idx] ?? null)
			.filter((p): p is THREE.Vector3 => Boolean(p))
		if (points.length < 2) {
			continue
		}
		curves.push({ curve: buildRoadCornerBezierCurvePath(points, edge.closed && points.length >= 3, junctionSmoothing) })
	}
	return curves
}

// createRoadCurve removed (unused)

// Removed unused `buildRoadCurves` wrapper.

type SmoothedHeightSeriesParams = {
	curve: THREE.Curve<THREE.Vector3>
	divisions: number
	width: number
	heightSampler: (x: number, z: number) => number
	minClearance: number
	smoothingStrengthFactor: number
}

function buildSmoothedHeightSeries({
	curve,
	divisions,
	width,
	heightSampler,
	minClearance,
	smoothingStrengthFactor,
}: SmoothedHeightSeriesParams): { heights: number[]; minimums: number[] } {
	const halfWidth = Math.max(0.001, width * 0.5)
	const values: number[] = []
	const minimums: number[] = []
	const center = new THREE.Vector3()
	const tangent = new THREE.Vector3()
	const normal = new THREE.Vector3()
	const left = new THREE.Vector3()
	const right = new THREE.Vector3()
	for (let i = 0; i <= divisions; i += 1) {
		const u = i / divisions
		curve.getPoint(u, center)
		curve.getTangent(u, tangent)
		normal.set(tangent.z, 0, -tangent.x)
		if (normal.lengthSq() <= ROAD_EPSILON) {
			normal.set(1, 0, 0)
		} else {
			normal.normalize()
		}
		left.copy(center).addScaledVector(normal, halfWidth)
		right.copy(center).addScaledVector(normal, -halfWidth)
		const hCenter = heightSampler(center.x, center.z)
		const hLeft = heightSampler(left.x, left.z)
		const hRight = heightSampler(right.x, right.z)
		const baseHeight = Math.max(hCenter, hLeft, hRight)
		const minHeight = baseHeight + Math.max(0, minClearance)
		const surface = minHeight + ROAD_SURFACE_Y_OFFSET
		values.push(surface)
		minimums.push(surface)
	}
	const passes = computeHeightSmoothingPasses(divisions, smoothingStrengthFactor)
	let smoothed = smoothHeightSeries(values, passes, minimums)
	const stepDistance = curve.getLength() / divisions
	const maxDeltaY = Math.max(ROAD_HEIGHT_SLOPE_MIN_DELTA_Y, stepDistance * ROAD_HEIGHT_SLOPE_MAX_GRADE)
	smoothed = clampHeightSeriesSlope(smoothed, minimums, maxDeltaY)
	return { heights: smoothed, minimums }
}

type HeightfieldFromSeriesParams = {
	startIndex: number
	endIndex: number
	rows: number
	columns: number
	elementSize: number
	heights: number[]
	minimums: number[]
}

function buildHeightfieldShapeFromSeries({
	startIndex,
	endIndex,
	rows,
	columns,
	elementSize,
	heights,
}: HeightfieldFromSeriesParams): Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }> | null {
	const span = endIndex - startIndex
	if (span <= 0) {
		return null
	}
	const pointsX = columns + 1
	const pointsZ = rows + 1
	if (pointsX < 2 || pointsZ < 2) {
		return null
	}
	const width = Math.max(1e-4, columns * elementSize)
	const depth = Math.max(1e-4, rows * elementSize)
	const halfWidth = width * 0.5
	const halfDepth = depth * 0.5
	const matrix: number[][] = []
	for (let col = 0; col < pointsX; col += 1) {
		const columnValues: number[] = []
		for (let row = pointsZ - 1; row >= 0; row -= 1) {
			const uAlong = pointsZ > 1 ? row / (pointsZ - 1) : 0
			const indexFloat = startIndex + uAlong * span
			const i0 = Math.max(0, Math.min(heights.length - 1, Math.floor(indexFloat)))
			const i1 = Math.max(0, Math.min(heights.length - 1, i0 + 1))
			const frac = indexFloat - i0
			const h0 = heights[i0] ?? 0
			const h1 = heights[i1] ?? h0
			const height = (h0 + (h1 - h0) * frac)
			columnValues.push(Number.isFinite(height) ? height : 0)
		}
		matrix.push(columnValues)
	}
	return {
		kind: 'heightfield',
		matrix,
		elementSize,
		width,
		depth,
		offset: [-halfWidth, -halfDepth, 0],
		applyScale: false,
	}
}

function buildRoadHeightfieldSignature(params: {
	definition: RoadDynamicMesh
	roadNode: SceneNode
	groundNode: SceneNode
	groundSignature: string
	roadWidth: number
	samplingDensityFactor: number
	smoothingStrengthFactor: number
	minClearance: number
	junctionSmoothing: number
	elementSize: number
	desiredTileLength: number
	bodyCount: number
	heightHash: number
}): string {
	const roadPosition = (params.roadNode.position as any) ?? {}
	const roadRotation = (params.roadNode.rotation as any) ?? {}
	const groundPosition = (params.groundNode.position as any) ?? {}
	const rx = typeof roadPosition.x === 'number' && Number.isFinite(roadPosition.x) ? roadPosition.x : 0
	const ry = typeof roadPosition.y === 'number' && Number.isFinite(roadPosition.y) ? roadPosition.y : 0
	const rz = typeof roadPosition.z === 'number' && Number.isFinite(roadPosition.z) ? roadPosition.z : 0
	const yaw = typeof roadRotation.y === 'number' && Number.isFinite(roadRotation.y) ? roadRotation.y : 0
	const gx = typeof groundPosition.x === 'number' && Number.isFinite(groundPosition.x) ? groundPosition.x : 0
	const gy = typeof groundPosition.y === 'number' && Number.isFinite(groundPosition.y) ? groundPosition.y : 0
	const gz = typeof groundPosition.z === 'number' && Number.isFinite(groundPosition.z) ? groundPosition.z : 0
	const verticesCount = Array.isArray(params.definition.vertices) ? params.definition.vertices.length : 0
	const segmentsCount = Array.isArray(params.definition.segments) ? params.definition.segments.length : 0
	return [
		`road:${params.roadNode.id}`,
		`frame:chord`,
		`v:${verticesCount}`,
		`s:${segmentsCount}`,
		`w:${Math.round(params.roadWidth * 1000)}`,
		`jd:${Math.round(params.junctionSmoothing * 1000)}`,
		`sd:${Math.round(params.samplingDensityFactor * 1000)}`,
		`ss:${Math.round(params.smoothingStrengthFactor * 1000)}`,
		`mc:${Math.round(params.minClearance * 1000)}`,
		`tile:${Math.round(params.desiredTileLength * 1000)}`,
		`es:${Math.round(params.elementSize * 1000)}`,
		`b:${params.bodyCount}`,
		`rh:${params.heightHash.toString(16)}`,
		`rp:${Math.round(rx * 1000)},${Math.round(ry * 1000)},${Math.round(rz * 1000)}`,
		`ry:${Math.round(yaw * 1000)}`,
		`gp:${Math.round(gx * 1000)},${Math.round(gy * 1000)},${Math.round(gz * 1000)}`,
		`gs:${params.groundSignature}`,
	].join('|')
}
