import type { EditorTool } from '@/types/editor-tool'
import type * as THREE from 'three'
import { createFaceSnapManager } from './faceSnap'
import { createSurfaceSnapController, type SurfaceSnapController } from './surfaceSnap'

export type FaceSnapControllerOptions = {
  getScene(): THREE.Scene | null
  objectMap: Map<string, THREE.Object3D>
  getActiveTool(): EditorTool
  isEditableKeyboardTarget(target: EventTarget | null): boolean
}

export type FaceSnapController = {
  handleKeyDown(event: KeyboardEvent): void
  handleKeyUp(event: KeyboardEvent): void
  handleBlur(): void
  setCommitActive(active: boolean): void
  ensureEffectPool(): void
  updateEffectIntensity(delta: number): void
  hideEffect(): void
  applyAlignmentSnap(target: THREE.Object3D, movementDelta: THREE.Vector3, excludedIds: Set<string>): void
  dispose(): void
}

export function createFaceSnapController(options: FaceSnapControllerOptions): FaceSnapController {
  const manager = createFaceSnapManager(options)
  return {
    handleKeyDown: manager.handleKeyDown,
    handleKeyUp: manager.handleKeyUp,
    handleBlur: manager.handleBlur,
    setCommitActive: manager.setCommitActive,
    ensureEffectPool: manager.ensureEffectPool,
    updateEffectIntensity: manager.updateEffectIntensity,
    hideEffect: manager.hideEffect,
    applyAlignmentSnap: manager.applyAlignmentSnap,
    dispose: manager.dispose,
  }
}

export { createSurfaceSnapController }
export type { SurfaceSnapController }
