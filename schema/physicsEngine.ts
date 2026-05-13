import * as THREE from 'three'
import type {
	SceneNode,
	SceneNodeComponentState,
	FloorDynamicMesh,
	WallDynamicMesh,
} from './index'
import type {
	RigidbodyComponentProps,
	RigidbodyPhysicsShape,
	RigidbodyVector3Tuple,
	BoundaryWallComponentProps,
} from './components'
import {
	BOUNDARY_WALL_COMPONENT_TYPE,
	clampBoundaryWallComponentProps,
	DEFAULT_LINEAR_DAMPING,
	DEFAULT_ANGULAR_DAMPING,
} from './components'
import { buildBoundaryWallSegments } from './boundaryWall'
import {
	syncBodyFromObject as syncSharedBodyFromObject,
	syncObjectFromBody as syncSharedObjectFromBody,
	type PhysicsBodyBindingEntry as RigidbodyInstance,
	type PhysicsOrientationAdjustment as RigidbodyOrientationAdjustment,
} from './physicsBodySync'
import {
	addPhysicsBodyToWorld,
	removePhysicsBodyBindingBodies,
	type PhysicsBodyLike,
	type PhysicsWorldLike,
} from './physicsRuntimeBridge'
import {
	createBackendRigidbodyBody,
	ensureBackendPhysicsWorld,
	extractRoadHeightfieldDebugSurfaces,
	normalizeShapeScale,
} from './physicsBackendBridge'
import type {
	PhysicsBodyShapeDefinitionBinding,
	EnsurePhysicsWorldParams as BackendEnsurePhysicsWorldParams,
	PhysicsContactSettings as BackendPhysicsContactSettings,
	PhysicsRigidbodyMaterialEntry as BackendPhysicsRigidbodyMaterialEntry,
} from './physicsBackendTypes'
import {
	resolveFloorShape,
	resolveGroundHeightfieldShape,
	resolveModelCollisionDynamicMesh as resolveSharedModelCollisionDynamicMesh,
	resolveModelCollisionFaceSegments as resolveSharedModelCollisionFaceSegments,
	resolveWallShape,
	type FloorShapeCache,
	type GroundHeightfieldCacheEntry,
	type WallTrimeshCache,
	type WallTrimeshCacheEntry,
} from './physicsShapeResolvers'
import { isGroundDynamicMesh } from './groundHeightfield'

import {
	buildRoadHeightfieldBodies as buildRoadHeightfieldBodiesInternal,
	isRoadDynamicMesh as isRoadDynamicMeshInternal,
	type RoadHeightfieldBodiesEntry,
} from './roadHeightfield'

export {
	buildRoadHeightfieldBodies,
	isRoadDynamicMesh,
	type RoadHeightfieldBodiesEntry,
	type RoadHeightfieldBuildParams,
} from './roadHeightfield'

export type RoadHeightfieldDebugSegment = {
	shape: Extract<RigidbodyPhysicsShape, { kind: 'heightfield' }>
}

export type RoadHeightfieldDebugEntry = {
	signature: string
	segments: RoadHeightfieldDebugSegment[]
}

export type RoadHeightfieldDebugCache = Map<string, RoadHeightfieldDebugEntry>

export function resolveRoadHeightfieldDebugSegments(params: {
	nodeId: string
	signature: string
	bodies: Parameters<typeof extractRoadHeightfieldDebugSurfaces>[0]
	cache: RoadHeightfieldDebugCache
	debugEnabled: boolean
}): RoadHeightfieldDebugEntry | null {
	const { nodeId, signature, bodies, cache, debugEnabled } = params
	if (!debugEnabled) {
		cache.delete(nodeId)
		return null
	}
	const cached = cache.get(nodeId)
	if (cached && cached.signature === signature) {
		return cached
	}
	const segments: RoadHeightfieldDebugSegment[] = extractRoadHeightfieldDebugSurfaces(bodies).map((segment) => ({
		shape: {
			kind: 'heightfield',
			matrix: segment.matrix,
			elementSize: segment.elementSize,
			width: (segment.matrix.length - 1) * segment.elementSize,
			depth: (segment.matrix[0]?.length ? segment.matrix[0].length - 1 : 0) * segment.elementSize,
			offset: segment.offset,
			applyScale: false,
		},
	}))
	const entry: RoadHeightfieldDebugEntry = { signature, segments }
	cache.set(nodeId, entry)
	return entry
}

export function ensureRoadHeightfieldRigidbodyInstance(params: {
	roadNode: SceneNode
	rigidbodyComponent: SceneNodeComponentState<RigidbodyComponentProps>
	roadObject: THREE.Object3D
	groundNode?: SceneNode | null
	world: PhysicsWorldLike
	existingInstance: RigidbodyInstance | null
	createBody: (
		node: SceneNode,
		component: SceneNodeComponentState<RigidbodyComponentProps>,
		shapeDefinition: RigidbodyPhysicsShape | null,
		object: THREE.Object3D,
	) => { body: PhysicsBodyLike } | null
	loggerTag?: string
	maxSegments?: number
}): { instance: RigidbodyInstance | null; shouldRemoveExisting: boolean } {
	const {
		roadNode,
		rigidbodyComponent,
		roadObject,
		world,
		existingInstance,
		createBody,
		maxSegments,
	} = params

	if (!isRoadDynamicMeshInternal(roadNode.dynamicMesh)) {
		return { instance: null, shouldRemoveExisting: true }
	}
	const props = rigidbodyComponent.props as RigidbodyComponentProps | undefined
	if (props?.bodyType !== 'STATIC') {
		return { instance: null, shouldRemoveExisting: true }
	}

	const built: RoadHeightfieldBodiesEntry | null = buildRoadHeightfieldBodiesInternal({
		roadNode,
		rigidbodyComponent,
		roadObject,
		world,
		createBody,
		maxSegments,
	})

	if (!built || !built.bodies.length) {
		// Keep existing bodies (if any) when build fails, to avoid dropping collisions.
		return { instance: null, shouldRemoveExisting: false }
	}

	if (existingInstance && existingInstance.signature === built.signature) {
		const existingBodies = Array.isArray(existingInstance.bodies) ? existingInstance.bodies : []
		if (existingBodies.length === built.bodies.length && existingBodies.length > 0) {
			return { instance: existingInstance, shouldRemoveExisting: false }
		}
	}

	if (existingInstance) {
		removePhysicsBodyBindingBodies(world as PhysicsWorldLike | null | undefined, existingInstance)
	}
	for (const body of built.bodies) {
		addPhysicsBodyToWorld(world as PhysicsWorldLike | null | undefined, body)
	}

	const instance: RigidbodyInstance = {
		nodeId: roadNode.id,
		body: built.bodies[0]!,
		bodies: built.bodies,
		object: roadObject,
		orientationAdjustment: null,
		signature: built.signature,
		syncObjectFromBody: false,
	}
	return { instance, shouldRemoveExisting: false }
}

/**
 * Optional userData flag applied by the scene graph for "air wall" render objects.
 * Air walls are invisible meshes that may still be used for collision generation.
 */
export const PHYSICS_AIR_WALL_USERDATA_KEY = 'isAirWall'

export function isAirWallRenderObject(object: THREE.Object3D | null | undefined): boolean {
	const userData = (object as any)?.userData as Record<string, unknown> | undefined
	return Boolean(userData && userData[PHYSICS_AIR_WALL_USERDATA_KEY] === true)
}

export type RigidbodyMaterialEntry = BackendPhysicsRigidbodyMaterialEntry

export type PhysicsContactSettings = BackendPhysicsContactSettings

export type EnsurePhysicsWorldParams = BackendEnsurePhysicsWorldParams

const heightfieldOrientationThree = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
const heightfieldOrientationThreeInverse = heightfieldOrientationThree.clone().invert()
const heightfieldOrientationAdjustment: RigidbodyOrientationAdjustment = {
	three: heightfieldOrientationThree,
	threeInverse: heightfieldOrientationThreeInverse,
}

const physicsScaleHelper = new THREE.Vector3()

function isWallDynamicMesh(mesh: unknown): mesh is { type: 'Wall' } {
	const typed = mesh as { type?: unknown } | null | undefined
	return Boolean(typed && typed.type === 'Wall')
}

function isFloorDynamicMesh(mesh: unknown): mesh is FloorDynamicMesh {
	const typed = mesh as { type?: unknown } | null | undefined
	return Boolean(typed && typed.type === 'Floor')
}

export type CreateRigidbodyBodyInput = {
	node: SceneNode
	component: SceneNodeComponentState<RigidbodyComponentProps>
	shapeDefinition: RigidbodyPhysicsShape | null
	object: THREE.Object3D
}

export type CreateRigidbodyBodyOptions = {
	world: PhysicsWorldLike
	groundHeightfieldCache: Map<string, GroundHeightfieldCacheEntry>
	floorShapeCache?: FloorShapeCache
	wallTrimeshCache?: WallTrimeshCache
	rigidbodyMaterialCache: Map<string, RigidbodyMaterialEntry>
	rigidbodyContactMaterialKeys: Set<string>
	contactSettings: PhysicsContactSettings
	loggerTag?: string
}

export type {
	BackendRigidbodyResult as PhysicsBackendRigidbodyResult,
} from './physicsBackendTypes'

export function createRigidbodyBody(
	input: CreateRigidbodyBodyInput,
	options: CreateRigidbodyBodyOptions,
): { body: PhysicsBodyLike; orientationAdjustment: RigidbodyOrientationAdjustment | null } | null {
	const { node, component, shapeDefinition, object } = input
	const {
		world,
		groundHeightfieldCache,
		floorShapeCache,
		wallTrimeshCache,
		rigidbodyMaterialCache,
		rigidbodyContactMaterialKeys,
		contactSettings,
		loggerTag,
	} = options
	object.updateMatrixWorld(true)
	object.getWorldScale(physicsScaleHelper)
	const shapeScale = normalizeShapeScale(physicsScaleHelper)
	let offsetTuple: RigidbodyVector3Tuple | null = null
	let resolvedShape: RigidbodyPhysicsShape | null = null
	let groundSegments: GroundHeightfieldCacheEntry['segments'] | null = null
	let wallSegments: WallTrimeshCacheEntry['segments'] | null = null
	let floorSegments: FloorShapeCacheEntry['segments'] | null = null
	let modelCollisionSegments: Array<{ shape: Extract<RigidbodyPhysicsShape, { kind: 'convex' }> }> | null = null
	let boundaryWallSegments: ReturnType<typeof buildBoundaryWallSegments> | null = null
	let needsHeightfieldOrientation = false
	if (isGroundDynamicMesh(node.dynamicMesh)) {
		const groundEntry = resolveGroundHeightfieldShape(node, node.dynamicMesh, groundHeightfieldCache)
		if (groundEntry) {
			groundSegments = groundEntry.segments
			resolvedShape = null
			offsetTuple = null
			needsHeightfieldOrientation = groundEntry.segments.length > 0
		}
	}
	if (isWallDynamicMesh(node.dynamicMesh) && wallTrimeshCache) {
		const entry = resolveWallShape({ node, definition: node.dynamicMesh as WallDynamicMesh, cache: wallTrimeshCache, loggerTag })
		if (entry) {
			wallSegments = entry.segments
			resolvedShape = null
			offsetTuple = null
		}
	}
	if (!resolvedShape && !wallSegments && isFloorDynamicMesh(node.dynamicMesh) && floorShapeCache) {
		const entry = resolveFloorShape(node, node.dynamicMesh, floorShapeCache)
		if (entry) {
			floorSegments = entry.segments
			offsetTuple = null
		}
	}
	const modelCollisionDefinition = resolveSharedModelCollisionDynamicMesh(node)
	if (!resolvedShape && !wallSegments && !floorSegments && modelCollisionDefinition) {
		const segments = resolveSharedModelCollisionFaceSegments(modelCollisionDefinition)
		if (segments.length) {
			modelCollisionSegments = segments
			offsetTuple = null
		}
	}
	const boundaryWallComponent = node.components?.[BOUNDARY_WALL_COMPONENT_TYPE] as
		| SceneNodeComponentState<BoundaryWallComponentProps>
		| undefined
	let boundaryWallProps: BoundaryWallComponentProps | null = null
	if (boundaryWallComponent && boundaryWallComponent.enabled === true) {
		boundaryWallProps = clampBoundaryWallComponentProps(
			boundaryWallComponent?.props as Partial<BoundaryWallComponentProps> | null | undefined,
		)
		const builtSegments = buildBoundaryWallSegments({
			node,
			object,
			props: boundaryWallProps,
		})
		if (builtSegments.length) {
			boundaryWallSegments = builtSegments
		}
	}
	if (!resolvedShape && shapeDefinition) {
		resolvedShape = shapeDefinition
		offsetTuple = shapeDefinition.offset ?? null
		if (shapeDefinition.kind === 'heightfield') {
			needsHeightfieldOrientation = true
		}
	}
	if (!resolvedShape && !groundSegments && !wallSegments && !floorSegments && !modelCollisionSegments?.length && !boundaryWallSegments?.length) {
		return null
	}
	const props = component.props as RigidbodyComponentProps
	const isDynamic = props.bodyType === 'DYNAMIC'
	const mass = isDynamic ? Math.max(0, props.mass ?? 0) : 0
	const shapeBindings: PhysicsBodyShapeDefinitionBinding[] = []
	const pushHeightfieldBinding = (definition: RigidbodyPhysicsShape, offset: RigidbodyVector3Tuple | null | undefined): void => {
		const [ox, oy, oz] = offset ?? [0, 0, 0]
		shapeBindings.push({
			definition,
			position: [
				(ox ?? 0) * shapeScale.x,
				(oy ?? 0) * shapeScale.y,
				(oz ?? 0) * shapeScale.z,
			],
		})
	}
	if (groundSegments && groundSegments.length) {
		for (const segment of groundSegments) {
			pushHeightfieldBinding(segment.shape, segment.offset)
		}
	}
	if (wallSegments && wallSegments.length) {
		for (const segment of wallSegments) {
			shapeBindings.push({
				definition: segment.shape,
				position: [
					segment.offset[0],
					segment.offset[1],
					segment.offset[2],
				],
				quaternion: [
					segment.orientation[0],
					segment.orientation[1],
					segment.orientation[2],
					segment.orientation[3],
				],
			})
		}
	}
	if (floorSegments && floorSegments.length) {
		for (const segment of floorSegments) {
			pushHeightfieldBinding(segment.shape, segment.shape.offset ?? [0, 0, 0])
		}
	}
	if (modelCollisionSegments && modelCollisionSegments.length) {
		for (const segment of modelCollisionSegments) {
			shapeBindings.push({ definition: segment.shape })
		}
	}
	if (boundaryWallSegments && boundaryWallSegments.length) {
		for (const segment of boundaryWallSegments) {
			shapeBindings.push({
				definition: {
					kind: 'box',
					halfExtents: [
						segment.halfExtents[0],
						segment.halfExtents[1],
						segment.halfExtents[2],
					],
					applyScale: false,
				},
				position: [
					segment.offset[0],
					segment.offset[1],
					segment.offset[2],
				],
				quaternion: [
					segment.orientation[0],
					segment.orientation[1],
					segment.orientation[2],
					segment.orientation[3],
				],
			})
		}
	}
	if (resolvedShape) {
		let shapeOffset: [number, number, number] | undefined
		if (offsetTuple) {
			const [ox, oy, oz] = offsetTuple
			shapeOffset = [
				(ox ?? 0) * shapeScale.x,
				(oy ?? 0) * shapeScale.y,
				(oz ?? 0) * shapeScale.z,
			]
		}
		shapeBindings.push({ definition: resolvedShape, position: shapeOffset })
	}
	if (!shapeBindings.length) {
		return null
	}
	const body = createBackendRigidbodyBody({
		world,
		mass,
		bodyType: props.bodyType,
		shapes: shapeBindings,
		shapeScale,
		rigidbodyMaterialCache,
		rigidbodyContactMaterialKeys,
		friction: props.friction,
		restitution: props.restitution,
		contactSettings,
		name: `node:${node.id}`,
	})
	const orientationAdjustment = needsHeightfieldOrientation ? heightfieldOrientationAdjustment : null
	syncSharedBodyFromObject(body, object, orientationAdjustment)
	body.updateMassProperties()
	body.linearDamping = props.linearDamping ?? DEFAULT_LINEAR_DAMPING
	body.angularDamping = props.angularDamping ?? DEFAULT_ANGULAR_DAMPING
	return { body, orientationAdjustment }
}

export { syncSharedBodyFromObject as syncBodyFromObject, syncSharedObjectFromBody as syncObjectFromBody }

export function ensurePhysicsWorld(params: EnsurePhysicsWorldParams): PhysicsWorldLike {
	params.rigidbodyMaterialCache.clear()
	params.rigidbodyContactMaterialKeys.clear()
	return ensureBackendPhysicsWorld({
		world: params.world,
		setWorld: params.setWorld,
		gravity: params.gravity,
		solverIterations: params.solverIterations,
		solverTolerance: params.solverTolerance,
		contactFriction: params.contactFriction,
		contactRestitution: params.contactRestitution,
		contactSettings: params.contactSettings,
		quatNormalizeFast: params.quatNormalizeFast,
		quatNormalizeSkip: params.quatNormalizeSkip,
	})
}



