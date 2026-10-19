import { PROCEDURAL_LANDSCAPE_COMPONENT_TYPE } from '@schema/components'

type RuntimeDocumentNode = {
  components?: Record<string, unknown>
  children?: RuntimeDocumentNode[]
}

type RuntimeDocument = {
  nodes?: RuntimeDocumentNode[]
}

/**
 * Runtime exports must retain the orthophoto URL for aerial and blended
 * terrain, but not for procedural-only shading. The original editor document
 * is never modified.
 */
export function stripInactiveDemOrthoReferences(
  document: RuntimeDocument,
): void {
  const stack = Array.isArray(document.nodes) ? [...document.nodes] : []
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    const component = node.components?.[PROCEDURAL_LANDSCAPE_COMPONENT_TYPE] as
      | {
          props?: {
            dem?: {
              assetId?: string | null
              runtimeOrthoUrl?: string | null
              runtimeOrthoBytes?: number | null
            }
            surface?: { enabled?: boolean; baseMapMode?: string }
          }
        }
      | undefined
    const dem = component?.props?.dem
    const surface = component?.props?.surface
    if (
      dem?.assetId
      && (
        surface?.enabled === false
        || (surface?.baseMapMode !== 'blend' && surface?.baseMapMode !== 'aerial')
      )
    ) {
      dem.runtimeOrthoUrl = null
      dem.runtimeOrthoBytes = null
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }
}
