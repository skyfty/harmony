import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveAutoTourManualTakeoverKind,
} from '../common/utils/autoTourManualTakeover.ts'

const eligibleCanvasPress = {
  activeVehicleTour: false,
  activeCharacterTour: false,
  canvasTarget: true,
  primaryPointer: true,
  primaryButton: true,
  padActive: false,
  takeoverBlocked: false,
}

test('vehicle auto-tour takes priority over character auto-tour', () => {
  assert.equal(resolveAutoTourManualTakeoverKind({
    ...eligibleCanvasPress,
    activeVehicleTour: true,
    activeCharacterTour: true,
  }), 'vehicle')
})

test('character auto-tour is taken over when no vehicle tour is active', () => {
  assert.equal(resolveAutoTourManualTakeoverKind({
    ...eligibleCanvasPress,
    activeCharacterTour: true,
  }), 'character')
})

test('UI targets and blocked overlays never take over an active auto-tour', () => {
  assert.equal(resolveAutoTourManualTakeoverKind({
    ...eligibleCanvasPress,
    activeVehicleTour: true,
    canvasTarget: false,
  }), null)
  assert.equal(resolveAutoTourManualTakeoverKind({
    ...eligibleCanvasPress,
    activeVehicleTour: true,
    takeoverBlocked: true,
  }), null)
})

test('secondary, repeated, and in-progress pointer sessions are ignored', () => {
  assert.equal(resolveAutoTourManualTakeoverKind({
    ...eligibleCanvasPress,
    activeVehicleTour: true,
    primaryPointer: false,
  }), null)
  assert.equal(resolveAutoTourManualTakeoverKind({
    ...eligibleCanvasPress,
    activeVehicleTour: true,
    primaryButton: false,
  }), null)
  assert.equal(resolveAutoTourManualTakeoverKind({
    ...eligibleCanvasPress,
    activeVehicleTour: true,
    padActive: true,
  }), null)
})

test('idle viewer does nothing', () => {
  assert.equal(resolveAutoTourManualTakeoverKind(eligibleCanvasPress), null)
})
