import * as THREE from 'three'
import {
	resolveInstancedLodTargetFromSnapshot,
	type InstancedLodSelectionSnapshot,
	type InstancedLodTarget,
} from './instancedLodSelection'

export type InstancedLodBoundsSnapshot = {
	min: [number, number, number]
	max: [number, number, number]
} | null

export type InstancedLodCullingCandidateSnapshot = InstancedLodSelectionSnapshot & {
	nodeId: string
	enableCulling: boolean
	matrixWorld: number[]
	bounds: InstancedLodBoundsSnapshot
	radiusHint?: number | null
}

export function normalizeInstancedLodBoundsSnapshot(bounds: InstancedLodBoundsSnapshot): InstancedLodBoundsSnapshot {
	if (!bounds) {
		return null
	}
	return {
		min: [
			Number.isFinite(bounds.min[0]) ? bounds.min[0] : 0,
			Number.isFinite(bounds.min[1]) ? bounds.min[1] : 0,
			Number.isFinite(bounds.min[2]) ? bounds.min[2] : 0,
		],
		max: [
			Number.isFinite(bounds.max[0]) ? bounds.max[0] : 0,
			Number.isFinite(bounds.max[1]) ? bounds.max[1] : 0,
			Number.isFinite(bounds.max[2]) ? bounds.max[2] : 0,
		],
	}
}

export function buildInstancedLodCullingCandidateSnapshot(params: {
	nodeId: string
	enableCulling: boolean
	matrixWorld: ArrayLike<number>
	bounds: InstancedLodBoundsSnapshot
	radiusHint?: number | null
	sourceAssetId?: InstancedLodSelectionSnapshot['sourceAssetId']
	instanceLayout?: InstancedLodSelectionSnapshot['instanceLayout']
	lodProps?: InstancedLodSelectionSnapshot['lodProps']
	worldPosition?: InstancedLodSelectionSnapshot['worldPosition']
	cameraPosition?: InstancedLodSelectionSnapshot['cameraPosition']
}): InstancedLodCullingCandidateSnapshot {
	return {
		nodeId: typeof params.nodeId === 'string' ? params.nodeId : '',
		enableCulling: params.enableCulling === true,
		matrixWorld: Array.from(params.matrixWorld ?? []),
		bounds: normalizeInstancedLodBoundsSnapshot(params.bounds),
		radiusHint: Number.isFinite(params.radiusHint ?? NaN) ? (params.radiusHint as number) : null,
		sourceAssetId: params.sourceAssetId ?? null,
		instanceLayout: params.instanceLayout ?? null,
		lodProps: params.lodProps ?? null,
		worldPosition: params.worldPosition ?? null,
		cameraPosition: params.cameraPosition ?? null,
	}
}

export type InstancedLodCullingRequest = {
	kind: 'cull-instanced-lod'
	requestId: number
	cameraProjectionMatrix: number[]
	cameraMatrixWorldInverse: number[]
	cameraPosition: { x: number; y: number; z: number }
	candidates: InstancedLodCullingCandidateSnapshot[]
}

export type InstancedLodCullingResponse = {
	kind: 'cull-instanced-lod-result'
	requestId: number
	visibleIds: string[]
	targets: Array<{
		nodeId: string
		target: InstancedLodTarget
	}>
	error?: string
}

const instancedLodCullingProjView = new THREE.Matrix4()
const instancedLodCullingFrustum = new THREE.Frustum()
const instancedLodCullingSphere = new THREE.Sphere()
const instancedLodCullingBox = new THREE.Box3()
const instancedLodCullingMatrix = new THREE.Matrix4()
const instancedLodCullingCenter = new THREE.Vector3()
const instancedLodCullingPosition = new THREE.Vector3()
const instancedLodCullingQuaternion = new THREE.Quaternion()
const instancedLodCullingScale = new THREE.Vector3()

function normalizeBoundingBox(bounds: InstancedLodBoundsSnapshot): InstancedLodBoundsSnapshot {
	if (!bounds) {
		return null
	}
	return {
		min: [
			Number.isFinite(bounds.min[0]) ? bounds.min[0] : 0,
			Number.isFinite(bounds.min[1]) ? bounds.min[1] : 0,
			Number.isFinite(bounds.min[2]) ? bounds.min[2] : 0,
		],
		max: [
			Number.isFinite(bounds.max[0]) ? bounds.max[0] : 0,
			Number.isFinite(bounds.max[1]) ? bounds.max[1] : 0,
			Number.isFinite(bounds.max[2]) ? bounds.max[2] : 0,
		],
	}
}

function computeCandidateWorldCenterAndRadius(candidate: InstancedLodCullingCandidateSnapshot): {
	worldPosition: { x: number; y: number; z: number }
	radius: number
} {
	instancedLodCullingMatrix.fromArray(candidate.matrixWorld)
	const bounds = normalizeBoundingBox(candidate.bounds)
	if (bounds) {
		instancedLodCullingBox.min.set(bounds.min[0], bounds.min[1], bounds.min[2])
		instancedLodCullingBox.max.set(bounds.max[0], bounds.max[1], bounds.max[2])
		if (!instancedLodCullingBox.isEmpty()) {
			instancedLodCullingBox.getCenter(instancedLodCullingCenter)
			instancedLodCullingCenter.applyMatrix4(instancedLodCullingMatrix)
			instancedLodCullingBox.getBoundingSphere(instancedLodCullingSphere)
			instancedLodCullingMatrix.decompose(
				instancedLodCullingPosition,
				instancedLodCullingQuaternion,
				instancedLodCullingScale,
			)
			const scale = Math.max(
				Number.isFinite(instancedLodCullingScale.x) ? instancedLodCullingScale.x : 1,
				Number.isFinite(instancedLodCullingScale.y) ? instancedLodCullingScale.y : 1,
				Number.isFinite(instancedLodCullingScale.z) ? instancedLodCullingScale.z : 1,
			)
			const radius = Number.isFinite(instancedLodCullingSphere.radius) && instancedLodCullingSphere.radius > 0
				? instancedLodCullingSphere.radius * (Number.isFinite(scale) && scale > 0 ? scale : 1)
				: (Number.isFinite(candidate.radiusHint ?? NaN) && (candidate.radiusHint ?? 0) > 0 ? (candidate.radiusHint as number) : 0.5)
			return {
				worldPosition: {
					x: instancedLodCullingCenter.x,
					y: instancedLodCullingCenter.y,
					z: instancedLodCullingCenter.z,
				},
				radius,
			}
		}
	}
	instancedLodCullingPosition.setFromMatrixPosition(instancedLodCullingMatrix)
	return {
		worldPosition: {
			x: instancedLodCullingPosition.x,
			y: instancedLodCullingPosition.y,
			z: instancedLodCullingPosition.z,
		},
		radius: Number.isFinite(candidate.radiusHint ?? NaN) && (candidate.radiusHint ?? 0) > 0 ? (candidate.radiusHint as number) : 0.5,
	}
}

export function buildInstancedLodCullingRequest(params: {
	requestId: number
	cameraProjectionMatrix: ArrayLike<number>
	cameraMatrixWorldInverse: ArrayLike<number>
	cameraPosition: { x: number; y: number; z: number }
	candidates: InstancedLodCullingCandidateSnapshot[]
}): InstancedLodCullingRequest {
	return {
		kind: 'cull-instanced-lod',
		requestId: params.requestId,
		cameraProjectionMatrix: Array.from(params.cameraProjectionMatrix),
		cameraMatrixWorldInverse: Array.from(params.cameraMatrixWorldInverse),
		cameraPosition: {
			x: Number.isFinite(params.cameraPosition.x) ? params.cameraPosition.x : 0,
			y: Number.isFinite(params.cameraPosition.y) ? params.cameraPosition.y : 0,
			z: Number.isFinite(params.cameraPosition.z) ? params.cameraPosition.z : 0,
		},
		candidates: params.candidates.slice(),
	}
}

export function computeInstancedLodCullingResult(request: InstancedLodCullingRequest): InstancedLodCullingResponse {
	instancedLodCullingProjView.multiplyMatrices(
		new THREE.Matrix4().fromArray(request.cameraProjectionMatrix),
		new THREE.Matrix4().fromArray(request.cameraMatrixWorldInverse),
	)
	instancedLodCullingFrustum.setFromProjectionMatrix(instancedLodCullingProjView)

	const visibleIds: string[] = []
	const targets: InstancedLodCullingResponse['targets'] = []

	for (let i = 0; i < request.candidates.length; i += 1) {
		const candidate = request.candidates[i]
		if (!candidate) {
			continue
		}

		const { worldPosition, radius } = computeCandidateWorldCenterAndRadius(candidate)
		if (!Number.isFinite(radius) || radius < 0) {
			continue
		}

		if (candidate.enableCulling) {
			instancedLodCullingSphere.center.set(worldPosition.x, worldPosition.y, worldPosition.z)
			instancedLodCullingSphere.radius = radius
			if (!instancedLodCullingFrustum.intersectsSphere(instancedLodCullingSphere)) {
				continue
			}
		}

		visibleIds.push(candidate.nodeId)
		targets.push({
			nodeId: candidate.nodeId,
			target: resolveInstancedLodTargetFromSnapshot({
				sourceAssetId: candidate.sourceAssetId ?? null,
				instanceLayout: candidate.instanceLayout,
				lodProps: candidate.lodProps ?? null,
				worldPosition,
				cameraPosition: request.cameraPosition,
			}),
		})
	}

	return {
		kind: 'cull-instanced-lod-result',
		requestId: request.requestId,
		visibleIds,
		targets,
	}
}
