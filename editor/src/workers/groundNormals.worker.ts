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

	// Accumulate face normals per vertex.
	for (let i = 0; i < indices.length; i += 3) {
		const ia3 = indices[i] * 3
		const ib3 = indices[i + 1] * 3
		const ic3 = indices[i + 2] * 3

		const ax = positions[ia3]
		const ay = positions[ia3 + 1]
		const az = positions[ia3 + 2]

		const bx = positions[ib3]
		const by = positions[ib3 + 1]
		const bz = positions[ib3 + 2]

		const cx = positions[ic3]
		const cy = positions[ic3 + 1]
		const cz = positions[ic3 + 2]

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

		normals[ia3] += nx
		normals[ia3 + 1] += ny
		normals[ia3 + 2] += nz

		normals[ib3] += nx
		normals[ib3 + 1] += ny
		normals[ib3 + 2] += nz

		normals[ic3] += nx
		normals[ic3 + 1] += ny
		normals[ic3 + 2] += nz
	}

	// Normalize.
	for (let i = 0; i < normals.length; i += 3) {
		const x = normals[i]
		const y = normals[i + 1]
		const z = normals[i + 2]
		const lenSq = x * x + y * y + z * z
		const invLen = 1 / Math.sqrt(lenSq || 1)
		normals[i] = x * invLen
		normals[i + 1] = y * invLen
		normals[i + 2] = z * invLen
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
