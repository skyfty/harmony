import * as THREE from 'three'
import type { SceneNode, SceneNodeComponentState, RoadDynamicMesh } from './index'

import type { RigidbodyComponentProps, RigidbodyPhysicsShape } from './components'
import { BOUNDARY_WALL_COMPONENT_TYPE, clampBoundaryWallComponentProps, type BoundaryWallComponentProps } from './components'
import { ROAD_COMPONENT_TYPE, clampRoadProps, type RoadComponentProps } from './components/definitions/roadComponent'
import { buildRoadStripGeometry, createSegmentHeightSampler } from './roadMesh'
import { buildJunctionLoopXZ, triangulateJunctionPatchXZ } from './roadJunctionPatch'
import { buildRoadCornerBezierCurvePath } from './roadCurvePath'
import { buildRoadGraph, getJunctionIncidentDirectionsXZ, type RoadGraph } from './roadGraph'
import type { PhysicsBodyLike, PhysicsOrientationAdjustment } from './physicsBodySync'

export type RoadCollisionMode = 'pure-box' | 'mixed'
export const ROAD_COLLISION_MODE: RoadCollisionMode = 'mixed'

type PhysicsWorldLike = {
	addBody: (body: PhysicsBodyLike) => unknown
	removeBody?: (body: PhysicsBodyLike) => unknown
}

export type RoadCollisionBodiesEntry = { signature: string; bodies: PhysicsBodyLike[] }

export type RoadCollisionDescriptor = {
	curveIndex: number
	tileIndex: number
	startIndex: number
	endIndex: number
	position: [number, number, number]
	yaw: number
	pitch: number
	shapeDefinition: RigidbodyPhysicsShape
}

export type RoadCollisionBuildSnapshot = {
	surfaceNode: SceneNode
	descriptors: RoadCollisionDescriptor[]
	layoutHash: number
	roadWidth: number
	collisionWidth: number
	samplingDensityFactor: number
	collisionSubdivisionFactor: number
	smoothingStrengthFactor: number
	minClearance: number
	junctionSmoothing: number
	desiredTileLength: number
	elementSize: number
	boundaryWallEnabled: boolean
	boundaryWallProps: BoundaryWallComponentProps | null
}

export type RoadCollisionBuildParams = {
	roadNode: SceneNode
	rigidbodyComponent: SceneNodeComponentState<RigidbodyComponentProps>
	roadObject?: THREE.Object3D
	world?: PhysicsWorldLike
	createBody?: (
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


export function collectRoadCollisionDescriptors(params: RoadCollisionBuildParams): RoadCollisionBuildSnapshot | null {
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
	if (roadProps.enableVehicleCollision === false) {
		return null
	}
	const roadWidth = Math.max(0.01, Number.isFinite(roadProps.width) ? roadProps.width : 2)
	const collisionWidth = roadWidth
	const samplingDensityFactor = roadProps.samplingDensityFactor ?? 1.0
	const collisionSubdivisionFactor = roadProps.collisionSubdivisionFactor ?? 1.0
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

	const roadSurfaceHeightSampler = serializedSampler ?? ((_x: number, _z: number) => 0)

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
	const preferredMaxSpans = typeof maxSegments === 'number' && Number.isFinite(maxSegments)
		? Math.max(1, Math.trunc(maxSegments))
		: null

	const desiredTileLength = clampNumber(roadWidth * 8, ROAD_COLLISION_MIN_TILE_LENGTH, ROAD_COLLISION_MAX_TILE_LENGTH, ROAD_COLLISION_DEFAULT_TILE_LENGTH)
	const meshOptions = { samplingDensityFactor, smoothingStrengthFactor, minClearance, junctionSmoothing }

	const descriptors: RoadCollisionDescriptor[] = []
	let layoutHash = 0
	let representativeDesiredTileLength = desiredTileLength
	let representativeElementSize = Math.max(1e-4, desiredTileLength / ROAD_COLLISION_MAX_ROWS)

	const junctionRoundSegments = 8 + Math.round(24 * Math.max(0, Math.min(1, junctionSmoothing)))
	for (const junctionVertex of graph.junctionVertices) {
		const center = graph.vertices[junctionVertex]
		if (!center) {
			continue
		}
		const incidentDirs = getJunctionIncidentDirectionsXZ(graph, junctionVertex)
		if (incidentDirs.length < 3) {
			continue
		}
		const roadRadius = Math.max(0.01, roadWidth * 0.5)
		const contour = sanitizeVector2Loop(buildJunctionLoopXZ({
			center,
			incidentDirsXZ: incidentDirs,
			radius: roadRadius,
			roundSegments: junctionRoundSegments,
		}))
		if (contour.length < 3) {
			continue
		}
		const contourHeights = sampleAndSmoothLoopHeights(
			contour,
			roadSurfaceHeightSampler,
			ROAD_SURFACE_Y_OFFSET,
			Math.max(0, minClearance),
			computeHeightSmoothingPasses(Math.max(4, contour.length), smoothingStrengthFactor),
		)
		const geometry = triangulateJunctionPatchXZ({
			contour,
			heightSampler: null,
			loopHeights: contourHeights.length ? { contour: contourHeights } : null,
			yOffset: 0,
			minClearance: 0,
		})
		const staticMesh = buildStaticMeshShapeFromGeometry(geometry)
		if (!staticMesh) {
			continue
		}
		if (!geometry) {
			continue
		}
		const staticMeshHash = hashStaticMeshGeometry(geometry)
		layoutHash = (layoutHash * 31 + junctionVertex) >>> 0
		layoutHash = (layoutHash * 31 + staticMeshHash) >>> 0
		descriptors.push({
			curveIndex: -1,
			tileIndex: descriptors.length,
			startIndex: 0,
			endIndex: 0,
			position: [0, 0, 0],
			yaw: 0,
			pitch: 0,
			shapeDefinition: staticMesh,
		})
	}

	let curveIndex = 0
	for (const descriptor of curves) {
		const curve = descriptor.curve
		const subsegments = collectRoadCurveSubsegments(curve)
		let segmentIndex = 0
		for (const segment of subsegments) {
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
			const spanMetrics = summarizeRoadCollisionSpan(segment, divisions, smoothedHeights, 0, divisions, length)
			const samplingDetail = Math.max(0, Math.min(1, geometryDetail * 0.15 + heightDetail * 0.85))
			const densityScale = Math.max(0.35, Math.min(1.5, Math.sqrt(clampNumber(samplingDensityFactor, 0.1, 10, 1.0) / 3.5)))
			const targetRows = Math.max(
				ROAD_COLLISION_MIN_ROWS,
				Math.min(ROAD_COLLISION_MAX_ROWS, Math.round((ROAD_COLLISION_MIN_ROWS + samplingDetail * (ROAD_COLLISION_MAX_ROWS - ROAD_COLLISION_MIN_ROWS)) * densityScale)),
			)
			const desiredTileLengthForCurve = clampNumber(
				(roadWidth * lerpNumber(16, 8, geometryDetail)) / Math.max(0.5, Math.sqrt(collisionSubdivisionFactor)),
				ROAD_COLLISION_MIN_TILE_LENGTH,
				ROAD_COLLISION_MAX_TILE_LENGTH,
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
			layoutHash = (layoutHash * 31 + Math.round(collisionSubdivisionFactor * 1000)) >>> 0
			const spans = collectRoadCollisionSpans(
				segment,
				divisions,
				smoothedHeights,
				roadWidth,
				collisionSubdivisionFactor,
				preferredMaxSpans,
			)
			const collisionSpans = shouldSubdivideSimpleRoadSpans(geometryDetail, heightDetail, heightRange)
				? subdivideRoadCollisionSpans(spans, collisionSubdivisionFactor, divisions)
				: spans
			const spanP0 = new THREE.Vector3()
			const spanP1 = new THREE.Vector3()
			const spanMid = new THREE.Vector3()
			const spanForward = new THREE.Vector3()
			const spanCenter = new THREE.Vector3()
			const spanQuaternion = new THREE.Quaternion()
			const spanEuler = new THREE.Euler(0, 0, 0, 'YXZ')
			const spanUp = new THREE.Vector3(0, 1, 0)
			let tileIndex = 0
			for (const span of collisionSpans) {
				const startU = span.startIndex / divisions
				const endU = span.endIndex / divisions
				segment.getPoint(startU, spanP0)
				segment.getPoint(endU, spanP1)
				spanForward.copy(spanP1).sub(spanP0)
				const forwardLen = Math.hypot(spanForward.x, spanForward.z)
				const chordLength = spanForward.length()
				let yaw = 0
				if (forwardLen > ROAD_EPSILON) {
					yaw = Math.atan2(spanForward.x, spanForward.z)
				} else {
					const midU = (startU + endU) * 0.5
					const tangent = segment.getTangent(midU)
					yaw = Math.atan2(tangent.x, tangent.z)
				}
				const spanHeights = smoothedHeights.slice(span.startIndex, span.endIndex + 1)
				const spanLength = Math.max((span.endIndex - span.startIndex) * (length / divisions), chordLength, forwardLen)
				const spanFit = computeRoadSpanSurfaceFit(spanHeights, spanLength)
				const spanSurfaceFitError = computeRoadSpanSurfaceFitError(spanHeights, spanFit)
				const spanCurve = new RoadSpanCurve(segment, startU, endU)
				const spanGeometryDetail = computeCurveGeometryDetailScore(spanCurve, spanLength)
				const boxOverlapMeters = Math.min(
					span.boxOverlapMeters ?? ROAD_BOX_JOIN_MIN_OVERLAP_METERS,
					Math.max(0, spanLength * 0.45),
				)
				layoutHash = (layoutHash * 31 + Math.round(boxOverlapMeters * 1000)) >>> 0
				layoutHash = (layoutHash * 31 + curveIndex) >>> 0
				layoutHash = (layoutHash * 31 + segmentIndex) >>> 0
				layoutHash = (layoutHash * 31 + tileIndex) >>> 0
				layoutHash = (layoutHash * 31 + span.startIndex) >>> 0
				layoutHash = (layoutHash * 31 + span.endIndex) >>> 0
				const useStaticMesh = shouldUseRoadStaticMeshForSpan({
					geometryDetail: spanGeometryDetail,
					surfaceFitError: spanSurfaceFitError,
					pitch: spanFit.pitch,
					slope: spanMetrics.slope,
					pitchDelta: spanMetrics.pitchDelta,
					spanLength,
					collisionSubdivisionFactor,
				})
				if (useStaticMesh) {
					const spanGeometry = buildRoadStripGeometry(
						spanCurve,
						collisionWidth,
						roadSurfaceHeightSampler,
						ROAD_SURFACE_Y_OFFSET,
						meshOptions,
						spanHeights,
					)
					const staticMeshShape = buildStaticMeshShapeFromGeometry(spanGeometry)
					if (spanGeometry) {
						layoutHash = (layoutHash * 31 + hashStaticMeshGeometry(spanGeometry)) >>> 0
						spanGeometry.dispose()
					}
					if (staticMeshShape) {
						descriptors.push({
							curveIndex,
							tileIndex,
							startIndex: span.startIndex,
							endIndex: span.endIndex,
							position: [0, 0, 0],
							yaw: 0,
							pitch: 0,
							shapeDefinition: staticMeshShape,
						})
					}
					tileIndex += 1
					continue
				}
				const boxShape = buildRoadRectangularTileShapeFromSeries({
					roadWidth: collisionWidth,
					length: spanLength + boxOverlapMeters * 2,
					heights: spanHeights,
				})
				if (!boxShape) {
					tileIndex += 1
					continue
				}
				const pitch = computeRoadSpanBoxPitch(spanHeights, spanLength)
				spanEuler.set(pitch, yaw, 0, 'YXZ')
				spanQuaternion.setFromEuler(spanEuler)
				spanUp.set(0, 1, 0).applyQuaternion(spanQuaternion)
				segment.getPoint((startU + endU) * 0.5, spanMid)
				spanCenter.copy(spanMid)
				spanCenter.y = spanFit.centerHeight
				spanCenter.addScaledVector(spanUp, -boxShape.halfExtents[1])
				layoutHash = (layoutHash * 31 + Math.round(pitch * 1000)) >>> 0
				descriptors.push({
					curveIndex,
					tileIndex,
					startIndex: span.startIndex,
					endIndex: span.endIndex,
					position: [spanCenter.x, spanCenter.y, spanCenter.z],
					yaw,
					pitch,
					shapeDefinition: boxShape,
				})
				tileIndex += 1
			}
			segmentIndex += 1
		}
		curveIndex += 1
	}

	if (!descriptors.length) {
		return null
	}

	return {
		surfaceNode,
		descriptors,
		layoutHash,
		roadWidth,
		collisionWidth,
		samplingDensityFactor,
		collisionSubdivisionFactor,
		smoothingStrengthFactor,
		minClearance,
		junctionSmoothing,
		desiredTileLength: representativeDesiredTileLength,
		elementSize: representativeElementSize,
		boundaryWallEnabled,
		boundaryWallProps,
	}
}

export function buildRoadCollisionBodies(params: RoadCollisionBuildParams): RoadCollisionBodiesEntry | null {
	const snapshot = collectRoadCollisionDescriptors(params)
	if (!snapshot) {
		return null
	}
	const {
		roadNode,
		rigidbodyComponent,
		roadObject,
		createBody,
	} = params

	if (!roadObject || !createBody) {
		return null
	}

	roadObject.updateMatrixWorld(true)

	const bodies: PhysicsBodyLike[] = []

	for (const descriptor of snapshot.descriptors) {
		if (!descriptor.shapeDefinition) {
			continue
		}

		const descriptorObject = new THREE.Object3D()
		if (descriptor.shapeDefinition.kind !== 'static-mesh') {
			descriptorObject.rotation.set(descriptor.pitch, descriptor.yaw, 0, 'YXZ')
			descriptorObject.position.set(descriptor.position[0], descriptor.position[1], descriptor.position[2])
		}
		roadObject.add(descriptorObject)
		descriptorObject.updateMatrixWorld(true)

		const bodyResult = createBody(snapshot.surfaceNode, rigidbodyComponent, descriptor.shapeDefinition, descriptorObject)

		roadObject.remove(descriptorObject)

		if (bodyResult?.body) {
			;(bodyResult.body as PhysicsBodyLike & { name?: string }).name = `road-collision:${roadNode.id}:curve:${descriptor.curveIndex}:tile:${descriptor.tileIndex}:span:${descriptor.startIndex}-${descriptor.endIndex}:kind:${descriptor.shapeDefinition.kind}`
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

	const signature = buildRoadCollisionSignature({
		definition: roadNode.dynamicMesh as RoadDynamicMesh,
		roadNode,
		roadWidth: snapshot.roadWidth,
		collisionWidth: snapshot.collisionWidth,
		samplingDensityFactor: snapshot.samplingDensityFactor,
		collisionSubdivisionFactor: snapshot.collisionSubdivisionFactor,
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


const ROAD_SURFACE_Y_OFFSET = 0.05
const ROAD_EPSILON = 1e-6
const ROAD_MIN_DIVISIONS = 4
const ROAD_MAX_DIVISIONS = 256
const ROAD_DIVISION_DENSITY = 8

const ROAD_HEIGHT_SMOOTHING_MIN_PASSES = 3
const ROAD_HEIGHT_SMOOTHING_MAX_PASSES = 12

const ROAD_HEIGHT_SLOPE_MAX_GRADE = 0.8
const ROAD_HEIGHT_SLOPE_MIN_DELTA_Y = 0.03
const ROAD_COLLISION_MIN_ROWS = 2
const ROAD_COLLISION_MAX_ROWS = 10
const ROAD_COLLISION_MIN_TILE_LENGTH = 1
const ROAD_COLLISION_MAX_TILE_LENGTH = 2
const ROAD_COLLISION_DEFAULT_TILE_LENGTH = 20
const ROAD_RECTANGULAR_MAX_GEOMETRY_DETAIL = 0.18
const ROAD_RECTANGULAR_MAX_HEIGHT_DETAIL = 0.18
const ROAD_RECTANGULAR_MAX_HEIGHT_RANGE = 0.12
const ROAD_RECTANGULAR_MIN_THICKNESS = 0.08
const ROAD_RECTANGULAR_MAX_THICKNESS = 0.28
const ROAD_BOX_JOIN_MIN_OVERLAP_METERS = 0.14
const ROAD_BOX_JOIN_MAX_OVERLAP_METERS = 0.55

// Road collision uses mixed span-level collision: flat / near-flat spans use boxes,
// while curved / steep / complex spans use a render-surface derived static mesh.
const ROAD_TILE_MAX_HEADING_DELTA_RAD = (8 * Math.PI) / 180
const ROAD_TILE_MAX_PITCH_DELTA_RAD = (4 * Math.PI) / 180

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

class RoadSpanCurve extends THREE.Curve<THREE.Vector3> {
	private readonly spanStartU: number
	private readonly spanEndU: number

	constructor(
		private readonly sourceCurve: THREE.Curve<THREE.Vector3>,
		startU: number,
		endU: number,
	) {
		super()
		this.spanStartU = Math.max(0, Math.min(1, startU))
		this.spanEndU = Math.max(this.spanStartU, Math.min(1, endU))
	}

	override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
		const localT = Math.max(0, Math.min(1, t))
		const sourceT = this.spanStartU + (this.spanEndU - this.spanStartU) * localT
		return this.sourceCurve.getPoint(sourceT, target)
	}

	override getTangent(t: number, target = new THREE.Vector3()): THREE.Vector3 {
		const localT = Math.max(0, Math.min(1, t))
		const sourceT = this.spanStartU + (this.spanEndU - this.spanStartU) * localT
		return this.sourceCurve.getTangent(sourceT, target)
	}

	override getLength(): number {
		const sampleCount = Math.max(8, Math.min(48, Math.ceil((this.spanEndU - this.spanStartU) * 32)))
		const point = new THREE.Vector3()
		const previous = new THREE.Vector3()
		let length = 0
		for (let i = 0; i <= sampleCount; i += 1) {
			const t = i / sampleCount
			this.getPoint(t, point)
			if (i > 0) {
				length += previous.distanceTo(point)
			}
			previous.copy(point)
		}
		return length
	}
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
	boxOverlapMeters: number
}

type RoadCollisionSpanRange = {
	startIndex: number
	endIndex: number
}

type RoadCollisionMergeParams = {
	curve: THREE.Curve<THREE.Vector3>
	divisions: number
	heights: number[]
	roadWidth: number
	collisionSubdivisionFactor: number
	curveLength: number
	leafSpans: RoadCollisionSpanRange[]
	roadSimpleScore: number
	preferredMaxSpans: number | null
}

type RoadCollisionSpanMetrics = {
	spanLength: number
	headingDelta: number
	heightRange: number
	heightDelta: number
	slope: number
	pitchDelta: number
}

function summarizeRoadCollisionSpan(
	curve: THREE.Curve<THREE.Vector3>,
	divisions: number,
	heights: number[],
	startIndex: number,
	endIndex: number,
	curveLength: number,
): RoadCollisionSpanMetrics {
	const start = Math.max(0, Math.min(divisions, Math.trunc(startIndex)))
	const end = Math.max(start + 1, Math.min(divisions, Math.trunc(endIndex)))
	const startU = start / divisions
	const endU = end / divisions
	const startPoint = curve.getPoint(startU)
	const endPoint = curve.getPoint(endU)
	const forward = endPoint.clone().sub(startPoint)
	const spanLength = Math.max((end - start) * (curveLength / divisions), forward.length())
	const headingDelta = computeHeadingDeltaRad(curve, startU, endU)
	const heightRange = computeRoadHeightRangeForSpan(heights, start, Math.min(heights.length, end + 1))
	const startHeight = Number.isFinite(heights[start]!) ? heights[start]! : 0
	const endHeight = Number.isFinite(heights[end]!) ? heights[end]! : startHeight
	const heightDelta = Math.abs(endHeight - startHeight)
	const slope = spanLength > ROAD_EPSILON ? heightDelta / spanLength : 0
	const mid = Math.max(start + 1, Math.min(end - 1, Math.floor((start + end) * 0.5)))
	let pitchDelta = 0
	if (mid > start && mid < end) {
		const leftFit = computeRoadSpanSurfaceFit(heights.slice(start, mid + 1), Math.max(ROAD_EPSILON, spanLength * ((mid - start) / Math.max(1, end - start))))
		const rightFit = computeRoadSpanSurfaceFit(heights.slice(mid, end + 1), Math.max(ROAD_EPSILON, spanLength * ((end - mid) / Math.max(1, end - start))))
		pitchDelta = Math.abs(normalizeAngleRad(rightFit.pitch - leftFit.pitch))
	}
	return {
		spanLength,
		headingDelta,
		heightRange,
		heightDelta,
		slope,
		pitchDelta,
	}
}

function collectRoadCollisionSpans(
	curve: THREE.Curve<THREE.Vector3>,
	divisions: number,
	heights: number[],
	roadWidth: number,
	collisionSubdivisionFactor: number,
	maxSpans: number | null,
): RoadCollisionSpan[] {
	if (!(divisions > 0)) {
		return []
	}
	const factor = clampNumber(collisionSubdivisionFactor, 0.25, 8, 1.0)
	const curveLength = curve.getLength()
	if (!(curveLength > ROAD_EPSILON)) {
		return []
	}
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
	}
	const roadSimpleScore = computeRoadSpanSimpleScore(intervalGeometryDetails, intervalHeightDetails, heights)
	const baseTargetLength = clampNumber(
		(roadWidth * lerpNumber(12, 6, Math.min(1, Math.max(0, (factor - 0.25) / 7.75)))) / Math.max(0.75, Math.sqrt(factor)),
		0.85,
		14,
		roadWidth * 8,
	)
	const headingThreshold = ROAD_TILE_MAX_HEADING_DELTA_RAD / Math.max(0.85, Math.sqrt(factor))
	const heightRangeThreshold = ROAD_RECTANGULAR_MAX_HEIGHT_RANGE / Math.max(0.75, Math.sqrt(factor))
	const slopeThreshold = ROAD_HEIGHT_SLOPE_MAX_GRADE / Math.max(0.85, Math.sqrt(factor))
	const pitchThreshold = ROAD_TILE_MAX_PITCH_DELTA_RAD / Math.max(0.85, Math.sqrt(factor))

	const pending: RoadCollisionSpanRange[] = [{ startIndex: 0, endIndex: divisions }]
	const leafSpans: RoadCollisionSpanRange[] = []
	while (pending.length) {
		const span = pending.pop()!
		const metrics = summarizeRoadCollisionSpan(curve, divisions, heights, span.startIndex, span.endIndex, curveLength)
		const canSplit = span.endIndex - span.startIndex > 1
		const shouldSplit =
			canSplit &&
			(
				metrics.spanLength > baseTargetLength ||
				metrics.headingDelta > headingThreshold ||
				metrics.heightRange > heightRangeThreshold ||
				metrics.slope > slopeThreshold ||
				metrics.pitchDelta > pitchThreshold
			)
		if (!shouldSplit) {
			leafSpans.push(span)
			continue
		}
		const mid = Math.floor((span.startIndex + span.endIndex) * 0.5)
		if (mid <= span.startIndex || mid >= span.endIndex) {
			leafSpans.push(span)
			continue
		}
		pending.push({ startIndex: mid, endIndex: span.endIndex })
		pending.push({ startIndex: span.startIndex, endIndex: mid })
	}

	leafSpans.sort((a, b) => {
		if (a.startIndex !== b.startIndex) {
			return a.startIndex - b.startIndex
		}
		return a.endIndex - b.endIndex
	})

	const mergedSpans = mergeRoadCollisionSpans({
		curve,
		divisions,
		heights,
		roadWidth,
		collisionSubdivisionFactor: factor,
		curveLength,
		leafSpans,
		roadSimpleScore,
		preferredMaxSpans: maxSpans != null ? Math.max(1, Math.trunc(maxSpans)) : null,
	})

	return mergedSpans.map((span) => ({
		...span,
		boxOverlapMeters: computeRoadBoxJoinOverlapMeters(
			span.startIndex,
			span.endIndex,
			intervalGeometryDetails,
			intervalHeightDetails,
		),
	}))
}

function computeRoadSpanSimpleScore(
	intervalGeometryDetails: number[],
	intervalHeightDetails: number[],
	heights: number[],
): number {
	const intervalCount = Math.max(1, Math.min(intervalGeometryDetails.length, intervalHeightDetails.length))
	let geometrySum = 0
	let heightSum = 0
	for (let i = 0; i < intervalCount; i += 1) {
		const geometryDetail = Number.isFinite(intervalGeometryDetails[i]!) ? intervalGeometryDetails[i]! : 0
		const heightDetail = Number.isFinite(intervalHeightDetails[i]!) ? intervalHeightDetails[i]! : 0
		geometrySum += Math.max(0, Math.min(1, geometryDetail))
		heightSum += Math.max(0, Math.min(1, heightDetail))
	}
	const geometryMean = geometrySum / intervalCount
	const heightMean = heightSum / intervalCount
	const heightRange = computeRoadHeightRange(heights)
	const normalizedHeightRange = Math.max(0, Math.min(1, heightRange / Math.max(ROAD_RECTANGULAR_MAX_HEIGHT_RANGE * 4, 1e-6)))
	const complexity = Math.max(
		0,
		Math.min(1, geometryMean * 0.5 + heightMean * 0.35 + normalizedHeightRange * 0.15),
	)
	return Math.max(0, Math.min(1, 1 - complexity))
}

function mergeRoadCollisionSpans(params: RoadCollisionMergeParams): RoadCollisionSpanRange[] {
	const factor = clampNumber(params.collisionSubdivisionFactor, 0.25, 8, 1.0)
	const scale = Math.max(0, Math.min(1, (factor - 0.25) / 7.75))
	const headingThreshold = ROAD_TILE_MAX_HEADING_DELTA_RAD / Math.max(0.85, Math.sqrt(factor))
	const heightRangeThreshold = ROAD_RECTANGULAR_MAX_HEIGHT_RANGE / Math.max(0.75, Math.sqrt(factor))
	const slopeThreshold = ROAD_HEIGHT_SLOPE_MAX_GRADE / Math.max(0.85, Math.sqrt(factor))
	const pitchThreshold = ROAD_TILE_MAX_PITCH_DELTA_RAD / Math.max(0.85, Math.sqrt(factor))
	const fitErrorThreshold = lerpNumber(0.01, 0.006, scale)
	const baseSpanLength = clampNumber(
		lerpNumber(params.roadWidth * 6, params.roadWidth * 12, params.roadSimpleScore),
		Math.max(params.roadWidth * 4, ROAD_COLLISION_MIN_TILE_LENGTH * 2),
		Math.max(params.curveLength, params.roadWidth * 12),
		params.roadWidth * 8,
	)
	const preferredCount = params.preferredMaxSpans != null
		? Math.max(1, Math.min(params.preferredMaxSpans, Math.max(1, Math.ceil(params.curveLength / baseSpanLength))))
		: Math.max(1, Math.ceil(params.curveLength / baseSpanLength))
	const preferredSpanLength = params.curveLength / preferredCount
	const mergeLengthCap = Math.max(
		baseSpanLength,
		preferredSpanLength * lerpNumber(1.05, 1.25, params.roadSimpleScore),
	)
	const mergeMetricMultiplier = lerpNumber(0.85, 1.18, params.roadSimpleScore)
	let working = params.leafSpans.slice()
	if (working.length <= 1) {
		return working
	}

	let changed = true
	while (changed) {
		changed = false
		const next: RoadCollisionSpanRange[] = []
		for (const span of working) {
			const previous = next[next.length - 1]
			if (!previous) {
				next.push({ ...span })
				continue
			}
			if (previous.endIndex !== span.startIndex) {
				next.push({ ...span })
				continue
			}
			const mergedMetrics = summarizeRoadCollisionSpan(
				params.curve,
				params.divisions,
				params.heights,
				previous.startIndex,
				span.endIndex,
				params.curveLength,
			)
			const mergedHeights = params.heights.slice(previous.startIndex, span.endIndex + 1)
			const mergedFit = computeRoadSpanSurfaceFit(mergedHeights, mergedMetrics.spanLength)
			const mergedFitError = computeRoadSpanSurfaceFitError(mergedHeights, mergedFit)
			const mergedComplexity = Math.max(
				mergedMetrics.headingDelta / headingThreshold,
				mergedMetrics.heightRange / heightRangeThreshold,
				mergedMetrics.slope / slopeThreshold,
				mergedMetrics.pitchDelta / pitchThreshold,
				mergedFitError / fitErrorThreshold,
			)
			const mergedSimpleScore = Math.max(0, Math.min(1, 1 - mergedComplexity))
			const dynamicLengthCap = mergeLengthCap * lerpNumber(1.0, 1.2, mergedSimpleScore)
			if (
				mergedMetrics.spanLength <= dynamicLengthCap &&
				mergedMetrics.headingDelta <= headingThreshold * mergeMetricMultiplier &&
				mergedMetrics.heightRange <= heightRangeThreshold * mergeMetricMultiplier &&
				mergedMetrics.slope <= slopeThreshold * mergeMetricMultiplier &&
				mergedMetrics.pitchDelta <= pitchThreshold * mergeMetricMultiplier &&
				mergedFitError <= fitErrorThreshold * lerpNumber(1.0, 1.1, mergedSimpleScore)
			) {
				previous.endIndex = span.endIndex
				changed = true
				continue
			}
			next.push({ ...span })
		}
		working = next
	}

	return working
}

function shouldSubdivideSimpleRoadSpans(geometryDetail: number, heightDetail: number, heightRange: number): boolean {
	return geometryDetail <= 0.02
		&& heightDetail <= 0.04
		&& heightRange <= 0.04
}

function subdivideRoadCollisionSpans(
	spans: RoadCollisionSpan[],
	collisionSubdivisionFactor: number,
	divisions: number,
): RoadCollisionSpan[] {
	const factor = clampNumber(collisionSubdivisionFactor, 0.25, 8, 1.0)
	const segmentsPerSpan = Math.max(1, Math.round(Math.sqrt(factor)))
	if (segmentsPerSpan <= 1) {
		return spans
	}
	const refined: RoadCollisionSpan[] = []
	for (const span of spans) {
		const width = Math.max(1, span.endIndex - span.startIndex)
		const pieces = Math.max(1, Math.min(segmentsPerSpan, width))
		if (pieces <= 1) {
			refined.push(span)
			continue
		}
		for (let piece = 0; piece < pieces; piece += 1) {
			const startIndex = Math.round(span.startIndex + (width * piece) / pieces)
			const endIndex = piece === pieces - 1
				? span.endIndex
				: Math.round(span.startIndex + (width * (piece + 1)) / pieces)
			if (endIndex <= startIndex || startIndex < 0 || endIndex > divisions) {
				continue
			}
			refined.push({
				startIndex,
				endIndex,
				boxOverlapMeters: span.boxOverlapMeters,
			})
		}
	}
	return refined.length ? refined : spans
}

function shouldUseRoadStaticMeshForSpan(params: {
	geometryDetail: number
	surfaceFitError: number
	pitch: number
	slope: number
	pitchDelta: number
	spanLength: number
	collisionSubdivisionFactor: number
}): boolean {
	const factor = clampNumber(params.collisionSubdivisionFactor, 0.25, 8, 1.0)
	const scale = Math.max(0, Math.min(1, (factor - 0.25) / 7.75))
	const geometryThreshold = lerpNumber(0.08, 0.03, scale)
	const fitErrorThreshold = lerpNumber(0.012, 0.006, scale)
	const pitchDeltaThreshold = lerpNumber(0.03, 0.015, scale)
	const steepPitchThreshold = lerpNumber(0.03, 0.018, scale)
	const minCurvedSpanLength = lerpNumber(0.75, 0.45, scale)
	if (params.surfaceFitError > fitErrorThreshold) {
		return true
	}
	if (Math.abs(params.pitch) > steepPitchThreshold) {
		return true
	}
	if (params.slope > steepPitchThreshold) {
		return true
	}
	return params.geometryDetail > geometryThreshold
		&& params.pitchDelta > pitchDeltaThreshold
		&& params.spanLength >= minCurvedSpanLength
}

function buildStaticMeshShapeFromGeometry(geometry: THREE.BufferGeometry | null | undefined): Extract<RigidbodyPhysicsShape, { kind: 'static-mesh' }> | null {
	if (!geometry) {
		return null
	}
	const position = geometry.getAttribute('position')
	if (!position || position.itemSize < 3 || position.count < 3) {
		return null
	}
	const indices = geometry.index
		? Array.from(geometry.index.array as ArrayLike<number>).map((value) => Math.max(0, Math.trunc(Number(value) || 0)))
		: Array.from({ length: position.count }, (_value, index) => index)
	if (indices.length < 3) {
		return null
	}
	const vertices: Array<[number, number, number]> = []
	for (let index = 0; index + 2 < position.array.length; index += 3) {
		vertices.push([
			Number(position.array[index] ?? 0),
			Number(position.array[index + 1] ?? 0),
			Number(position.array[index + 2] ?? 0),
		])
	}
	if (vertices.length < 3) {
		return null
	}
	return {
		kind: 'static-mesh',
		vertices,
		indices,
		offset: [0, 0, 0],
		applyScale: false,
	}
}

function hashStaticMeshGeometry(geometry: THREE.BufferGeometry): number {
	let hash = 2166136261
	const push = (value: number) => {
		hash ^= value | 0
		hash = Math.imul(hash, 16777619) >>> 0
	}
	const position = geometry.getAttribute('position')
	if (!position || position.itemSize < 3) {
		return hash >>> 0
	}
	push(position.count)
	push(geometry.index?.count ?? 0)
	for (let index = 0; index < position.array.length; index += 1) {
		push(Math.round(Number(position.array[index] ?? 0) * 1000))
	}
	if (geometry.index) {
		for (let index = 0; index < geometry.index.array.length; index += 1) {
			push(Math.trunc(Number(geometry.index.array[index] ?? 0)))
		}
	}
	return hash >>> 0
}

function sanitizeVector2Loop(loop: THREE.Vector2[]): THREE.Vector2[] {
	if (!Array.isArray(loop) || loop.length < 3) {
		return []
	}
	const cleaned: THREE.Vector2[] = []
	for (const point of loop) {
		const last = cleaned.length ? cleaned[cleaned.length - 1]! : null
		if (!last || last.distanceToSquared(point) > ROAD_EPSILON * ROAD_EPSILON) {
			cleaned.push(point)
		}
	}
	if (cleaned.length >= 3 && cleaned[0]!.distanceToSquared(cleaned[cleaned.length - 1]!) <= ROAD_EPSILON * ROAD_EPSILON) {
		cleaned.pop()
	}
	return cleaned.length >= 3 ? cleaned : []
}

function sampleAndSmoothLoopHeights(
	loop: THREE.Vector2[],
	sampler: ((x: number, z: number) => number) | null,
	baseOffset: number,
	clearance: number,
	passes: number,
): number[] {
	const cleaned = sanitizeVector2Loop(loop)
	if (!cleaned.length) {
		return []
	}
	const values: number[] = []
	const minimums: number[] = []
	for (const point of cleaned) {
		const sampled = sampler ? sampler(point.x, point.y) : 0
		const y = (Number.isFinite(sampled) ? sampled : 0) + baseOffset + clearance
		values.push(y)
		minimums.push(y)
	}
	return smoothHeightSeries(values, passes, minimums)
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
	// Keep the whole edge together so the adaptive span logic can merge across
	// simple internal line segments and only split where curvature or slope
	// actually demands it.
	return [curve]
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

type RoadRectangularTileShapeParams = {
	roadWidth: number
	length: number
	heights: number[]
}

type RoadSpanSurfaceFit = {
	startHeight: number
	endHeight: number
	centerHeight: number
	pitch: number
}

function computeRoadSpanBoxPitch(
	heights: number[],
	spanLength: number,
): number {
	if (!Array.isArray(heights) || heights.length < 2) {
		return 0
	}
	const startHeight = Number.isFinite(heights[0]!) ? heights[0]! : 0
	const endHeight = Number.isFinite(heights[heights.length - 1]!) ? heights[heights.length - 1]! : startHeight
	const horizontalLength = Math.max(ROAD_EPSILON, Number.isFinite(spanLength) ? spanLength : 0)
	return Math.atan2(endHeight - startHeight, horizontalLength)
}

function computeRoadSpanSurfaceFit(
	heights: number[],
	spanLength: number,
): RoadSpanSurfaceFit {
	if (!Array.isArray(heights) || heights.length < 2) {
		return {
			startHeight: 0,
			endHeight: 0,
			centerHeight: 0,
			pitch: 0,
		}
	}
	const sampleCount = heights.length
	const horizontalLength = Math.max(ROAD_EPSILON, Number.isFinite(spanLength) ? spanLength : 0)
	let sumX = 0
	let sumY = 0
	let sumXX = 0
	let sumXY = 0
	for (let i = 0; i < sampleCount; i += 1) {
		const value = Number.isFinite(heights[i]!) ? heights[i]! : 0
		const x = sampleCount > 1 ? (i / (sampleCount - 1)) * horizontalLength : 0
		sumX += x
		sumY += value
		sumXX += x * x
		sumXY += x * value
	}
	const denominator = sampleCount * sumXX - sumX * sumX
	const slope = Math.abs(denominator) > ROAD_EPSILON ? (sampleCount * sumXY - sumX * sumY) / denominator : 0
	const startHeight = Number.isFinite(heights[0]!) ? heights[0]! : 0
	const endHeight = Number.isFinite(heights[heights.length - 1]!) ? heights[heights.length - 1]! : startHeight
	const centerHeight = (startHeight + endHeight) * 0.5
	return {
		startHeight,
		endHeight,
		centerHeight,
		pitch: Math.atan(slope),
	}
}

function computeRoadSpanSurfaceFitError(
	heights: number[],
	fit: RoadSpanSurfaceFit,
): number {
	if (!Array.isArray(heights) || heights.length < 2) {
		return 0
	}
	const sampleCount = heights.length
	let sumSquaredError = 0
	for (let i = 0; i < sampleCount; i += 1) {
		const value = Number.isFinite(heights[i]!) ? heights[i]! : 0
		const x = sampleCount > 1 ? i / (sampleCount - 1) : 0
		const predicted = fit.startHeight + (fit.endHeight - fit.startHeight) * x
		const residual = value - predicted
		sumSquaredError += residual * residual
	}
	return Math.sqrt(sumSquaredError / sampleCount)
}

function buildRoadRectangularTileShapeFromSeries({
	roadWidth,
	length,
	heights,
}: RoadRectangularTileShapeParams): Extract<RigidbodyPhysicsShape, { kind: 'box' }> | null {
	if (!(roadWidth > ROAD_EPSILON) || !(length > ROAD_EPSILON) || heights.length < 2) {
		return null
	}
	const heightRange = computeRoadHeightRange(heights)
	const thickness = Math.max(
		ROAD_RECTANGULAR_MIN_THICKNESS,
		Math.min(
			ROAD_RECTANGULAR_MAX_THICKNESS,
			Math.max(ROAD_SURFACE_Y_OFFSET * 4, (Number.isFinite(heightRange) ? heightRange : 0) + 0.08),
		),
	)
	return {
		kind: 'box',
		halfExtents: [Math.max(1e-4, roadWidth * 0.5), Math.max(1e-4, thickness * 0.5), Math.max(1e-4, length * 0.5)],
		offset: [0, 0, 0],
	applyScale: false,
	} satisfies Extract<RigidbodyPhysicsShape, { kind: 'box' }>
}

function buildRoadCollisionSignature(params: {
	definition: RoadDynamicMesh
	roadNode: SceneNode
	roadWidth: number
	collisionWidth: number
	samplingDensityFactor: number
	collisionSubdivisionFactor: number
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
		`cd:${Math.round(params.collisionSubdivisionFactor * 1000)}`,
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



