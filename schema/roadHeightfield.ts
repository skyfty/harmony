import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type { SceneNode, SceneNodeComponentState, RoadDynamicMesh } from './index'

import type { RigidbodyComponentProps, RigidbodyPhysicsShape } from './components'
import { BOUNDARY_WALL_COMPONENT_TYPE, clampBoundaryWallComponentProps, type BoundaryWallComponentProps } from './components'
import { ROAD_COMPONENT_TYPE, clampRoadProps, type RoadComponentProps } from './components/definitions/roadComponent'
import { resolveRoadLocalHeightSampler, createSegmentHeightSampler } from './roadMesh'
import { buildGroundHeightfieldData } from './groundHeightfield'
import { buildRoadCornerBezierCurvePath } from './roadCurvePath'
import { buildRoadGraph, type RoadGraph } from './roadGraph'

export type RoadHeightfieldBodiesEntry = { signature: string; bodies: CANNON.Body[] }

export type RoadHeightfieldTileDescriptor = {
	curveIndex: number
	tileIndex: number
	startIndex: number
	endIndex: number
	position: [number, number, number]
	yaw: number
	shapeDefinition: Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>
}

export type RoadHeightfieldBuildSnapshot = {
	surfaceNode: SceneNode
	tiles: RoadHeightfieldTileDescriptor[]
	groundSignature: string
	heightHash: number
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
	groundNode?: SceneNode | null
	world: CANNON.World
	createBody: (
		node: SceneNode,
		component: SceneNodeComponentState<RigidbodyComponentProps>,
		shapeDefinition: RigidbodyPhysicsShape | null,
		object: THREE.Object3D,
	) => { body: CANNON.Body } | null
	maxSegments?: number
}
	// RoadHeightfieldBuildParams: 构建道路高度场所需参数的类型定义。
	// - roadNode: 场景中的道路节点，包含动态网格等信息
	// - rigidbodyComponent: 道路节点对应的刚体组件状态（用于读取 bodyType 等）
	// - roadObject: THREE.Object3D，作为道路的父对象用于挂载生成的 tile 对象
	// - groundNode: 可选的地形节点，用于从地形采样高度
	// - world: CANNON.World 物理世界实例（用于创建刚体时使用）
	// - createBody: 工厂函数，用于基于节点、组件和形状定义创建物理 body
	// - maxSegments: 可选的最大分段数限制，用于控制生成多少个 collider
export function isRoadDynamicMesh(value: SceneNode['dynamicMesh'] | null | undefined): value is RoadDynamicMesh {
	return Boolean(value && (value as any).type === 'Road')
}
// isRoadDynamicMesh: 简单的类型守卫，用于判断给定的 dynamicMesh 是否为 Road 类型
// 返回 true 表示该节点的 dynamicMesh 可以作为道路定义进行后续处理

export function collectRoadHeightfieldTileDescriptors(params: RoadHeightfieldBuildParams): RoadHeightfieldBuildSnapshot | null {
	const {
		roadNode,
		rigidbodyComponent,
		groundNode,
		maxSegments,
	} = params

    // collectRoadHeightfieldTileDescriptors: 根据道路定义与可选地形信息，
    // 计算并收集用于构建高度场刚体的 tile 描述符列表。
    // 返回值为 RoadHeightfieldBuildSnapshot 或 null（当无法构建时）。

	if (!isRoadDynamicMesh(roadNode.dynamicMesh)) {
		return null
	}
	const definition = roadNode.dynamicMesh
	if ((rigidbodyComponent.props as RigidbodyComponentProps | undefined)?.bodyType !== 'STATIC') {
		return null
	}

    // 只对静态刚体（STATIC）生成高度场碰撞体；动态或运动学刚体不处理

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
	const snapToTerrain = roadProps.snapToTerrain
	const heightSampler = groundNode ? resolveRoadLocalHeightSampler(roadNode, groundNode) : null

    // 预处理道路属性：宽度、采样密度、平滑强度、最小净空、交叉口平滑等
    // heightSampler: 当提供 groundNode 时，用来从地形采样高度的函数

	const graph = buildRoadGraph(definition)
	if (!graph) {
		return null
	}

    // 将道路的动态网格转为图结构（顶点 + 路径），以便按曲线分段进行采样

	// If per-segment heights are present, build a segment-based sampler and
	// let subsequent curve sampling use it. Otherwise fall back to runtime sampler.
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

    // 如果提供了按段的高度（segmentHeights），则构建一个基于段的采样器。
    // 该采样器会基于已序列化的段高度数据直接返回道路表面高度，
    // 从而避免运行时再去采样地形或其他动态来源。
	const roadSurfaceHeightSampler = serializedSampler
		? serializedSampler
		: snapToTerrain
			? heightSampler
			: (_x: number, _z: number) => 0
	if (!roadSurfaceHeightSampler) {
		return null
	}

    // roadSurfaceHeightSampler 最终会是如下三者之一：
    //  - serializedSampler: 已序列化的按段高度采样器（优先）
    //  - heightSampler: 从地形采样的函数（当 snapToTerrain 为 true）
    //  - 恒为 0 的采样器（若不对齐地形且无段高度数据）

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

    // boundaryWallEnabled: 判断是否启用了边界墙组件，如果启用则读取其属性并在 surfaceNode 中
    // 移除 boundary wall 组件（用于后续生成 collider 时只考虑道路表面本身）
    // buildRoadCurvesFromGraph: 将图结构转换为一组平滑曲线（用于按曲线分段采样）

	const hasSegmentHeights = Boolean(serializedSampler)

	const desiredTileLength = clampNumber(roadWidth * 8, 2, 16, 8)
	const targetRows = 192
	const elementSize = Math.max(1e-4, desiredTileLength / targetRows)
	const maxBodies = typeof maxSegments === 'number' && Number.isFinite(maxSegments)
		? Math.max(1, Math.trunc(maxSegments))
		: 128

    // 计算瓦片（tile）相关参数：期望瓦片长度、每瓦片的网格行数（目标），以及元素尺寸
    // elementSize 用于构建高度场网格时在前向方向上的采样间距

	let totalBodies = 0
	const tiles: RoadHeightfieldTileDescriptor[] = []
	let signatureHash = 0

	let curveIndex = 0
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
		const smoothedHeights = buildRoadCenterlineHeightSeries({
			curve,
			divisions,
			heightSampler: roadSurfaceHeightSampler,
			minClearance,
			smoothingStrengthFactor,
			smooth: !hasSegmentHeights,
		})
		// Feed the signature with the final smoothed heights so edits invalidate correctly.
		smoothedHeights.forEach((value) => {
			const normalized = Math.round((Number.isFinite(value) ? value : 0) * 1000)
			signatureHash = (signatureHash * 31 + normalized) >>> 0
		})

        // 对曲线进行离散化（divisions），并基于中心线构建高度序列（smoothedHeights）
        // signatureHash 用于跟踪高度变化，用作后续缓存或对比的签名

		const stepDistance = length / divisions
		const divisionsPerTile = Math.max(1, Math.round(desiredTileLength / stepDistance))
		let startIndex = 0
		const p0 = new THREE.Vector3()
		const p1 = new THREE.Vector3()
		const forward = new THREE.Vector3()
		const centerPoint = new THREE.Vector3()
		let tileIndex = 0
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
			const rows = Math.max(2, Math.ceil(tileLength / elementSize))
			const shape = buildHeightfieldShapeFromSeries({
				startIndex,
				endIndex,
				rows,
				elementSize,
				roadWidth: collisionWidth,
				heights: smoothedHeights,
			})
			if (!shape) {
				startIndex = endIndex
				continue
			}
			tiles.push({
				curveIndex,
				tileIndex,
				startIndex,
				endIndex,
				position: [centerPoint.x, 0, centerPoint.z],
				yaw,
				shapeDefinition: shape,
			})
			totalBodies += 1
			tileIndex += 1
			startIndex = endIndex
		}
		curveIndex += 1
	}

    // 对每条曲线分段，按照期望瓦片长度将曲线切分为多个 tile；
    // 在弯道处会根据 headingDelta 递减 tile 长度以更贴合曲面；
    // 每个 tile 会生成一个高度场形状（shapeDefinition），并记录其位置与朝向（yaw）。

	if (!tiles.length) {
		return null
	}

	const groundData = groundNode && (groundNode.dynamicMesh as any)?.type === 'Ground'
		? buildGroundHeightfieldData(groundNode, groundNode.dynamicMesh as any)
		: null
	const groundSignature = groundData?.signature ?? 'none'
	return {
		surfaceNode,
		tiles,
		groundSignature,
		heightHash: signatureHash,
		roadWidth,
		collisionWidth,
		samplingDensityFactor,
		smoothingStrengthFactor,
		minClearance,
		junctionSmoothing,
		desiredTileLength,
		elementSize,
		boundaryWallEnabled,
		boundaryWallProps,
	}
}

// 返回值说明：RoadHeightfieldBuildSnapshot 包含了构建高度场所需的所有瓦片描述符、
// 道路与地形相关的签名信息以及用于再现此构建的参数（便于缓存和校验）。

export function buildRoadHeightfieldBodies(params: RoadHeightfieldBuildParams): RoadHeightfieldBodiesEntry | null {
	const snapshot = collectRoadHeightfieldTileDescriptors(params)
	if (!snapshot) {
		return null
	}
	const {
		roadNode,
		rigidbodyComponent,
		roadObject,
		groundNode = null,
		createBody,
	} = params

	roadObject.updateMatrixWorld(true)

	const bodies: CANNON.Body[] = []
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
			;(bodyResult.body as CANNON.Body & { name?: string }).name = `road-tile:${roadNode.id}:curve:${tile.curveIndex}:tile:${tile.tileIndex}`
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
		groundNode,
		groundSignature: snapshot.groundSignature,
		roadWidth: snapshot.roadWidth,
		collisionWidth: snapshot.collisionWidth,
		samplingDensityFactor: snapshot.samplingDensityFactor,
		smoothingStrengthFactor: snapshot.smoothingStrengthFactor,
		minClearance: snapshot.minClearance,
		junctionSmoothing: snapshot.junctionSmoothing,
		elementSize: snapshot.elementSize,
		desiredTileLength: snapshot.desiredTileLength,
		bodyCount: bodies.length,
		heightHash: snapshot.heightHash,
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
const ROAD_COLLISION_TILE_OVERLAP_METERS = 0.5

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
	rows: number
	elementSize: number
	roadWidth: number
	heights: number[]
}

function buildHeightfieldShapeFromSeries({
	startIndex,
	endIndex,
	rows,
	elementSize,
	roadWidth,
	heights,
}: HeightfieldFromSeriesParams): Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }> | null {
	const span = endIndex - startIndex
	if (span <= 0) {
		return null
	}
	const overlapRows = Math.max(1, Math.ceil(ROAD_COLLISION_TILE_OVERLAP_METERS / elementSize))
	const pointsX = Math.max(2, Math.ceil(Math.max(roadWidth, elementSize) / elementSize) + 1)
	const pointsZ = rows + 1 + overlapRows * 2
	if (pointsX < 2 || pointsZ < 2) {
		return null
	}
	const width = Math.max(1e-4, (pointsX - 1) * elementSize)
	const depth = Math.max(1e-4, (pointsZ - 1) * elementSize)
	const halfWidth = width * 0.5
	const halfDepth = depth * 0.5
	const matrix: number[][] = []
	for (let col = 0; col < pointsX; col += 1) {
		const columnValues: number[] = []
		for (let row = pointsZ - 1; row >= 0; row -= 1) {
			const innerRows = Math.max(1, pointsZ - 1 - overlapRows * 2)
			const uAlong = pointsZ > 1
				? Math.max(0, Math.min(1, (row - overlapRows) / innerRows))
				: 0
			const indexFloat = startIndex + uAlong * span
			const i0 = Math.max(0, Math.min(heights.length - 1, Math.floor(indexFloat)))
			const i1 = Math.max(0, Math.min(heights.length - 1, i0 + 1))
			const frac = indexFloat - i0
			const h0 = heights[i0] ?? 0
			const h1 = heights[i1] ?? h0
			const height = h0 + (h1 - h0) * frac
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
	groundNode?: SceneNode | null
	groundSignature: string
	roadWidth: number
	collisionWidth: number
	samplingDensityFactor: number
	smoothingStrengthFactor: number
	minClearance: number
	junctionSmoothing: number
	elementSize: number
	desiredTileLength: number
	bodyCount: number
	heightHash: number
	boundaryWallEnabled: boolean
	boundaryWallProps: BoundaryWallComponentProps | null
}): string {
	const roadPosition = (params.roadNode.position as any) ?? {}
	const roadRotation = (params.roadNode.rotation as any) ?? {}
	const groundPosition = (params.groundNode?.position as any) ?? {}
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
		`cw:${Math.round(params.collisionWidth * 1000)}`,
		`jd:${Math.round(params.junctionSmoothing * 1000)}`,
		`sd:${Math.round(params.samplingDensityFactor * 1000)}`,
		`ss:${Math.round(params.smoothingStrengthFactor * 1000)}`,
		`mc:${Math.round(params.minClearance * 1000)}`,
		`tile:${Math.round(params.desiredTileLength * 1000)}`,
		`es:${Math.round(params.elementSize * 1000)}`,
		`b:${params.bodyCount}`,
		`rh:${params.heightHash.toString(16)}`,
		`bw:${params.boundaryWallEnabled ? 1 : 0}`,
		`bwh:${Math.round((params.boundaryWallProps?.height ?? 0) * 1000)}`,
		`bwt:${Math.round((params.boundaryWallProps?.thickness ?? 0) * 1000)}`,
		`bwo:${Math.round((params.boundaryWallProps?.offset ?? 0) * 1000)}`,
		`rp:${Math.round(rx * 1000)},${Math.round(ry * 1000)},${Math.round(rz * 1000)}`,
		`ry:${Math.round(yaw * 1000)}`,
		`gp:${Math.round(gx * 1000)},${Math.round(gy * 1000)},${Math.round(gz * 1000)}`,
		`gs:${params.groundSignature}`,
	].join('|')
}
