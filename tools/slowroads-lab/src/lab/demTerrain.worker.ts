import {
  parseDemTerrain,
  type DemTerrainWorkerRequest,
  type DemTerrainWorkerResponse,
} from '../core/demTerrain'

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<DemTerrainWorkerRequest>) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

workerScope.onmessage = async (event: MessageEvent<DemTerrainWorkerRequest>): Promise<void> => {
  const { demBuffer, sidecar, options } = event.data
  try {
    const result = await parseDemTerrain(demBuffer, sidecar, options)
    const response: DemTerrainWorkerResponse = { ok: true, result }
    workerScope.postMessage(response, [result.grid.heights.buffer])
  } catch (error) {
    const response: DemTerrainWorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    workerScope.postMessage(response, [])
  }
}
