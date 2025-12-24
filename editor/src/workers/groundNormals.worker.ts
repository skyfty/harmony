/// <reference lib="webworker" />

type IndexType = 'u16' | 'u32'

type ComputeNormalsRequest = {
	kind: 'compute-normals'
	requestId: number
	chunks: Array<{
		key: string
		positions: ArrayBuffer
		indices: ArrayBuffer
		indexType: IndexType
	}>
}

type ComputeNormalsResponse = {
	kind: 'compute-normals-result'
	requestId: number
	results: Array<{
		key: string
		normals: ArrayBuffer
	}>
	error?: string
}

function computeVertexNormalsIndexed(
	positions: Float32Array,
	indices: Uint16Array | Uint32Array,
): Float32Array {
	const normals = new Float32Array(positions.length)
	for (let i = 0; i < indices.length; i += 3) {
		const ia = indices[i]!
		const ib = indices[i + 1]!
		const ic = indices[i + 2]!

		const ax = positions[ia * 3] ?? 0
		const ay = positions[ia * 3 + 1] ?? 0
		const az = positions[ia * 3 + 2] ?? 0

		const bx = positions[ib * 3] ?? 0
		const by = positions[ib * 3 + 1] ?? 0
		const bz = positions[ib * 3 + 2] ?? 0

		const cx = positions[ic * 3] ?? 0
		const cy = positions[ic * 3 + 1] ?? 0
		const cz = positions[ic * 3 + 2] ?? 0

		const abx = bx - ax
		const aby = by - ay
		const abz = bz - az

		const acx = cx - ax
		const acy = cy - ay
		const acz = cz - az

		// Face normal = AB x AC
		const nx = aby * acz - abz * acy
		const ny = abz * acx - abx * acz
		const nz = abx * acy - aby * acx

		normals[ia * 3] = (normals[ia * 3] ?? 0) + nx
		normals[ia * 3 + 1] = (normals[ia * 3 + 1] ?? 0) + ny
		normals[ia * 3 + 2] = (normals[ia * 3 + 2] ?? 0) + nz

		normals[ib * 3] = (normals[ib * 3] ?? 0) + nx
		normals[ib * 3 + 1] = (normals[ib * 3 + 1] ?? 0) + ny
		normals[ib * 3 + 2] = (normals[ib * 3 + 2] ?? 0) + nz

		normals[ic * 3] = (normals[ic * 3] ?? 0) + nx
		normals[ic * 3 + 1] = (normals[ic * 3 + 1] ?? 0) + ny
		normals[ic * 3 + 2] = (normals[ic * 3 + 2] ?? 0) + nz
	}

	for (let i = 0; i < normals.length; i += 3) {
		const x = normals[i] ?? 0
		const y = normals[i + 1] ?? 0
		const z = normals[i + 2] ?? 0
		const len = Math.hypot(x, y, z) || 1
		normals[i] = x / len
		normals[i + 1] = y / len
		normals[i + 2] = z / len
	}

	return normals
}

self.onmessage = (event: MessageEvent<ComputeNormalsRequest>) => {
	const message = event.data
	if (!message || message.kind !== 'compute-normals') {
		return
	}

	try {
		const results: ComputeNormalsResponse['results'] = []
		for (const chunk of message.chunks) {
			const positions = new Float32Array(chunk.positions)
			const indices = chunk.indexType === 'u16'
				? new Uint16Array(chunk.indices)
				: new Uint32Array(chunk.indices)

			const normals = computeVertexNormalsIndexed(positions, indices)
			results.push({ key: chunk.key, normals: normals.buffer as ArrayBuffer })
		}

		const response: ComputeNormalsResponse = {
			kind: 'compute-normals-result',
			requestId: message.requestId,
			results,
		}
		self.postMessage(response, results.map((r) => r.normals))
	} catch (error) {
		const response: ComputeNormalsResponse = {
			kind: 'compute-normals-result',
			requestId: message.requestId,
			results: [],
			error: error instanceof Error ? error.message : String(error),
		}
		self.postMessage(response)
	}
}
