/// <reference lib="webworker" />

import {
  buildPlanningDemTerrainConversion,
  buildPlanningDemTerrainConversionWorkerResponse,
  buildPlanningDemTerrainDataset,
  buildPlanningDemTerrainDatasetWorkerResponse,
  collectPlanningDemTerrainConversionWorkerTransferables,
  collectPlanningDemTerrainDatasetWorkerTransferables,
  type PlanningDemTerrainConversionWorkerRequest,
  type PlanningDemTerrainConversionWorkerResponse,
  type PlanningDemTerrainConversionWorkerProgressResponse,
  type PlanningDemTerrainDatasetWorkerRequest,
  type PlanningDemTerrainDatasetWorkerResponse,
} from '@/utils/planningDemTerrainDataset'

self.onmessage = (event: MessageEvent<PlanningDemTerrainDatasetWorkerRequest | PlanningDemTerrainConversionWorkerRequest>) => {
  const message = event.data
  if (!message) {
    return
  }

  void (async () => {
    try {
      if (message.kind === 'build-planning-dem-terrain-conversion') {
        const result = await buildPlanningDemTerrainConversion({
          ...message.options,
          onProgress: (progress) => {
            const progressResponse: PlanningDemTerrainConversionWorkerProgressResponse = {
              kind: 'build-planning-dem-terrain-conversion-progress',
              requestId: message.requestId,
              progress,
            }
            self.postMessage(progressResponse)
          },
        })
        const response = buildPlanningDemTerrainConversionWorkerResponse(message.requestId, result)
        self.postMessage(response, collectPlanningDemTerrainConversionWorkerTransferables(result))
        return
      }

      if (message.kind === 'build-planning-dem-terrain-dataset') {
        const result = await buildPlanningDemTerrainDataset(message.options)
        const response = buildPlanningDemTerrainDatasetWorkerResponse(message.requestId, result)
        self.postMessage(response, collectPlanningDemTerrainDatasetWorkerTransferables(result))
      }
    } catch (error) {
      const response: PlanningDemTerrainDatasetWorkerResponse | PlanningDemTerrainConversionWorkerResponse = message.kind === 'build-planning-dem-terrain-conversion'
        ? {
            kind: 'build-planning-dem-terrain-conversion-result',
            requestId: message.requestId,
            result: null,
            error: error instanceof Error ? error.message : String(error),
          }
        : {
            kind: 'build-planning-dem-terrain-dataset-result',
            requestId: message.requestId,
            result: null,
            error: error instanceof Error ? error.message : String(error),
          }
      self.postMessage(response)
    }
  })()
}
