import { ref, reactive, nextTick, type Ref, onBeforeUnmount } from 'vue'
import { clampToRange } from '@/utils/math'
import type { PanelPlacementState } from '@/types/panel-placement-state'

export function useToolbarPositioning(
  viewportEl: Ref<HTMLElement | null>,
  panelVisibility: Ref<{ hierarchy: boolean; inspector: boolean; project: boolean }>,
  panelPlacement: Ref<PanelPlacementState>,
  onUpdate?: () => void
) {
  const TOOLBAR_OFFSET = 12
  const TOOLBAR_MIN_MARGIN = 45
  const VIEWPORT_TOOLBAR_TOP_MARGIN = 16

  const transformToolbarStyle = reactive<{ top: string; left: string }>({
    top: `${TOOLBAR_MIN_MARGIN}px`,
    left: `${TOOLBAR_MIN_MARGIN}px`,
  })

  const viewportToolbarStyle = reactive<{ top: string; left: string }>({
    top: `${VIEWPORT_TOOLBAR_TOP_MARGIN}px`,
    left: '0px',
  })

  const transformToolbarHostRef = ref<HTMLDivElement | null>(null)
  const viewportToolbarHostRef = ref<HTMLDivElement | null>(null)

  let hierarchyPanelObserver: ResizeObserver | null = null
  let inspectorPanelObserver: ResizeObserver | null = null
  let observedHierarchyElement: Element | null = null
  let observedInspectorElement: Element | null = null

  function getHierarchyPanelElement(): HTMLElement | null {
    if (typeof document === 'undefined') {
      return null
    }
    if (!panelVisibility.value.hierarchy) {
      return null
    }
    const placement = panelPlacement.value.hierarchy
    if (placement === 'floating') {
      return document.querySelector('.floating-panel.hierarchy-floating .panel-card') as HTMLElement | null
    }
    return document.querySelector('.panel.hierarchy-panel .panel-card') as HTMLElement | null
  }

  function getInspectorPanelElement(): HTMLElement | null {
    if (typeof document === 'undefined') {
      return null
    }
    if (!panelVisibility.value.inspector) {
      return null
    }
    const placement = panelPlacement.value.inspector
    if (placement === 'floating') {
      return document.querySelector('.floating-panel.inspector-floating .panel-card') as HTMLElement | null
    }
    return document.querySelector('.panel.inspector-panel .panel-card') as HTMLElement | null
  }

  function updateTransformToolbarPosition() {
    const viewport = viewportEl.value
    if (!viewport) {
      return
    }
    const viewportRect = viewport.getBoundingClientRect()
    if (viewportRect.width <= 0 || viewportRect.height <= 0) {
      return
    }

    const panelEl = getHierarchyPanelElement()
    const toolbarEl = transformToolbarHostRef.value
    const toolbarWidth = toolbarEl?.offsetWidth ?? 0
    const toolbarHeight = toolbarEl?.offsetHeight ?? 0

    if (!panelEl) {
      const maxLeftFallback = Math.max(TOOLBAR_MIN_MARGIN, viewportRect.width - toolbarWidth - TOOLBAR_MIN_MARGIN)
      const fallbackLeft = clampToRange(TOOLBAR_MIN_MARGIN, TOOLBAR_MIN_MARGIN, maxLeftFallback)
      transformToolbarStyle.left = `${fallbackLeft}px`
      const maxTopFallback = Math.max(TOOLBAR_MIN_MARGIN, viewportRect.height - toolbarHeight - TOOLBAR_MIN_MARGIN)
      const fallbackTop = clampToRange(TOOLBAR_MIN_MARGIN, TOOLBAR_MIN_MARGIN, maxTopFallback)
      transformToolbarStyle.top = `${fallbackTop}px`
      return
    }

    const panelRect = panelEl.getBoundingClientRect()
    const maxLeft = Math.max(TOOLBAR_MIN_MARGIN, viewportRect.width - toolbarWidth - TOOLBAR_MIN_MARGIN)
    const maxTop = Math.max(TOOLBAR_MIN_MARGIN, viewportRect.height - toolbarHeight - TOOLBAR_MIN_MARGIN)
    const candidateLeft = panelRect.right - viewportRect.left + TOOLBAR_OFFSET
    const candidateTop = panelRect.top - viewportRect.top + TOOLBAR_OFFSET
    const computedLeft = clampToRange(candidateLeft, TOOLBAR_MIN_MARGIN, maxLeft)
    const computedTop = clampToRange(candidateTop, TOOLBAR_MIN_MARGIN, maxTop)
    transformToolbarStyle.left = `${computedLeft}px`
    transformToolbarStyle.top = `${computedTop}px`
  }

  function updateViewportToolbarPosition() {
    const viewport = viewportEl.value
    const toolbarEl = viewportToolbarHostRef.value
    if (!viewport || !toolbarEl) {
      return
    }

    const viewportRect = viewport.getBoundingClientRect()
    if (viewportRect.width <= 0 || viewportRect.height <= 0) {
      return
    }

    const toolbarWidth = toolbarEl.offsetWidth
    const toolbarHeight = toolbarEl.offsetHeight

    const centeredLeft = (viewportRect.width - toolbarWidth) / 2
    const maxLeft = Math.max(TOOLBAR_MIN_MARGIN, viewportRect.width - toolbarWidth - TOOLBAR_MIN_MARGIN)
    const resolvedLeft = clampToRange(centeredLeft, TOOLBAR_MIN_MARGIN, maxLeft)

    const maxTop = Math.max(VIEWPORT_TOOLBAR_TOP_MARGIN, viewportRect.height - toolbarHeight - VIEWPORT_TOOLBAR_TOP_MARGIN)
    const resolvedTop = clampToRange(VIEWPORT_TOOLBAR_TOP_MARGIN, VIEWPORT_TOOLBAR_TOP_MARGIN, maxTop)

    viewportToolbarStyle.left = `${resolvedLeft}px`
    viewportToolbarStyle.top = `${resolvedTop}px`
  }

  function scheduleToolbarUpdate() {
    nextTick(() => {
      const update = () => {
        updateTransformToolbarPosition()
        updateViewportToolbarPosition()
        refreshPanelObservers()
        if (onUpdate) {
          onUpdate()
        }
      }

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(update)
      } else {
        update()
      }
    })
  }

  function refreshPanelObservers() {
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const hierarchyEl = getHierarchyPanelElement()
    if (observedHierarchyElement !== hierarchyEl) {
      if (hierarchyPanelObserver && observedHierarchyElement) {
        hierarchyPanelObserver.unobserve(observedHierarchyElement)
      }
      observedHierarchyElement = hierarchyEl
      if (hierarchyEl) {
        if (!hierarchyPanelObserver) {
          hierarchyPanelObserver = new ResizeObserver(() => scheduleToolbarUpdate())
        }
        hierarchyPanelObserver.observe(hierarchyEl)
      }
    }

    const inspectorEl = getInspectorPanelElement()
    if (observedInspectorElement !== inspectorEl) {
      if (inspectorPanelObserver && observedInspectorElement) {
        inspectorPanelObserver.unobserve(observedInspectorElement)
      }
      observedInspectorElement = inspectorEl
      if (inspectorEl) {
        if (!inspectorPanelObserver) {
          inspectorPanelObserver = new ResizeObserver(() => scheduleToolbarUpdate())
        }
        inspectorPanelObserver.observe(inspectorEl)
      }
    }
  }

  onBeforeUnmount(() => {
    if (hierarchyPanelObserver) hierarchyPanelObserver.disconnect()
    if (inspectorPanelObserver) inspectorPanelObserver.disconnect()
  })

  return {
    transformToolbarStyle,
    viewportToolbarStyle,
    transformToolbarHostRef,
    viewportToolbarHostRef,
    scheduleToolbarUpdate,
    refreshPanelObservers
  }
}
