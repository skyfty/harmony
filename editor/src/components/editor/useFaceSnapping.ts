import * as THREE from 'three'
import type { EditorTool } from '@/types/editor-tool'
import {
  FACE_SNAP_PREVIEW_DISTANCE,
  FACE_SNAP_COMMIT_DISTANCE,
  FACE_SNAP_MIN_OVERLAP,
  FACE_SNAP_MOVEMENT_EPSILON,
  FACE_SNAP_EFFECT_MAX_OPACITY,
  FACE_SNAP_EFFECT_MIN_OPACITY,
  FACE_SNAP_EFFECT_MIN_SIZE,
  FACE_SNAP_EFFECT_MAX_SIZE,
  FACE_SNAP_EFFECT_SCALE_PULSE,
  FACE_SNAP_EFFECT_PULSE_SPEED,
} from './constants'
import { setBoundingBoxFromObject } from './sceneUtils'

const FACE_SNAP_EARLY_PREVIEW_DISTANCE = FACE_SNAP_PREVIEW_DISTANCE * 2
const FACE_SNAP_DISTANCE_LABEL_CANVAS_WIDTH = 256
const FACE_SNAP_DISTANCE_LABEL_CANVAS_HEIGHT = 128
const FACE_SNAP_DISTANCE_UNIT = 'm'
const FACE_SNAP_COLOR_NEAR = new THREE.Color(0x32ffe0)
const FACE_SNAP_COLOR_FAR = new THREE.Color(0xff5a36)
const FACE_SNAP_LINE_COLOR_NEAR = new THREE.Color(0x18c9ff)
const FACE_SNAP_LINE_COLOR_FAR = new THREE.Color(0xffa94d)
const FACE_SNAP_GAP_UPDATE_THROTTLE_MS = 32
const FACE_SNAP_EFFECT_POSITION_DAMPING = 18
const FACE_SNAP_EFFECT_SCALE_DAMPING = 14
const FACE_SNAP_EFFECT_OPACITY_DAMPING = 12

const FACE_SNAP_DEFAULT_NORMAL = new THREE.Vector3(0, 0, 1)
const FACE_SNAP_AXES: AxisKey[] = ['x', 'y', 'z']
const FACE_SNAP_OTHER_AXES: Record<AxisKey, [AxisKey, AxisKey]> = {
  x: ['y', 'z'],
  y: ['x', 'z'],
  z: ['x', 'y'],
}
const FACE_SNAP_EFFECT_SIZE_MAPPING: Record<AxisKey, [AxisKey, AxisKey]> = {
  x: ['z', 'y'],
  y: ['x', 'z'],
  z: ['x', 'y'],
}
const AXIS_INDEX: Record<AxisKey, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

type AxisKey = 'x' | 'y' | 'z'
type SnapDirection = 1 | -1

type FaceSnapAxisResult = {
  valid: boolean
  direction: SnapDirection
  gap: number
  overlapArea: number
  overlapMin: THREE.Vector3
  overlapMax: THREE.Vector3
}

type FaceSnapEffectIndicator = {
  plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  material: THREE.MeshBasicMaterial
  border: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>
  gapLine: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>
  gapLineMaterial: THREE.LineDashedMaterial
  gapMarkers: [THREE.Mesh, THREE.Mesh]
  label: THREE.Sprite | null
  labelCanvas: HTMLCanvasElement | null
  labelContext: CanvasRenderingContext2D | null
  labelTexture: THREE.CanvasTexture | null
  targetOpacity: number
  renderOpacity: number
  closeness: number
  baseScale: THREE.Vector2
  renderScale: THREE.Vector2
  targetPosition: THREE.Vector3
  renderPosition: THREE.Vector3
  pulseSeed: number
  active: boolean
  lastGapUpdate: number
  lastGapValue: number
}

export type FaceSnapManagerOptions = {
  getScene(): THREE.Scene | null
  objectMap: Map<string, THREE.Object3D>
  getActiveTool(): EditorTool
  isEditableKeyboardTarget(target: EventTarget | null): boolean
}

export interface FaceSnapManager {
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

class FaceSnapManagerImpl implements FaceSnapManager {
  private readonly getSceneRef: FaceSnapManagerOptions['getScene']
  private readonly objectMap: Map<string, THREE.Object3D>
  private readonly getActiveTool: FaceSnapManagerOptions['getActiveTool']
  private readonly isEditableKeyboardTarget: FaceSnapManagerOptions['isEditableKeyboardTarget']

  private isCommitActive = false

  private readonly faceSnapPrimaryBounds = new THREE.Box3()
  private readonly faceSnapCandidateBounds = new THREE.Box3()
  private readonly faceSnapWorldDelta = new THREE.Vector3()
  private readonly faceSnapLocalDelta = new THREE.Vector3()
  private readonly faceSnapPlaneCenter = new THREE.Vector3()
  private readonly faceSnapPlaneNormal = new THREE.Vector3()
  private readonly faceSnapParentPosition = new THREE.Vector3()
  private readonly faceSnapParentQuaternion = new THREE.Quaternion()
  private readonly faceSnapParentScale = new THREE.Vector3()
  private readonly faceSnapColorScratch = new THREE.Color()
  private readonly faceSnapGapStart = new THREE.Vector3()
  private readonly faceSnapGapEnd = new THREE.Vector3()

  private readonly faceSnapAxisResults: Record<AxisKey, FaceSnapAxisResult> = {
    x: {
      valid: false,
      direction: 1,
      gap: Number.POSITIVE_INFINITY,
      overlapArea: 0,
      overlapMin: new THREE.Vector3(),
      overlapMax: new THREE.Vector3(),
    },
    y: {
      valid: false,
      direction: 1,
      gap: Number.POSITIVE_INFINITY,
      overlapArea: 0,
      overlapMin: new THREE.Vector3(),
      overlapMax: new THREE.Vector3(),
    },
    z: {
      valid: false,
      direction: 1,
      gap: Number.POSITIVE_INFINITY,
      overlapArea: 0,
      overlapMin: new THREE.Vector3(),
      overlapMax: new THREE.Vector3(),
    },
  }

  private readonly faceSnapEffectIndicators: Record<AxisKey, FaceSnapEffectIndicator | null> = {
    x: null,
    y: null,
    z: null,
  }

  constructor(options: FaceSnapManagerOptions) {
    this.getSceneRef = options.getScene
    this.objectMap = options.objectMap
    this.getActiveTool = options.getActiveTool
    this.isEditableKeyboardTarget = options.isEditableKeyboardTarget
  }

  public handleKeyDown = (event: KeyboardEvent): void => {
    if (this.getActiveTool() !== 'translate') {
      return
    }
    if (event.key !== 'Shift') {
      return
    }
    if (event.defaultPrevented) {
      return
    }
    if (this.isEditableKeyboardTarget(event.target)) {
      return
    }
    this.setCommitActive(true)
  }

  public handleKeyUp = (event: KeyboardEvent): void => {
    if (this.getActiveTool() !== 'translate') {
      return
    }
    if (event.key !== 'Shift') {
      return
    }
    this.setCommitActive(event.shiftKey)
  }

  public handleBlur = (): void => {
    if (this.getActiveTool() !== 'translate') {
      return
    }
    this.setCommitActive(false)
  }

  public setCommitActive(active: boolean): void {
    this.isCommitActive = active
  }

  public ensureEffectPool(): void {
    FACE_SNAP_AXES.forEach((axis) => {
      this.ensureEffectIndicator(axis)
    })
  }

  public hideEffect(): void {
    this.hideEffectInternal()
  }

  public updateEffectIntensity(delta: number): void {
    const safeDelta = delta > 0 ? delta : 1 / 60
    const positionAlpha = 1 - Math.exp(-FACE_SNAP_EFFECT_POSITION_DAMPING * safeDelta)
    const scaleAlpha = 1 - Math.exp(-FACE_SNAP_EFFECT_SCALE_DAMPING * safeDelta)
    const opacityAlpha = 1 - Math.exp(-FACE_SNAP_EFFECT_OPACITY_DAMPING * safeDelta)

    FACE_SNAP_AXES.forEach((axis) => {
      const indicator = this.faceSnapEffectIndicators[axis]
      if (!indicator) {
        return
      }

      const { plane, material, baseScale, renderScale, targetPosition, renderPosition } = indicator
      const desiredOpacity = indicator.active ? indicator.targetOpacity : 0
      indicator.renderOpacity += (desiredOpacity - indicator.renderOpacity) * opacityAlpha

      if (indicator.renderOpacity <= 0.001 && !indicator.active) {
        if (plane.visible) {
          plane.visible = false
          material.opacity = 0
          material.needsUpdate = true
        }
        this.hideGapIndicator(indicator)
        return
      }

      plane.visible = true
      renderPosition.lerp(targetPosition, positionAlpha)
      plane.position.copy(renderPosition)

      renderScale.lerp(baseScale, scaleAlpha)

      const elapsed = performance.now() - indicator.pulseSeed
      const pulseSecondary = Math.sin(elapsed / (FACE_SNAP_EFFECT_PULSE_SPEED * 0.68))
      plane.scale.set(renderScale.x, renderScale.y, 1)

      const opacityPulse = indicator.closeness * 0.18 * pulseSecondary
      const opacity = THREE.MathUtils.clamp(
        indicator.renderOpacity + opacityPulse,
        FACE_SNAP_EFFECT_MIN_OPACITY * 0.3,
        1,
      )
      material.opacity = opacity
      material.needsUpdate = true

      indicator.gapLineMaterial.dashOffset = -elapsed * 0.0015 * (1 + indicator.closeness)
      indicator.gapLineMaterial.needsUpdate = indicator.gapLine.visible
      indicator.gapMarkers.forEach((marker) => {
        if (!marker.visible) {
          return
        }
        const markerMaterial = marker.material as THREE.MeshBasicMaterial
        markerMaterial.opacity = THREE.MathUtils.clamp(
          indicator.gapLineMaterial.opacity + indicator.closeness * 0.15 * pulseSecondary,
          0,
          1,
        )
        markerMaterial.needsUpdate = true
      })
      if (indicator.label?.visible) {
        const spriteMaterial = indicator.label.material as THREE.SpriteMaterial
        spriteMaterial.opacity = THREE.MathUtils.lerp(0.4, 1, indicator.closeness)
        spriteMaterial.needsUpdate = true
      }
    })
  }

  public applyAlignmentSnap(
    target: THREE.Object3D,
    movementDelta: THREE.Vector3,
    excludedIds: Set<string>,
  ): void {
    const scene = this.getSceneRef()
    if (!scene) {
      return
    }

    this.ensureEffectPool()

    target.updateMatrixWorld(true)
    setBoundingBoxFromObject(target, this.faceSnapPrimaryBounds)
    if (this.faceSnapPrimaryBounds.isEmpty()) {
      this.hideEffectInternal()
      return
    }

    this.resetAxisResults()

    this.objectMap.forEach((candidate, candidateId) => {
      if (!candidate) {
        return
      }
      if (candidate === target) {
        return
      }
      if (excludedIds.has(candidateId)) {
        return
      }
      if (!candidate.visible) {
        return
      }

      candidate.updateMatrixWorld(true)
      setBoundingBoxFromObject(candidate, this.faceSnapCandidateBounds)
      if (this.faceSnapCandidateBounds.isEmpty()) {
        return
      }

      FACE_SNAP_AXES.forEach((axis) => {
        this.evaluateDirection(axis, 1, movementDelta)
        this.evaluateDirection(axis, -1, movementDelta)
      })
    })

    let anyValidAxis = false
    this.faceSnapWorldDelta.set(0, 0, 0)

    FACE_SNAP_AXES.forEach((axis) => {
      const result = this.faceSnapAxisResults[axis]
      if (!result.valid) {
        this.hideIndicator(axis)
        return
      }

      anyValidAxis = true
      this.triggerFaceSnapEffect(axis, result.direction, result.overlapMin, result.overlapMax, result.gap)

      if (result.gap > FACE_SNAP_MOVEMENT_EPSILON) {
        const axisIndex = AXIS_INDEX[axis]
        const component = this.faceSnapWorldDelta.getComponent(axisIndex) + result.direction * result.gap
        this.faceSnapWorldDelta.setComponent(axisIndex, component)
      }
    })

    if (!anyValidAxis) {
      this.hideEffectInternal()
      return
    }

    if (this.faceSnapWorldDelta.lengthSq() <= FACE_SNAP_MOVEMENT_EPSILON * FACE_SNAP_MOVEMENT_EPSILON) {
      return
    }

    if (!this.isCommitActive) {
      return
    }

    this.faceSnapLocalDelta.copy(this.faceSnapWorldDelta)

    const parent = target.parent
    if (parent) {
      parent.updateMatrixWorld(true)
      parent.matrixWorld.decompose(this.faceSnapParentPosition, this.faceSnapParentQuaternion, this.faceSnapParentScale)
      this.faceSnapParentQuaternion.invert()
      this.faceSnapLocalDelta.applyQuaternion(this.faceSnapParentQuaternion)

      const safeDivide = (value: number) => (Math.abs(value) <= 1e-6 ? 1 : value)
      this.faceSnapLocalDelta.set(
        this.faceSnapLocalDelta.x / safeDivide(this.faceSnapParentScale.x),
        this.faceSnapLocalDelta.y / safeDivide(this.faceSnapParentScale.y),
        this.faceSnapLocalDelta.z / safeDivide(this.faceSnapParentScale.z),
      )
    }

    target.position.add(this.faceSnapLocalDelta)
  }

  public dispose(): void {
    this.hideEffectInternal()
    FACE_SNAP_AXES.forEach((axis) => {
      const indicator = this.faceSnapEffectIndicators[axis]
      if (!indicator) {
        return
      }
      this.disposeIndicator(indicator)
      this.faceSnapEffectIndicators[axis] = null
    })
    this.isCommitActive = false
  }

  private ensureEffectIndicator(axis: AxisKey): FaceSnapEffectIndicator | null {
    const scene = this.getSceneRef()
    if (!scene) {
      return null
    }

    let indicator = this.faceSnapEffectIndicators[axis]
    if (indicator) {
      return indicator
    }

    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
    material.toneMapped = false

    const plane = new THREE.Mesh(geometry, material)
    plane.visible = false
    plane.renderOrder = 1024

    const borderGeometry = new THREE.BufferGeometry()
    borderGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([
        -0.5, 0, -0.5,
        0.5, 0, -0.5,
        0.5, 0, 0.5,
        -0.5, 0, 0.5,
      ], 3),
    )
    const borderMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      linewidth: 2.5,
    })
    borderMaterial.toneMapped = false
    const border = new THREE.LineLoop(borderGeometry, borderMaterial)
    border.position.z = 1e-3
    border.renderOrder = plane.renderOrder + 1
    plane.add(border)

    const gapLineGeometry = new THREE.BufferGeometry()
    gapLineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3))
    const gapLineMaterial = new THREE.LineDashedMaterial({
      color: FACE_SNAP_LINE_COLOR_NEAR.getHex(),
      transparent: true,
      opacity: 0,
      gapSize: 0.15,
      dashSize: 0.3,
      depthTest: false,
      depthWrite: false,
      linewidth: 2,
    })
    gapLineMaterial.toneMapped = false
    const gapLine = new THREE.Line(gapLineGeometry, gapLineMaterial)
    gapLine.visible = false
    gapLine.renderOrder = plane.renderOrder + 2
    gapLine.computeLineDistances()

    const createGapMarker = () => {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 16, 12),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
        }),
      )
      sphere.renderOrder = gapLine.renderOrder + 1
      sphere.visible = false
      return sphere
    }
    const gapMarkers = [createGapMarker(), createGapMarker()] as [THREE.Mesh, THREE.Mesh]

    let label: THREE.Sprite | null = null
    let labelCanvas: HTMLCanvasElement | null = null
    let labelContext: CanvasRenderingContext2D | null = null
    let labelTexture: THREE.CanvasTexture | null = null
    if (typeof document !== 'undefined') {
      labelCanvas = document.createElement('canvas')
      labelCanvas.width = FACE_SNAP_DISTANCE_LABEL_CANVAS_WIDTH
      labelCanvas.height = FACE_SNAP_DISTANCE_LABEL_CANVAS_HEIGHT
      labelContext = labelCanvas.getContext('2d')
      if (labelContext) {
        labelTexture = new THREE.CanvasTexture(labelCanvas)
        labelTexture.needsUpdate = true
        const spriteMaterial = new THREE.SpriteMaterial({
          map: labelTexture,
          transparent: true,
          depthWrite: false,
          depthTest: false,
        })
        spriteMaterial.toneMapped = false
        label = new THREE.Sprite(spriteMaterial)
        label.renderOrder = gapLine.renderOrder + 2
        label.visible = false
      }
    }

    scene.add(plane)
    scene.add(gapLine)
    gapMarkers.forEach((marker) => scene.add(marker))
    if (label) {
      scene.add(label)
    }

    indicator = {
      plane,
      material,
      border,
      gapLine,
      gapLineMaterial,
      gapMarkers,
      label,
      labelCanvas,
      labelContext,
      labelTexture,
      targetOpacity: 0,
      renderOpacity: 0,
      closeness: 0,
      baseScale: new THREE.Vector2(1, 1),
      renderScale: new THREE.Vector2(1, 1),
      targetPosition: new THREE.Vector3(),
      renderPosition: new THREE.Vector3(),
      pulseSeed: 0,
      active: false,
      lastGapUpdate: 0,
      lastGapValue: Number.POSITIVE_INFINITY,
    }
    indicator.renderPosition.copy(plane.position)
    indicator.targetPosition.copy(plane.position)
    indicator.renderScale.set(1, 1)
    this.faceSnapEffectIndicators[axis] = indicator
    return indicator
  }

  private evaluateDirection(axis: AxisKey, direction: SnapDirection, movementDelta: THREE.Vector3): void {
    const axisIndex = AXIS_INDEX[axis]
    const primaryMin = this.faceSnapPrimaryBounds.min.getComponent(axisIndex)
    const primaryMax = this.faceSnapPrimaryBounds.max.getComponent(axisIndex)
    const candidateMin = this.faceSnapCandidateBounds.min.getComponent(axisIndex)
    const candidateMax = this.faceSnapCandidateBounds.max.getComponent(axisIndex)

    const rawGap = direction === 1
      ? candidateMin - primaryMax
      : primaryMin - candidateMax

    if (rawGap < -FACE_SNAP_MOVEMENT_EPSILON || rawGap > FACE_SNAP_EARLY_PREVIEW_DISTANCE) {
      return
    }

    const gap = Math.max(rawGap, 0)

    const movement = movementDelta.getComponent(axisIndex)
    if (Math.abs(movement) > FACE_SNAP_MOVEMENT_EPSILON) {
      if (direction === 1 && movement < 0) {
        return
      }
      if (direction === -1 && movement > 0) {
        return
      }
    }

    const [firstAxis, secondAxis] = FACE_SNAP_OTHER_AXES[axis]
    const firstIndex = AXIS_INDEX[firstAxis]
    const secondIndex = AXIS_INDEX[secondAxis]

    const firstMin = Math.max(
      this.faceSnapPrimaryBounds.min.getComponent(firstIndex),
      this.faceSnapCandidateBounds.min.getComponent(firstIndex),
    )
    const firstMax = Math.min(
      this.faceSnapPrimaryBounds.max.getComponent(firstIndex),
      this.faceSnapCandidateBounds.max.getComponent(firstIndex),
    )
    if (firstMax - firstMin < FACE_SNAP_MIN_OVERLAP) {
      return
    }

    const secondMin = Math.max(
      this.faceSnapPrimaryBounds.min.getComponent(secondIndex),
      this.faceSnapCandidateBounds.min.getComponent(secondIndex),
    )
    const secondMax = Math.min(
      this.faceSnapPrimaryBounds.max.getComponent(secondIndex),
      this.faceSnapCandidateBounds.max.getComponent(secondIndex),
    )
    if (secondMax - secondMin < FACE_SNAP_MIN_OVERLAP) {
      return
    }

    const overlapArea = (firstMax - firstMin) * (secondMax - secondMin)
    const result = this.faceSnapAxisResults[axis]

    if (
      !result.valid ||
      gap < result.gap - FACE_SNAP_MOVEMENT_EPSILON ||
      (Math.abs(gap - result.gap) <= FACE_SNAP_MOVEMENT_EPSILON && overlapArea > result.overlapArea)
    ) {
      result.valid = true
      result.direction = direction
      result.gap = gap
      result.overlapArea = overlapArea

      const contact = direction === 1 ? candidateMin : candidateMax
      result.overlapMin.setComponent(axisIndex, contact)
      result.overlapMax.setComponent(axisIndex, contact)
      result.overlapMin.setComponent(firstIndex, firstMin)
      result.overlapMax.setComponent(firstIndex, firstMax)
      result.overlapMin.setComponent(secondIndex, secondMin)
      result.overlapMax.setComponent(secondIndex, secondMax)
    }
  }

  private resetAxisResults(): void {
    FACE_SNAP_AXES.forEach((axis) => {
      const result = this.faceSnapAxisResults[axis]
      result.valid = false
      result.direction = 1
      result.gap = Number.POSITIVE_INFINITY
      result.overlapArea = 0
      result.overlapMin.setScalar(0)
      result.overlapMax.setScalar(0)
    })
  }

  private triggerFaceSnapEffect(
    axis: AxisKey,
    direction: SnapDirection,
    overlapMin: THREE.Vector3,
    overlapMax: THREE.Vector3,
    gap: number,
  ): void {
    const indicator = this.ensureEffectIndicator(axis)
    if (!indicator) {
      return
    }

    const { plane, material, baseScale, renderScale, border, targetPosition, renderPosition } = indicator
    const wasActive = indicator.active

    this.faceSnapPlaneCenter.set(
      (overlapMin.x + overlapMax.x) * 0.5,
      (overlapMin.y + overlapMax.y) * 0.5,
      (overlapMin.z + overlapMax.z) * 0.5,
    )

    this.faceSnapPlaneNormal.set(0, 0, 0)
    this.faceSnapPlaneNormal.setComponent(AXIS_INDEX[axis], direction)
    this.faceSnapPlaneNormal.normalize()
    plane.quaternion.setFromUnitVectors(FACE_SNAP_DEFAULT_NORMAL, this.faceSnapPlaneNormal)

    const [widthAxis, heightAxis] = FACE_SNAP_EFFECT_SIZE_MAPPING[axis]
    const width = THREE.MathUtils.clamp(
      Math.max(
        overlapMax.getComponent(AXIS_INDEX[widthAxis]) - overlapMin.getComponent(AXIS_INDEX[widthAxis]),
        FACE_SNAP_EFFECT_MIN_SIZE,
      ),
      FACE_SNAP_EFFECT_MIN_SIZE,
      FACE_SNAP_EFFECT_MAX_SIZE,
    )
    const height = THREE.MathUtils.clamp(
      Math.max(
        overlapMax.getComponent(AXIS_INDEX[heightAxis]) - overlapMin.getComponent(AXIS_INDEX[heightAxis]),
        FACE_SNAP_EFFECT_MIN_SIZE,
      ),
      FACE_SNAP_EFFECT_MIN_SIZE,
      FACE_SNAP_EFFECT_MAX_SIZE,
    )

    const axisIndex = AXIS_INDEX[axis]
    if (gap > FACE_SNAP_COMMIT_DISTANCE) {
      const contactCenter = this.faceSnapPlaneCenter.getComponent(axisIndex)
      const offset = gap * 0.5
      this.faceSnapPlaneCenter.setComponent(axisIndex, contactCenter - direction * offset)
    }

    targetPosition.copy(this.faceSnapPlaneCenter)
    if (!wasActive) {
      renderPosition.copy(this.faceSnapPlaneCenter)
      plane.position.copy(this.faceSnapPlaneCenter)
    }

    const closeness = THREE.MathUtils.clamp(1 - gap / FACE_SNAP_EARLY_PREVIEW_DISTANCE, 0, 1)
    indicator.closeness = closeness
    const easedCloseness = Math.pow(closeness, 0.75)
    const opacityRamp = Math.pow(closeness, 1.1)
    indicator.targetOpacity = THREE.MathUtils.lerp(
      FACE_SNAP_EFFECT_MIN_OPACITY * 0.5,
      FACE_SNAP_EFFECT_MAX_OPACITY,
      opacityRamp,
    )
    this.faceSnapColorScratch.copy(FACE_SNAP_COLOR_FAR).lerp(FACE_SNAP_COLOR_NEAR, easedCloseness)
    material.color.copy(this.faceSnapColorScratch)
    material.needsUpdate = true
    const borderMaterial = border.material as THREE.LineBasicMaterial
    borderMaterial.color.copy(this.faceSnapColorScratch)
    borderMaterial.opacity = THREE.MathUtils.lerp(0.35, 0.95, easedCloseness)
    borderMaterial.needsUpdate = true

    const baseScaleBoost = 1 + FACE_SNAP_EFFECT_SCALE_PULSE * easedCloseness
    baseScale.set(width * baseScaleBoost, height * baseScaleBoost)
    if (!wasActive) {
      renderScale.copy(baseScale)
      plane.scale.set(renderScale.x, renderScale.y, 1)
    }

    indicator.pulseSeed = performance.now()
    plane.visible = true
    if (!wasActive) {
      indicator.renderOpacity = indicator.targetOpacity
      material.opacity = indicator.targetOpacity
    }
    indicator.active = true
    this.updateGapIndicator(indicator, axis, direction, overlapMin, overlapMax, gap, closeness)
  }

  private updateGapIndicator(
    indicator: FaceSnapEffectIndicator,
    axis: AxisKey,
    direction: SnapDirection,
    overlapMin: THREE.Vector3,
    overlapMax: THREE.Vector3,
    gap: number,
    closeness: number,
  ): void {
    const now = performance.now()
    if (
      now - indicator.lastGapUpdate < FACE_SNAP_GAP_UPDATE_THROTTLE_MS &&
      Math.abs(gap - indicator.lastGapValue) < FACE_SNAP_MOVEMENT_EPSILON
    ) {
      return
    }

    indicator.lastGapUpdate = now
    indicator.lastGapValue = gap
    const shouldRevealGap = gap > FACE_SNAP_MOVEMENT_EPSILON || closeness < 0.999
    if (!shouldRevealGap) {
      this.hideGapIndicator(indicator)
      return
    }

    const axisIndex = AXIS_INDEX[axis]
    const [firstAxis, secondAxis] = FACE_SNAP_OTHER_AXES[axis]
    const firstIndex = AXIS_INDEX[firstAxis]
    const secondIndex = AXIS_INDEX[secondAxis]
    const firstCenter = (overlapMin.getComponent(firstIndex) + overlapMax.getComponent(firstIndex)) * 0.5
    const secondCenter = (overlapMin.getComponent(secondIndex) + overlapMax.getComponent(secondIndex)) * 0.5
    const contact = overlapMin.getComponent(axisIndex)
    this.faceSnapGapEnd.copy(this.faceSnapPlaneCenter)
    this.faceSnapGapEnd.setComponent(axisIndex, contact)
    this.faceSnapGapEnd.setComponent(firstIndex, firstCenter)
    this.faceSnapGapEnd.setComponent(secondIndex, secondCenter)
    const from = contact - direction * gap
    this.faceSnapGapStart.copy(this.faceSnapPlaneCenter)
    this.faceSnapGapStart.setComponent(axisIndex, from)
    this.faceSnapGapStart.setComponent(firstIndex, firstCenter)
    this.faceSnapGapStart.setComponent(secondIndex, secondCenter)

    const attribute = indicator.gapLine.geometry.getAttribute('position') as THREE.BufferAttribute
    attribute.setXYZ(0, this.faceSnapGapStart.x, this.faceSnapGapStart.y, this.faceSnapGapStart.z)
    attribute.setXYZ(1, this.faceSnapGapEnd.x, this.faceSnapGapEnd.y, this.faceSnapGapEnd.z)
    attribute.needsUpdate = true
    indicator.gapLine.computeLineDistances()
    indicator.gapLine.visible = true

    const colorMix = Math.pow(closeness, 1.2)
    this.faceSnapColorScratch.copy(FACE_SNAP_LINE_COLOR_FAR).lerp(FACE_SNAP_LINE_COLOR_NEAR, colorMix)
    indicator.gapLineMaterial.color.copy(this.faceSnapColorScratch)
    indicator.gapLineMaterial.opacity = THREE.MathUtils.lerp(0.2, 1, colorMix)
    indicator.gapLineMaterial.dashSize = Math.max(0.05, gap * 0.25)
    indicator.gapLineMaterial.gapSize = indicator.gapLineMaterial.dashSize * 0.6
    indicator.gapLineMaterial.needsUpdate = true

    const markerScale = THREE.MathUtils.lerp(0.12, 0.22, colorMix)
    indicator.gapMarkers.forEach((marker, index) => {
      marker.position.copy(index === 0 ? this.faceSnapGapStart : this.faceSnapGapEnd)
      marker.scale.setScalar(markerScale)
      marker.visible = true
      const markerMaterial = marker.material as THREE.MeshBasicMaterial
      markerMaterial.color.copy(this.faceSnapColorScratch)
      markerMaterial.opacity = indicator.gapLineMaterial.opacity
      markerMaterial.needsUpdate = true
    })

    if (indicator.label) {
      this.updateDistanceLabel(indicator, gap)
      const labelScaleBase = Math.max(0.5, gap * 0.3)
      indicator.label.scale.set(labelScaleBase, labelScaleBase * 0.5, 1)
      indicator.label.position.copy(this.faceSnapGapStart).lerp(this.faceSnapGapEnd, 0.5)
      indicator.label.visible = true
    }
  }

  private updateDistanceLabel(indicator: FaceSnapEffectIndicator, distance: number): void {
    const canvas = indicator.labelCanvas
    const context = indicator.labelContext
    const texture = indicator.labelTexture
    if (!canvas || !context || !texture) {
      return
    }

    context.clearRect(0, 0, canvas.width, canvas.height)
    const padding = 18
    context.fillStyle = 'rgba(8, 20, 30, 0.85)'
    this.drawRoundedRect(context, padding, padding, canvas.width - padding * 2, canvas.height - padding * 2, 24)
    context.fill()
    context.lineWidth = 3
    context.strokeStyle = 'rgba(255, 255, 255, 0.25)'
    context.stroke()
    context.fillStyle = '#ffffff'
    context.font = '600 42px Inter, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    const label = `${distance.toFixed(2)}${FACE_SNAP_DISTANCE_UNIT}`
    context.fillText(label, canvas.width / 2, canvas.height / 2)
    texture.needsUpdate = true
  }

  private drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const r = Math.min(radius, width * 0.5, height * 0.5)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + width - r, y)
    ctx.quadraticCurveTo(x + width, y, x + width, y + r)
    ctx.lineTo(x + width, y + height - r)
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
    ctx.lineTo(x + r, y + height)
    ctx.quadraticCurveTo(x, y + height, x, y + height - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  private hideGapIndicator(indicator: FaceSnapEffectIndicator): void {
    indicator.gapLine.visible = false
    indicator.gapLineMaterial.opacity = 0
    indicator.gapLineMaterial.needsUpdate = true
    indicator.gapMarkers.forEach((marker) => {
      marker.visible = false
    })
    if (indicator.label) {
      indicator.label.visible = false
    }
    indicator.lastGapUpdate = 0
    indicator.lastGapValue = Number.POSITIVE_INFINITY
  }

  private hideEffectInternal(axis?: AxisKey): void {
    if (typeof axis === 'undefined') {
      FACE_SNAP_AXES.forEach((key) => this.hideEffectInternal(key))
      return
    }

    const indicator = this.faceSnapEffectIndicators[axis]
    if (!indicator) {
      return
    }

    indicator.active = false
    indicator.targetOpacity = 0
    indicator.closeness = 0
    indicator.baseScale.copy(indicator.renderScale)
    const borderMaterial = indicator.border.material as THREE.LineBasicMaterial
    borderMaterial.opacity = 0
    borderMaterial.needsUpdate = true
    this.hideGapIndicator(indicator)
  }

  private hideIndicator(axis: AxisKey): void {
    this.hideEffectInternal(axis)
  }

  private disposeIndicator(indicator: FaceSnapEffectIndicator): void {
    indicator.plane.removeFromParent()
    indicator.plane.geometry.dispose()
    indicator.material.dispose()
    indicator.border.geometry.dispose()
    indicator.border.material.dispose()
    indicator.gapLine.removeFromParent()
    indicator.gapLine.geometry.dispose()
    indicator.gapLineMaterial.dispose()
    indicator.gapMarkers.forEach((marker) => {
      marker.removeFromParent()
      marker.geometry.dispose()
      const markerMaterial = marker.material as THREE.Material
      markerMaterial.dispose()
    })
    if (indicator.label) {
      indicator.label.removeFromParent()
      const spriteMaterial = indicator.label.material as THREE.Material
      spriteMaterial.dispose()
    }
    indicator.labelTexture?.dispose()
    indicator.labelTexture = null
    indicator.labelCanvas = null
    indicator.labelContext = null
  }
}

export function createFaceSnapManager(options: FaceSnapManagerOptions): FaceSnapManager {
  return new FaceSnapManagerImpl(options)
}
