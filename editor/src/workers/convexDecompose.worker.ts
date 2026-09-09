/// <reference lib="webworker" />

import { ConvexMeshDecomposition } from 'vhacd-js'
import type {
  ConvexDecomposeWorkerRequest,
  ConvexDecomposeWorkerResponse,
  ConvexHullMesh,
} from '../utils/convexDecompose'

let decomposerPromise: ReturnType<typeof ConvexMeshDecomposition.create> | null = null

function getDecomposer(): ReturnType<typeof ConvexMeshDecomposition.create> {
  if (!decomposerPromise) {
    decomposerPromise = ConvexMeshDecomposition.create()
  }
  return decomposerPromise
}

self.onmessage = async (event: MessageEvent<ConvexDecomposeWorkerRequest>) => {
  const message = event.data
  if (!message || message.__type !== 'convex-decompose-request') {
    return
  }
  try {
    const decomposer = await getDecomposer()
    const hulls = decomposer.computeConvexHulls(
      {
        positions: message.positions,
        indices: message.indices,
      },
      message.options,
    )
    const transferables: ArrayBuffer[] = []
    const normalizedHulls: ConvexHullMesh[] = (Array.isArray(hulls) ? hulls : []).map((hull) => {
      const positions = hull.positions.slice(0) as Float64Array
      const indices = hull.indices.slice(0) as Uint32Array
      transferables.push(positions.buffer as ArrayBuffer, indices.buffer as ArrayBuffer)
      return { positions, indices }
    })
    const response: ConvexDecomposeWorkerResponse = {
      __type: 'convex-decompose-result',
      requestId: message.requestId,
      hulls: normalizedHulls,
    }
    self.postMessage(response, transferables)
  } catch (error) {
    const response: ConvexDecomposeWorkerResponse = {
      __type: 'convex-decompose-error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
}
