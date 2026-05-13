import * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState, RoadDynamicMesh } from './index'

import type { RigidbodyComponentProps, RigidbodyPhysicsShape } from './components'
import { BOUNDARY_WALL_COMPONENT_TYPE, clampBoundaryWallComponentProps, type BoundaryWallComponentProps } from './components'
import { ROAD_COMPONENT_TYPE, clampRoadProps, type RoadComponentProps } from './components/definitions/roadComponent'
import { createSegmentHeightSampler } from './roadMesh'
import { buildRoadCornerBezierCurvePath } from './roadCurvePath'
import { buildRoadGraph, type RoadGraph } from './roadGraph'
import type { PhysicsBodyLike, PhysicsOrientationAdjustment } from './physicsBodySync'

type PhysicsWorldLike = {
	addBody: (body: PhysicsBodyLike) => unknown
	removeBody?: (body: PhysicsBodyLike) => unknown
}

export type RoadHeightfieldBodiesEntry = { signature: string; bodies: PhysicsBodyLike[] }

export type RoadHeightfieldTileDescriptor = {
	curveIndex: number
	tileIndex: number
	startIndex: number
	endIndex: number
	position: [number, number, number]
	yaw: number
	shapeDefinition: RigidbodyPhysicsShape
}

export type RoadHeightfieldBuildSnapshot = {
	surfaceNode: SceneNode
	tiles: RoadHeightfieldTileDescriptor[]
	layoutHash: number
	roadWidth: number
	collisionWidth: number
	samplingDensityFactor: number
	smoothingStrengthFactor: number
	minClearance: number
	junctionSmoothing: number
	desiredTileLength: number
	elementSize: number
	boundaryWallEnabled: boolean
	boundaryWallProps: BoundaryWallComponentProps | null
}

export type RoadHeightfieldBuildParams = {
	roadNode: SceneNode
	rigidbodyComponent: SceneNodeComponentState<RigidbodyComponentProps>
	roadObject: THREE.Object3D
	world: PhysicsWorldLike
	createBody: (
		node: SceneNode,
		component: SceneNodeComponentState<RigidbodyComponentProps>,
		shapeDefinition: RigidbodyPhysicsShape | null,
		object: THREE.Object3D,
	) => { body: PhysicsBodyLike; orientationAdjustment: PhysicsOrientationAdjustment | null } | null
	maxSegments?: number
}
export function isRoadDynamicMesh(value: SceneNode['dynamicMesh'] | null | undefined): value is RoadDynamicMesh {
	return Boolean(value && (value as any).type === 'Road')
}


export function collectRoadHeightfieldTileDescriptors(params: RoadHeightfieldBuildParams): RoadHeightfieldBuildSnapshot | null {
	const {
		roadNode,
		rigidbodyComponent,
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
	const collisionWidth = roadWidth
	const samplingDensityFactor = roadProps.samplingDensityFactor ?? 1.0
	const smoothingStrengthFactor = roadProps.smoothingStrengthFactor ?? 1.0
	const minClearance = roadProps.minClearance ?? 0.01
	const junctionSmoothing = roadProps.junctionSmoothing ?? 0

	const graph = buildRoadGraph(definition)
	if (!graph) {
		return null
	}

	let serializedSampler: ((x: number, z: number) => number) | null = null
	if (Array.isArray((definition as any).segmentHeights) && Array.isArray(definition.segments)) {
		const rawSegments = Array.isArray(definition.segments) ? definition.segments : []
		const sanitizedSegments: Array<{ a: number; b: number; segmentIndex: number }> = []
		for (let i = 0; i < rawSegments.length; i += 1) {
			const seg = rawSegments[i]
			const a = Number((seg as any)?.a)
			const b = Number((seg as any)?.b)
			if (!Number.isInteger(a) || !Number.isInteger(b)) continue
			if (a < 0 || b < 0 || a >= graph.vertices.length || b >= graph.vertices.length) continue
			sanitizedSegments.push({ a, b, segmentIndex: i })
		}
		const tmpBuild: any = { vertexVectors: graph.vertices, paths: [], sanitizedSegments }
		serializedSampler = createSegmentHeightSampler(tmpBuild, (definition as any).segmentHeights)
	}

	const roadSurfaceHeightSampler = serializedSampler
	if (!roadSurfaceHeightSampler) {
		return null
	}

	const boundaryWallComponent = roadNode.components?.[BOUNDARY_WALL_COMPONENT_TYPE] as
		| SceneNodeComponentState<BoundaryWallComponentProps>
		| undefined
	const boundaryWallEnabled = boundaryWallComponent?.enabled !== false && Boolean(boundaryWallComponent)
	const boundaryWallProps = boundaryWallEnabled
		? clampBoundaryWallComponentProps(boundaryWallComponent?.props as Partial<BoundaryWallComponentProps> | null | undefined)
		: null
	const surfaceNode = boundaryWallEnabled
		? {
			...roadNode,
			components: Object.fromEntries(
				Object.entries(roadNode.components ?? {}).filter(([type]) => type !== BOUNDARY_WALL_COMPONENT_TYPE),
			),
		}
		: roadNode
	const curves = buildRoadCurvesFromGraph(junctionSmoothing, graph)
	if (!curves.length) {
		return null
	}

	const hasSegmentHeights = Boolean(serializedSampler)

	const desiredTileLength = clampNumber(roadWidth * 8, ROAD_HEIGHTFIELD_MIN_TILE_LENGTH, ROAD_HEIGHTFIELD_MAX_TILE_LENGTH, ROAD_HEIGHTFIELD_DEFAULT_TILE_LENGTH)
	const maxBodies = typeof maxSegments === 'number' && Number.isFinite(maxSegments)
		? Math.max(1, Math.trunc(maxSegments))
		: 128


	let totalBodies = 0
	const tiles: RoadHeightfieldTileDescriptor[] = []
	let layoutHash = 0
	let representativeDesiredTileLength = desiredTileLength
	let representativeElementSize = Math.max(1e-4, desiredTileLength / ROAD_HEIGHTFIELD_MAX_ROWS)

	let curveIndex = 0
	for (const descriptor of curves) {
		if (totalBodies >= maxBodies) {
			break
		}
		const curve = descriptor.curve
		const subsegments = collectRoadCurveSubsegments(curve)
		let segmentIndex = 0
		for (const segment of subsegments) {
			if (totalBodies >= maxBodies) {
				break
			}
			const length = segment.getLength()
			if (!(length > 1e-6)) {
				segmentIndex += 1
				continue
			}
			const geometryDetail = computeCurveGeometryDetailScore(segment, length)
			const divisions = computeRoadDivisionsForCurve(segment, length, samplingDensityFactor, junctionSmoothing, geometryDetail)
			if (divisions < 2) {
				segmentIndex += 1
				continue
			}
			const smoothedHeights = buildRoadCenterlineHeightSeries({
				curve: segment,
				divisions,
				heightSampler: roadSurfaceHeightSampler,
				minClearance,
				smoothingStrengthFactor,
				smooth: !hasSegmentHeights,
			})
			const heightDetail = computeRoadHeightDetailScore(smoothedHeights, length)
			const heightRange = computeRoadHeightRange(smoothedHeights)
			const samplingDetail = Math.max(0, Math.min(1, geometryDetail * 0.15 + heightDetail * 0.85))
			const densityScale = Math.max(0.35, Math.min(1.5, Math.sqrt(clampNumber(samplingDensityFactor, 0.1, 10, 1.0) / 3.5)))
			const targetRows = Math.max(
				ROAD_HEIGHTFIELD_MIN_ROWS,
				Math.min(ROAD_HEIGHTFIELD_MAX_ROWS, Math.round((ROAD_HEIGHTFIELD_MIN_ROWS + samplingDetail * (ROAD_HEIGHTFIELD_MAX_ROWS - ROAD_HEIGHTFIELD_MIN_ROWS)) * densityScale)),
			)
			const desiredTileLengthForCurve = clampNumber(
				roadWidth * lerpNumber(16, 8, geometryDetail),
				ROAD_HEIGHTFIELD_MIN_TILE_LENGTH,
				ROAD_HEIGHTFIELD_MAX_TILE_LENGTH,
				desiredTileLength,
			)
			const elementSize = Math.max(1e-4, desiredTileLengthForCurve / targetRows)
			if (curveIndex === 0 && segmentIndex === 0) {
				representativeDesiredTileLength = desiredTileLengthForCurve
				representativeElementSize = elementSize
			}
			layoutHash = (layoutHash * 31 + Math.round(geometryDetail * 1000)) >>> 0
			layoutHash = (layoutHash * 31 + Math.round(heightDetail * 1000)) >>> 0
			layoutHash = (layoutHash * 31 + Math.round(heightRange * 1000)) >>> 0
			layoutHash = (layoutHash * 31 + targetRows) >>> 0
			layoutHash = (layoutHash * 31 + Math.round(desiredTileLengthForCurve * 1000)) >>> 0
			layoutHash = (layoutHash * 31 + Math.round(elementSize * 1000)) >>> 0

			const spans = collectRoadCollisionSpans(segment, divisions, smoothedHeights)
			const spanP0 = new THREE.Vector3()
			const spanP1 = new THREE.Vector3()
			const spanForward = new THREE.Vector3()
			const spanCenter = new THREE.Vector3()
			let tileIndex = 0
			for (const span of spans) {
				if (totalBodies >= maxBodies) {
					break
				}
				const startU = span.startIndex / divisions
				const endU = span.endIndex / divisions
				segment.getPoint(startU, spanP0)
				segment.getPoint(endU, spanP1)
				spanForward.copy(spanP1).sub(spanP0)
				const forwardLen = Math.hypot(spanForward.x, spanForward.z)
				let yaw = 0
				if (forwardLen > ROAD_EPSILON) {
					yaw = Math.atan2(spanForward.x, spanForward.z)
				} else {
					const midU = (startU + endU) * 0.5
					const tangent = segment.getTangent(midU)
					yaw = Math.atan2(tangent.x, tangent.z)
				}
				spanCenter.copy(spanP0).add(spanP1).multiplyScalar(0.5)
				const spanLength = Math.max((span.endIndex - span.startIndex) * (length / divisions), forwardLen)
				layoutHash = (layoutHash * 31 + curveIndex) >>> 0
				layoutHash = (layoutHash * 31 + segmentIndex) >>> 0
				layoutHash = (layoutHash * 31 + tileIndex) >>> 0
				layoutHash = (layoutHash * 31 + span.startIndex) >>> 0
				layoutHash = (layoutHash * 31 + span.endIndex) >>> 0
				layoutHash = (layoutHash * 31 + (span.kind === 'box' ? 1 : 2)) >>> 0

				if (span.kind === 'box') {
					const spanHeights = smoothedHeights.slice(span.startIndex, span.endIndex + 1)
					const boxOverlapMeters = Math.min(
						span.boxOverlapMeters ?? ROAD_BOX_JOIN_MIN_OVERLAP_METERS,
						Math.max(0, spanLength * 0.45),
					)
					layoutHash = (layoutHash * 31 + Math.round(boxOverlapMeters * 1000)) >>> 0
					const boxLength = spanLength + boxOverlapMeters * 2
					const boxShape = buildRoadRectangularTileShapeFromSeries({
						roadWidth: collisionWidth,
						length: boxLength,
						heights: spanHeights,
					})
					if (!boxShape) {
						continue
					}
					const surfaceHeight = spanHeights.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) / spanHeights.length
					const boxHalfY = boxShape.kind === 'box' ? boxShape.halfExtents[1] : 0
					tiles.push({
						curveIndex,
						tileIndex,
						startIndex: span.startIndex,
						endIndex: span.endIndex,
						position: [spanCenter.x, surfaceHeight - boxHalfY, spanCenter.z],
						yaw,
						shapeDefinition: boxShape,
					})
				} else {
					const rows = Math.max(2, Math.ceil(spanLength / elementSize))
					const fieldShape = buildHeightfieldShapeFromSeries({
						startIndex: span.startIndex,
						endIndex: span.endIndex,
						spanLength,
						rows,
						roadWidth: collisionWidth,
						heights: smoothedHeights,
					})
					if (!fieldShape) {
						continue
					}
					tiles.push({
						curveIndex,
						tileIndex,
						startIndex: span.startIndex,
						endIndex: span.endIndex,
						position: [spanCenter.x, 0, spanCenter.z],
						yaw,
						shapeDefinition: fieldShape,
					})
				}
				totalBodies += 1
				tileIndex += 1
			}
			segmentIndex += 1
		}
		curveIndex += 1
	}

	if (!tiles.length) {
		return null
	}

	return {
		surfaceNode,
		tiles,
		layoutHash,
		roadWidth,
		collisionWidth,
		samplingDensityFactor,
		smoothingStrengthFactor,
		minClearance,
		junctionSmoothing,
		desiredTileLength: representativeDesiredTileLength,
		elementSize: representativeElementSize,
		boundaryWallEnabled,
		boundaryWallProps,
	}
}

export function buildRoadHeightfieldBodies(params: RoadHeightfieldBuildParams): RoadHeightfieldBodiesEntry | null {
	const snapshot = collectRoadHeightfieldTileDescriptors(params)
	if (!snapshot) {
		return null
	}
	const {
		roadNode,
		rigidbodyComponent,
		roadObject,
		createBody,
	} = params

	roadObject.updateMatrixWorld(true)

	const bodies: PhysicsBodyLike[] = []

	for (const tile of snapshot.tiles) {
		if (!tile.shapeDefinition) {
			continue
		}

		const tileObject = new THREE.Object3D()
		tileObject.rotation.set(0, tile.yaw, 0)
		tileObject.position.set(tile.position[0], tile.position[1], tile.position[2])
		roadObject.add(tileObject)
		tileObject.updateMatrixWorld(true)

		const bodyResult = createBody(snapshot.surfaceNode, rigidbodyComponent, tile.shapeDefinition, tileObject)

		roadObject.remove(tileObject)

		if (bodyResult?.body) {
			;(bodyResult.body as PhysicsBodyLike & { name?: string }).name = `road-tile:${roadNode.id}:curve:${tile.curveIndex}:tile:${tile.tileIndex}:span:${tile.startIndex}-${tile.endIndex}:kind:${tile.shapeDefinition.kind}`
			bodies.push(bodyResult.body)
		}
	}

	if (snapshot.boundaryWallEnabled) {
		const boundaryBodyResult = createBody(roadNode, rigidbodyComponent, null, roadObject)
		if (boundaryBodyResult?.body) {
			bodies.push(boundaryBodyResult.body)
		}
	}

	if (!bodies.length) {
		return null
	}

	const signature = buildRoadHeightfieldSignature({
		definition: roadNode.dynamicMesh as RoadDynamicMesh,
		roadNode,
		roadWidth: snapshot.roadWidth,
		collisionWidth: snapshot.collisionWidth,
		samplingDensityFactor: snapshot.samplingDensityFactor,
		smoothingStrengthFactor: snapshot.smoothingStrengthFactor,
		minClearance: snapshot.minClearance,
		junctionSmoothing: snapshot.junctionSmoothing,
		elementSize: snapshot.elementSize,
		desiredTileLength: snapshot.desiredTileLength,
		bodyCount: bodies.length,
		layoutHash: snapshot.layoutHash,
		boundaryWallEnabled: snapshot.boundaryWallEnabled,
		boundaryWallProps: snapshot.boundaryWallProps,
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
const ROAD_HEIGHTFIELD_MIN_ROWS = 2
const ROAD_HEIGHTFIELD_MAX_ROWS = 10
// Debug/test-only sizing for a large centered heightmap.
const ROAD_HEIGHTFIELD_TEST_MAP_POINTS = 11
const ROAD_HEIGHTFIELD_MIN_TILE_LENGTH = 1
const ROAD_HEIGHTFIELD_MAX_TILE_LENGTH = 2
const ROAD_HEIGHTFIELD_DEFAULT_TILE_LENGTH = 20
const ROAD_RECTANGULAR_MAX_GEOMETRY_DETAIL = 0.18
const ROAD_RECTANGULAR_MAX_HEIGHT_DETAIL = 0.18
const ROAD_RECTANGULAR_MAX_HEIGHT_RANGE = 0.12
const ROAD_RECTANGULAR_MIN_THICKNESS = 0.08
const ROAD_RECTANGULAR_MAX_THICKNESS = 0.28
const ROAD_BOX_JOIN_MIN_OVERLAP_METERS = 0.14
const ROAD_BOX_JOIN_MAX_OVERLAP_METERS = 0.55

// Road collision uses tiled heightfields exclusively.
// Tile length is adaptively reduced on bends to keep chord approximation tight.
const ROAD_TILE_MAX_HEADING_DELTA_RAD = (8 * Math.PI) / 180

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

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
	return Math.max(min, Math.min(max, numeric))
}

function lerpNumber(start: number, end: number, t: number): number {
	return start + (end - start) * t
}

function computeCurveGeometryDetailScore(curve: THREE.Curve<THREE.Vector3>, length: number): number {
	if (!Number.isFinite(length) || length <= ROAD_EPSILON) {
		return 0
	}
	const sampleCount = Math.max(4, Math.min(16, Math.ceil(length / 2)))
	const tangent = new THREE.Vector3()
	let previousHeading = 0
	let hasPreviousHeading = false
	let totalHeadingDelta = 0
	let maxHeadingDelta = 0
	for (let i = 0; i <= sampleCount; i += 1) {
		const u = i / sampleCount
		curve.getTangent(u, tangent)
		tangent.y = 0
		const heading = Math.atan2(tangent.x, tangent.z)
		if (hasPreviousHeading) {
			const delta = Math.abs(normalizeAngleRad(heading - previousHeading))
			totalHeadingDelta += delta
			maxHeadingDelta = Math.max(maxHeadingDelta, delta)
		}
		previousHeading = heading
		hasPreviousHeading = true
	}
	const totalTurnScore = Math.max(0, Math.min(1, totalHeadingDelta / Math.PI))
	const sharpTurnScore = Math.max(0, Math.min(1, maxHeadingDelta / ((10 * Math.PI) / 180)))
	return Math.max(0, Math.min(1, totalTurnScore * 0.65 + sharpTurnScore * 0.35))
}

function computeRoadHeightDetailScore(values: number[], length: number): number {
	if (!Number.isFinite(length) || length <= ROAD_EPSILON || values.length < 3) {
		return 0
	}
	const step = length / Math.max(1, values.length - 1)
	if (!Number.isFinite(step) || step <= ROAD_EPSILON) {
		return 0
	}
	let maxSlope = 0
	let maxDeltaSlope = 0
	for (let i = 1; i < values.length; i += 1) {
		const current = Number.isFinite(values[i]!) ? values[i]! : 0
		const previous = Number.isFinite(values[i - 1]!) ? values[i - 1]! : 0
		const slope = Math.abs(current - previous) / step
		maxSlope = Math.max(maxSlope, slope)
		if (i >= 2) {
			const beforePrevious = Number.isFinite(values[i - 2]!) ? values[i - 2]! : 0
			const previousSlope = Math.abs(previous - beforePrevious) / step
			maxDeltaSlope = Math.max(maxDeltaSlope, Math.abs(slope - previousSlope))
		}
	}
	const slopeScore = Math.max(0, Math.min(1, maxSlope / ROAD_HEIGHT_SLOPE_MAX_GRADE))
	const roughnessScore = Math.max(0, Math.min(1, maxDeltaSlope / Math.max(ROAD_HEIGHT_SLOPE_MIN_DELTA_Y, 0.15)))
	return Math.max(0, Math.min(1, slopeScore * 0.8 + roughnessScore * 0.2))
}

function computeRoadHeightRange(values: number[]): number {
	let min = Number.POSITIVE_INFINITY
	let max = Number.NEGATIVE_INFINITY
	for (const value of values) {
		const numeric = Number.isFinite(value) ? value : 0
		min = Math.min(min, numeric)
		max = Math.max(max, numeric)
	}
	if (!Number.isFinite(min) || !Number.isFinite(max)) {
		return 0
	}
	return max - min
}

function computeRoadHeightRangeForSpan(values: number[], startIndex: number, endIndex: number): number {
	const start = Math.max(0, Math.min(values.length, Math.trunc(startIndex)))
	const end = Math.max(start, Math.min(values.length, Math.trunc(endIndex)))
	let min = Number.POSITIVE_INFINITY
	let max = Number.NEGATIVE_INFINITY
	for (let i = start; i < end; i += 1) {
		const numeric = Number.isFinite(values[i]!) ? values[i]! : 0
		min = Math.min(min, numeric)
		max = Math.max(max, numeric)
	}
	if (!Number.isFinite(min) || !Number.isFinite(max)) {
		return 0
	}
	return max - min
}

type RoadCollisionSpan = {
	startIndex: number
	endIndex: number
	kind: 'box' | 'heightfield'
	boxOverlapMeters?: number
}

function collectRoadCollisionSpans(
	curve: THREE.Curve<THREE.Vector3>,
	divisions: number,
	heights: number[],
): RoadCollisionSpan[] {
	return [{startIndex: 0, endIndex: divisions, kind: 'heightfield'}]
	if (!(divisions > 0)) {
		return []
	}
	const intervalKinds: Array<'box' | 'heightfield'> = []
	const intervalGeometryDetails: number[] = []
	const intervalHeightDetails: number[] = []
	for (let i = 0; i < divisions; i += 1) {
		const startU = i / divisions
		const endU = (i + 1) / divisions
		const geometryDetail = computeHeadingDeltaRad(curve, startU, endU)
		const heightRange = computeRoadHeightRangeForSpan(heights, Math.max(0, i - 1), Math.min(heights.length, i + 2))
	const heightDetail = Math.max(0, Math.min(1, heightRange / Math.max(ROAD_RECTANGULAR_MAX_HEIGHT_RANGE, 1e-6)))
		intervalGeometryDetails.push(geometryDetail)
		intervalHeightDetails.push(heightDetail)
		const isBoxCandidate =
			geometryDetail <= ROAD_RECTANGULAR_MAX_GEOMETRY_DETAIL &&
			geometryDetail <= ROAD_TILE_MAX_HEADING_DELTA_RAD * 0.75 &&
			heightDetail <= ROAD_RECTANGULAR_MAX_HEIGHT_DETAIL &&
			heightRange <= ROAD_RECTANGULAR_MAX_HEIGHT_RANGE * 0.5
		intervalKinds.push(isBoxCandidate ? 'box' : 'heightfield')
	}
	const spans: RoadCollisionSpan[] = []
	let startIndex = 0
	while (startIndex < divisions) {
		const kind = intervalKinds[startIndex]!
		let endIndex = startIndex + 1
		while (endIndex < divisions && intervalKinds[endIndex] === kind) {
			endIndex += 1
		}
		if (kind === 'box' && endIndex - startIndex < 2) {
			spans.push({ startIndex, endIndex, kind: 'heightfield' })
		} else {
			spans.push({
				startIndex,
				endIndex,
				kind,
				boxOverlapMeters:
					kind === 'box'
						? computeRoadBoxJoinOverlapMeters(startIndex, endIndex, intervalGeometryDetails, intervalHeightDetails)
			: undefined,
			})
		}
		startIndex = endIndex
	}
	const promotedSpans: RoadCollisionSpan[] = []
	for (let index = 0; index < spans.length; index += 1) {
		const span = spans[index]!
		if (span.kind === 'heightfield') {
			const intervalCount = span.endIndex - span.startIndex
			const hasBoxNeighbor =
				promotedSpans[promotedSpans.length - 1]?.kind === 'box' ||
				spans[index + 1]?.kind === 'box'
			if (intervalCount <= 2 && hasBoxNeighbor) {
				promotedSpans.push({
					...span,
					kind: 'box',
					boxOverlapMeters: computeRoadBoxJoinOverlapMeters(
						span.startIndex,
						span.endIndex,
						intervalGeometryDetails,
						intervalHeightDetails,
					),
				})
				continue
			}
		}
		promotedSpans.push(span)
	}
	const mergedSpans: RoadCollisionSpan[] = []
	for (const span of promotedSpans) {
		const previous = mergedSpans[mergedSpans.length - 1]
		if (previous && previous.kind === span.kind) {
			previous.endIndex = span.endIndex
			if (previous.kind === 'box') {
				previous.boxOverlapMeters = Math.max(previous.boxOverlapMeters ?? 0, span.boxOverlapMeters ?? 0)
			}
			continue
		}
		mergedSpans.push({ ...span })
	}
	return mergedSpans.map((span) => {
		if (span.kind !== 'box') {
			return span
		}
		return {
			...span,
			boxOverlapMeters: computeRoadBoxJoinOverlapMeters(
				span.startIndex,
				span.endIndex,
				intervalGeometryDetails,
				intervalHeightDetails,
			),
		}
	})
}

function computeRoadBoxJoinOverlapMeters(
	startIndex: number,
	endIndex: number,
	intervalGeometryDetails: number[],
	intervalHeightDetails: number[],
): number {
	const start = Math.max(0, Math.min(intervalGeometryDetails.length, Math.trunc(startIndex)))
	const end = Math.max(start, Math.min(intervalGeometryDetails.length, Math.trunc(endIndex)))
	const intervalCount = Math.max(1, end - start)
	let geometryScoreSum = 0
	let heightScoreSum = 0
	for (let i = start; i < end; i += 1) {
		const geometryDetail = Number.isFinite(intervalGeometryDetails[i]!) ? intervalGeometryDetails[i]! : 0
		const heightDetail = Number.isFinite(intervalHeightDetails[i]!) ? intervalHeightDetails[i]! : 0
		geometryScoreSum += 1 - Math.max(0, Math.min(1, geometryDetail / Math.max(ROAD_RECTANGULAR_MAX_GEOMETRY_DETAIL, 1e-6)))
		heightScoreSum += 1 - Math.max(0, Math.min(1, heightDetail / Math.max(ROAD_RECTANGULAR_MAX_HEIGHT_DETAIL, 1e-6)))
	}
	const geometryScore = geometryScoreSum / intervalCount
	const heightScore = heightScoreSum / intervalCount
	const straightnessScore = Math.max(0, Math.min(1, geometryScore * 0.7 + heightScore * 0.3))
	const lengthScore = Math.max(0, Math.min(1, (intervalCount - 1) / 5))
	const adaptiveScore = Math.max(0, Math.min(1, straightnessScore * 0.75 + lengthScore * 0.25))
	return lerpNumber(ROAD_BOX_JOIN_MIN_OVERLAP_METERS, ROAD_BOX_JOIN_MAX_OVERLAP_METERS, adaptiveScore)
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
	geometryDetail = 0,
): number {
	let divisions = computeRoadDivisions(length, samplingDensityFactor)
	if (!(divisions > 0)) {
		return 0
	}
	const geometryScale = lerpNumber(0.3, 0.85, Math.max(0, Math.min(1, geometryDetail)))
	divisions = Math.max(ROAD_MIN_DIVISIONS, Math.min(ROAD_MAX_DIVISIONS, Math.round(divisions * geometryScale)))
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

function collectRoadCurveSubsegments(curve: THREE.Curve<THREE.Vector3>): THREE.Curve<THREE.Vector3>[] {
	const subcurves = (curve as any)?.curves
	if (!Array.isArray(subcurves) || !subcurves.length) {
	return [curve]
	}
	return subcurves.filter((segment): segment is THREE.Curve<THREE.Vector3> => Boolean(segment))
}

// createRoadCurve removed (unused)

// Removed unused `buildRoadCurves` wrapper.

type RoadCenterlineHeightSeriesParams = {
	curve: THREE.Curve<THREE.Vector3>
	divisions: number
	heightSampler: (x: number, z: number) => number
	minClearance: number
	smoothingStrengthFactor: number
	smooth: boolean
}

function buildRoadCenterlineHeightSeries({
	curve,
	divisions,
	heightSampler,
	minClearance,
	smoothingStrengthFactor,
	smooth,
}: RoadCenterlineHeightSeriesParams): number[] {
	const values: number[] = []
	const minimums: number[] = []
	const center = new THREE.Vector3()
	for (let i = 0; i <= divisions; i += 1) {
		const u = i / divisions
		curve.getPoint(u, center)
		const hCenter = heightSampler(center.x, center.z)
		const baseHeight = Number.isFinite(hCenter) ? hCenter : 0
		const minHeight = baseHeight + Math.max(0, minClearance)
		const surface = minHeight + ROAD_SURFACE_Y_OFFSET
		values.push(surface)
		minimums.push(surface)
	}
	if (!smooth) {
		return values
	}
	const passes = computeHeightSmoothingPasses(divisions, smoothingStrengthFactor)
	let smoothed = smoothHeightSeries(values, passes, minimums)
	const stepDistance = curve.getLength() / divisions
	const maxDeltaY = Math.max(ROAD_HEIGHT_SLOPE_MIN_DELTA_Y, stepDistance * ROAD_HEIGHT_SLOPE_MAX_GRADE)
	smoothed = clampHeightSeriesSlope(smoothed, minimums, maxDeltaY)
	return smoothed
}

type HeightfieldFromSeriesParams = {
	startIndex: number
	endIndex: number
	spanLength: number
	rows: number
	roadWidth: number
	heights: number[]
}

type RoadRectangularTileShapeParams = {
	roadWidth: number
	length: number
	heights: number[]
}

function buildRoadRectangularTileShapeFromSeries({
	roadWidth,
	length,
	heights,
}: RoadRectangularTileShapeParams): RigidbodyPhysicsShape | null {
	if (!(roadWidth > ROAD_EPSILON) || !(length > ROAD_EPSILON) || heights.length < 2) {
		return null
	}
	const heightRange = computeRoadHeightRange(heights)
	if (!Number.isFinite(heightRange) || heightRange > ROAD_RECTANGULAR_MAX_HEIGHT_RANGE) {
		return null
	}
	const thickness = Math.max(
		ROAD_RECTANGULAR_MIN_THICKNESS,
		Math.min(
			ROAD_RECTANGULAR_MAX_THICKNESS,
			Math.max(ROAD_SURFACE_Y_OFFSET * 4, heightRange * 2 + 0.04),
		),
	)
	return {
		kind: 'box',
		halfExtents: [Math.max(1e-4, roadWidth * 0.5), Math.max(1e-4, thickness * 0.5), Math.max(1e-4, length * 0.5)],
		offset: [0, 0, 0],
		applyScale: false,
	}
}

function buildHeightfieldShapeFromSeries({
	startIndex,
	endIndex,
	spanLength,
	rows,
	roadWidth,
	heights,
}: HeightfieldFromSeriesParams): Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }> | null {
	const span = endIndex - startIndex
	if (span <= 0 || !Number.isFinite(spanLength) || spanLength <= ROAD_EPSILON) {
		return null
	}
	const tileWidth = Math.max(1e-4, roadWidth)
	const tileLength = Math.max(1e-4, spanLength)
	const targetElementSize = Math.max(1e-4, tileLength / Math.max(1, rows))
	const pointsX = Math.max(2, Math.max(ROAD_HEIGHTFIELD_TEST_MAP_POINTS, Math.round(tileWidth / targetElementSize) + 1))
	const pointsZ = Math.max(2, Math.max(ROAD_HEIGHTFIELD_TEST_MAP_POINTS, Math.round(tileLength / targetElementSize) + 1))
	if (pointsX < 2 || pointsZ < 2) {
		return null
	}

	if (!Array.isArray(heights) || heights.length < 2) {
		return null
	}
	const width = tileWidth
	const depth = tileLength
	const halfWidth = width * 0.5
	const halfDepth = depth * 0.5
	const effectiveElementSize = targetElementSize

	const matrix: number[][] = []
		
	for (let row = 0; row <pointsX; row += 1) {
		const rowValues: number[] = []
		for (let col = 0; col <  pointsZ; col += 1) {
			rowValues.push(0)
		}
		matrix.push(rowValues)
	}

	return {
		kind: 'heightfield',
		matrix,
		elementSize: effectiveElementSize,
		width,
		depth,
		offset: [-halfWidth, -halfDepth, 0],
		applyScale: false,
	}
}

function buildRoadHeightfieldSignature(params: {
	definition: RoadDynamicMesh
	roadNode: SceneNode
	roadWidth: number
	collisionWidth: number
	samplingDensityFactor: number
	smoothingStrengthFactor: number
	minClearance: number
	junctionSmoothing: number
	elementSize: number
	desiredTileLength: number
	bodyCount: number
	layoutHash: number
	boundaryWallEnabled: boolean
	boundaryWallProps: BoundaryWallComponentProps | null
}): string {
	const roadPosition = (params.roadNode.position as any) ?? {}
	const roadRotation = (params.roadNode.rotation as any) ?? {}
	const rx = typeof roadPosition.x === 'number' && Number.isFinite(roadPosition.x) ? roadPosition.x : 0
	const ry = typeof roadPosition.y === 'number' && Number.isFinite(roadPosition.y) ? roadPosition.y : 0
	const rz = typeof roadPosition.z === 'number' && Number.isFinite(roadPosition.z) ? roadPosition.z : 0
	const yaw = typeof roadRotation.y === 'number' && Number.isFinite(roadRotation.y) ? roadRotation.y : 0
	const verticesCount = Array.isArray(params.definition.vertices) ? params.definition.vertices.length : 0
	const segmentsCount = Array.isArray(params.definition.segments) ? params.definition.segments.length : 0
	return [
		`road:${params.roadNode.id}`,
		`frame:chord`,
		`v:${verticesCount}`,
		`s:${segmentsCount}`,
		`w:${Math.round(params.roadWidth * 1000)}`,
		`cw:${Math.round(params.collisionWidth * 1000)}`,
		`jd:${Math.round(params.junctionSmoothing * 1000)}`,
		`sd:${Math.round(params.samplingDensityFactor * 1000)}`,
		`ss:${Math.round(params.smoothingStrengthFactor * 1000)}`,
		`mc:${Math.round(params.minClearance * 1000)}`,
		`tile:${Math.round(params.desiredTileLength * 1000)}`,
		`es:${Math.round(params.elementSize * 1000)}`,
		`b:${params.bodyCount}`,
		`lh:${params.layoutHash.toString(16)}`,
		`bw:${params.boundaryWallEnabled ? 1 : 0}`,
		`bwh:${Math.round((params.boundaryWallProps?.height ?? 0) * 1000)}`,
		`bwt:${Math.round((params.boundaryWallProps?.thickness ?? 0) * 1000)}`,
		`bwo:${Math.round((params.boundaryWallProps?.offset ?? 0) * 1000)}`,
		`rp:${Math.round(rx * 1000)},${Math.round(ry * 1000)},${Math.round(rz * 1000)}`,
		`ry:${Math.round(yaw * 1000)}`,
	].join('|')
}



