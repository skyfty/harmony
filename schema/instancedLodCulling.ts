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
	worldPosition: { x: number; y: number; z: number }
	radius: number
}

export type InstancedLodStaticCandidateSnapshot = {
	nodeId: string
	sourceAssetId: InstancedLodSelectionSnapshot['sourceAssetId']
	instanceLayout: InstancedLodSelectionSnapshot['instanceLayout']
	lodProps: InstancedLodSelectionSnapshot['lodProps']
}

export type InstancedLodFrameCandidateSnapshot = {
	index: number
	enableCulling: boolean
	worldPosition: { x: number; y: number; z: number }
	radius: number
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
	worldPositionOverride?: { x: number; y: number; z: number } | null
	radiusOverride?: number | null
	sourceAssetId?: InstancedLodSelectionSnapshot['sourceAssetId']
	instanceLayout?: InstancedLodSelectionSnapshot['instanceLayout']
	lodProps?: InstancedLodSelectionSnapshot['lodProps']
	worldPosition?: InstancedLodSelectionSnapshot['worldPosition']
	cameraPosition?: InstancedLodSelectionSnapshot['cameraPosition']
}): InstancedLodCullingCandidateSnapshot {
	const computed = computeCandidateWorldCenterAndRadius({
		matrixWorld: params.matrixWorld,
		bounds: params.bounds,
		radiusHint: params.radiusHint,
	})
	const worldPosition = params.worldPositionOverride ?? computed.worldPosition
	const radius = Number.isFinite(params.radiusOverride ?? NaN) && (params.radiusOverride ?? 0) > 0
		? (params.radiusOverride as number)
		: computed.radius
	return {
		nodeId: typeof params.nodeId === 'string' ? params.nodeId : '',
		enableCulling: params.enableCulling === true,
		worldPosition,
		radius,
		sourceAssetId: params.sourceAssetId ?? null,
		instanceLayout: params.instanceLayout ?? null,
		lodProps: params.lodProps ?? null,
		cameraPosition: params.cameraPosition ?? null,
	}
}

export type InstancedLodCullingRequest = {
	kind: 'cull-instanced-lod'
	requestId: number
	cameraProjectionMatrix: Float32Array
	cameraMatrixWorldInverse: Float32Array
	cameraPosition: Float32Array
	candidateCount: number
	candidateIndices: Uint32Array
	candidateEnableCulling: Uint8Array
	candidateWorldPositions: Float32Array
	candidateRadii: Float32Array
}

export type InstancedLodCullingSyncRequest = {
	kind: 'sync-instanced-lod-candidates'
	revision: number
	candidates: InstancedLodStaticCandidateSnapshot[]
}

export type InstancedLodCullingResponse = {
	kind: 'cull-instanced-lod-result'
	requestId: number
	visibleIndices: Uint32Array
	targetKinds: Uint8Array
	targetAssetIds: Array<string | null>
	targetSourceModelAssetIds: Array<string | null>
	targetFaceCameras: Uint8Array
	targetForwardAxes: Array<InstancedLodTarget['forwardAxis'] | null>
	targetKeys: Array<string | null>
	error?: string
}

export function buildInstancedLodTargetFromParallelSnapshot(params: {
	kind: number
	assetId: string | null
	sourceModelAssetId: string | null
	faceCamera: boolean
	forwardAxis: InstancedLodTarget['forwardAxis'] | null
	key: string | null
}): InstancedLodTarget {
	return {
		kind: params.kind === 1 ? 'billboard' : 'model',
		assetId: params.assetId,
		sourceModelAssetId: params.sourceModelAssetId,
		faceCamera: params.faceCamera === true,
		forwardAxis: params.forwardAxis ?? 'z',
		key: params.key,
	}
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

function computeCandidateWorldCenterAndRadius(candidate: {
	matrixWorld: ArrayLike<number>
	bounds: InstancedLodBoundsSnapshot
	radiusHint?: number | null
}): {
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
	candidates: InstancedLodFrameCandidateSnapshot[]
}): InstancedLodCullingRequest {
	const candidateCount = Math.max(0, Math.trunc(params.candidates.length))
	const candidateIndices = new Uint32Array(candidateCount)
	const candidateEnableCulling = new Uint8Array(candidateCount)
	const candidateWorldPositions = new Float32Array(candidateCount * 3)
	const candidateRadii = new Float32Array(candidateCount)

	for (let i = 0; i < candidateCount; i += 1) {
		const candidate = params.candidates[i]
		if (!candidate) {
			continue
		}
		candidateIndices[i] = Number.isFinite(candidate.index) && candidate.index >= 0 ? Math.trunc(candidate.index) : 0
		candidateEnableCulling[i] = candidate.enableCulling === true ? 1 : 0
		candidateWorldPositions[i * 3] = Number.isFinite(candidate.worldPosition.x) ? candidate.worldPosition.x : 0
		candidateWorldPositions[i * 3 + 1] = Number.isFinite(candidate.worldPosition.y) ? candidate.worldPosition.y : 0
		candidateWorldPositions[i * 3 + 2] = Number.isFinite(candidate.worldPosition.z) ? candidate.worldPosition.z : 0
		candidateRadii[i] = Number.isFinite(candidate.radius) && candidate.radius > 0 ? candidate.radius : 0
	}

	return {
		kind: 'cull-instanced-lod',
		requestId: params.requestId,
		cameraProjectionMatrix: Float32Array.from(params.cameraProjectionMatrix),
		cameraMatrixWorldInverse: Float32Array.from(params.cameraMatrixWorldInverse),
		cameraPosition: Float32Array.from([
			Number.isFinite(params.cameraPosition.x) ? params.cameraPosition.x : 0,
			Number.isFinite(params.cameraPosition.y) ? params.cameraPosition.y : 0,
			Number.isFinite(params.cameraPosition.z) ? params.cameraPosition.z : 0,
		]),
		candidateCount,
		candidateIndices,
		candidateEnableCulling,
		candidateWorldPositions,
		candidateRadii,
	}
}

export function buildInstancedLodCullingSyncRequest(params: {
	revision: number
	candidates: InstancedLodStaticCandidateSnapshot[]
}): InstancedLodCullingSyncRequest {
	return {
		kind: 'sync-instanced-lod-candidates',
		revision: Number.isFinite(params.revision) ? Math.max(0, Math.trunc(params.revision)) : 0,
		candidates: params.candidates.map((candidate) => ({
			nodeId: typeof candidate.nodeId === 'string' ? candidate.nodeId : '',
			sourceAssetId: candidate.sourceAssetId ?? null,
			instanceLayout: candidate.instanceLayout ?? null,
			lodProps: candidate.lodProps ?? null,
		})),
	}
}

export function computeInstancedLodCullingResult(
	request: InstancedLodCullingRequest,
	staticCandidatesByIndex?: ReadonlyArray<InstancedLodStaticCandidateSnapshot>,
): InstancedLodCullingResponse {
	instancedLodCullingProjView.multiplyMatrices(
		new THREE.Matrix4().fromArray(request.cameraProjectionMatrix),
		new THREE.Matrix4().fromArray(request.cameraMatrixWorldInverse),
	)
	instancedLodCullingFrustum.setFromProjectionMatrix(instancedLodCullingProjView)

	const visibleIndices: number[] = []
	const targetKinds: number[] = []
	const targetAssetIds: Array<string | null> = []
	const targetSourceModelAssetIds: Array<string | null> = []
	const targetFaceCameras: number[] = []
	const targetForwardAxes: Array<InstancedLodTarget['forwardAxis'] | null> = []
	const targetKeys: Array<string | null> = []
	const cameraPosition = {
		x: request.cameraPosition[0] ?? 0,
		y: request.cameraPosition[1] ?? 0,
		z: request.cameraPosition[2] ?? 0,
	}

	const candidateCount = Math.max(
		0,
		Math.min(
			Math.trunc(request.candidateCount ?? 0),
			request.candidateIndices.length,
			request.candidateEnableCulling.length,
			Math.floor(request.candidateWorldPositions.length / 3),
			request.candidateRadii.length,
		),
	)

	for (let i = 0; i < candidateCount; i += 1) {
		const index = request.candidateIndices[i] ?? 0
		if (!Number.isFinite(index)) {
			continue
		}
		const candidateIndex = Math.trunc(index)
		if (candidateIndex < 0) {
			continue
		}

		const worldPosition = {
			x: request.candidateWorldPositions[i * 3] ?? 0,
			y: request.candidateWorldPositions[i * 3 + 1] ?? 0,
			z: request.candidateWorldPositions[i * 3 + 2] ?? 0,
		}
		const radius = request.candidateRadii[i] ?? 0
		if (!Number.isFinite(radius) || radius < 0) {
			continue
		}

		if ((request.candidateEnableCulling[i] ?? 0) === 1) {
			instancedLodCullingSphere.center.set(worldPosition.x, worldPosition.y, worldPosition.z)
			instancedLodCullingSphere.radius = radius
			if (!instancedLodCullingFrustum.intersectsSphere(instancedLodCullingSphere)) {
				continue
			}
		}

		const staticCandidate = staticCandidatesByIndex?.[candidateIndex] ?? null
		const nodeId = staticCandidate?.nodeId ?? ''
		if (!nodeId) {
			continue
		}
		visibleIndices.push(candidateIndex)
		const target = resolveInstancedLodTargetFromSnapshot({
			sourceAssetId: staticCandidate?.sourceAssetId ?? null,
			instanceLayout: staticCandidate?.instanceLayout ?? null,
			lodProps: staticCandidate?.lodProps ?? null,
			worldPosition,
			cameraPosition,
		})
		targetKinds.push(target.kind === 'billboard' ? 1 : 0)
		targetAssetIds.push(target.assetId)
		targetSourceModelAssetIds.push(target.sourceModelAssetId)
		targetFaceCameras.push(target.faceCamera === true ? 1 : 0)
		targetForwardAxes.push(target.forwardAxis)
		targetKeys.push(target.key)
	}

	return {
		kind: 'cull-instanced-lod-result',
		requestId: request.requestId,
		visibleIndices: Uint32Array.from(visibleIndices),
		targetKinds: Uint8Array.from(targetKinds),
		targetAssetIds,
		targetSourceModelAssetIds,
		targetFaceCameras: Uint8Array.from(targetFaceCameras),
		targetForwardAxes,
		targetKeys,
	}
}
