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
	buildGroundHeightfieldChunkPlan,
	buildGroundHeightfieldChunkData,
	computeGroundHeightfieldChunkHash,
	type GroundHeightfieldChunkPlan,
} from './groundHeightfield'
import type { GroundHeightfieldData } from './groundHeightfield'
import { isGroundDynamicMesh } from './groundHeightfield'

export type RigidbodyOrientationAdjustment = {
	cannon: CANNON.Quaternion
	cannonInverse: CANNON.Quaternion
	three: THREE.Quaternion
	threeInverse: THREE.Quaternion
}

export type RigidbodyInstance = {
	nodeId: string
	body: CANNON.Body
	object: THREE.Object3D | null
	orientationAdjustment: RigidbodyOrientationAdjustment | null
}

export type GroundHeightfieldCacheEntry = {
	signature: string
	shape: CANNON.Heightfield
	offset: [number, number, number]
}

export type GroundHeightfieldChunkCacheEntry = {
	key: string
	shape: CANNON.Heightfield
	offset: [number, number, number]
	hash: number
	lastUsedAt: number
}

export type GroundHeightfieldChunkCache = {
	planSignature: string
	plan: GroundHeightfieldChunkPlan
	chunks: Map<string, GroundHeightfieldChunkCacheEntry>
}

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
const groundHeightfieldCameraWorldHelper = new THREE.Vector3()
const physicsPositionHelper = new THREE.Vector3()
const physicsQuaternionHelper = new THREE.Quaternion()
const physicsScaleHelper = new THREE.Vector3()
const syncBodyQuaternionHelper = new THREE.Quaternion()
const bodyQuaternionHelper = new THREE.Quaternion()
const cylinderShapeRotationHelper = new CANNON.Quaternion()
cylinderShapeRotationHelper.setFromEuler(Math.PI / 2, 0, 0)
const cylinderShapeOffsetHelper = new CANNON.Vec3()

type LoggerTag = string | undefined

function warn(loggerTag: LoggerTag, message: string, ...args: unknown[]): void {
	const prefix = loggerTag ?? '[PhysicsEngine]'
	console.warn(`${prefix} ${message}`, ...args)
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
	groundHeightfieldChunkCache?: Map<string, GroundHeightfieldChunkCache>
	groundHeightfieldObject?: THREE.Object3D | null
	groundHeightfieldCamera?: THREE.Camera | null
	groundHeightfieldRadius?: number
	groundHeightfieldMaxChunks?: number
	groundHeightfieldMaxSamplePoints?: number
	rigidbodyMaterialCache: Map<string, RigidbodyMaterialEntry>
	rigidbodyContactMaterialKeys: Set<string>
	contactSettings: PhysicsContactSettings
	loggerTag?: string
}

function clampInclusive(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value))
}

function groundChunkKey(chunkRow: number, chunkColumn: number): string {
	return `${chunkRow}:${chunkColumn}`
}

function getOrCreateChunkCache(
	cacheMap: Map<string, GroundHeightfieldChunkCache>,
	nodeId: string,
	plan: GroundHeightfieldChunkPlan,
): GroundHeightfieldChunkCache {
	const existing = cacheMap.get(nodeId)
	if (existing && existing.planSignature === plan.signature) {
		return existing
	}
	const next: GroundHeightfieldChunkCache = {
		planSignature: plan.signature,
		plan,
		chunks: new Map(),
	}
	cacheMap.set(nodeId, next)
	return next
}

function clearGroundHeightfieldChunkShapes(body: CANNON.Body, cache: GroundHeightfieldChunkCache): void {
	const entries = Array.from(cache.chunks.values())
	entries.forEach((entry) => {
		try {
			body.removeShape(entry.shape)
		} catch (_error) {
			/* noop */
		}
	})
	cache.chunks.clear()
	body.aabbNeedsUpdate = true
}

export function updateGroundHeightfieldChunksForBody(params: {
	body: CANNON.Body
	node: SceneNode
	definition: GroundDynamicMesh
	groundObject: THREE.Object3D
	camera: THREE.Camera
	chunkCacheMap: Map<string, GroundHeightfieldChunkCache>
	radius?: number
	maxChunks?: number
	maxSamplePoints?: number
	loggerTag?: string
}): void {
	const { body, node, definition, groundObject, camera, chunkCacheMap, loggerTag } = params
	const radius = typeof params.radius === 'number' && Number.isFinite(params.radius) && params.radius > 0
		? params.radius
		: 350
	const maxChunks = typeof params.maxChunks === 'number' && Number.isFinite(params.maxChunks) && params.maxChunks > 0
		? Math.max(4, Math.trunc(params.maxChunks))
		: 256
	const maxSamplePoints = typeof params.maxSamplePoints === 'number' && Number.isFinite(params.maxSamplePoints) && params.maxSamplePoints > 0
		? Math.max(500, Math.trunc(params.maxSamplePoints))
		: 75_000

	const plan = buildGroundHeightfieldChunkPlan(node, definition, { maxSamplePoints })
	if (!plan) {
		chunkCacheMap.delete(node.id)
		return
	}
	const cache = getOrCreateChunkCache(chunkCacheMap, node.id, plan)
	if (cache.planSignature !== plan.signature) {
		// Plan changed; clear existing shapes.
		clearGroundHeightfieldChunkShapes(body, cache)
		cache.planSignature = plan.signature
		cache.plan = plan
	}

	groundObject.updateMatrixWorld(true)
	camera.getWorldPosition(groundHeightfieldCameraWorldHelper)
	const cameraLocal = groundObject.worldToLocal(groundHeightfieldCameraWorldHelper)
	const localX = cameraLocal.x
	const localZ = cameraLocal.z

	const chunkCells = plan.chunkCells
	const maxChunkRowIndex = Math.max(0, Math.floor((plan.rows - 1) / chunkCells))
	const maxChunkColumnIndex = Math.max(0, Math.floor((plan.columns - 1) / chunkCells))
	const minColumn = clampInclusive(Math.floor((localX - radius + plan.halfWidth) / plan.elementSize), 0, plan.columns)
	const maxColumn = clampInclusive(Math.ceil((localX + radius + plan.halfWidth) / plan.elementSize), 0, plan.columns)
	const minRow = clampInclusive(Math.floor((localZ - radius + plan.halfDepth) / plan.elementSize), 0, plan.rows)
	const maxRow = clampInclusive(Math.ceil((localZ + radius + plan.halfDepth) / plan.elementSize), 0, plan.rows)
	const minChunkColumn = clampInclusive(Math.floor(minColumn / chunkCells), 0, maxChunkColumnIndex)
	const maxChunkColumn = clampInclusive(Math.floor(maxColumn / chunkCells), 0, maxChunkColumnIndex)
	const minChunkRow = clampInclusive(Math.floor(minRow / chunkCells), 0, maxChunkRowIndex)
	const maxChunkRow = clampInclusive(Math.floor(maxRow / chunkCells), 0, maxChunkRowIndex)

	const now = performance.now ? performance.now() : Date.now()
	const keep = new Set<string>()
	let created = 0
	for (let cr = minChunkRow; cr <= maxChunkRow; cr += 1) {
		for (let cc = minChunkColumn; cc <= maxChunkColumn; cc += 1) {
			const key = groundChunkKey(cr, cc)
			keep.add(key)
			const existing = cache.chunks.get(key)
			if (existing) {
				const nextHash = computeGroundHeightfieldChunkHash(node, definition, plan, cr, cc)
				if (nextHash !== existing.hash) {
					try {
						body.removeShape(existing.shape)
						const chunkData = buildGroundHeightfieldChunkData(node, definition, plan, cr, cc)
						if (chunkData) {
							const nextShape = new CANNON.Heightfield(chunkData.matrix, { elementSize: chunkData.elementSize })
							body.addShape(
								nextShape,
								heightfieldShapeOffsetHelper.set(
									chunkData.offset[0],
									chunkData.offset[1],
									chunkData.offset[2],
								),
							)
							existing.shape = nextShape
							existing.offset = chunkData.offset
							existing.hash = nextHash
						}
					} catch (error) {
						warn(loggerTag, 'Failed to refresh ground heightfield chunk shape', key, error)
					}
				}
				existing.lastUsedAt = now
				continue
			}
			if (created >= maxChunks) {
				continue
			}
			const chunkData = buildGroundHeightfieldChunkData(node, definition, plan, cr, cc)
			if (!chunkData) {
				continue
			}
			try {
				const shape = new CANNON.Heightfield(chunkData.matrix, { elementSize: chunkData.elementSize })
				body.addShape(
					shape,
					heightfieldShapeOffsetHelper.set(chunkData.offset[0], chunkData.offset[1], chunkData.offset[2]),
				)
				cache.chunks.set(key, {
					key,
					shape,
					offset: chunkData.offset,
					hash: computeGroundHeightfieldChunkHash(node, definition, plan, cr, cc),
					lastUsedAt: now,
				})
				created += 1
			} catch (error) {
				warn(loggerTag, 'Failed to add ground heightfield chunk shape', key, error)
			}
		}
	}

	// Cull far chunks with a small TTL to avoid churn.
	const ttlMs = 1_500
	Array.from(cache.chunks.values()).forEach((entry) => {
		if (keep.has(entry.key)) {
			return
		}
		if (now - entry.lastUsedAt < ttlMs) {
			return
		}
		try {
			body.removeShape(entry.shape)
		} catch (error) {
			warn(loggerTag, 'Failed to remove ground heightfield chunk shape', entry.key, error)
		}
		cache.chunks.delete(entry.key)
	})

	body.aabbNeedsUpdate = true
	body.updateMassProperties()
}

export function createRigidbodyBody(
	input: CreateRigidbodyBodyInput,
	options: CreateRigidbodyBodyOptions,
): { body: CANNON.Body; orientationAdjustment: RigidbodyOrientationAdjustment | null } | null {
	const { node, component, shapeDefinition, object } = input
	const {
		world,
		groundHeightfieldCache,
		groundHeightfieldChunkCache,
		groundHeightfieldObject,
		groundHeightfieldCamera,
		groundHeightfieldRadius,
		groundHeightfieldMaxChunks,
		groundHeightfieldMaxSamplePoints,
		rigidbodyMaterialCache,
		rigidbodyContactMaterialKeys,
		contactSettings,
		loggerTag,
	} = options
	object.updateMatrixWorld(true)
	object.getWorldScale(physicsScaleHelper)
	const shapeScale = normalizeScaleVector(physicsScaleHelper)
	// Special-case ground: optionally use chunked heightfields to avoid a single massive matrix.
	if (isGroundDynamicMesh(node.dynamicMesh) && groundHeightfieldChunkCache && groundHeightfieldObject) {
		const props = component.props as RigidbodyComponentProps
		const body = new CANNON.Body({ mass: 0 })
		body.type = CANNON.Body.STATIC
		body.material = ensureRigidbodyMaterial({
			world,
			rigidbodyMaterialCache,
			rigidbodyContactMaterialKeys,
			friction: props.friction ?? DEFAULT_RIGIDBODY_FRICTION,
			restitution: props.restitution ?? DEFAULT_RIGIDBODY_RESTITUTION,
			contactSettings,
		})
		const orientationAdjustment = groundHeightfieldOrientationAdjustment
		syncBodyFromObject(body, object, orientationAdjustment)

		// Seed chunks (camera-driven when available; otherwise centered on origin).
		if (groundHeightfieldCamera) {
			updateGroundHeightfieldChunksForBody({
				body,
				node,
				definition: node.dynamicMesh,
				groundObject: groundHeightfieldObject,
				camera: groundHeightfieldCamera,
				chunkCacheMap: groundHeightfieldChunkCache,
				radius: groundHeightfieldRadius,
				maxChunks: groundHeightfieldMaxChunks,
				maxSamplePoints: groundHeightfieldMaxSamplePoints,
				loggerTag,
			})
		}

		body.updateMassProperties()
		body.linearDamping = props.linearDamping ?? DEFAULT_LINEAR_DAMPING
		body.angularDamping = props.angularDamping ?? DEFAULT_ANGULAR_DAMPING
		return { body, orientationAdjustment }
	}

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
	const isDynamic = props.bodyType === 'DYNAMIC'
	const mass = isDynamic ? Math.max(0, props.mass ?? 0) : 0
	const body = new CANNON.Body({ mass })
	body.type = mapBodyType(props.bodyType)
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
