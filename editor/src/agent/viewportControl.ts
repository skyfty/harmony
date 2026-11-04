import type {
  HarmonyCameraSetRequest,
  HarmonyCameraSetResult,
  HarmonyCameraState,
  HarmonyToolSetRequest,
  HarmonyToolSetResult,
  HarmonyToolState,
} from '@schema/editorAgentProtocol'
import { AgentBridgeError } from '@/agent/errors'

export interface HarmonyAgentViewportController {
  getCameraState: () => HarmonyCameraState
  setCameraState: (request: HarmonyCameraSetRequest) => Promise<HarmonyCameraSetResult>
  getToolState: () => HarmonyToolState
  setActiveTool: (request: HarmonyToolSetRequest) => Promise<HarmonyToolSetResult>
}

let activeController: HarmonyAgentViewportController | null = null

export function registerHarmonyAgentViewportController(
  controller: HarmonyAgentViewportController,
): () => void {
  activeController = controller
  return () => {
    if (activeController === controller) {
      activeController = null
    }
  }
}

function requireController(): HarmonyAgentViewportController {
  if (!activeController) {
    throw new AgentBridgeError(
      'OPERATION_NOT_SUPPORTED',
      'The Editor viewport controller is not ready',
    )
  }
  return activeController
}

export function getAgentCameraState(): HarmonyCameraState {
  return requireController().getCameraState()
}

export function setAgentCameraState(request: HarmonyCameraSetRequest): Promise<HarmonyCameraSetResult> {
  return requireController().setCameraState(request)
}

export function getAgentToolState(): HarmonyToolState {
  return requireController().getToolState()
}

export function setAgentTool(request: HarmonyToolSetRequest): Promise<HarmonyToolSetResult> {
  return requireController().setActiveTool(request)
}
