import * as THREE from 'three'
import {
  SIGNBOARD_CLOSE_FADE_DISTANCE,
  SIGNBOARD_FADE_START_DISTANCE,
  SIGNBOARD_MAX_DISTANCE,
  SIGNBOARD_WORLD_Y_OFFSET,
  formatSignboardDistance,
  resolveSignboardAnchorWorldPosition,
} from './signboardOverlay'

type SignboardCanvas = HTMLCanvasElement | OffscreenCanvas | { width: number; height: number; getContext: (type: '2d') => SignboardCanvasContext }
type SignboardCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | any

interface SignboardRuntimeEntry {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  texture: THREE.CanvasTexture
  canvas: SignboardCanvas
  context: SignboardCanvasContext
  labelText: string
  distanceText: string
  punchBadgeVisible: boolean
  opacity: number
  worldWidth: number
  worldHeight: number
}

const signboardEntries = new Map<string, SignboardRuntimeEntry>()
const signboardAnchorScratch = new THREE.Vector3()
const signboardCameraScratch = new THREE.Vector3()

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
const CARD_PADDING_X = 28
const CARD_PADDING_Y = 18
const CONTENT_GAP = 18
const LABEL_FONT_MAX = 28
const LABEL_FONT_MIN = 18
const CARD_MIN_WIDTH = 280
const CARD_MAX_WIDTH = 460
const CARD_CORNER_RADIUS = 22
const WORLD_HEIGHT = 1.16
const BILLBOARD_WORLD_Y_OFFSET = 0.55
const DIVIDER_WIDTH = 1.5
const PUNCH_BADGE_DIAMETER = 24
const PUNCH_BADGE_GAP = 10
const PUNCH_BADGE_TEXT = '✓'

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

function createCanvas(width: number, height: number): SignboardCanvas {
  const globalObject = globalThis as typeof globalThis & {
    OffscreenCanvas?: new (width: number, height: number) => OffscreenCanvas
    uni?: { createOffscreenCanvas?: (options: { type?: '2d'; width: number; height: number }) => SignboardCanvas }
    wx?: { createOffscreenCanvas?: (options: { type?: '2d'; width: number; height: number }) => SignboardCanvas }
  }

  if (typeof globalObject.OffscreenCanvas === 'function') {
    return new globalObject.OffscreenCanvas(width, height)
  }
  if (typeof globalObject.uni?.createOffscreenCanvas === 'function') {
    return globalObject.uni.createOffscreenCanvas({ type: '2d', width, height })
  }
  if (typeof globalObject.wx?.createOffscreenCanvas === 'function') {
    return globalObject.wx.createOffscreenCanvas({ type: '2d', width, height })
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    return canvas
  }

  throw new Error('Unable to create a canvas for signboard billboards')
}

function roundRectPath(context: SignboardCanvasContext, x: number, y: number, width: number, height: number, radius: number): void {
  const actualRadius = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + actualRadius, y)
  context.arcTo(x + width, y, x + width, y + height, actualRadius)
  context.arcTo(x + width, y + height, x, y + height, actualRadius)
  context.arcTo(x, y + height, x, y, actualRadius)
  context.arcTo(x, y, x + width, y, actualRadius)
  context.closePath()
}

function resolveStyle(appearance?: Partial<SignboardBillboardStyle>): SignboardBillboardStyle {
  return {
    ...DEFAULT_SIGNBOARD_BILLBOARD_STYLE,
    ...(appearance ?? {}),
  }
}

function drawSignboardBackground(context: SignboardCanvasContext, width: number, height: number, style: SignboardBillboardStyle): void {
  roundRectPath(context, 0, 0, width, height, CARD_CORNER_RADIUS)
  const fill = context.createLinearGradient(0, 0, 0, height)
  fill.addColorStop(0, style.backgroundTopColor)
  fill.addColorStop(0.36, style.backgroundMiddleColor)
  fill.addColorStop(1, style.backgroundBottomColor)
  context.fillStyle = fill
  context.fill()

  context.lineWidth = 1.2
  context.strokeStyle = style.borderColor
  context.stroke()

  const glow = context.createRadialGradient(width * 0.16, height * 0.28, 0, width * 0.16, height * 0.28, width * 0.72)
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.18)')
  glow.addColorStop(0.5, style.glowColor)
  glow.addColorStop(1, 'rgba(115, 196, 255, 0)')
  context.fillStyle = glow
  context.fillRect(0, 0, width, height)

  context.fillStyle = style.sheenColor
  context.fillRect(14, 7, Math.max(0, width - 28), 1)
  context.fillStyle = 'rgba(255, 255, 255, 0.03)'
  context.fillRect(14, height - 8, Math.max(0, width - 28), 1)
}

function measureTextWidth(context: SignboardCanvasContext, text: string): number {
  return context.measureText(text).width
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

function computeOpacity(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return 0
  }
  if (distanceMeters > SIGNBOARD_MAX_DISTANCE) {
    return 0
  }

  const fadeStart = Math.min(SIGNBOARD_FADE_START_DISTANCE, SIGNBOARD_MAX_DISTANCE)
  const farFadeRange = Math.max(SIGNBOARD_MAX_DISTANCE - fadeStart, 1e-6)
  const farFade = Math.min(Math.max((SIGNBOARD_MAX_DISTANCE - distanceMeters) / farFadeRange, 0), 1)
  const closeFade = SIGNBOARD_CLOSE_FADE_DISTANCE > 0
    ? Math.min(Math.max(distanceMeters / SIGNBOARD_CLOSE_FADE_DISTANCE, 0), 1)
    : 1

  return farFade * closeFade
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
  const contentWidth = labelAreaWidth + CONTENT_GAP + DIVIDER_WIDTH + CONTENT_GAP + distanceAreaWidth + badgeAreaWidth
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
  drawSignboardBackground(context, cardWidth, cardHeight, style)

  context.textBaseline = 'middle'
  context.shadowColor = style.textShadowColor
  context.shadowBlur = style.shadowBlur
  context.shadowOffsetY = style.shadowOffsetY

  const baselineY = cardHeight / 2 + 1
  const leftTextX = CARD_PADDING_X + 16
  const labelRightLimit = leftTextX + labelAreaWidth
  const labelText = label.length ? label : ' '
  context.textAlign = 'left'
  context.fillStyle = style.labelColor
  context.font = `700 ${labelFontSize}px sans-serif`
  context.fillText(labelText, leftTextX, baselineY)

  const dividerX = Math.min(cardWidth - CARD_PADDING_X - distanceAreaWidth - CONTENT_GAP, labelRightLimit + CONTENT_GAP)
  context.shadowColor = 'transparent'
  context.strokeStyle = style.dividerColor
  context.lineWidth = DIVIDER_WIDTH
  context.beginPath()
  context.moveTo(dividerX, CARD_PADDING_Y - 2)
  context.lineTo(dividerX, cardHeight - CARD_PADDING_Y + 2)
  context.stroke()

  const distanceX = cardWidth - CARD_PADDING_X - 4
  context.textAlign = 'right'
  context.shadowColor = style.textShadowColor
  context.shadowBlur = Math.max(0, style.shadowBlur - 2)
  context.fillStyle = style.distanceTextAccentColor
  context.font = `600 ${distanceFontSize}px sans-serif`
  context.fillText(distance, distanceX, baselineY)

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

  const texture = new THREE.CanvasTexture(canvas as CanvasImageSource)
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
  }
  drawSignboardTexture(entry, style)
  sprite.scale.set(entry.worldWidth, entry.worldHeight, 1)
  return entry
}

function updateSignboardEntry(
  scene: THREE.Scene,
  camera: THREE.Camera,
  nodeId: string,
  object: THREE.Object3D | null,
  resolveLabel: (nodeId: string) => string,
  isPunched: (nodeId: string) => boolean,
  style: SignboardBillboardStyle,
): void {
  let entry = signboardEntries.get(nodeId)
  if (!object) {
    if (entry) {
      entry.sprite.visible = false
      entry.material.opacity = 0
    }
    return
  }

  const labelText = resolveLabel(nodeId)
  const punchBadgeVisible = isPunched(nodeId)
  object.updateWorldMatrix(true, true)
  resolveSignboardAnchorWorldPosition(object, signboardAnchorScratch, SIGNBOARD_WORLD_Y_OFFSET + BILLBOARD_WORLD_Y_OFFSET)
  camera.getWorldPosition(signboardCameraScratch)
  const distanceMeters = signboardAnchorScratch.distanceTo(signboardCameraScratch)
  const opacity = computeOpacity(distanceMeters)
  const distanceText = formatSignboardDistance(distanceMeters)

  if (!entry) {
    entry = createSignboardEntry(scene, nodeId, labelText, distanceText, punchBadgeVisible, style)
    signboardEntries.set(nodeId, entry)
  }

  const textChanged = entry.labelText !== labelText || entry.distanceText !== distanceText
  const punchChanged = entry.punchBadgeVisible !== punchBadgeVisible
  if (textChanged || punchChanged) {
    entry.labelText = labelText
    entry.distanceText = distanceText
    entry.punchBadgeVisible = punchBadgeVisible
    drawSignboardTexture(entry, style)
    entry.sprite.scale.set(entry.worldWidth, entry.worldHeight, 1)
  }

  entry.sprite.position.copy(signboardAnchorScratch)
  entry.material.opacity = opacity
  entry.sprite.visible = opacity > 0.01
  entry.opacity = opacity
}

export function syncSignboardBillboards(params: {
  scene: THREE.Scene | null | undefined
  camera: THREE.Camera | null | undefined
  nodeObjectMap: Map<string, THREE.Object3D>
  signboardNodeIds: Set<string>
  resolveLabel: (nodeId: string) => string
  isPunched?: (nodeId: string) => boolean
  appearance?: Partial<SignboardBillboardStyle>
}): void {
  const { scene, camera, nodeObjectMap, signboardNodeIds, resolveLabel } = params
  if (!scene || !camera) {
    return
  }
  const style = resolveStyle(params.appearance)
  const isPunched = params.isPunched ?? (() => false)

  for (const [nodeId, entry] of signboardEntries) {
    if (!signboardNodeIds.has(nodeId)) {
      scene.remove(entry.sprite)
      entry.texture.dispose()
      entry.material.dispose()
      signboardEntries.delete(nodeId)
    }
  }

  signboardNodeIds.forEach((nodeId) => {
    updateSignboardEntry(scene, camera, nodeId, nodeObjectMap.get(nodeId) ?? null, resolveLabel, isPunched, style)
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