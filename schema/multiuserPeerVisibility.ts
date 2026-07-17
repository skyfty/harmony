import type { SceneJsonExportDocument, SceneNode, SceneNodeComponentState } from './core'
import {
  ONLINE_COMPONENT_TYPE,
  clampOnlineComponentProps,
  type OnlineComponentProps,
} from './components/definitions/onlineComponent'
import type { MultiuserPeerState } from './multiuserContext'

export const DEFAULT_REMOTE_MULTIUSER_VISIBLE_PEERS = 6
export const REMOTE_MULTIUSER_ENTER_GRACE_FRAMES = 1
export const REMOTE_MULTIUSER_EXIT_GRACE_FRAMES = 2
export const REMOTE_MULTIUSER_MIN_RESIDENCY_FRAMES = 8

export interface RemoteMultiuserPeerVisibilityState {
  visible: boolean
  lastInFrustumFrame: number
  lastOutFrustumFrame: number
  visibleSinceFrame: number
}

export function createRemoteMultiuserPeerVisibilityState(): RemoteMultiuserPeerVisibilityState {
  return {
    visible: false,
    lastInFrustumFrame: -1,
    lastOutFrustumFrame: 0,
    visibleSinceFrame: 0,
  }
}

export function markRemoteMultiuserPeerVisible(
  state: RemoteMultiuserPeerVisibilityState,
  frameIndex: number,
): void {
  if (!state.visible) {
    state.visible = true
    state.visibleSinceFrame = frameIndex
  } else if (state.visibleSinceFrame <= 0) {
    state.visibleSinceFrame = frameIndex
  }
}

export function markRemoteMultiuserPeerHidden(state: RemoteMultiuserPeerVisibilityState): void {
  state.visible = false
}

export function shouldKeepRemoteMultiuserPeerVisible(
  state: RemoteMultiuserPeerVisibilityState,
  frameIndex: number,
): boolean {
  const enteredRecently = state.lastInFrustumFrame > 0
    && frameIndex - state.lastInFrustumFrame <= REMOTE_MULTIUSER_ENTER_GRACE_FRAMES
  if (enteredRecently) {
    return true
  }
  if (!state.visible) {
    return false
  }
  if (frameIndex - state.visibleSinceFrame <= REMOTE_MULTIUSER_MIN_RESIDENCY_FRAMES) {
    return true
  }
  return frameIndex - state.lastOutFrustumFrame <= REMOTE_MULTIUSER_EXIT_GRACE_FRAMES
}

export function getRemoteMultiuserPeerSelectionRadius(state: MultiuserPeerState): number {
  if (state.subjectType === 'vehicle' || state.subjectType === 'ship' || state.subjectType === 'aircraft') {
    return 4.5
  }
  if (state.subjectType === 'character') {
    return 2.2
  }
  return 2.5
}

export function resolveMultiuserVisiblePeerLimit(document: SceneJsonExportDocument | null): number {
  if (!document?.nodes?.length) {
    return DEFAULT_REMOTE_MULTIUSER_VISIBLE_PEERS
  }
  const stack: SceneNode[] = [...document.nodes]
  while (stack.length) {
    const node = stack.pop()
    if (!node) {
      continue
    }
    const component = node.components?.[ONLINE_COMPONENT_TYPE] as SceneNodeComponentState<OnlineComponentProps> | undefined
    if (component && component.enabled !== false) {
      return clampOnlineComponentProps(component.props).maxVisiblePeers
    }
    if (Array.isArray(node.children) && node.children.length) {
      stack.push(...node.children)
    }
  }
  return DEFAULT_REMOTE_MULTIUSER_VISIBLE_PEERS
}
