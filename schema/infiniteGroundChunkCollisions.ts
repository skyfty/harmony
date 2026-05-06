import * as THREE from 'three'
import * as CANNON from 'cannon-es'

import {
	clampRigidbodyComponentProps,
	resolveInfiniteGroundGridOriginMeters,
	deserializeGroundChunkData,
	parseGroundChunkKey,
	resolveGroundChunkCoordFromWorldPosition,
	resolveGroundChunkOrigin,
	RIGIDBODY_COMPONENT_TYPE,
	type GroundChunkManifestRecord,
	type GroundLocalEditTileData,
	type GroundRuntimeDynamicMesh,
	type RigidbodyComponentProps,
	type RigidbodyPhysicsShape,
	type SceneNode,
	type SceneNodeComponentState,
} from './index'
import { resolveGroundEffectiveHeightAtVertex, sampleGroundHeight } from './groundMesh'
import {
	removeRigidbodyInstanceBodies,
	type RigidbodyInstance,
	type RigidbodyOrientationAdjustment,
} from './physicsEngine'

type HeightfieldShapeDefinition = Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>

type InfiniteGroundChunkColliderSource = 'manifest' | 'runtime-detailed' | 'base-flat'

type InfiniteGroundChunkColliderDescriptor = {
	runtimeKey: string
	source: InfiniteGroundChunkColliderSource
	chunkKey: string
	signature: string
	shapeDefinition?: HeightfieldShapeDefinition
	record?: GroundChunkManifestRecord
	loadBuffer?: boolean
	bufferFallbackHeight: number
	chunkSizeMeters: number
	resolution: number
}

type PendingEntry = {
	signature: string
	promise: Promise<void>
}

export type InfiniteGroundChunkColliderRuntimeDeps = {
	getPhysicsWorld: () => CANNON.World | null
	ensurePhysicsWorld: () => CANNON.World
	createBody: (
		node: SceneNode,
		component: SceneNodeComponentState<RigidbodyComponentProps>,
		shapeDefinition: HeightfieldShapeDefinition | null,
		object: THREE.Object3D,
	) => { body: CANNON.Body; orientationAdjustment: RigidbodyOrientationAdjustment | null } | null
	loggerTag?: string
}

export type InfiniteGroundChunkColliderSyncParams = {
	enabled: boolean
	groundObject: THREE.Object3D
	groundDefinition: GroundRuntimeDynamicMesh
	camera: THREE.Camera | null | undefined
	sourceId: string
	manifestRevision?: number
	manifestRecords?: Record<string, GroundChunkManifestRecord>
	loadChunkData?: (record: GroundChunkManifestRecord) => Promise<ArrayBuffer | null>
}

export type InfiniteGroundChunkColliderRuntime = {
	clear: () => void
	sync: (params: InfiniteGroundChunkColliderSyncParams) => void
	getDebugEntries: () => InfiniteGroundChunkColliderDebugEntry[]
}

export type InfiniteGroundChunkColliderDebugEntry = {
	runtimeKey: string
	nodeId: string
	source: InfiniteGroundChunkColliderSource
	instance: RigidbodyInstance
	shapes: HeightfieldShapeDefinition[]
}

const collisionRuntimeCameraLocal = new THREE.Vector3()
const DIAGNOSTIC_LOG_INTERVAL_MS = 2000
const DIAGNOSTIC_COLLIDER_WARN_THRESHOLD = 64

function makeRuntimeKey(source: InfiniteGroundChunkColliderSource, chunkKey: string): string {
	return `${source}:${chunkKey}`
}

function stringifyDiagnosticPayload(payload: Record<string, unknown>): string {
	try {
		return JSON.stringify(payload)
	} catch (error) {
		return `{"error":"failed-to-stringify","message":${JSON.stringify(String(error))}}`
	}
}

function normalizeManifestRevision(value: number | undefined): number {
	return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0
}

function buildStaticRigidbodyComponent(chunkKey: string): SceneNodeComponentState<RigidbodyComponentProps> {
	return {
		id: `__groundChunkCollider:${chunkKey}`,
		type: RIGIDBODY_COMPONENT_TYPE,
		enabled: true,
		props: clampRigidbodyComponentProps({ bodyType: 'STATIC', mass: 0 }),
	}
}

function buildColliderNode(source: InfiniteGroundChunkColliderSource, chunkKey: string): SceneNode {
	return {
		id: `__groundChunkCollider:${source}:${chunkKey}`,
		name: `Ground Chunk Collider ${chunkKey}`,
		nodeType: 'Mesh',
		position: { x: 0, y: 0, z: 0 },
		rotation: { x: 0, y: 0, z: 0 },
		scale: { x: 1, y: 1, z: 1 },
		visible: true,
	} as SceneNode
}

function createChunkCollisionProxy(
	groundObject: THREE.Object3D,
	chunkKey: string,
	chunkSizeMeters: number,
): THREE.Object3D | null {
	const coord = parseGroundChunkKey(chunkKey)
	if (!coord) {
		return null
	}
	const origin = resolveGroundChunkOrigin(coord, chunkSizeMeters)
	const proxy = new THREE.Object3D()
	const center = new THREE.Vector3(
		origin.x + chunkSizeMeters * 0.5,
		0,
		origin.z + chunkSizeMeters * 0.5,
	)
	groundObject.localToWorld(center)
	const worldPosition = new THREE.Vector3()
	const worldQuaternion = new THREE.Quaternion()
	const worldScale = new THREE.Vector3()
	groundObject.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale)
	proxy.position.copy(center)
	proxy.quaternion.copy(worldQuaternion)
	proxy.scale.copy(worldScale)
	proxy.updateMatrixWorld(true)
	return proxy
}

function decodeChunkHeights(buffer: ArrayBuffer | null, resolution: number): Float32Array | null {
	const normalizedResolution = Math.max(1, Math.trunc(resolution))
	const expectedVertexCount = (normalizedResolution + 1) * (normalizedResolution + 1)
	const decoded = deserializeGroundChunkData(buffer)
	if (decoded?.header?.resolution === normalizedResolution && decoded.heights.length === expectedVertexCount) {
		return decoded.heights instanceof Float32Array ? decoded.heights : Float32Array.from(decoded.heights)
	}
	if (!(buffer instanceof ArrayBuffer)) {
		return null
	}
	if (buffer.byteLength !== expectedVertexCount * Float32Array.BYTES_PER_ELEMENT) {
		return null
	}
	return new Float32Array(buffer)
}

function buildManifestHeightfieldShape(
	record: GroundChunkManifestRecord,
	buffer: ArrayBuffer | null,
	fallbackHeight: number,
): { shapeDefinition: HeightfieldShapeDefinition; signature: string } {
	const resolution = Math.max(1, Math.trunc(record.resolution))
	const heights = decodeChunkHeights(buffer, resolution)
	return buildHeightfieldShapeFromHeights(
		record.chunkSizeMeters,
		resolution,
		heights,
		fallbackHeight,
		`${record.key}|${record.revision}|${resolution}|`,
	)
}

function buildHeightfieldShapeFromHeights(
	chunkSizeMeters: number,
	resolution: number,
	heights: ArrayLike<number> | null | undefined,
	fallbackHeight: number,
	signatureBase = '',
): { shapeDefinition: HeightfieldShapeDefinition; signature: string } {
	const vertexColumns = resolution + 1
	const vertexRows = resolution + 1
	const matrix: number[][] = []
	let heightHash = 0

	for (let column = 0; column < vertexColumns; column += 1) {
		const columnValues: number[] = []
		for (let row = vertexRows - 1; row >= 0; row -= 1) {
			const heightIndex = row * vertexColumns + column
			const height = heights?.[heightIndex] ?? fallbackHeight
			columnValues.push(height)
			heightHash = (heightHash * 31 + Math.round(height * 1000)) >>> 0
		}
		matrix.push(columnValues)
	}

	return {
		shapeDefinition: {
			kind: 'heightfield',
			matrix,
			elementSize: chunkSizeMeters / resolution,
			width: chunkSizeMeters,
			depth: chunkSizeMeters,
			offset: [-chunkSizeMeters * 0.5, -chunkSizeMeters * 0.5, 0],
			applyScale: false,
		},
		signature: `${signatureBase}${heightHash.toString(16)}`,
	}
}

function getGroundLocalEditTiles(definition: GroundRuntimeDynamicMesh): GroundLocalEditTileData[] {
	return definition.localEditTiles && typeof definition.localEditTiles === 'object'
		? Object.values(definition.localEditTiles)
		: []
}

function resolveIntersectingLocalEditTiles(
	chunkKey: string,
	chunkSizeMeters: number,
	localEditTiles: GroundLocalEditTileData[],
): GroundLocalEditTileData[] {
	const coord = parseGroundChunkKey(chunkKey)
	if (!coord || localEditTiles.length === 0) {
		return []
	}
	const chunkOrigin = resolveGroundChunkOrigin(coord, chunkSizeMeters)
	const chunkMinX = chunkOrigin.x
	const chunkMaxX = chunkOrigin.x + chunkSizeMeters
	const chunkMinZ = chunkOrigin.z
	const chunkMaxZ = chunkOrigin.z + chunkSizeMeters

	return localEditTiles.filter((tile) => {
		const tileSizeMeters = Number(tile.tileSizeMeters)
		if (!Number.isFinite(tileSizeMeters) || tileSizeMeters <= 0) {
			return false
		}
		const tileOrigin = resolveInfiniteGroundGridOriginMeters(tileSizeMeters)
		const tileMinX = tileOrigin + tile.tileColumn * tileSizeMeters
		const tileMinZ = tileOrigin + tile.tileRow * tileSizeMeters
		const tileMaxX = tileMinX + tileSizeMeters
		const tileMaxZ = tileMinZ + tileSizeMeters
		return tileMaxX > chunkMinX
			&& tileMinX < chunkMaxX
			&& tileMaxZ > chunkMinZ
			&& tileMinZ < chunkMaxZ
	})
}

function buildRuntimeDetailedColliderSignature(
	chunkKey: string,
	layoutSignature: string,
	groundDefinition: GroundRuntimeDynamicMesh,
	localEditTiles: GroundLocalEditTileData[],
): string {
	const surfaceRevision = Number.isFinite(groundDefinition.surfaceRevision)
		? Math.max(0, Math.trunc(groundDefinition.surfaceRevision as number))
		: 0
	const tileSignature = localEditTiles
		.map((tile) => [
			tile.key,
			Math.max(0, Math.trunc(Number(tile.updatedAt) || 0)),
			Math.max(1, Math.trunc(Number(tile.resolution) || 0)),
			Math.round((Number(tile.tileSizeMeters) || 0) * 1000),
		].join(':'))
		.sort()
		.join(';')
	return `${chunkKey}|runtime-detailed|${surfaceRevision}|${layoutSignature}|${tileSignature}`
}

function resolveRuntimeChunkSpec(
	chunkKey: string,
	groundDefinition: GroundRuntimeDynamicMesh,
	chunkSizeMeters: number,
): { coord: NonNullable<ReturnType<typeof parseGroundChunkKey>>; startRow: number; startColumn: number; rows: number; columns: number } | null {
	const coord = parseGroundChunkKey(chunkKey)
	if (!coord) {
		return null
	}
	const baseCellSize = Number.isFinite(groundDefinition.cellSize) && groundDefinition.cellSize > 1e-6
		? groundDefinition.cellSize
		: 1
	const chunkSpanCells = Math.max(1, Math.round(chunkSizeMeters / Math.max(baseCellSize, Number.EPSILON)))
	return {
		coord,
		startRow: coord.chunkZ * chunkSpanCells,
		startColumn: coord.chunkX * chunkSpanCells,
		rows: chunkSpanCells,
		columns: chunkSpanCells,
	}
}

function resolveImportedLocalEditCellSizeForCollision(definition: GroundRuntimeDynamicMesh): number | null {
	const demSource = definition.planningMetadata?.demSource as Record<string, unknown> | null | undefined
	if (!demSource) {
		return null
	}
	const direct = Number(demSource.localEditCellSize)
	if (Number.isFinite(direct) && direct > 0) {
		return Math.max(1e-6, direct)
	}
	const applied = Number(demSource.appliedSampleStepMeters)
	if (Number.isFinite(applied) && applied > 0) {
		return Math.max(1e-6, applied)
	}
	const candidates = [demSource.sampleStepMeters, demSource.sampleStepX, demSource.sampleStepY]
		.map((value) => Number(value))
		.filter((value) => Number.isFinite(value) && value > 0)
	if (!candidates.length) {
		return null
	}
	return Math.max(1e-6, Math.min(...candidates))
}

function buildRuntimeDetailedHeightfieldShape(
	chunkKey: string,
	chunkSizeMeters: number,
	groundDefinition: GroundRuntimeDynamicMesh,
	localEditTiles: GroundLocalEditTileData[],
	fallbackHeight: number,
): {
	shapeDefinition: HeightfieldShapeDefinition
	signature: string
	resolution: number
	samplingMode: 'vertex' | 'world'
	segmentColumns: number
	segmentRows: number
} | null {
	const spec = resolveRuntimeChunkSpec(chunkKey, groundDefinition, chunkSizeMeters)
	if (!spec) {
		return null
	}
	const baseCellSize = Number.isFinite(groundDefinition.cellSize) && groundDefinition.cellSize > 1e-6
		? groundDefinition.cellSize
		: 1
	const origin = resolveGroundChunkOrigin(spec.coord, chunkSizeMeters)
	const hasNonDemTile = localEditTiles.some((tile) => tile.source !== 'dem')
	const importedCellSize = hasNonDemTile
		? null
		: resolveImportedLocalEditCellSizeForCollision(groundDefinition)
	const localEditCellSize = importedCellSize ? Math.max(baseCellSize, importedCellSize) : baseCellSize
	const useWorldSpaceSampling = localEditCellSize > baseCellSize
	const segmentColumns = useWorldSpaceSampling
		? Math.max(1, Math.ceil((spec.columns * baseCellSize) / localEditCellSize))
		: spec.columns
	const segmentRows = useWorldSpaceSampling
		? Math.max(1, Math.ceil((spec.rows * baseCellSize) / localEditCellSize))
		: spec.rows
	const stepX = (spec.columns * baseCellSize) / segmentColumns
	const stepZ = (spec.rows * baseCellSize) / segmentRows
	const matrix: number[][] = []
	let heightHash = 0

	for (let localColumn = 0; localColumn <= segmentColumns; localColumn += 1) {
		const columnValues: number[] = []
		for (let localRow = segmentRows; localRow >= 0; localRow -= 1) {
			const height = useWorldSpaceSampling
				? sampleGroundHeight(
					groundDefinition,
					origin.x + localColumn * stepX,
					origin.z + localRow * stepZ,
				)
				: resolveGroundEffectiveHeightAtVertex(
					groundDefinition,
					spec.startRow + localRow,
					spec.startColumn + localColumn,
				)
			columnValues.push(height)
			heightHash = (heightHash * 31 + Math.round((Number.isFinite(height) ? height : fallbackHeight) * 1000)) >>> 0
		}
		matrix.push(columnValues.map((value) => (Number.isFinite(value) ? value : fallbackHeight)))
	}

	const layoutSignature = [
		useWorldSpaceSampling ? 'world' : 'vertex',
		segmentColumns,
		segmentRows,
		Math.round(stepX * 1000),
		Math.round(stepZ * 1000),
	].join(':')
	return {
		shapeDefinition: {
			kind: 'heightfield',
			matrix,
			elementSize: stepX,
			width: segmentColumns * stepX,
			depth: segmentRows * stepZ,
			offset: [-(segmentColumns * stepX) * 0.5, -(segmentRows * stepZ) * 0.5, 0],
			applyScale: false,
		},
		signature: `${buildRuntimeDetailedColliderSignature(chunkKey, layoutSignature, groundDefinition, localEditTiles)}|${heightHash.toString(16)}`,
		resolution: Math.max(segmentColumns, segmentRows),
		samplingMode: useWorldSpaceSampling ? 'world' : 'vertex',
		segmentColumns,
		segmentRows,
	}
}

function buildFlatBaseHeightfieldShape(
	chunkKey: string,
	chunkSizeMeters: number,
	flatHeight: number,
): { shapeDefinition: HeightfieldShapeDefinition; signature: string } {
	return {
		shapeDefinition: {
			kind: 'heightfield',
			matrix: [
				[flatHeight, flatHeight],
				[flatHeight, flatHeight],
			],
			elementSize: chunkSizeMeters,
			width: chunkSizeMeters,
			depth: chunkSizeMeters,
			offset: [-chunkSizeMeters * 0.5, -chunkSizeMeters * 0.5, 0],
			applyScale: false,
		},
		signature: `${chunkKey}|flat|${chunkSizeMeters}|${Math.round(flatHeight * 1000)}`,
	}
}

function removeInstance(world: CANNON.World | null, instance: RigidbodyInstance | null | undefined): void {
	if (!instance) {
		return
	}
	removeRigidbodyInstanceBodies(world, instance)
}

function resolveCollisionRadiusChunks(groundDefinition: GroundRuntimeDynamicMesh): number {
	const explicitCollisionRadius = Number(groundDefinition.collisionRadiusChunks)
	if (Number.isFinite(explicitCollisionRadius) && explicitCollisionRadius > 0) {
		return Math.max(1, Math.trunc(explicitCollisionRadius))
	}
	const explicitRenderRadius = Number(groundDefinition.renderRadiusChunks)
	if (Number.isFinite(explicitRenderRadius) && explicitRenderRadius > 0) {
		return Math.max(1, Math.trunc(explicitRenderRadius))
	}
	return 1
}

function resolveDesiredCollisionChunkKeys(
	groundObject: THREE.Object3D,
	groundDefinition: GroundRuntimeDynamicMesh,
	camera: THREE.Camera,
): string[] {
	camera.getWorldPosition(collisionRuntimeCameraLocal)
	groundObject.worldToLocal(collisionRuntimeCameraLocal)
	const chunkSizeCandidate = Number(groundDefinition.chunkSizeMeters)
	const chunkSizeMeters = Number.isFinite(chunkSizeCandidate) && chunkSizeCandidate > 0
		? chunkSizeCandidate
		: 100
	const centerCoord = resolveGroundChunkCoordFromWorldPosition(
		collisionRuntimeCameraLocal.x,
		collisionRuntimeCameraLocal.z,
		chunkSizeMeters,
	)
	const radiusChunks = resolveCollisionRadiusChunks(groundDefinition)
	const minChunkZ = centerCoord.chunkZ - radiusChunks
	const maxChunkZ = centerCoord.chunkZ + radiusChunks
	const minChunkX = centerCoord.chunkX - radiusChunks
	const maxChunkX = centerCoord.chunkX + radiusChunks
	const chunkKeys: string[] = []
	for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
		for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
			chunkKeys.push(`${chunkX}:${chunkZ}`)
		}
	}
	return chunkKeys
}

export function createInfiniteGroundChunkColliderRuntime(
	deps: InfiniteGroundChunkColliderRuntimeDeps,
): InfiniteGroundChunkColliderRuntime {
	const instances = new Map<string, RigidbodyInstance>()
	const debugShapes = new Map<string, HeightfieldShapeDefinition[]>()
	const pending = new Map<string, PendingEntry>()
	const desiredSignatures = new Map<string, string>()
	let activeSourceId: string | null = null
	let activeManifestRevision = -1
	let lastDiagnosticLogAt = 0
	let lastDiagnosticSignature = ''

	function clear(): void {
		const world = deps.getPhysicsWorld()
		instances.forEach((instance) => removeInstance(world, instance))
		instances.clear()
		debugShapes.clear()
		pending.clear()
		desiredSignatures.clear()
		activeSourceId = null
		activeManifestRevision = -1
		lastDiagnosticSignature = ''
	}

	function ensureColliderInstance(
		groundObject: THREE.Object3D,
		descriptor: InfiniteGroundChunkColliderDescriptor,
		shapeDefinition: HeightfieldShapeDefinition,
		signature: string,
	): void {
		const world = deps.getPhysicsWorld() ?? deps.ensurePhysicsWorld()
		const existing = instances.get(descriptor.runtimeKey) ?? null
		if (existing?.signature === signature) {
			return
		}
		if (existing) {
			removeInstance(world, existing)
			instances.delete(descriptor.runtimeKey)
		}
		const proxy = createChunkCollisionProxy(groundObject, descriptor.chunkKey, descriptor.chunkSizeMeters)
		if (!proxy) {
			return
		}
		const bodyEntry = deps.createBody(
			buildColliderNode(descriptor.source, descriptor.chunkKey),
			buildStaticRigidbodyComponent(descriptor.chunkKey),
			shapeDefinition,
			proxy,
		)
		if (!bodyEntry) {
			return
		}
		world.addBody(bodyEntry.body)
		const instance: RigidbodyInstance = {
			nodeId: `__groundChunkCollider:${descriptor.runtimeKey}`,
			body: bodyEntry.body,
			bodies: [bodyEntry.body],
			object: null,
			orientationAdjustment: bodyEntry.orientationAdjustment,
			signature,
			syncObjectFromBody: false,
		}
		instances.set(descriptor.runtimeKey, instance)
		debugShapes.set(descriptor.runtimeKey, [shapeDefinition])
	}

	function scheduleManifestCollider(
		groundObject: THREE.Object3D,
		descriptor: InfiniteGroundChunkColliderDescriptor,
		loadChunkData: (record: GroundChunkManifestRecord) => Promise<ArrayBuffer | null>,
	): void {
		const existingPending = pending.get(descriptor.runtimeKey)
		if (existingPending?.signature === descriptor.signature) {
			return
		}
		const record = descriptor.record
		if (!record) {
			return
		}
		const pendingEntry: PendingEntry = {
			signature: descriptor.signature,
			promise: loadChunkData(record)
				.then((buffer) => {
					if (activeSourceId == null || desiredSignatures.get(descriptor.runtimeKey) !== descriptor.signature) {
						return
					}
					const built = buildManifestHeightfieldShape(record, buffer, descriptor.bufferFallbackHeight)
					ensureColliderInstance(groundObject, descriptor, built.shapeDefinition, built.signature)
				})
				.catch((error) => {
					console.warn(deps.loggerTag ?? '[InfiniteGroundChunkCollider]', 'Failed to load ground chunk collision', record.key, error)
				})
				.finally(() => {
					const activePending = pending.get(descriptor.runtimeKey)
					if (activePending?.signature === descriptor.signature) {
						pending.delete(descriptor.runtimeKey)
					}
				}),
		}
		pending.set(descriptor.runtimeKey, pendingEntry)
	}

	function sync(params: InfiniteGroundChunkColliderSyncParams): void {
		if (!params.enabled || params.groundDefinition.terrainMode !== 'infinite' || !params.camera) {
			clear()
			return
		}
		const sourceId = params.sourceId.trim()
		if (!sourceId) {
			clear()
			return
		}
		const manifestRevision = normalizeManifestRevision(params.manifestRevision ?? params.groundDefinition.chunkManifestRevision)
		if (activeSourceId !== sourceId || activeManifestRevision !== manifestRevision) {
			clear()
			activeSourceId = sourceId
			activeManifestRevision = manifestRevision
		}

		params.groundObject.updateMatrixWorld(true)
		const baseHeight = typeof params.groundDefinition.baseHeight === 'number' && Number.isFinite(params.groundDefinition.baseHeight)
			? params.groundDefinition.baseHeight
			: 0
		const chunkSizeMeters = typeof params.groundDefinition.chunkSizeMeters === 'number' && Number.isFinite(params.groundDefinition.chunkSizeMeters) && params.groundDefinition.chunkSizeMeters > 0
			? params.groundDefinition.chunkSizeMeters
			: 100
		params.camera.getWorldPosition(collisionRuntimeCameraLocal)
		params.groundObject.worldToLocal(collisionRuntimeCameraLocal)
		const centerCoord = resolveGroundChunkCoordFromWorldPosition(
			collisionRuntimeCameraLocal.x,
			collisionRuntimeCameraLocal.z,
			chunkSizeMeters,
		)

		const manifestRecords = params.manifestRecords ?? {}
		const targetChunkKeys = resolveDesiredCollisionChunkKeys(params.groundObject, params.groundDefinition, params.camera)
		const nextDesired = new Map<string, InfiniteGroundChunkColliderDescriptor>()
		const localEditTiles = getGroundLocalEditTiles(params.groundDefinition)
		const runtimeDetailedChunkKeys: string[] = []
		let runtimeDetailedWorldColliderCount = 0
		let runtimeDetailedVertexColliderCount = 0
		const runtimeDetailedLayouts: string[] = []

		targetChunkKeys.forEach((chunkKey) => {
			const intersectingLocalEditTiles = resolveIntersectingLocalEditTiles(
				chunkKey,
				chunkSizeMeters,
				localEditTiles,
			)
			if (intersectingLocalEditTiles.length > 0) {
				const built = buildRuntimeDetailedHeightfieldShape(
					chunkKey,
					chunkSizeMeters,
					params.groundDefinition,
					intersectingLocalEditTiles,
					baseHeight,
				)
				if (!built) {
					return
				}
				runtimeDetailedChunkKeys.push(chunkKey)
				if (built.samplingMode === 'world') {
					runtimeDetailedWorldColliderCount += 1
				} else {
					runtimeDetailedVertexColliderCount += 1
				}
				runtimeDetailedLayouts.push(`${chunkKey}:${built.samplingMode}:${built.segmentColumns}x${built.segmentRows}`)
				nextDesired.set(makeRuntimeKey('runtime-detailed', chunkKey), {
					runtimeKey: makeRuntimeKey('runtime-detailed', chunkKey),
					source: 'runtime-detailed',
					chunkKey,
					signature: built.signature,
					shapeDefinition: built.shapeDefinition,
					bufferFallbackHeight: baseHeight,
					chunkSizeMeters,
					resolution: built.resolution,
				})
				return
			}
			const record = manifestRecords[chunkKey]
			if (record) {
				nextDesired.set(makeRuntimeKey('manifest', record.key), {
					runtimeKey: makeRuntimeKey('manifest', record.key),
					source: 'manifest',
					chunkKey: record.key,
					signature: `${record.key}|${record.revision}|${record.resolution}|${record.chunkSizeMeters}`,
					record,
					loadBuffer: true,
					bufferFallbackHeight: baseHeight,
					chunkSizeMeters: record.chunkSizeMeters,
					resolution: Math.max(1, Math.trunc(record.resolution)),
				})
				return
			}
			const coord = parseGroundChunkKey(chunkKey)
			if (!coord) {
				return
			}
			const origin = resolveGroundChunkOrigin(coord, chunkSizeMeters)
			const centerX = origin.x + chunkSizeMeters * 0.5
			const centerZ = origin.z + chunkSizeMeters * 0.5
			const flatHeight = sampleGroundHeight(params.groundDefinition, centerX, centerZ)
			const built = buildFlatBaseHeightfieldShape(chunkKey, chunkSizeMeters, flatHeight)
			nextDesired.set(makeRuntimeKey('base-flat', chunkKey), {
				runtimeKey: makeRuntimeKey('base-flat', chunkKey),
				source: 'base-flat',
				chunkKey,
				signature: built.signature,
				shapeDefinition: built.shapeDefinition,
				bufferFallbackHeight: baseHeight,
				chunkSizeMeters,
				resolution: 1,
			})
		})

		desiredSignatures.clear()
		nextDesired.forEach((descriptor, runtimeKey) => {
			desiredSignatures.set(runtimeKey, descriptor.signature)
		})

		const world = deps.getPhysicsWorld()
		instances.forEach((instance, runtimeKey) => {
			if (nextDesired.has(runtimeKey)) {
				return
			}
			removeInstance(world, instance)
			instances.delete(runtimeKey)
			debugShapes.delete(runtimeKey)
		})
		pending.forEach((entry, runtimeKey) => {
			if (nextDesired.has(runtimeKey)) {
				return
			}
			if (entry.signature === desiredSignatures.get(runtimeKey)) {
				return
			}
			pending.delete(runtimeKey)
		})

		nextDesired.forEach((descriptor) => {
			if (descriptor.shapeDefinition) {
				ensureColliderInstance(params.groundObject, descriptor, descriptor.shapeDefinition, descriptor.signature)
				return
			}
			if (descriptor.loadBuffer && descriptor.record && params.loadChunkData) {
				scheduleManifestCollider(params.groundObject, descriptor, params.loadChunkData)
			}
		})

		const now = Date.now()
		const manifestColliderCount = Array.from(nextDesired.values()).filter((descriptor) => descriptor.source === 'manifest').length
		const runtimeDetailedColliderCount = Array.from(nextDesired.values()).filter((descriptor) => descriptor.source === 'runtime-detailed').length
		const flatColliderCount = nextDesired.size - manifestColliderCount - runtimeDetailedColliderCount
		const diagnosticPayload = {
			sourceId,
			manifestRevision,
			chunkSizeMeters,
			collisionRadiusChunks: resolveCollisionRadiusChunks(params.groundDefinition),
			centerChunkKey: `${centerCoord.chunkX}:${centerCoord.chunkZ}`,
			targetChunkKeyCount: targetChunkKeys.length,
			desiredColliderCount: nextDesired.size,
			manifestColliderCount,
			runtimeDetailedColliderCount,
			runtimeDetailedWorldColliderCount,
			runtimeDetailedVertexColliderCount,
			flatColliderCount,
			runtimeDetailedChunkKeys,
			runtimeDetailedLayouts,
			activeColliderCount: instances.size,
			pendingColliderCount: pending.size,
		}
		const diagnosticSignature = [
			diagnosticPayload.sourceId,
			diagnosticPayload.manifestRevision,
			diagnosticPayload.collisionRadiusChunks,
			diagnosticPayload.targetChunkKeyCount,
			diagnosticPayload.runtimeDetailedColliderCount,
			diagnosticPayload.desiredColliderCount,
			diagnosticPayload.activeColliderCount,
			diagnosticPayload.pendingColliderCount,
		].join('|')
		if (
			nextDesired.size >= DIAGNOSTIC_COLLIDER_WARN_THRESHOLD
			|| (diagnosticSignature !== lastDiagnosticSignature && now - lastDiagnosticLogAt >= DIAGNOSTIC_LOG_INTERVAL_MS)
		) {
			console.warn(
				deps.loggerTag ?? '[InfiniteGroundChunkCollider]',
				`collision-runtime ${stringifyDiagnosticPayload(diagnosticPayload)}`,
			)
			lastDiagnosticLogAt = now
			lastDiagnosticSignature = diagnosticSignature
		}
	}

	return {
		clear,
		sync,
		getDebugEntries: () => Array.from(instances.entries()).map(([runtimeKey, instance]) => ({
			runtimeKey,
			nodeId: instance.nodeId,
			source: runtimeKey.startsWith('manifest:')
				? 'manifest'
				: runtimeKey.startsWith('runtime-detailed:')
					? 'runtime-detailed'
					: 'base-flat',
			instance,
			shapes: debugShapes.get(runtimeKey)?.map((shape) => ({
				...shape,
				matrix: shape.matrix.map((column) => [...column]),
			})) ?? [],
		})),
	}
}
