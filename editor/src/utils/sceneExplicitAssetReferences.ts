import type { BehaviorComponentProps, SceneBehavior } from '@schema'
import {
  BEHAVIOR_COMPONENT_TYPE,
  BILLBOARD_COMPONENT_TYPE,
  DISPLAY_BOARD_COMPONENT_TYPE,
  LOD_COMPONENT_TYPE,
  type BillboardComponentProps,
  type DisplayBoardComponentProps,
  type LodComponentProps,
} from '@schema/components'

export interface ExplicitSceneAssetReference {
  assetId: string | null | undefined
  path: string
}

function visitLodAssetReferences(
  props: Partial<LodComponentProps> | null | undefined,
  visit: (reference: ExplicitSceneAssetReference) => void,
): void {
  if (!Array.isArray(props?.levels)) {
    return
  }
  props.levels.forEach((level, index) => {
    visit({
      assetId: level?.modelAssetId,
      path: `levels[${index}].modelAssetId`,
    })
    visit({
      assetId: level?.billboardAssetId,
      path: `levels[${index}].billboardAssetId`,
    })
  })
}

function visitDisplayAssetReference(
  props: Partial<DisplayBoardComponentProps> | Partial<BillboardComponentProps> | null | undefined,
  visit: (reference: ExplicitSceneAssetReference) => void,
): void {
  visit({
    assetId: props?.assetId,
    path: 'assetId',
  })
}

function visitBehaviorAssetReferences(
  props: Partial<BehaviorComponentProps> | null | undefined,
  visit: (reference: ExplicitSceneAssetReference) => void,
): void {
  const behaviors = Array.isArray(props?.behaviors) ? (props.behaviors as SceneBehavior[]) : []
  behaviors.forEach((behavior, index) => {
    const script = behavior?.script
    if (!script) {
      return
    }
    if (script.type === 'showAlert') {
      visit({
        assetId: (script.params as { contentAssetId?: string | null } | null | undefined)?.contentAssetId,
        path: `behaviors[${index}].script.params.contentAssetId`,
      })
      return
    }
    if (script.type === 'lantern') {
      const slides = Array.isArray((script.params as { slides?: unknown[] } | null | undefined)?.slides)
        ? ((script.params as { slides: Array<{ descriptionAssetId?: string | null; imageAssetId?: string | null }> }).slides)
        : []
      slides.forEach((slide, slideIndex) => {
        visit({
          assetId: slide?.descriptionAssetId,
          path: `behaviors[${index}].script.params.slides[${slideIndex}].descriptionAssetId`,
        })
        visit({
          assetId: slide?.imageAssetId,
          path: `behaviors[${index}].script.params.slides[${slideIndex}].imageAssetId`,
        })
      })
    }
  })
}

export function visitExplicitComponentAssetReferences(
  componentType: string,
  props: Record<string, unknown> | null | undefined,
  visit: (reference: ExplicitSceneAssetReference) => void,
): void {
  switch (componentType) {
    case LOD_COMPONENT_TYPE:
      visitLodAssetReferences(props as Partial<LodComponentProps> | null | undefined, visit)
      return
    case DISPLAY_BOARD_COMPONENT_TYPE:
      visitDisplayAssetReference(props as Partial<DisplayBoardComponentProps> | null | undefined, visit)
      return
    case BILLBOARD_COMPONENT_TYPE:
      visitDisplayAssetReference(props as Partial<BillboardComponentProps> | null | undefined, visit)
      return
    case BEHAVIOR_COMPONENT_TYPE:
      visitBehaviorAssetReferences(props as Partial<BehaviorComponentProps> | null | undefined, visit)
      return
    default:
      return
  }
}