import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type {
	SceneNode,
	SceneNodeComponentState,
	GroundDynamicMesh,
} from '@harmony/schema'
import type {
	RigidbodyComponentProps,
	RigidbodyPhysicsShape,
	RigidbodyVector3Tuple,
} from './components'
import {
	DEFAULT_LINEAR_DAMPING,
	DEFAULT_ANGULAR_DAMPING,
	DEFAULT_RIGIDBODY_FRICTION,
	DEFAULT_RIGIDBODY_RESTITUTION,
} from './components'
import {
	buildGroundHeightfieldData,
} from './groundHeightfield'
import type { GroundHeightfieldData } from './groundHeightfield'
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
	shape: Extract<RigidbodyPhysicsShape, { kind: 'heightfield' | 'box' }>
}

export type RoadHeightfieldDebugEntry = {
	signature: string
	segments: RoadHeightfieldDebugSegment[]
}

export type RoadHeightfieldDebugCache = Map<string, RoadHeightfieldDebugEntry>

export function resolveRoadHeightfieldDebugSegments(params: {
	nodeId: string
	signature: string
	bodies: CANNON.Body[]
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
	const segments: RoadHeightfieldDebugSegment[] = []
	bodies.forEach((body) => {
		const heightfieldShape = body.shapes.find((candidate) => candidate instanceof CANNON.Heightfield) as
			| CANNON.Heightfield
			| undefined
		if (heightfieldShape) {
			const matrixSource = (heightfieldShape as any).data as unknown
			const elementSize = (heightfieldShape as any).elementSize as unknown
			if (!Array.isArray(matrixSource) || typeof elementSize !== 'number' || !Number.isFinite(elementSize) || elementSize <= 0) {
				return
			}
			let rowCount = 0
			matrixSource.forEach((column) => {
				if (Array.isArray(column) && column.length > rowCount) {
					rowCount = column.length
				}
			})
			if (matrixSource.length < 2 || rowCount < 2) {
				return
			}
			const matrix: number[][] = matrixSource.map((column) => {
				if (!Array.isArray(column)) {
					return []
				}
				return column.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0))
			})
			const width = (matrix.length - 1) * elementSize
			const depth = (rowCount - 1) * elementSize
			segments.push({
				shape: {
					kind: 'heightfield',
					matrix,
					elementSize,
					width,
					depth,
					offset: [0, 0, 0],
					scaleNormalized: false,
				},
			})
			return
		}
		const boxShape = body.shapes.find((candidate) => candidate instanceof CANNON.Box) as CANNON.Box | undefined
		if (!boxShape) {
			return
		}
		const hx = (boxShape as any).halfExtents?.x as unknown
		const hy = (boxShape as any).halfExtents?.y as unknown
		const hz = (boxShape as any).halfExtents?.z as unknown
		if (![hx, hy, hz].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
			return
		}
		segments.push({
			shape: {
				kind: 'box',
				halfExtents: [hx as number, hy as number, hz as number],
				offset: [0, 0, 0],
				scaleNormalized: false,
			},
		})
	})
	const entry: RoadHeightfieldDebugEntry = { signature, segments }
	cache.set(nodeId, entry)
	return entry
}

export function ensureRoadHeightfieldRigidbodyInstance(params: {
	roadNode: SceneNode
	rigidbodyComponent: SceneNodeComponentState<RigidbodyComponentProps>
	roadObject: THREE.Object3D
	groundNode: SceneNode
	world: CANNON.World
	existingInstance: RigidbodyInstance | null
	createBody: (
		node: SceneNode,
		component: SceneNodeComponentState<RigidbodyComponentProps>,
		shapeDefinition: RigidbodyPhysicsShape | null,
		object: THREE.Object3D,
	) => { body: CANNON.Body } | null
	loggerTag?: string
	maxSegments?: number
}): { instance: RigidbodyInstance | null; shouldRemoveExisting: boolean } {
	const {
		roadNode,
		rigidbodyComponent,
		roadObject,
		groundNode,
		world,
		existingInstance,
		createBody,
		loggerTag,
		maxSegments,
	} = params

	if (!isRoadDynamicMeshInternal(roadNode.dynamicMesh)) {
		return { instance: null, shouldRemoveExisting: true }
	}
	if (!isGroundDynamicMesh(groundNode.dynamicMesh)) {
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
		groundNode,
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
		removeRigidbodyInstanceBodies(world, existingInstance)
	}
	for (const body of built.bodies) {
		try {
			world.addBody(body)
		} catch (error) {
			warn(loggerTag, 'Failed to add road heightfield body', error)
		}
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

export type RigidbodyOrientationAdjustment = {
	cannon: CANNON.Quaternion
	cannonInverse: CANNON.Quaternion
	three: THREE.Quaternion
	threeInverse: THREE.Quaternion
}

export type RigidbodyInstance = {
	nodeId: string
	/** Primary body for legacy callers (vehicles, etc). */
	body: CANNON.Body
	/** All bodies that represent this node in the physics world. For most nodes this is `[body]`. */
	bodies: CANNON.Body[]
	object: THREE.Object3D | null
	orientationAdjustment: RigidbodyOrientationAdjustment | null
	/** Optional signature for multi-body/static regeneration (e.g. Road segmented heightfield). */
	signature?: string
	/** If false, we should not copy the physics body transform back onto the render object. */
	syncObjectFromBody?: boolean
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

export type GroundHeightfieldCacheEntry = {
	signature: string
	shape: CANNON.Heightfield
	offset: [number, number, number]
}

export type WallTrimeshCacheEntry = {
	signature: string
	shape: CANNON.Trimesh
}

export type WallTrimeshCache = Map<string, WallTrimeshCacheEntry>

export type RigidbodyMaterialEntry = {
	material: CANNON.Material
	friction: number
	restitution: number
}

export type PhysicsContactSettings = {
	contactEquationStiffness: number
	contactEquationRelaxation: number
	frictionEquationStiffness: number
	frictionEquationRelaxation: number
}

export type EnsurePhysicsWorldParams = {
	world: CANNON.World | null
	setWorld: (world: CANNON.World) => void
	gravity: CANNON.Vec3
	solverIterations: number
	solverTolerance: number
	contactFriction: number
	contactRestitution: number
	contactSettings: PhysicsContactSettings
	rigidbodyMaterialCache: Map<string, RigidbodyMaterialEntry>
	rigidbodyContactMaterialKeys: Set<string>
}

export function removeRigidbodyInstanceBodies(world: CANNON.World | null | undefined, instance: RigidbodyInstance | null | undefined): void {
	if (!world || !instance) {
		return
	}
	const bodies = Array.isArray(instance.bodies) && instance.bodies.length ? instance.bodies : [instance.body]
	bodies.forEach((body) => {
		try {
			world.removeBody(body)
		} catch (error) {
			console.warn('[PhysicsEngine] Failed to remove body', error)
		}
	})
}

const groundHeightfieldOrientation = new CANNON.Quaternion()
groundHeightfieldOrientation.setFromEuler(-Math.PI / 2, 0, 0)
const groundHeightfieldOrientationInverse = new CANNON.Quaternion(
	-groundHeightfieldOrientation.x,
	-groundHeightfieldOrientation.y,
	-groundHeightfieldOrientation.z,
	groundHeightfieldOrientation.w,
)
const groundHeightfieldOrientationThree = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
const groundHeightfieldOrientationThreeInverse = groundHeightfieldOrientationThree.clone().invert()
const groundHeightfieldOrientationAdjustment: RigidbodyOrientationAdjustment = {
	cannon: groundHeightfieldOrientation,
	cannonInverse: groundHeightfieldOrientationInverse,
	three: groundHeightfieldOrientationThree,
	threeInverse: groundHeightfieldOrientationThreeInverse,
}

const heightfieldShapeOffsetHelper = new CANNON.Vec3()
const physicsPositionHelper = new THREE.Vector3()
const physicsQuaternionHelper = new THREE.Quaternion()
const physicsScaleHelper = new THREE.Vector3()
const syncBodyQuaternionHelper = new THREE.Quaternion()
const bodyQuaternionHelper = new THREE.Quaternion()
const wallRootPositionHelper = new THREE.Vector3()
const wallRootQuaternionHelper = new THREE.Quaternion()
const wallRootQuaternionInverseHelper = new THREE.Quaternion()
const wallVertexWorldHelper = new THREE.Vector3()
const wallVertexLocalHelper = new THREE.Vector3()
const cylinderShapeRotationHelper = new CANNON.Quaternion()
cylinderShapeRotationHelper.setFromEuler(Math.PI / 2, 0, 0)
const cylinderShapeOffsetHelper = new CANNON.Vec3()

type LoggerTag = string | undefined

function warn(loggerTag: LoggerTag, message: string, ...args: unknown[]): void {
	const prefix = loggerTag ?? '[PhysicsEngine]'
	console.warn(`${prefix} ${message}`, ...args)
}

function isWallDynamicMesh(mesh: unknown): mesh is { type: 'Wall' } {
	const typed = mesh as { type?: unknown } | null | undefined
	return Boolean(typed && typed.type === 'Wall')
}

function resolveWallShape(params: {
	node: SceneNode
	object: THREE.Object3D
	cache: WallTrimeshCache
	loggerTag?: LoggerTag
}): WallTrimeshCacheEntry | null {
	const { node, object, cache, loggerTag } = params
	const nodeId = node.id
	if (!nodeId) {
		return null
	}

	object.updateMatrixWorld(true)
	object.matrixWorld.decompose(wallRootPositionHelper, wallRootQuaternionHelper, physicsScaleHelper)
	wallRootQuaternionInverseHelper.copy(wallRootQuaternionHelper).invert()

	let wallMesh: THREE.Mesh | null = null
	object.traverse((child) => {
		if (wallMesh) {
			return
		}
		const mesh = child as unknown as THREE.Mesh
		if (!mesh || !(mesh as any).isMesh) {
			return
		}
		const userData = (mesh as any).userData as Record<string, unknown> | undefined
		const dynamicMeshType = typeof userData?.dynamicMeshType === 'string' ? (userData.dynamicMeshType as string) : ''
		if (mesh.name === 'WallMesh' || dynamicMeshType === 'Wall') {
			wallMesh = mesh
		}
	})

	if (!wallMesh) {
		cache.delete(nodeId)
		return null
	}
	const geometry = (wallMesh as any).geometry as THREE.BufferGeometry | undefined
	if (!geometry) {
		cache.delete(nodeId)
		return null
	}
	const positionAttribute = geometry.getAttribute('position') as THREE.BufferAttribute | null
	if (!positionAttribute || positionAttribute.itemSize < 3 || positionAttribute.count < 3) {
		cache.delete(nodeId)
		return null
	}

	// Build vertices in the wall root's local frame (translation+rotation removed),
	// with scale baked into vertex positions (Cannon bodies ignore scale).
	const vertexCount = positionAttribute.count
	const vertices: number[] = new Array(vertexCount * 3)
	const positionArray = positionAttribute.array as ArrayLike<number>
	for (let i = 0; i < vertexCount; i += 1) {
		const base = i * 3
		wallVertexLocalHelper.set(
			Number(positionArray[base] ?? 0),
			Number(positionArray[base + 1] ?? 0),
			Number(positionArray[base + 2] ?? 0),
		)
		wallVertexWorldHelper.copy(wallVertexLocalHelper).applyMatrix4(wallMesh.matrixWorld)
		wallVertexWorldHelper.sub(wallRootPositionHelper).applyQuaternion(wallRootQuaternionInverseHelper)
		vertices[base] = wallVertexWorldHelper.x
		vertices[base + 1] = wallVertexWorldHelper.y
		vertices[base + 2] = wallVertexWorldHelper.z
	}

	const indexAttribute = geometry.getIndex() as THREE.BufferAttribute | null
	let indices: number[]
	if (indexAttribute && indexAttribute.count >= 3) {
		const indexArray = indexAttribute.array as ArrayLike<number>
		indices = new Array(indexAttribute.count)
		for (let i = 0; i < indexAttribute.count; i += 1) {
			indices[i] = (Number(indexArray[i] ?? 0) | 0) >>> 0
		}
	} else {
		const triangleCount = Math.floor(vertexCount / 3)
		if (triangleCount <= 0) {
			cache.delete(nodeId)
			return null
		}
		indices = new Array(triangleCount * 3)
		for (let i = 0; i < triangleCount * 3; i += 1) {
			indices[i] = i
		}
	}

	// Signature for caching: quantize to reduce float jitter.
	const cached = cache.get(nodeId)
	const quantize = 1000
	let hash = 2166136261
	const fnv = (value: number) => {
		hash ^= value
		hash = Math.imul(hash, 16777619) >>> 0
	}
	for (let i = 0; i < vertices.length; i += 1) {
		const v = vertices[i] ?? 0
		const q = Number.isFinite(v) ? Math.round(v * quantize) : 0
		fnv(q | 0)
	}
	for (let i = 0; i < indices.length; i += 1) {
		fnv((indices[i] ?? 0) | 0)
	}
	const signature = `${vertices.length}:${indices.length}:${hash.toString(16)}`
	if (cached && cached.signature === signature) {
		return cached
	}

	try {
		const shape = new CANNON.Trimesh(vertices, indices)
		const entry: WallTrimeshCacheEntry = { signature, shape }
		cache.set(nodeId, entry)
		return entry
	} catch (error) {
		warn(loggerTag, 'Failed to build wall trimesh', error)
		cache.delete(nodeId)
		return null
	}
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const numeric = typeof value === 'number' && Number.isFinite(value) ? value : null
	if (numeric === null) {
		return fallback
	}
	if (numeric <= min) {
		return min
	}
	if (numeric >= max) {
		return max
	}
	return numeric
}

function normalizeScaleVector(
	scaleLike: THREE.Vector3 | { x?: number; y?: number; z?: number } | null | undefined,
): { x: number; y: number; z: number } {
	const sx = typeof scaleLike?.x === 'number' && Number.isFinite(scaleLike.x) ? Math.abs(scaleLike.x) : 1
	const sy = typeof scaleLike?.y === 'number' && Number.isFinite(scaleLike.y) ? Math.abs(scaleLike.y) : 1
	const sz = typeof scaleLike?.z === 'number' && Number.isFinite(scaleLike.z) ? Math.abs(scaleLike.z) : 1
	return {
		x: sx > 0 ? sx : 1,
		y: sy > 0 ? sy : 1,
		z: sz > 0 ? sz : 1,
	}
}

function formatRigidbodyMaterialKey(friction: number, restitution: number): string {
	return `${friction.toFixed(3)}:${restitution.toFixed(3)}`
}

function formatRigidbodyContactKey(materialA: CANNON.Material, materialB: CANNON.Material): string {
	const idA = typeof materialA.id === 'number' ? materialA.id : -1
	const idB = typeof materialB.id === 'number' ? materialB.id : -1
	return idA <= idB ? `${idA}:${idB}` : `${idB}:${idA}`
}

function ensureContactMaterial(
	world: CANNON.World,
	materialA: CANNON.Material,
	materialB: CANNON.Material,
	friction: number,
	restitution: number,
	settings: PhysicsContactSettings,
	contactKeys: Set<string>,
): void {
	const key = formatRigidbodyContactKey(materialA, materialB)
	if (contactKeys.has(key)) {
		return
	}
	const contactOptions = {
		friction,
		restitution,
		contactEquationStiffness: settings.contactEquationStiffness,
		contactEquationRelaxation: settings.contactEquationRelaxation,
		frictionEquationStiffness: settings.frictionEquationStiffness,
		frictionEquationRelaxation: settings.frictionEquationRelaxation,
	}
	world.addContactMaterial(new CANNON.ContactMaterial(materialA, materialB, contactOptions))
	contactKeys.add(key)
}

function registerRigidbodyMaterialContacts(
	world: CANNON.World,
	entry: RigidbodyMaterialEntry,
	rigidbodyMaterialCache: Map<string, RigidbodyMaterialEntry>,
	settings: PhysicsContactSettings,
	contactKeys: Set<string>,
): void {
	ensureContactMaterial(world, entry.material, entry.material, entry.friction, entry.restitution, settings, contactKeys)
	const defaultMaterial = world.defaultMaterial
	if (defaultMaterial) {
		ensureContactMaterial(world, defaultMaterial, entry.material, entry.friction, entry.restitution, settings, contactKeys)
	}
	rigidbodyMaterialCache.forEach((otherEntry) => {
		if (otherEntry.material === entry.material) {
			return
		}
		const combinedFriction = Math.sqrt(entry.friction * otherEntry.friction)
		const combinedRestitution = Math.max(entry.restitution, otherEntry.restitution)
		ensureContactMaterial(
			world,
			entry.material,
			otherEntry.material,
			combinedFriction,
			combinedRestitution,
			settings,
			contactKeys,
		)
	})
}

type EnsureMaterialParams = {
	world: CANNON.World
	rigidbodyMaterialCache: Map<string, RigidbodyMaterialEntry>
	rigidbodyContactMaterialKeys: Set<string>
	friction: number
	restitution: number
	contactSettings: PhysicsContactSettings
}

function ensureRigidbodyMaterial({
	world,
	rigidbodyMaterialCache,
	rigidbodyContactMaterialKeys,
	friction,
	restitution,
	contactSettings,
}: EnsureMaterialParams): CANNON.Material {
	const clampedFriction = clampNumber(friction, 0, 1, DEFAULT_RIGIDBODY_FRICTION)
	const clampedRestitution = clampNumber(restitution, 0, 1, DEFAULT_RIGIDBODY_RESTITUTION)
	const key = formatRigidbodyMaterialKey(clampedFriction, clampedRestitution)
	let entry = rigidbodyMaterialCache.get(key)
	if (!entry) {
		const material = new CANNON.Material(`rigidbody:${key}`)
		material.friction = clampedFriction
		material.restitution = clampedRestitution
		entry = { material, friction: clampedFriction, restitution: clampedRestitution }
		rigidbodyMaterialCache.set(key, entry)
		registerRigidbodyMaterialContacts(
			world,
			entry,
			rigidbodyMaterialCache,
			contactSettings,
			rigidbodyContactMaterialKeys,
		)
	}
	return entry.material
}

function mapBodyType(type: RigidbodyComponentProps['bodyType']): CANNON.Body['type'] {
	switch (type) {
		case 'STATIC':
			return CANNON.Body.STATIC
		case 'KINEMATIC':
			return CANNON.Body.KINEMATIC
		case 'DYNAMIC':
		default:
			return CANNON.Body.DYNAMIC
	}
}

function normalizeHeightfieldMatrix(source: unknown): number[][] | null {
	if (!Array.isArray(source) || source.length < 2) {
		return null
	}
	let maxRows = 0
	const normalizedColumns = source.map((column) => {
		if (!Array.isArray(column)) {
			return []
		}
		const normalized = column.map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0))
		if (normalized.length > maxRows) {
			maxRows = normalized.length
		}
		return normalized
	})
	if (normalizedColumns.length < 2 || maxRows < 2) {
		return null
	}
	const paddedColumns = normalizedColumns.map((column) => {
		if (column.length === maxRows) {
			return column
		}
		const padValue = column.length ? column[column.length - 1]! : 0
		while (column.length < maxRows) {
			column.push(padValue)
		}
		return column
	})
	return paddedColumns as number[][]
}

type SanitizedFaces = { faces: number[][]; invalidCount: number }

function sanitizeConvexFaces(source: unknown, vertexCount: number): SanitizedFaces {
	const result: SanitizedFaces = { faces: [], invalidCount: 0 }
	if (!Array.isArray(source) || vertexCount < 4) {
		return result
	}
	source.forEach((face) => {
		if (!Array.isArray(face) || face.length < 3) {
			result.invalidCount += 1
			return
		}
		const normalized: number[] = []
		let invalid = false
		for (let i = 0; i < face.length; i += 1) {
			const raw = face[i]
			const numeric = typeof raw === 'number' ? raw : Number(raw)
			if (!Number.isFinite(numeric)) {
				invalid = true
				break
			}
			const index = Math.trunc(numeric)
			if (index < 0 || index >= vertexCount) {
				invalid = true
				break
			}
			if (!normalized.length || normalized[normalized.length - 1] !== index) {
				normalized.push(index)
			}
		}
		if (invalid) {
			result.invalidCount += 1
			return
		}
		const deduped = normalized.filter((value, index, array) => array.indexOf(value) === index)
		if (deduped.length < 3) {
			result.invalidCount += 1
			return
		}
		result.faces.push(deduped)
	})
	return result
}

function orientConvexFaces(faces: number[][], vertices: CANNON.Vec3[]): number[][] {
	if (!faces.length || !vertices.length) {
		return faces
	}
	const centroid = new CANNON.Vec3()
	vertices.forEach((vertex) => {
		centroid.vadd(vertex, centroid)
	})
	centroid.scale(1 / vertices.length, centroid)
	const ab = new CANNON.Vec3()
	const ac = new CANNON.Vec3()
	const normal = new CANNON.Vec3()
	const toCentroid = new CANNON.Vec3()
	return faces.map((face) => {
		if (face.length < 3) {
			return face
		}
		const [i0, i1, i2] = face
		if (i0 === undefined || i1 === undefined || i2 === undefined) {
			return face
		}
		const a = vertices[i0]
		const b = vertices[i1]
		const c = vertices[i2]
		if (!a || !b || !c) {
			return face
		}
		ab.set(b.x, b.y, b.z).vsub(a, ab)
		ac.set(c.x, c.y, c.z).vsub(a, ac)
		ab.cross(ac, normal)
		if (normal.lengthSquared() < 1e-12) {
			return face
		}
		toCentroid.set(a.x, a.y, a.z).vsub(centroid, toCentroid)
		return normal.dot(toCentroid) >= 0 ? face : [...face].reverse()
	})
}


function createCannonShape(
	definition: RigidbodyPhysicsShape,
	loggerTag: LoggerTag,
	scale: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 },
): CANNON.Shape | null {
	const safeScale = normalizeScaleVector(scale)
	const scaleNormalized = definition.scaleNormalized === true
	const scaleX = scaleNormalized ? safeScale.x : 1
	const scaleY = scaleNormalized ? safeScale.y : 1
	const scaleZ = scaleNormalized ? safeScale.z : 1
	if (definition.kind === 'box') {
		const [x, y, z] = definition.halfExtents
		if (![x, y, z].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
			return null
		}
		return new CANNON.Box(new CANNON.Vec3(x * scaleX, y * scaleY, z * scaleZ))
	}
	if (definition.kind === 'convex') {
		if (!Array.isArray(definition.vertices) || definition.vertices.length < 4) {
			return null
		}
		const vertices: CANNON.Vec3[] = []
		const vertexMap = new Map<string, number>()
		const indexMap = new Map<number, number>()
		for (let i = 0; i < definition.vertices.length; i += 1) {
			const tuple = definition.vertices[i]
			const vx = Number(tuple?.[0])
			const vy = Number(tuple?.[1])
			const vz = Number(tuple?.[2])
			if (![vx, vy, vz].every((value) => Number.isFinite(value))) {
				return null
			}
			const scaledX = vx * scaleX
			const scaledY = vy * scaleY
			const scaledZ = vz * scaleZ
			const key = `${scaledX.toFixed(4)},${scaledY.toFixed(4)},${scaledZ.toFixed(4)}`
			if (vertexMap.has(key)) {
				indexMap.set(i, vertexMap.get(key)!)
			} else {
				const newIndex = vertices.length
				vertices.push(new CANNON.Vec3(scaledX, scaledY, scaledZ))
				vertexMap.set(key, newIndex)
				indexMap.set(i, newIndex)
			}
		}
		const remappedFaces: number[][] = []
		if (Array.isArray(definition.faces)) {
			definition.faces.forEach((face) => {
				if (!Array.isArray(face)) {
					return
				}
				const newFace: number[] = []
				face.forEach((idx) => {
					const numeric = typeof idx === 'number' ? idx : Number(idx)
					if (Number.isFinite(numeric)) {
						const originalIndex = Math.trunc(numeric)
						if (indexMap.has(originalIndex)) {
							newFace.push(indexMap.get(originalIndex)!)
						}
					}
				})
				if (newFace.length >= 3) {
					remappedFaces.push(newFace)
				}
			})
		}
		const { faces, invalidCount } = sanitizeConvexFaces(remappedFaces, vertices.length)
		if (!faces.length) {
			return null
		}
		if (invalidCount) {
			warn(loggerTag, 'Convex collider faces contain invalid vertex indices; skipped %d face(s).', invalidCount)
		}
		const orientedFaces = orientConvexFaces(faces, vertices)
		return new CANNON.ConvexPolyhedron({ vertices, faces: orientedFaces })
	}
	if (definition.kind === 'heightfield') {
		const matrix = normalizeHeightfieldMatrix(definition.matrix)
		const elementSize = typeof definition.elementSize === 'number' && Number.isFinite(definition.elementSize)
			? definition.elementSize
			: null
		if (!matrix || !elementSize || elementSize <= 0) {
			return null
		}
		return new CANNON.Heightfield(matrix, { elementSize })
	}
	if (definition.kind === 'sphere') {
		const radius = Number(definition.radius)
		if (!Number.isFinite(radius) || radius <= 0) {
			return null
		}
		const scaleFactor = Math.max(scaleX, scaleY, scaleZ)
		return new CANNON.Sphere(radius * scaleFactor)
	}
	if (definition.kind === 'cylinder') {
		const radiusTop = Number(definition.radiusTop)
		const radiusBottom = Number(definition.radiusBottom)
		const height = Number(definition.height)
		if (![radiusTop, radiusBottom, height].every((value) => Number.isFinite(value) && value > 0)) {
			return null
		}
		const segmentCount = Number.isFinite(definition.segments)
			? Math.max(3, Math.min(48, Math.trunc(definition.segments ?? 16)))
			: 16
		const radiusScale = Math.max(scaleX, scaleZ)
		const heightScale = scaleY
		const cylinder = new CANNON.Cylinder(
			radiusTop * radiusScale,
			radiusBottom * radiusScale,
			height * heightScale,
			segmentCount,
		)
		cylinder.transformAllPoints(cylinderShapeOffsetHelper.set(0, 0, 0), cylinderShapeRotationHelper)
		return cylinder
	}
	return null
}

export function resolveGroundHeightfieldShape(
	node: SceneNode,
	definition: GroundDynamicMesh,
	cache: Map<string, GroundHeightfieldCacheEntry>,
): GroundHeightfieldCacheEntry | null {
	const nodeId = node.id
	const data: GroundHeightfieldData | null = buildGroundHeightfieldData(node, definition)
	if (!data) {
		cache.delete(nodeId)
		return null
	}
	const cached = cache.get(nodeId)
	if (cached && cached.signature === data.signature) {
		return cached
	}
	const shape = new CANNON.Heightfield(data.matrix, { elementSize: data.elementSize })
	const entry: GroundHeightfieldCacheEntry = {
		signature: data.signature,
		shape,
		offset: data.offset,
	}
	cache.set(nodeId, entry)
	return entry
}

type CreateRigidbodyBodyInput = {
	node: SceneNode
	component: SceneNodeComponentState<RigidbodyComponentProps>
	shapeDefinition: RigidbodyPhysicsShape | null
	object: THREE.Object3D
}

export type CreateRigidbodyBodyOptions = {
	world: CANNON.World
	groundHeightfieldCache: Map<string, GroundHeightfieldCacheEntry>
	wallTrimeshCache?: WallTrimeshCache
	rigidbodyMaterialCache: Map<string, RigidbodyMaterialEntry>
	rigidbodyContactMaterialKeys: Set<string>
	contactSettings: PhysicsContactSettings
	loggerTag?: string
}

export function createRigidbodyBody(
	input: CreateRigidbodyBodyInput,
	options: CreateRigidbodyBodyOptions,
): { body: CANNON.Body; orientationAdjustment: RigidbodyOrientationAdjustment | null } | null {
	const { node, component, shapeDefinition, object } = input
	const {
		world,
		groundHeightfieldCache,
		wallTrimeshCache,
		rigidbodyMaterialCache,
		rigidbodyContactMaterialKeys,
		contactSettings,
		loggerTag,
	} = options
	object.updateMatrixWorld(true)
	object.getWorldScale(physicsScaleHelper)
	const shapeScale = normalizeScaleVector(physicsScaleHelper)
	let offsetTuple: RigidbodyVector3Tuple | null = null
	let resolvedShape: CANNON.Shape | null = null
	let needsHeightfieldOrientation = false
	if (isGroundDynamicMesh(node.dynamicMesh)) {
		const groundEntry = resolveGroundHeightfieldShape(node, node.dynamicMesh, groundHeightfieldCache)
		if (groundEntry) {
			resolvedShape = groundEntry.shape
			offsetTuple = groundEntry.offset
			needsHeightfieldOrientation = true
		}
	}
	if (!resolvedShape && isWallDynamicMesh(node.dynamicMesh) && wallTrimeshCache) {
		const entry = resolveWallShape({ node, object, cache: wallTrimeshCache, loggerTag })
		if (entry) {
			resolvedShape = entry.shape
			offsetTuple = null
		}
	}
	if (!resolvedShape && shapeDefinition) {
		resolvedShape = createCannonShape(shapeDefinition, loggerTag, shapeScale)
		offsetTuple = shapeDefinition.offset ?? null
		if (shapeDefinition.kind === 'heightfield') {
			needsHeightfieldOrientation = true
		}
	}
	if (!resolvedShape) {
		return null
	}
	const props = component.props as RigidbodyComponentProps
	const isWall = isWallDynamicMesh(node.dynamicMesh)
	const effectiveBodyType: RigidbodyComponentProps['bodyType'] = isWall ? 'STATIC' : props.bodyType
	const isDynamic = effectiveBodyType === 'DYNAMIC'
	const mass = isDynamic ? Math.max(0, props.mass ?? 0) : 0
	const body = new CANNON.Body({ mass })
	body.type = mapBodyType(effectiveBodyType)
	body.material = ensureRigidbodyMaterial({
		world,
		rigidbodyMaterialCache,
		rigidbodyContactMaterialKeys,
		friction: props.friction ?? DEFAULT_RIGIDBODY_FRICTION,
		restitution: props.restitution ?? DEFAULT_RIGIDBODY_RESTITUTION,
		contactSettings,
	})
	let shapeOffset: CANNON.Vec3 | undefined
	if (offsetTuple) {
		const [ox, oy, oz] = offsetTuple
		shapeOffset = heightfieldShapeOffsetHelper.set(
			(ox ?? 0) * shapeScale.x,
			(oy ?? 0) * shapeScale.y,
			(oz ?? 0) * shapeScale.z,
		)
	}
	const orientationAdjustment = needsHeightfieldOrientation ? groundHeightfieldOrientationAdjustment : null
	body.addShape(resolvedShape, shapeOffset)
	syncBodyFromObject(body, object, orientationAdjustment)
	body.updateMassProperties()
	body.linearDamping = props.linearDamping ?? DEFAULT_LINEAR_DAMPING
	body.angularDamping = props.angularDamping ?? DEFAULT_ANGULAR_DAMPING
	return { body, orientationAdjustment }
}

export function syncBodyFromObject(
	body: CANNON.Body,
	object: THREE.Object3D,
	orientationAdjustment: RigidbodyOrientationAdjustment | null = null,
): void {
	object.updateMatrixWorld(true)
	object.matrixWorld.decompose(physicsPositionHelper, physicsQuaternionHelper, physicsScaleHelper)
	syncBodyQuaternionHelper.copy(physicsQuaternionHelper)
	if (orientationAdjustment) {
		syncBodyQuaternionHelper.multiply(orientationAdjustment.three)
	}
	body.position.set(physicsPositionHelper.x, physicsPositionHelper.y, physicsPositionHelper.z)
	body.quaternion.set(
		syncBodyQuaternionHelper.x,
		syncBodyQuaternionHelper.y,
		syncBodyQuaternionHelper.z,
		syncBodyQuaternionHelper.w,
	)
	body.velocity.set(0, 0, 0)
	body.angularVelocity.set(0, 0, 0)
}

export function syncObjectFromBody(
	entry: Pick<RigidbodyInstance, 'object' | 'body' | 'orientationAdjustment'>,
	afterSync?: (object: THREE.Object3D) => void,
): void {
	const { object, body, orientationAdjustment } = entry
	if (!object) {
		return
	}
	object.position.set(body.position.x, body.position.y, body.position.z)
	bodyQuaternionHelper.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
	if (orientationAdjustment) {
		bodyQuaternionHelper.multiply(orientationAdjustment.threeInverse)
	}
	object.quaternion.copy(bodyQuaternionHelper)
	object.updateMatrixWorld(true)
	afterSync?.(object)
}

export function ensurePhysicsWorld(params: EnsurePhysicsWorldParams): CANNON.World {
	if (params.world) {
		return params.world
	}
	params.rigidbodyMaterialCache.clear()
	params.rigidbodyContactMaterialKeys.clear()
	const world = new CANNON.World()
	world.gravity.copy(params.gravity)
	const solver = new CANNON.GSSolver()
	solver.iterations = params.solverIterations
	solver.tolerance = params.solverTolerance
	world.solver = solver
	world.broadphase = new CANNON.SAPBroadphase(world)
	world.allowSleep = true
	world.quatNormalizeFast = false
	world.quatNormalizeSkip = 0
	world.defaultContactMaterial.friction = params.contactFriction
	world.defaultContactMaterial.restitution = params.contactRestitution
	world.defaultContactMaterial.contactEquationStiffness = params.contactSettings.contactEquationStiffness
	world.defaultContactMaterial.contactEquationRelaxation = params.contactSettings.contactEquationRelaxation
	world.defaultContactMaterial.frictionEquationStiffness = params.contactSettings.frictionEquationStiffness
	world.defaultContactMaterial.frictionEquationRelaxation = params.contactSettings.frictionEquationRelaxation
	params.setWorld(world)
	return world
}
