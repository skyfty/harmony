import * as THREE from 'three'
import * as CANNON from 'cannon-es'

import {
	clampRigidbodyComponentProps,
	deserializeGroundChunkData,
	parseGroundChunkKey,
	resolveGroundChunkOrigin,
	RIGIDBODY_COMPONENT_TYPE,
	type GroundChunkManifestRecord,
	type GroundRuntimeDynamicMesh,
	type RigidbodyComponentProps,
	type RigidbodyPhysicsShape,
	type SceneNode,
	type SceneNodeComponentState,
} from './index'
import { getVisibleInfiniteGroundChunkKeys } from './groundMesh'
import { resolveVisibleInfiniteGroundChunkManifestRecords } from './groundChunkManifestRuntime'
import {
	removeRigidbodyInstanceBodies,
	type RigidbodyInstance,
	type RigidbodyOrientationAdjustment,
} from './physicsEngine'

type HeightfieldShapeDefinition = Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>

type InfiniteGroundChunkColliderSource = 'manifest' | 'base-flat'

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

function makeRuntimeKey(source: InfiniteGroundChunkColliderSource, chunkKey: string): string {
	return `${source}:${chunkKey}`
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
	const vertexColumns = resolution + 1
	const vertexRows = resolution + 1
	const heights = decodeChunkHeights(buffer, resolution)
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
			elementSize: record.chunkSizeMeters / resolution,
			width: record.chunkSizeMeters,
			depth: record.chunkSizeMeters,
			offset: [-record.chunkSizeMeters * 0.5, -record.chunkSizeMeters * 0.5, 0],
			applyScale: false,
		},
		signature: `${record.key}|${record.revision}|${resolution}|${heightHash.toString(16)}`,
	}
}

function buildFlatBaseHeightfieldShape(
	chunkKey: string,
	chunkSizeMeters: number,
	baseHeight: number,
): { shapeDefinition: HeightfieldShapeDefinition; signature: string } {
	return {
		shapeDefinition: {
			kind: 'heightfield',
			matrix: [
				[baseHeight, baseHeight],
				[baseHeight, baseHeight],
			],
			elementSize: chunkSizeMeters,
			width: chunkSizeMeters,
			depth: chunkSizeMeters,
			offset: [-chunkSizeMeters * 0.5, -chunkSizeMeters * 0.5, 0],
			applyScale: false,
		},
		signature: `${chunkKey}|flat|${chunkSizeMeters}|${Math.round(baseHeight * 1000)}`,
	}
}

function removeInstance(world: CANNON.World | null, instance: RigidbodyInstance | null | undefined): void {
	if (!instance) {
		return
	}
	removeRigidbodyInstanceBodies(world, instance)
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

	function clear(): void {
		const world = deps.getPhysicsWorld()
		instances.forEach((instance) => removeInstance(world, instance))
		instances.clear()
		debugShapes.clear()
		pending.clear()
		desiredSignatures.clear()
		activeSourceId = null
		activeManifestRevision = -1
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

		const manifestRecords = params.manifestRecords ?? {}
		const visibleManifestRecords = Object.keys(manifestRecords).length > 0
			? resolveVisibleInfiniteGroundChunkManifestRecords(params.groundObject, params.groundDefinition, params.camera, manifestRecords)
			: []
		const manifestChunkKeys = new Set(visibleManifestRecords.map((record) => record.key))
		const nextDesired = new Map<string, InfiniteGroundChunkColliderDescriptor>()

		visibleManifestRecords.forEach((record) => {
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
		})

		getVisibleInfiniteGroundChunkKeys(params.groundObject).forEach((chunkKey) => {
			if (manifestChunkKeys.has(chunkKey)) {
				return
			}
			const built = buildFlatBaseHeightfieldShape(chunkKey, chunkSizeMeters, baseHeight)
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
	}

	return {
		clear,
		sync,
		getDebugEntries: () => Array.from(instances.entries()).map(([runtimeKey, instance]) => ({
			runtimeKey,
			nodeId: instance.nodeId,
			source: runtimeKey.startsWith('manifest:') ? 'manifest' : 'base-flat',
			instance,
			shapes: debugShapes.get(runtimeKey)?.map((shape) => ({
				...shape,
				matrix: shape.matrix.map((column) => [...column]),
			})) ?? [],
		})),
	}
}