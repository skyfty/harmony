import {
  PLANNING_IMAGES_RESOLVER_KEY,
  type PlanningImageDisplayEntry,
  type PlanningImageMediaResolver,
  type PlanningImageResolvedMedia,
} from '@schema/components'
import { getPlanningImageBlobByHash } from '@/utils/planningImageStorage'

export async function resolvePlanningImageMedia(entry: PlanningImageDisplayEntry): Promise<PlanningImageResolvedMedia | null> {
  const imageHash = typeof entry.imageHash === 'string' ? entry.imageHash.trim() : ''
  if (imageHash) {
    const blob = await getPlanningImageBlobByHash(imageHash)
    if (blob) {
      const url = URL.createObjectURL(blob)
      return {
        url,
        mimeType: entry.mimeType ?? blob.type ?? null,
        dispose: () => URL.revokeObjectURL(url),
      }
    }
  }

  const sourceUrl = typeof entry.sourceUrl === 'string' ? entry.sourceUrl.trim() : ''
  if (!sourceUrl) {
    return null
  }
  return {
    url: sourceUrl,
    mimeType: entry.mimeType ?? null,
  }
}

export function installPlanningImagesResolver(): void {
  ;(globalThis as typeof globalThis & { [PLANNING_IMAGES_RESOLVER_KEY]?: PlanningImageMediaResolver })[
    PLANNING_IMAGES_RESOLVER_KEY
  ] = resolvePlanningImageMedia
}