import type { PointerCaptureGuard } from './pointerCaptureGuard'
import type { PointerInteractionSession } from '@/types/pointer-interaction'

export function usePointerInteractionStateMachine(options: {
  pointerCaptureGuard: PointerCaptureGuard
  clickDragThresholdPx: number
}) {
  let session: PointerInteractionSession | null = null

  const ensureMovedForPointerEvent = (event: PointerEvent): boolean => {
    if (!session || session.pointerId !== event.pointerId) {
      return false
    }
    if (session.moved) {
      return true
    }
    const dx = event.clientX - session.startX
    const dy = event.clientY - session.startY
    if (Math.hypot(dx, dy) >= options.clickDragThresholdPx) {
      session.moved = true
      return true
    }
    return false
  }

  return {
    get: () => session,

    beginRepairClick(event: PointerEvent) {
      session = {
        kind: 'repairClick',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      }
      return session
    },

    beginBuildToolRightClick(event: PointerEvent, extra: { roadCancelEligible: boolean }) {
      session = {
        kind: 'buildToolRightClick',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        roadCancelEligible: Boolean(extra.roadCancelEligible),
      }
      return session
    },

    updateMoved(event: PointerEvent) {
      ensureMovedForPointerEvent(event)
    },

    /** Ensures `moved` is up-to-date for pointer-up without any intermediate move events. */
    ensureMoved(event: PointerEvent): boolean {
      return ensureMovedForPointerEvent(event)
    },

    clearIfPointer(pointerId: number) {
      if (session?.pointerId === pointerId) {
        session = null
        return true
      }
      return false
    },

    clearIfKind(kind: PointerInteractionSession['kind']) {
      if (session?.kind === kind) {
        session = null
        return true
      }
      return false
    },

    capture(pointerId: number) {
      return options.pointerCaptureGuard.capture(pointerId)
    },

    releaseIfCaptured(pointerId: number) {
      return options.pointerCaptureGuard.releaseIfCaptured(pointerId)
    },

    /** Best-effort: always attempt release for symmetry, regardless of internal bookkeeping. */
    release(pointerId: number) {
      return options.pointerCaptureGuard.release(pointerId)
    },
  }
}
