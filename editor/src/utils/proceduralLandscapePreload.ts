import {
  resolveDocumentEnvironment,
  type SceneJsonExportDocument,
  type SceneSlowroadsTexturePreload,
} from '@schema/core'
import { collectProceduralLandscapeTexturePreloadForNodes } from '@schema/proceduralLandscape/preload'

export function buildProceduralLandscapeTexturePreload(
  document: Pick<SceneJsonExportDocument, 'nodes' | 'environment'>,
): SceneSlowroadsTexturePreload | undefined {
  const season = resolveDocumentEnvironment(document as SceneJsonExportDocument).slowroads.season
  return collectProceduralLandscapeTexturePreloadForNodes(document.nodes, season)
}

/** Add/refresh landscape texture hints on a runtime scene document. */
export function ensureProceduralLandscapeTexturePreload(
  document: SceneJsonExportDocument,
): SceneSlowroadsTexturePreload | undefined {
  const preload = buildProceduralLandscapeTexturePreload(document)
  if (!preload) {
    if (document.assetPreload) {
      delete document.assetPreload.slowroadsTextures
    }
    return undefined
  }

  document.assetPreload = {
    ...(document.assetPreload ?? { mesh: { all: [] } }),
    mesh: document.assetPreload?.mesh ?? { all: [] },
    slowroadsTextures: preload,
  }
  return preload
}
