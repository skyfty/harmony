import * as THREE from 'three'
import {
  SIGNBOARD_MAX_DISTANCE,
  SIGNBOARD_WORLD_Y_OFFSET,
  computeSignboardGuidanceEntries,
  computeSignboardDistancePresentation,
  formatSignboardDistance,
  type SignboardGuidanceEntry,
  type SignboardGuidanceInsets,
} from './signboardOverlay'
import { createCanvas, type HarmonyCanvas, type HarmonyCanvas2DContext } from './canvas'

type SignboardCanvas = HarmonyCanvas
type SignboardCanvasContext = HarmonyCanvas2DContext

interface SignboardRuntimeEntry {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  texture: THREE.CanvasTexture
  canvas: SignboardCanvas
  context: HarmonyCanvas2DContext
  labelText: string
  distanceText: string
  punchBadgeVisible: boolean
  opacity: number
  worldWidth: number
  worldHeight: number
  anchorPosition: THREE.Vector3
  presentationScale: number
  presentationOpacity: number
  motionPhase: number
  lastDistanceLabelUpdateMs: number
}

const signboardEntries = new Map<string, SignboardRuntimeEntry>()
const signboardAnchorScratch = new THREE.Vector3()
const signboardCameraScratch = new THREE.Vector3()
const SIGNBOARD_MOTION_PERIOD_SECONDS = 6.4
const SIGNBOARD_MOTION_SCALE_AMPLITUDE = 0.008
const SIGNBOARD_MOTION_BOB_WORLD = 0.012
const SIGNBOARD_MOTION_OPACITY_AMPLITUDE = 0.015
let reducedMotionQuery: MediaQueryList | null | undefined

function resolveSignboardMotionPhase(nodeId: string): number {
  let hash = 2166136261
  for (let index = 0; index < nodeId.length; index += 1) {
    hash ^= nodeId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) / 4294967295) * Math.PI * 2
}

function shouldReduceSignboardMotion(): boolean {
  if (reducedMotionQuery !== undefined) {
    return reducedMotionQuery?.matches ?? false
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    reducedMotionQuery = null
    return false
  }
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  return reducedMotionQuery.matches
}

function isRuntimeObjectEffectivelyVisible(object: THREE.Object3D | null | undefined): boolean {
  let current = object
  while (current) {
    if (current.visible === false) {
      return false
    }
    current = current.parent
  }
  return true
}

export interface SignboardBillboardStyle {
  backgroundTopColor: string
  backgroundMiddleColor: string
  backgroundBottomColor: string
  borderColor: string
  glowColor: string
  sheenColor: string
  labelColor: string
  distanceColor: string
  dividerColor: string
  textShadowColor: string
  textStrokeColor?: string
  distanceStrokeColor?: string
  textStrokeWidth?: number
  shadowColor: string
  shadowBlur: number
  shadowOffsetY: number
  punchBadgeBackgroundTopColor: string
  punchBadgeBackgroundBottomColor: string
  punchBadgeBorderColor: string
  punchBadgeTextColor: string
  punchBadgeShadowColor: string
  distanceTextAccentColor: string
}

const TEXTURE_DPR = 2
const CARD_PADDING_X = 24
const CARD_PADDING_Y = 16
const CONTENT_GAP = 16
const LABEL_FONT_MAX = 28
const LABEL_FONT_MIN = 18
const CARD_MIN_WIDTH = 280
const CARD_MAX_WIDTH = 460
const WORLD_HEIGHT = 1.16
const BILLBOARD_WORLD_Y_OFFSET = 0.55
const BEACON_AREA_WIDTH = 24
const BEACON_CORE_RADIUS = 3.2
const BEACON_HALO_RADIUS = 11
const PUNCH_BADGE_DIAMETER = 24
const PUNCH_BADGE_GAP = 10
const PUNCH_BADGE_TEXT = '✓'
const DISTANCE_LABEL_REFRESH_INTERVAL_MS = 150

const DEFAULT_SIGNBOARD_BILLBOARD_STYLE: SignboardBillboardStyle = {
  backgroundTopColor: 'rgba(255, 255, 255, 0.28)',
  backgroundMiddleColor: 'rgba(204, 226, 242, 0.18)',
  backgroundBottomColor: 'rgba(146, 179, 202, 0.10)',
  borderColor: 'rgba(255, 255, 255, 0.34)',
  glowColor: 'rgba(122, 196, 255, 0.10)',
  sheenColor: 'rgba(255, 255, 255, 0.08)',
  labelColor: '#f8fcff',
  distanceColor: 'rgba(231, 244, 255, 0.82)',
  dividerColor: 'rgba(255, 255, 255, 0.18)',
  textShadowColor: 'rgba(255, 255, 255, 0.14)',
  textStrokeColor: 'rgba(0, 0, 0, 0.72)',
  distanceStrokeColor: 'rgba(255, 255, 255, 0.84)',
  textStrokeWidth: 1.4,
  shadowColor: 'rgba(255, 255, 255, 0.12)',
  shadowBlur: 6,
  shadowOffsetY: 1,
  punchBadgeBackgroundTopColor: 'rgba(242, 255, 248, 0.98)',
  punchBadgeBackgroundBottomColor: 'rgba(226, 255, 239, 0.94)',
  punchBadgeBorderColor: 'rgba(255, 207, 102, 0.42)',
  punchBadgeTextColor: '#c88c12',
  punchBadgeShadowColor: 'rgba(255, 196, 77, 0.28)',
  distanceTextAccentColor: '#c88c12',
}

function resolveStyle(appearance?: Partial<SignboardBillboardStyle>): SignboardBillboardStyle {
  return {
    ...DEFAULT_SIGNBOARD_BILLBOARD_STYLE,
    ...(appearance ?? {}),
  }
}

function drawSignboardBeacon(
  context: SignboardCanvasContext,
  centerX: number,
  centerY: number,
  style: SignboardBillboardStyle,
): void {
  const halo = context.createRadialGradient(
    centerX,
    centerY,
    0,
    centerX,
    centerY,
    BEACON_HALO_RADIUS,
  )
  halo.addColorStop(0, style.labelColor)
  halo.addColorStop(0.22, style.glowColor)
  halo.addColorStop(1, 'rgba(0, 0, 0, 0)')
  context.fillStyle = halo
  context.beginPath()
  context.arc(centerX, centerY, BEACON_HALO_RADIUS, 0, Math.PI * 2)
  context.fill()

  context.fillStyle = style.labelColor
  context.beginPath()
  context.arc(centerX, centerY, BEACON_CORE_RADIUS, 0, Math.PI * 2)
  context.fill()
}

function measureTextWidth(context: SignboardCanvasContext, text: string): number {
  return context.measureText(text).width
}

function drawOutlinedCanvasText(
  context: SignboardCanvasContext,
  text: string,
  x: number,
  y: number,
  font: string,
  fillColor: string,
  strokeColor: string,
  strokeWidth: number,
): void {
  context.font = font
  context.lineJoin = 'round'
  context.lineCap = 'round'
  context.lineWidth = Math.max(0.8, strokeWidth)
  context.strokeStyle = strokeColor
  context.strokeText(text, x, y)
  context.fillStyle = fillColor
  context.fillText(text, x, y)
}

function fitLabelFontSize(context: SignboardCanvasContext, label: string, maxWidth: number): number {
  let fontSize = LABEL_FONT_MAX
  while (fontSize > LABEL_FONT_MIN) {
    context.font = `700 ${fontSize}px sans-serif`
    if (measureTextWidth(context, label) <= maxWidth) {
      return fontSize
    }
    fontSize -= 1
  }
  return LABEL_FONT_MIN
}

function quantizeSignboardDistance(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    return distanceMeters
  }
  const step = distanceMeters < 10
    ? 0.2
    : distanceMeters < 50
      ? 0.5
      : distanceMeters < 200
        ? 1
        : distanceMeters < 1000
          ? 5
          : 10
  return Math.round(distanceMeters / step) * step
}

function drawPunchBadge(context: SignboardCanvasContext, centerX: number, centerY: number, style: SignboardBillboardStyle, fontSize: number, diameter: number): void {
  const radius = diameter / 2
  const fill = context.createLinearGradient(centerX - radius, centerY - radius, centerX + radius, centerY + radius)
  fill.addColorStop(0, 'rgba(255, 250, 235, 0.98)')
  fill.addColorStop(1, 'rgba(255, 240, 200, 0.96)')
  context.beginPath()
  context.arc(centerX, centerY, radius, 0, Math.PI * 2)
  context.fillStyle = fill
  context.fill()
  context.lineWidth = 1.1
  context.strokeStyle = style.punchBadgeBorderColor
  context.stroke()
  context.shadowColor = style.punchBadgeShadowColor
  context.shadowBlur = 5
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = style.punchBadgeTextColor
  context.font = `700 ${fontSize}px sans-serif`
  context.fillText(PUNCH_BADGE_TEXT, centerX, centerY - 0.5)
}

function drawSignboardTexture(entry: SignboardRuntimeEntry, style: SignboardBillboardStyle): void {
  const context = entry.context
  const label = entry.labelText || ''
  const distance = entry.distanceText || ''
  const showPunchBadge = entry.punchBadgeVisible

  context.resetTransform?.()
  context.clearRect(0, 0, entry.canvas.width, entry.canvas.height)
  context.scale(TEXTURE_DPR, TEXTURE_DPR)

  const maxTextWidth = CARD_MAX_WIDTH - CARD_PADDING_X * 2 - CONTENT_GAP - 88
  const labelFontSize = fitLabelFontSize(context, label, maxTextWidth)
  const distanceFontSize = labelFontSize
  const punchBadgeFontSize = labelFontSize
  const punchBadgeDiameter = Math.max(PUNCH_BADGE_DIAMETER, Math.round(labelFontSize * 1.35))
  const punchBadgeGap = showPunchBadge ? Math.max(PUNCH_BADGE_GAP, Math.round(labelFontSize * 0.72)) : 0

  context.font = `700 ${labelFontSize}px sans-serif`
  const labelWidth = measureTextWidth(context, label)
  context.font = `600 ${distanceFontSize}px sans-serif`
  const distanceWidth = measureTextWidth(context, distance)

  const labelAreaWidth = Math.min(Math.max(labelWidth, 136), 280)
  const distanceAreaWidth = Math.min(Math.max(distanceWidth + 24, 72), 108)
  const badgeAreaWidth = showPunchBadge ? punchBadgeDiameter + punchBadgeGap : 0
  const contentWidth = BEACON_AREA_WIDTH + labelAreaWidth + CONTENT_GAP + distanceAreaWidth + badgeAreaWidth
  const cardWidth = Math.min(CARD_MAX_WIDTH, Math.max(CARD_MIN_WIDTH, Math.ceil(contentWidth + CARD_PADDING_X * 2)))
  const cardHeight = Math.ceil(CARD_PADDING_Y * 2 + Math.max(labelFontSize, distanceFontSize) + 8)

  const canvasWidth = cardWidth * TEXTURE_DPR
  const canvasHeight = cardHeight * TEXTURE_DPR
  if (entry.canvas.width !== canvasWidth) {
    entry.canvas.width = canvasWidth
  }
  if (entry.canvas.height !== canvasHeight) {
    entry.canvas.height = canvasHeight
  }

  context.resetTransform?.()
  context.scale(TEXTURE_DPR, TEXTURE_DPR)

  context.textBaseline = 'middle'
  context.shadowColor = style.textShadowColor
  context.shadowBlur = style.shadowBlur
  context.shadowOffsetY = style.shadowOffsetY

  const baselineY = cardHeight / 2 + 1
  const beaconX = CARD_PADDING_X + 8
  const leftTextX = CARD_PADDING_X + BEACON_AREA_WIDTH + 4
  const labelRightLimit = leftTextX + labelAreaWidth
  const labelText = label.length ? label : ' '
  drawSignboardBeacon(context, beaconX, baselineY, style)
  context.textAlign = 'left'
  drawOutlinedCanvasText(
    context,
    labelText,
    leftTextX,
    baselineY,
    `800 ${labelFontSize}px sans-serif`,
    style.labelColor,
    style.textStrokeColor ?? 'rgba(0, 0, 0, 0.72)',
    style.textStrokeWidth ?? 1.4,
  )

  const markerDotX = Math.min(
    cardWidth - CARD_PADDING_X - distanceAreaWidth - badgeAreaWidth - CONTENT_GAP / 2,
    labelRightLimit + CONTENT_GAP / 2,
  )
  context.shadowColor = 'transparent'
  context.fillStyle = style.distanceTextAccentColor
  context.beginPath()
  context.arc(markerDotX, baselineY, 1.25, 0, Math.PI * 2)
  context.fill()

  const distanceX = cardWidth - CARD_PADDING_X - badgeAreaWidth - 4
  context.textAlign = 'right'
  context.shadowColor = style.textShadowColor
  context.shadowBlur = Math.max(0, style.shadowBlur - 2)
  drawOutlinedCanvasText(
    context,
    distance,
    distanceX,
    baselineY,
    `700 ${distanceFontSize}px sans-serif`,
    style.distanceTextAccentColor,
    style.distanceStrokeColor ?? style.textStrokeColor ?? 'rgba(0, 0, 0, 0.72)',
    (style.textStrokeWidth ?? 1.4) * 0.82,
  )

  if (showPunchBadge) {
    drawPunchBadge(context, cardWidth - CARD_PADDING_X - punchBadgeDiameter / 2, baselineY, style, punchBadgeFontSize, punchBadgeDiameter)
  }

  context.shadowColor = 'transparent'
  context.fillStyle = style.sheenColor
  context.fillRect(cardWidth - 34, 6, 20, 1)

  entry.texture.needsUpdate = true
  entry.worldWidth = Math.max(0.9, (cardWidth / cardHeight) * WORLD_HEIGHT)
  entry.worldHeight = WORLD_HEIGHT
}

function createSignboardEntry(scene: THREE.Scene, nodeId: string, labelText: string, distanceText: string, punchBadgeVisible: boolean, style: SignboardBillboardStyle): SignboardRuntimeEntry {
  const canvas = createCanvas(CARD_MIN_WIDTH * TEXTURE_DPR, 180 * TEXTURE_DPR)
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to acquire a 2D context for signboard billboards')
  }

  const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const sprite = new THREE.Sprite(material)
  sprite.center.set(0.5, 0)
  sprite.name = `SignboardBillboard:${nodeId}`
  sprite.renderOrder = 5000
  sprite.userData.harmonyRuntimeSignboardBillboard = true
  scene.add(sprite)

  const entry: SignboardRuntimeEntry = {
    sprite,
    material,
    texture,
    canvas,
    context,
    labelText,
    distanceText,
    punchBadgeVisible,
    opacity: 1,
    worldWidth: 1,
    worldHeight: WORLD_HEIGHT,
    anchorPosition: new THREE.Vector3(),
    presentationScale: 1,
    presentationOpacity: 0,
    motionPhase: resolveSignboardMotionPhase(nodeId),
    lastDistanceLabelUpdateMs: Date.now(),
  }
  drawSignboardTexture(entry, style)
  sprite.scale.set(entry.worldWidth, entry.worldHeight, 1)
  return entry
}

function updateSignboardEntry(
  scene: THREE.Scene,
  nodeId: string,
  object: THREE.Object3D | null,
  resolveLabel: (nodeId: string) => string,
  isPunched: (nodeId: string) => boolean,
  style: SignboardBillboardStyle,
  distanceReferenceWorld?: THREE.Vector3 | null,
): void {
  let entry = signboardEntries.get(nodeId)
  if (!object) {
    if (entry) {
      entry.sprite.visible = false
      entry.material.opacity = 0
      entry.opacity = 0
      entry.presentationOpacity = 0
    }
    return
  }

  if (!isRuntimeObjectEffectivelyVisible(object)) {
    if (entry) {
      entry.sprite.visible = false
      entry.material.opacity = 0
      entry.opacity = 0
      entry.presentationOpacity = 0
    }
    return
  }

  const labelText = resolveLabel(nodeId)
  const punchBadgeVisible = isPunched(nodeId)
  object.getWorldPosition(signboardAnchorScratch)
  signboardAnchorScratch.y += SIGNBOARD_WORLD_Y_OFFSET + BILLBOARD_WORLD_Y_OFFSET
  const distanceReference = distanceReferenceWorld ?? signboardCameraScratch
  const distanceMeters = signboardAnchorScratch.distanceTo(distanceReference)
  const presentation = computeSignboardDistancePresentation(distanceMeters)
  const quantizedDistanceMeters = quantizeSignboardDistance(distanceMeters)
  const distanceText = formatSignboardDistance(quantizedDistanceMeters)

  if (!entry) {
    entry = createSignboardEntry(scene, nodeId, labelText, distanceText, punchBadgeVisible, style)
    signboardEntries.set(nodeId, entry)
  }

  const nowMs = Date.now()
  const labelChanged = entry.labelText !== labelText
  const distanceChanged = entry.distanceText !== distanceText
  const allowDistanceLabelRefresh =
    distanceChanged && (nowMs - entry.lastDistanceLabelUpdateMs >= DISTANCE_LABEL_REFRESH_INTERVAL_MS)
  const textChanged = labelChanged || allowDistanceLabelRefresh
  const punchChanged = entry.punchBadgeVisible !== punchBadgeVisible
  const shouldRefreshDistanceText = distanceChanged && (textChanged || punchChanged)
  if (textChanged || punchChanged) {
    entry.labelText = labelText
    if (shouldRefreshDistanceText) {
      entry.distanceText = distanceText
      entry.lastDistanceLabelUpdateMs = nowMs
    }
    entry.punchBadgeVisible = punchBadgeVisible
    drawSignboardTexture(entry, style)
  }

  entry.sprite.position.copy(signboardAnchorScratch)
  entry.sprite.scale.set(entry.worldWidth * presentation.scale, entry.worldHeight * presentation.scale, 1)
  const cardVisible = presentation.visible
    && distanceMeters <= SIGNBOARD_MAX_DISTANCE
    && presentation.opacity > 0.01
  entry.material.opacity = cardVisible ? presentation.opacity : 0
  entry.sprite.visible = cardVisible
  entry.opacity = cardVisible ? presentation.opacity : 0
  entry.anchorPosition.copy(signboardAnchorScratch)
  entry.presentationScale = presentation.scale
  entry.presentationOpacity = cardVisible ? presentation.opacity : 0
}

export function syncSignboardBillboards(params: {
  scene: THREE.Scene | null | undefined
  camera: THREE.Camera | null | undefined
  nodeObjectMap: Map<string, THREE.Object3D>
  signboardNodeIds: Set<string>
  resolveLabel: (nodeId: string) => string
  isPunched?: (nodeId: string) => boolean
  appearance?: Partial<SignboardBillboardStyle>
  distanceReferenceWorld?: THREE.Vector3 | null
  viewportWidth?: number
  viewportHeight?: number
  safeArea?: Partial<SignboardGuidanceInsets>
}): SignboardGuidanceEntry[] {
  const {
    scene,
    camera,
    nodeObjectMap,
    signboardNodeIds,
    resolveLabel,
    distanceReferenceWorld,
  } = params
  if (!scene || !camera) {
    return []
  }
  const style = resolveStyle(params.appearance)
  const isPunched = params.isPunched ?? (() => false)
  camera.getWorldPosition(signboardCameraScratch)
  const resolvedDistanceReference = distanceReferenceWorld ?? signboardCameraScratch
  const guidanceCandidates: Array<{
    nodeId: string
    label: string
    anchorWorld: THREE.Vector3
    distanceMeters: number
  }> = []

  for (const [nodeId, entry] of signboardEntries) {
    if (!signboardNodeIds.has(nodeId)) {
      scene.remove(entry.sprite)
      entry.texture.dispose()
      entry.material.dispose()
      signboardEntries.delete(nodeId)
    }
  }

  signboardNodeIds.forEach((nodeId) => {
    const object = nodeObjectMap.get(nodeId) ?? null
    updateSignboardEntry(
      scene,
      nodeId,
      object,
      resolveLabel,
      isPunched,
      style,
      resolvedDistanceReference,
    )
    if (!object || !isRuntimeObjectEffectivelyVisible(object)) {
      return
    }
    object.getWorldPosition(signboardAnchorScratch)
    signboardAnchorScratch.y += SIGNBOARD_WORLD_Y_OFFSET + BILLBOARD_WORLD_Y_OFFSET
    guidanceCandidates.push({
      nodeId,
      label: resolveLabel(nodeId),
      anchorWorld: signboardAnchorScratch.clone(),
      distanceMeters: signboardAnchorScratch.distanceTo(resolvedDistanceReference),
    })
  })

  const viewportWidth = params.viewportWidth
  const viewportHeight = params.viewportHeight
  if (
    !Number.isFinite(viewportWidth)
    || !Number.isFinite(viewportHeight)
    || (viewportWidth ?? 0) <= 0
    || (viewportHeight ?? 0) <= 0
  ) {
    return []
  }
  return computeSignboardGuidanceEntries({
    candidates: guidanceCandidates,
    camera,
    viewportWidth: viewportWidth!,
    viewportHeight: viewportHeight!,
    safeArea: params.safeArea,
  })
}

export function tickSignboardBillboardMotion(timeSeconds: number): void {
  if (!signboardEntries.size) {
    return
  }
  const resolvedTime = Number.isFinite(timeSeconds) ? timeSeconds : 0
  const motionReduced = shouldReduceSignboardMotion()

  signboardEntries.forEach((entry) => {
    if (!entry.sprite.visible) {
      return
    }
    if (motionReduced) {
      entry.sprite.position.copy(entry.anchorPosition)
      entry.sprite.scale.set(
        entry.worldWidth * entry.presentationScale,
        entry.worldHeight * entry.presentationScale,
        1,
      )
      entry.material.opacity = entry.presentationOpacity
      return
    }

    const cycle = resolvedTime / SIGNBOARD_MOTION_PERIOD_SECONDS * Math.PI * 2 + entry.motionPhase
    const breathScale = 1 + Math.sin(cycle) * SIGNBOARD_MOTION_SCALE_AMPLITUDE
    const bob = Math.sin(cycle) * SIGNBOARD_MOTION_BOB_WORLD
    const glow = 1 + Math.sin(cycle * 0.875 + entry.motionPhase * 0.37) * SIGNBOARD_MOTION_OPACITY_AMPLITUDE

    entry.sprite.position.copy(entry.anchorPosition)
    entry.sprite.position.y += bob
    entry.sprite.scale.set(
      entry.worldWidth * entry.presentationScale * breathScale,
      entry.worldHeight * entry.presentationScale * breathScale,
      1,
    )
    entry.material.opacity = Math.min(1, Math.max(0, entry.presentationOpacity * glow))
  })
}

export function disposeSignboardBillboards(scene?: THREE.Scene | null): void {
  signboardEntries.forEach((entry) => {
    if (scene) {
      scene.remove(entry.sprite)
    } else {
      entry.sprite.parent?.remove(entry.sprite)
    }
    entry.texture.dispose()
    entry.material.dispose()
  })
  signboardEntries.clear()
}
