import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import type {
	SceneNode,
	Vector3Like,
	GroundDynamicMesh,
} from '@harmony/schema'
import { isGroundDynamicMesh } from './groundHeightfield'

export const DEFAULT_AIR_WALL_HEIGHT = 8
export const DEFAULT_AIR_WALL_THICKNESS = 0.6
export const DEFAULT_AIR_WALL_VERTICAL_PADDING = 0.5

export type AirWallDefinition = {
	key: string
	halfExtents: [number, number, number]
	bodyPosition: CANNON.Vec3
	bodyQuaternion: THREE.Quaternion
	debugPosition: THREE.Vector3
	debugQuaternion: THREE.Quaternion
}

export type BuildGroundAirWallOptions = {
	groundNode: SceneNode
	groundObject?: THREE.Object3D | null
	dynamicMesh?: GroundDynamicMesh | null
	height?: number
	thickness?: number
	verticalPadding?: number
}

const MIN_DIMENSION = 1e-4

function normalizeVectorComponent(value: unknown, fallback = 0): number {
	const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
	return numeric
}

function normalizeScaleComponent(value: unknown, fallback = 1): number {
	const numeric = typeof value === 'number' && Number.isFinite(value) && value !== 0 ? value : fallback
	return Math.abs(numeric)
}

function applyNodeTransformFallback(
	node: SceneNode,
	position: THREE.Vector3,
	scale: THREE.Vector3,
	quaternion: THREE.Quaternion,
): void {
	const nodePosition = node.position as Vector3Like | undefined
	if (nodePosition && typeof nodePosition === 'object') {
		position.set(
			normalizeVectorComponent(nodePosition.x),
			normalizeVectorComponent(nodePosition.y),
			normalizeVectorComponent(nodePosition.z),
		)
	}
	const nodeScale = node.scale as Vector3Like | undefined
	if (nodeScale && typeof nodeScale === 'object') {
		scale.set(
			normalizeScaleComponent(nodeScale.x),
			normalizeScaleComponent(nodeScale.y),
			normalizeScaleComponent(nodeScale.z),
		)
	}
	const nodeRotation = node.rotation as Vector3Like | undefined
	if (nodeRotation && typeof nodeRotation === 'object') {
		const rx = normalizeVectorComponent(nodeRotation.x)
		const ry = normalizeVectorComponent(nodeRotation.y)
		const rz = normalizeVectorComponent(nodeRotation.z)
		quaternion.setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'))
	}
}

function resolveGroundTransform(
	node: SceneNode,
	groundObject: THREE.Object3D | null | undefined,
): { position: THREE.Vector3; scale: THREE.Vector3; quaternion: THREE.Quaternion; bounds: THREE.Box3 } {
	const position = new THREE.Vector3(0, 0, 0)
	const scale = new THREE.Vector3(1, 1, 1)
	const quaternion = new THREE.Quaternion()
	const bounds = new THREE.Box3()
	if (groundObject) {
		groundObject.updateMatrixWorld(true)
		groundObject.getWorldScale(scale)
		groundObject.getWorldPosition(position)
		groundObject.getWorldQuaternion(quaternion)
		try {
			bounds.setFromObject(groundObject)
		} catch (error) {
			console.warn('[AirWall] Failed to compute ground bounds', error)
		}
	} else {
		applyNodeTransformFallback(node, position, scale, quaternion)
	}
	return { position, scale, quaternion, bounds }
}

export function buildGroundAirWallDefinitions(options: BuildGroundAirWallOptions): AirWallDefinition[] {
	const { groundNode, groundObject = null, dynamicMesh: dynamicOverride, height, thickness, verticalPadding } = options
	const mesh = dynamicOverride ?? (groundNode.dynamicMesh as GroundDynamicMesh | undefined | null)
	if (!mesh || !isGroundDynamicMesh(mesh)) {
		return []
	}
	const baseWidth = mesh.width
	const baseDepth = mesh.depth
	if (!Number.isFinite(baseWidth) || !Number.isFinite(baseDepth) || baseWidth <= 0 || baseDepth <= 0) {
		return []
	}
	const { position, scale, quaternion, bounds } = resolveGroundTransform(groundNode, groundObject)
	const wallThickness = Math.max(MIN_DIMENSION, thickness ?? DEFAULT_AIR_WALL_THICKNESS)
	const wallHeightBase = Math.max(MIN_DIMENSION, height ?? DEFAULT_AIR_WALL_HEIGHT)
	const padding = Math.max(0, verticalPadding ?? DEFAULT_AIR_WALL_VERTICAL_PADDING)
	const worldWidth = Math.max(MIN_DIMENSION, baseWidth * Math.abs(scale.x))
	const worldDepth = Math.max(MIN_DIMENSION, baseDepth * Math.abs(scale.z))
	const halfWidth = worldWidth * 0.5
	const halfDepth = worldDepth * 0.5
	let wallHeight = wallHeightBase
	let wallBaseY: number
	if (bounds.isEmpty()) {
		wallBaseY = position.y - padding
	} else {
		const boundsHeight = Math.max(0, bounds.max.y - bounds.min.y)
		const paddedHeight = boundsHeight + padding * 2
		wallHeight = Math.max(wallHeightBase, paddedHeight)
		wallBaseY = bounds.min.y - padding
	}
	const wallHalfHeight = wallHeight * 0.5
	const wallCenterY = wallBaseY + wallHalfHeight
	const depthWithMargin = worldDepth + wallThickness * 2
	const widthWithMargin = worldWidth + wallThickness * 2
	const rightAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion).normalize()
	const forwardAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion).normalize()
	const upAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize()
	const yawQuaternionHelper = new THREE.Quaternion()
	const result: AirWallDefinition[] = []
	const pushWall = (
		key: string,
		halfExtents: [number, number, number],
		offsetAxis: THREE.Vector3,
		offsetDistance: number,
		debugYaw: number,
	) => {
		const center = position.clone().add(offsetAxis.clone().multiplyScalar(offsetDistance))
		const bodyPosition = new CANNON.Vec3(center.x, wallCenterY, center.z)
		const bodyQuaternion = quaternion.clone()
		const debugQuaternion = quaternion.clone().multiply(yawQuaternionHelper.setFromAxisAngle(upAxis, debugYaw))
		const debugPosition = new THREE.Vector3(center.x, wallCenterY, center.z)
		result.push({
			key,
			halfExtents,
			bodyPosition,
			bodyQuaternion,
			debugPosition,
			debugQuaternion,
		})
	}
	pushWall(
		'airwall:+x',
		[wallThickness * 0.5, wallHalfHeight, depthWithMargin * 0.5],
		rightAxis,
		halfWidth + wallThickness * 0.5,
		-Math.PI / 2,
	)
	pushWall(
		'airwall:-x',
		[wallThickness * 0.5, wallHalfHeight, depthWithMargin * 0.5],
		rightAxis,
		-(halfWidth + wallThickness * 0.5),
		Math.PI / 2,
	)
	pushWall(
		'airwall:+z',
		[widthWithMargin * 0.5, wallHalfHeight, wallThickness * 0.5],
		forwardAxis,
		halfDepth + wallThickness * 0.5,
		0,
	)
	pushWall(
		'airwall:-z',
		[widthWithMargin * 0.5, wallHalfHeight, wallThickness * 0.5],
		forwardAxis,
		-(halfDepth + wallThickness * 0.5),
		Math.PI,
	)
	return result
}
