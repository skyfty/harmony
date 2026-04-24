import type {
  BehaviorEventType,
  BehaviorComponentProps,
  BehaviorScriptType,
  DelayBehaviorParams,
  LookBehaviorParams,
  MoveToBehaviorParams,
  SceneBehavior,
  SceneBehaviorMap,
  SceneBehaviorScriptBinding,
  ShowAlertBehaviorParams,
  BubbleBehaviorAnimationPreset,
  BubbleBehaviorAnchorMode,
  BubbleBehaviorParams,
  BubbleBehaviorVariant,
  InfoBoardBehaviorParams,
  PlaySoundBehaviorParams,
  SoundDistanceResponseMode,
  SoundBehaviorCommand,
  SoundPlaybackMode,
  ShowBehaviorParams,
  LanternBehaviorParams,
  LanternSlideDefinition,
  LanternSlideLayout,
  HideBehaviorParams,
  WatchBehaviorParams,
  ShowPurposeBehaviorParams,
  HidePurposeBehaviorParams,
  TriggerBehaviorParams,
  AnimationBehaviorParams,
  ShowCockpitBehaviorParams,
  HideCockpitBehaviorParams,
  DriveBehaviorParams,
  ControlCharacterBehaviorParams,
  ReleaseCharacterBehaviorParams,
  DebusBehaviorParams,
  LoadSceneBehaviorParams,
  ExitSceneBehaviorParams,
  PunchBehaviorParams,
} from '../index'

export interface BehaviorActionDefinition {
  id: BehaviorEventType
  label: string
  description?: string
}

export interface BehaviorScriptDefinition<TParams = unknown> {
  id: BehaviorScriptType
  label: string
  description?: string
  icon: string
  createDefaultParams(): TParams
}

const actionDefinitions: BehaviorActionDefinition[] = [
  {
    id: 'click',
    label: 'On Click',
    description: 'Triggered when the node is clicked or tapped.',
  },
  {
    id: 'approach',
    label: 'On Approach',
    description: 'Triggered when the camera moves within range of the node.',
  },
  {
    id: 'depart',
    label: 'On Depart',
    description: 'Triggered when the camera exits the node\'s proximity.',
  },
  {
    id: 'perform',
    label: 'Perform',
    description: 'Triggered manually to run a scripted sequence.',
  },
]

const DEFAULT_CONFIRM_TEXT = 'Confirm'
const DEFAULT_CANCEL_TEXT = 'Cancel'
const DEFAULT_BUBBLE_DURATION_SECONDS = 2.5
const DEFAULT_BUBBLE_DELAY_SECONDS = 0
const DEFAULT_BUBBLE_MAX_DISTANCE_METERS = 0
const DEFAULT_BUBBLE_SCREEN_OFFSET_X = 0
const DEFAULT_BUBBLE_SCREEN_OFFSET_Y = -12
const DEFAULT_BUBBLE_WORLD_OFFSET_Y = 1.6
const DEFAULT_PLAY_SOUND_VOLUME = 1
const DEFAULT_PLAY_SOUND_PLAYBACK_RATE = 1
const DEFAULT_PLAY_SOUND_DETUNE_CENTS = 0
const DEFAULT_PLAY_SOUND_START_DELAY_SECONDS = 0
const DEFAULT_PLAY_SOUND_DURATION_SECONDS = 0
const DEFAULT_PLAY_SOUND_FADE_IN_SECONDS = 0
const DEFAULT_PLAY_SOUND_FADE_OUT_SECONDS = 0
const DEFAULT_PLAY_SOUND_MIN_INTERVAL_SECONDS = 4
const DEFAULT_PLAY_SOUND_MAX_INTERVAL_SECONDS = 12
const DEFAULT_PLAY_SOUND_MAX_DISTANCE_METERS = 20
const DEFAULT_PLAY_SOUND_REF_DISTANCE_METERS = 1.5
const DEFAULT_PLAY_SOUND_ROLLOFF_FACTOR = 1
const DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_MODE: SoundDistanceResponseMode = 'off'
const DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_START_METERS = 0
const DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_END_METERS = 8
const DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_SUPPRESSED_GAIN = 0.15
const DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_CURVE_POWER = 1

function normalizeAssetId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.max(0, numeric)
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return numeric
}

function normalizeClampedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = normalizeFiniteNumber(value, fallback)
  return Math.min(max, Math.max(min, numeric))
}

function normalizeBubbleVariant(value: string | null | undefined): BubbleBehaviorVariant {
  switch (value) {
    case 'success':
    case 'warning':
    case 'danger':
      return value
    default:
      return 'info'
  }
}

function normalizeBubbleAnimationPreset(value: string | null | undefined): BubbleBehaviorAnimationPreset {
  switch (value) {
    case 'fade':
    case 'scale':
    case 'shake':
      return value
    default:
      return 'float'
  }
}

function normalizeBubbleAnchorMode(value: string | null | undefined): BubbleBehaviorAnchorMode {
  switch (value) {
    case 'nodeAnchored':
      return 'nodeAnchored'
    default:
      return 'screenFixed'
  }
}

function normalizeSoundCommand(value: string | null | undefined): SoundBehaviorCommand {
  return value === 'stop' ? 'stop' : 'play'
}

function normalizeSoundPlaybackMode(value: string | null | undefined): SoundPlaybackMode {
  switch (value) {
    case 'loop':
    case 'interval':
      return value
    default:
      return 'once'
  }
}

function normalizeSoundDistanceResponseMode(value: string | null | undefined): SoundDistanceResponseMode {
  switch (value) {
    case 'near-loud':
    case 'near-quiet':
      return value
    default:
      return 'off'
  }
}

let lanternSlideCounter = 0

function generateLanternSlideId(): string {
  lanternSlideCounter += 1
  return `lantern_slide_${Date.now()}_${lanternSlideCounter.toString(16)}`
}

function normalizeLanternLayout(layout: string | null | undefined): LanternSlideLayout {
  switch (layout) {
    case 'imageTop':
    case 'imageLeft':
    case 'imageRight':
      return layout
    default:
      return 'imageTop'
  }
}

function normalizeLanternSlides(slides: LanternSlideDefinition[] | null | undefined): LanternSlideDefinition[] {
  if (!Array.isArray(slides)) {
    return [
      {
        id: generateLanternSlideId(),
        title: '',
        description: '',
        descriptionAssetId: null,
        imageAssetId: null,
        layout: 'imageTop',
      },
    ]
  }
  if (!slides.length) {
    return []
  }
  return slides.map((slide) => {
    const id = typeof slide?.id === 'string' && slide.id.trim().length ? slide.id.trim() : generateLanternSlideId()
    const title = typeof slide?.title === 'string' ? slide.title.trim() : ''
    const description = typeof slide?.description === 'string' ? slide.description.trim() : ''
    const descriptionAssetRaw = (slide as Partial<LanternSlideDefinition> & { descriptionAssetId?: unknown })?.descriptionAssetId
    const descriptionAssetId = typeof descriptionAssetRaw === 'string' && descriptionAssetRaw.trim().length ? descriptionAssetRaw.trim() : null
    const imageAssetId = typeof slide?.imageAssetId === 'string' && slide.imageAssetId.trim().length ? slide.imageAssetId.trim() : null
    const layout = normalizeLanternLayout(slide?.layout)
    return {
      id,
      title,
      description,
      descriptionAssetId,
      imageAssetId,
      layout,
    }
  })
}

function normalizeTargetNodeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function normalizeSceneId(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

const scriptDefinitions: BehaviorScriptDefinition[] = [
  {
    id: 'delay',
    label: 'Delay',
    description: 'Pause the sequence for a period of time before continuing.',
    icon: 'mdi-clock-outline',
    createDefaultParams(): DelayBehaviorParams {
      return {
        seconds: 1,
      }
    },
  },
  {
    id: 'moveTo',
    label: 'Move To',
    description: 'Slide the camera to the node and orient it relative to the node.',
    icon: 'mdi-camera-control',
    createDefaultParams(): MoveToBehaviorParams {
      return {
        targetNodeId: null,
        duration: 0.8,
      }
    },
  },
  {
    id: 'showAlert',
    label: 'Show Alert',
    description: 'Display an overlay message and wait for user confirmation.',
    icon: 'mdi-alert-circle-outline',
    createDefaultParams(): ShowAlertBehaviorParams {
      return {
        content: 'This behavior has been triggered.',
        contentAssetId: null,
        showConfirm: true,
        confirmText: DEFAULT_CONFIRM_TEXT,
        showCancel: false,
        cancelText: DEFAULT_CANCEL_TEXT,
      }
    },
  },
  {
    id: 'bubble',
    label: 'Bubble Prompt',
    description: 'Display a short floating HUD bubble and continue after it fades out.',
    icon: 'mdi-message-text-outline',
    createDefaultParams(): BubbleBehaviorParams {
      return {
        content: 'Prompt message',
        contentAssetId: null,
        durationSeconds: DEFAULT_BUBBLE_DURATION_SECONDS,
        delaySeconds: DEFAULT_BUBBLE_DELAY_SECONDS,
        anchorMode: 'screenFixed',
        targetNodeId: null,
        repeat: true,
        maxDistanceMeters: DEFAULT_BUBBLE_MAX_DISTANCE_METERS,
        styleVariant: 'info',
        animationPreset: 'float',
        screenOffsetX: DEFAULT_BUBBLE_SCREEN_OFFSET_X,
        screenOffsetY: DEFAULT_BUBBLE_SCREEN_OFFSET_Y,
        worldOffsetY: DEFAULT_BUBBLE_WORLD_OFFSET_Y,
        requireVisibleInView: true,
      }
    },
  },
  {
    id: 'playSound',
    label: 'Play Sound',
    description: 'Play, loop, interval-trigger, or stop an audio asset.',
    icon: 'mdi-volume-high',
    createDefaultParams(): PlaySoundBehaviorParams {
      return {
        assetId: null,
        command: 'play',
        instanceKey: null,
        targetNodeId: null,
        spatial: false,
        playbackMode: 'once',
        volume: DEFAULT_PLAY_SOUND_VOLUME,
        playbackRate: DEFAULT_PLAY_SOUND_PLAYBACK_RATE,
        detuneCents: DEFAULT_PLAY_SOUND_DETUNE_CENTS,
        startDelaySeconds: DEFAULT_PLAY_SOUND_START_DELAY_SECONDS,
        durationSeconds: DEFAULT_PLAY_SOUND_DURATION_SECONDS,
        fadeInSeconds: DEFAULT_PLAY_SOUND_FADE_IN_SECONDS,
        fadeOutSeconds: DEFAULT_PLAY_SOUND_FADE_OUT_SECONDS,
        minIntervalSeconds: DEFAULT_PLAY_SOUND_MIN_INTERVAL_SECONDS,
        maxIntervalSeconds: DEFAULT_PLAY_SOUND_MAX_INTERVAL_SECONDS,
        maxDistanceMeters: DEFAULT_PLAY_SOUND_MAX_DISTANCE_METERS,
        refDistanceMeters: DEFAULT_PLAY_SOUND_REF_DISTANCE_METERS,
        rolloffFactor: DEFAULT_PLAY_SOUND_ROLLOFF_FACTOR,
        distanceResponseMode: DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_MODE,
        distanceResponseStartMeters: DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_START_METERS,
        distanceResponseEndMeters: DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_END_METERS,
        distanceResponseSuppressedGain: DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_SUPPRESSED_GAIN,
        distanceResponseCurvePower: DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_CURVE_POWER,
        waitForCompletion: false,
      }
    },
  },
  {
    id: 'watch',
    label: 'Watch',
    description: 'Aim the camera at a chosen target node.',
    icon: 'mdi-eye-outline',
    createDefaultParams(): WatchBehaviorParams {
      return {
        targetNodeId: null,
        caging: false,
      }
    },
  },
  {
    id: 'showPurpose',
    label: 'Show Purpose',
    description: 'Display observe and level view buttons in the viewer.',
    icon: 'mdi-crosshairs',
    createDefaultParams(): ShowPurposeBehaviorParams {
      return {
        targetNodeId: null,
      }
    },
  },
  {
    id: 'hidePurpose',
    label: 'Hide Purpose',
    description: 'Hide the observe and level view buttons.',
    icon: 'mdi-crosshairs-off',
    createDefaultParams(): HidePurposeBehaviorParams {
      return {}
    },
  },
  {
    id: 'show',
    label: 'Show',
    description: 'Make the target node visible before continuing.',
    icon: 'mdi-eye-plus-outline',
    createDefaultParams(): ShowBehaviorParams {
      return {
        targetNodeId: null,
      }
    },
  },
  {
    id: 'hide',
    label: 'Hide',
    description: 'Hide the target node before continuing.',
    icon: 'mdi-eye-off-outline',
    createDefaultParams(): HideBehaviorParams {
      return {
        targetNodeId: null,
      }
    },
  },
  {
    id: 'showInfoBoard',
    label: 'Show Info Board',
    description: 'Show an information board overlay with optional narration.',
    icon: 'mdi-clipboard-text-outline',
    createDefaultParams(): InfoBoardBehaviorParams {
      return {
        title: '展示板',
        content: 'Information board content.',
        contentAssetId: null,
        audioAssetId: null,
      }
    },
  },
  {
    id: 'hideInfoBoard',
    label: 'Hide Info Board',
    description: 'Hide the active information board overlay and stop narration.',
    icon: 'mdi-clipboard-remove-outline',
    createDefaultParams(): HidePurposeBehaviorParams {
      return {}
    },
  },
  {
    id: 'lantern',
    label: 'Lantern Slides',
    description: 'Display a carousel of slides and wait for confirmation.',
    icon: 'mdi-view-carousel-outline',
    createDefaultParams(): LanternBehaviorParams {
      return {
        slides: normalizeLanternSlides([
          {
            id: generateLanternSlideId(),
            title: '',
            description: '',
            descriptionAssetId: null,
            imageAssetId: null,
            layout: 'imageTop',
          },
        ]),
      }
    },
  },
  {
    id: 'look',
    label: 'Level Look',
    description: 'Level the camera to a horizontal view while keeping position.',
    icon: 'mdi-compass-outline',
    createDefaultParams(): LookBehaviorParams {
      return {}
    },
  },
  {
    id: 'loadScene',
    label: 'Load Scene',
    description: 'Load another scene by scene id.',
    icon: 'mdi-folder-open-outline',
    createDefaultParams(): LoadSceneBehaviorParams {
      return {
        scene: '',
        pushToStack: true,
      }
    },
  },
  {
    id: 'exitScene',
    label: 'Exit Scene',
    description: 'Exit the current scene and return to the previous one.',
    icon: 'mdi-exit-to-app',
    createDefaultParams(): ExitSceneBehaviorParams {
      return {}
    },
  },
  {
    id: 'trigger',
    label: 'Trigger Behavior',
    description: 'Invoke a perform behavior sequence on another node.',
    icon: 'mdi-play-circle-outline',
    createDefaultParams(): TriggerBehaviorParams {
      return {
        targetNodeId: null,
        sequenceId: null,
      }
    },
  },
  {
    id: 'animation',
    label: 'Play Animation',
    description: 'Play an animation clip on the selected node.',
    icon: 'mdi-animation-outline',
    createDefaultParams(): AnimationBehaviorParams {
      return {
        targetNodeId: null,
        clipName: null,
        loop: false,
        waitForCompletion: false,
      }
    },
  },
  {
    id: 'showCockpit',
    label: 'Show Cockpit',
    description: 'Display the vehicle driving controls without changing drive state.',
    icon: 'mdi-steering',
    createDefaultParams(): ShowCockpitBehaviorParams {
      return {}
    },
  },
  {
    id: 'hideCockpit',
    label: 'Hide Cockpit',
    description: 'Hide the vehicle driving controls.',
    icon: 'mdi-steering-off',
    createDefaultParams(): HideCockpitBehaviorParams {
      return {}
    },
  },
  {
    id: 'drive',
    label: 'Drive Vehicle',
    description: 'Attach the camera to a vehicle and show driving controls.',
    icon: 'mdi-steering',
    createDefaultParams(): DriveBehaviorParams {
      return {
        targetNodeId: null,
        seatNodeId: null,
      }
    },
  },
  {
    id: 'controlCharacter',
    label: 'Control Character',
    description: 'Attach the controller to a character node and show character movement controls.',
    icon: 'mdi-account-arrow-right-outline',
    createDefaultParams(): ControlCharacterBehaviorParams {
      return {
        targetNodeId: null,
      }
    },
  },
  {
    id: 'releaseCharacter',
    label: 'Release Character',
    description: 'Exit character control mode and restore default controls.',
    icon: 'mdi-account-arrow-left-outline',
    createDefaultParams(): ReleaseCharacterBehaviorParams {
      return {}
    },
  },
  {
    id: 'debus',
    label: 'Debus Vehicle',
    description: 'Exit vehicle driving mode and restore default controls.',
    icon: 'mdi-car-off',
    createDefaultParams(): DebusBehaviorParams {
      return {}
    },
  },
  {
    id: 'punch',
    label: 'Punch',
    description: 'Emit a punch event so external systems can record scene check-in data.',
    icon: 'mdi-map-marker-check-outline',
    createDefaultParams(): PunchBehaviorParams {
      return {}
    },
  },
]

let sequenceIdCounter = 0

function generateSequenceId(): string {
  sequenceIdCounter += 1
  return `beh_seq_${Date.now()}_${sequenceIdCounter.toString(16)}`
}

function normalizeSequenceId(value: string | null | undefined): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length) {
      return trimmed
    }
  }
  return generateSequenceId()
}

export function createBehaviorSequenceId(): string {
  return generateSequenceId()
}

export function listBehaviorActions(): BehaviorActionDefinition[] {
  return actionDefinitions
}

export function listBehaviorScripts(): BehaviorScriptDefinition[] {
  return scriptDefinitions
}

export function findBehaviorAction(id: BehaviorEventType): BehaviorActionDefinition | null {
  return actionDefinitions.find((entry) => entry.id === id) ?? null
}

export function findBehaviorScript<TParams = unknown>(
  id: BehaviorScriptType,
): BehaviorScriptDefinition<TParams> | null {
  return (scriptDefinitions.find((entry) => entry.id === id) as BehaviorScriptDefinition<TParams> | undefined) ?? null
}

export type BehaviorMap = SceneBehaviorMap

let behaviorStepIdCounter = 0

function createBehaviorStepId(prefix: string): string {
  behaviorStepIdCounter += 1
  return `${prefix}_${Date.now()}_${behaviorStepIdCounter.toString(16)}`
}

export interface WarpGateBehaviorOptions {
  warpGateNodeId: string
  viewPointNodeId?: string | null
  fallbackNodeId?: string | null
  showViewPointSequenceId?: string | null
  hideViewPointSequenceId?: string | null
  name?: string
}

export function createWarpGateBehaviorSequence(options: WarpGateBehaviorOptions): SceneBehavior[] {
  const sharedTarget = options.viewPointNodeId ?? options.fallbackNodeId ?? null
  const result: SceneBehavior[] = []

  const createSequence = (action: BehaviorEventType, scripts: SceneBehaviorScriptBinding[]) => {
    const sequenceId = createBehaviorSequenceId()
    scripts.forEach((script, index) => {
      result.push({
        id: createBehaviorStepId(`warp_gate_${action}_${index}`),
        name: options.name ?? '',
        action,
        sequenceId,
        script: ensureBehaviorParams(script),
      })
    })
  }

  createSequence('click', [
    {
      type: 'moveTo',
      params: {
        targetNodeId: options.warpGateNodeId,
      },
    } as SceneBehaviorScriptBinding,
    {
      type: 'watch',
      params: {
        targetNodeId: sharedTarget,
      },
    } as SceneBehaviorScriptBinding,
  ])

  createSequence('approach', [
    {
      type: 'hide',
      params: {
        targetNodeId: options.warpGateNodeId,
      },
    } as SceneBehaviorScriptBinding,
    {
      type: 'showPurpose',
      params: {
        targetNodeId: sharedTarget,
      },
    } as SceneBehaviorScriptBinding,
    {
      type: 'trigger',
      params: {
        targetNodeId: sharedTarget,
        sequenceId: options.showViewPointSequenceId ?? null,
      },
    } as SceneBehaviorScriptBinding,
  ])

  createSequence('depart', [
    {
      type: 'show',
      params: {
        targetNodeId: options.warpGateNodeId,
      },
    } as SceneBehaviorScriptBinding,
    {
      type: 'hidePurpose',
      params: {},
    } as SceneBehaviorScriptBinding,
    {
      type: 'trigger',
      params: {
        targetNodeId: sharedTarget,
        sequenceId: options.hideViewPointSequenceId ?? null,
      },
    } as SceneBehaviorScriptBinding,
  ])

  return result
}

export const NAMED_BEHAVIOR_SEQUENCES_KEY = 'namedBehaviorSequences'

export interface NamedBehaviorSequenceEntry {
  action: BehaviorEventType
  name: string
  sequenceId: string
}

export type NamedBehaviorSequenceMap = Record<string, NamedBehaviorSequenceEntry>

const VALID_BEHAVIOR_ACTIONS: BehaviorEventType[] = ['click', 'approach', 'depart', 'perform']

function normalizeNamedSequenceKey(name: string): string {
  return name.trim().toLowerCase()
}

export function normalizeNamedBehaviorSequenceMap(input: unknown): NamedBehaviorSequenceMap {
  if (!input || typeof input !== 'object') {
    return {}
  }
  const map: NamedBehaviorSequenceMap = {}
  Object.entries(input as Record<string, unknown>).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') {
      return
    }
    const candidate = value as Partial<NamedBehaviorSequenceEntry> & {
      action?: unknown
      sequenceId?: unknown
      name?: unknown
    }
    const rawAction = candidate.action
    if (typeof rawAction !== 'string' || !VALID_BEHAVIOR_ACTIONS.includes(rawAction as BehaviorEventType)) {
      return
    }
    const sequenceId = typeof candidate.sequenceId === 'string' && candidate.sequenceId.trim().length
      ? candidate.sequenceId.trim()
      : ''
    if (!sequenceId) {
      return
    }
    const rawName = typeof candidate.name === 'string' && candidate.name.trim().length
      ? candidate.name.trim()
      : key
    const normalizedKey = normalizeNamedSequenceKey(rawName)
    map[normalizedKey] = {
      action: rawAction as BehaviorEventType,
      name: rawName,
      sequenceId,
    }
  })
  return map
}

export function getNamedBehaviorSequence(
  map: NamedBehaviorSequenceMap,
  name: string,
): NamedBehaviorSequenceEntry | null {
  return map[normalizeNamedSequenceKey(name)] ?? null
}

export function upsertNamedBehaviorSequence(
  map: NamedBehaviorSequenceMap,
  name: string,
  action: BehaviorEventType,
  options: { sequenceId?: string } = {},
): { map: NamedBehaviorSequenceMap; entry: NamedBehaviorSequenceEntry } {
  const normalizedKey = normalizeNamedSequenceKey(name)
  const existing = map[normalizedKey]
  if (existing) {
    return { map, entry: existing }
  }
  const sequenceId = options.sequenceId && options.sequenceId.trim().length
    ? options.sequenceId.trim()
    : createBehaviorSequenceId()
  const entry: NamedBehaviorSequenceEntry = {
    action,
    name,
    sequenceId,
  }
  return {
    map: {
      ...map,
      [normalizedKey]: entry,
    },
    entry,
  }
}

export function createEmptyBehaviorComponentProps(): BehaviorComponentProps {
  return {
    behaviors: [],
  }
}

function cloneScriptBinding(binding: SceneBehaviorScriptBinding): SceneBehaviorScriptBinding {
  switch (binding.type) {
    case 'delay':
      return {
        type: 'delay',
        params: {
          seconds: Math.max(0, binding.params?.seconds ?? 0),
        },
      }
    case 'moveTo': {
      const params = binding.params as MoveToBehaviorParams | undefined
      return {
        type: 'moveTo',
        params: {
          targetNodeId: params?.targetNodeId ?? null,
          duration: Math.max(0, params?.duration ?? 0.6),
        },
      }
    }
    case 'showAlert':
      return {
        type: 'showAlert',
        params: {
          content: binding.params?.content ?? '',
          contentAssetId: binding.params?.contentAssetId ?? null,
          showConfirm: binding.params?.showConfirm ?? true,
          confirmText: binding.params?.confirmText ?? DEFAULT_CONFIRM_TEXT,
          showCancel: binding.params?.showCancel ?? false,
          cancelText: binding.params?.cancelText ?? DEFAULT_CANCEL_TEXT,
        },
      }
    case 'bubble': {
      const params = binding.params as BubbleBehaviorParams | undefined
      return {
        type: 'bubble',
        params: {
          content: typeof params?.content === 'string' ? params.content : 'Prompt message',
          contentAssetId: normalizeAssetId(params?.contentAssetId),
          durationSeconds: normalizeNonNegativeNumber(params?.durationSeconds, DEFAULT_BUBBLE_DURATION_SECONDS),
          delaySeconds: normalizeNonNegativeNumber(params?.delaySeconds, DEFAULT_BUBBLE_DELAY_SECONDS),
          anchorMode: normalizeBubbleAnchorMode(params?.anchorMode),
          targetNodeId: normalizeTargetNodeId(params?.targetNodeId),
          repeat: params?.repeat !== false,
          maxDistanceMeters: normalizeNonNegativeNumber(params?.maxDistanceMeters, DEFAULT_BUBBLE_MAX_DISTANCE_METERS),
          styleVariant: normalizeBubbleVariant(params?.styleVariant),
          animationPreset: normalizeBubbleAnimationPreset(params?.animationPreset),
          screenOffsetX: normalizeFiniteNumber(params?.screenOffsetX, DEFAULT_BUBBLE_SCREEN_OFFSET_X),
          screenOffsetY: normalizeFiniteNumber(params?.screenOffsetY, DEFAULT_BUBBLE_SCREEN_OFFSET_Y),
          worldOffsetY: normalizeFiniteNumber(params?.worldOffsetY, DEFAULT_BUBBLE_WORLD_OFFSET_Y),
          requireVisibleInView: params?.requireVisibleInView !== false,
        },
      }
    }
    case 'playSound': {
      const params = binding.params as PlaySoundBehaviorParams | undefined
      const command = normalizeSoundCommand(params?.command)
      const playbackMode = normalizeSoundPlaybackMode(params?.playbackMode)
      const distanceResponseStartMeters = normalizeNonNegativeNumber(
        params?.distanceResponseStartMeters,
        DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_START_METERS,
      )
      return {
        type: 'playSound',
        params: {
          assetId: normalizeAssetId(params?.assetId),
          command,
          instanceKey: normalizeAssetId(params?.instanceKey),
          targetNodeId: normalizeTargetNodeId(params?.targetNodeId),
          spatial: params?.spatial === true,
          playbackMode,
          volume: normalizeClampedNumber(params?.volume, DEFAULT_PLAY_SOUND_VOLUME, 0, 1),
          playbackRate: normalizeClampedNumber(params?.playbackRate, DEFAULT_PLAY_SOUND_PLAYBACK_RATE, 0.25, 4),
          detuneCents: normalizeClampedNumber(params?.detuneCents, DEFAULT_PLAY_SOUND_DETUNE_CENTS, -2400, 2400),
          startDelaySeconds: normalizeNonNegativeNumber(params?.startDelaySeconds, DEFAULT_PLAY_SOUND_START_DELAY_SECONDS),
          durationSeconds: normalizeNonNegativeNumber(params?.durationSeconds, DEFAULT_PLAY_SOUND_DURATION_SECONDS),
          fadeInSeconds: normalizeNonNegativeNumber(params?.fadeInSeconds, DEFAULT_PLAY_SOUND_FADE_IN_SECONDS),
          fadeOutSeconds: normalizeNonNegativeNumber(params?.fadeOutSeconds, DEFAULT_PLAY_SOUND_FADE_OUT_SECONDS),
          minIntervalSeconds: normalizeNonNegativeNumber(params?.minIntervalSeconds, DEFAULT_PLAY_SOUND_MIN_INTERVAL_SECONDS),
          maxIntervalSeconds: Math.max(
            normalizeNonNegativeNumber(params?.minIntervalSeconds, DEFAULT_PLAY_SOUND_MIN_INTERVAL_SECONDS),
            normalizeNonNegativeNumber(params?.maxIntervalSeconds, DEFAULT_PLAY_SOUND_MAX_INTERVAL_SECONDS),
          ),
          maxDistanceMeters: normalizeNonNegativeNumber(params?.maxDistanceMeters, DEFAULT_PLAY_SOUND_MAX_DISTANCE_METERS),
          refDistanceMeters: normalizeNonNegativeNumber(params?.refDistanceMeters, DEFAULT_PLAY_SOUND_REF_DISTANCE_METERS),
          rolloffFactor: normalizeNonNegativeNumber(params?.rolloffFactor, DEFAULT_PLAY_SOUND_ROLLOFF_FACTOR),
          distanceResponseMode: normalizeSoundDistanceResponseMode(params?.distanceResponseMode),
          distanceResponseStartMeters,
          distanceResponseEndMeters: Math.max(
            distanceResponseStartMeters,
            normalizeNonNegativeNumber(params?.distanceResponseEndMeters, DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_END_METERS),
          ),
          distanceResponseSuppressedGain: normalizeClampedNumber(
            params?.distanceResponseSuppressedGain,
            DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_SUPPRESSED_GAIN,
            0,
            1,
          ),
          distanceResponseCurvePower: Math.max(
            0.01,
            normalizeNonNegativeNumber(
              params?.distanceResponseCurvePower,
              DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_CURVE_POWER,
            ),
          ),
          waitForCompletion: command === 'play' && playbackMode === 'once' ? Boolean(params?.waitForCompletion) : false,
        },
      }
    }
    case 'watch': {
      const params = binding.params as WatchBehaviorParams | undefined
      return {
        type: 'watch',
        params: {
          targetNodeId: params?.targetNodeId ?? null,
          caging: params?.caging === true,
        },
      }
    }
    case 'showPurpose': {
      const params = binding.params as ShowPurposeBehaviorParams | undefined
      return {
        type: 'showPurpose',
        params: {
          targetNodeId: params?.targetNodeId ?? null,
        },
      }
    }
    case 'hidePurpose':
      return {
        type: 'hidePurpose',
        params: {},
      }
    case 'show': {
      const params = binding.params as ShowBehaviorParams | undefined
      return {
        type: 'show',
        params: {
          targetNodeId: params?.targetNodeId ?? null,
        },
      }
    }
    case 'hide': {
      const params = binding.params as HideBehaviorParams | undefined
      return {
        type: 'hide',
        params: {
          targetNodeId: params?.targetNodeId ?? null,
        },
      }
    }
    case 'lantern': {
      const params = binding.params as LanternBehaviorParams | undefined
      return {
        type: 'lantern',
        params: {
          slides: normalizeLanternSlides(params?.slides),
        },
      }
    }
    case 'look':
      return {
        type: 'look',
        params: {},
      }
    case 'loadScene': {
      const params = binding.params as LoadSceneBehaviorParams | undefined
      return {
        type: 'loadScene',
        params: {
          scene: normalizeSceneId(params?.scene),
          pushToStack: typeof params?.pushToStack === 'boolean' ? params.pushToStack : true,
        },
      }
    }
    case 'exitScene':
      return {
        type: 'exitScene',
        params: {},
      }
    case 'drive': {
      const params = binding.params as DriveBehaviorParams | undefined
      return {
        type: 'drive',
        params: {
          targetNodeId: normalizeTargetNodeId(params?.targetNodeId),
          seatNodeId: normalizeTargetNodeId(params?.seatNodeId),
        },
      }
    }
    case 'controlCharacter': {
      const params = binding.params as ControlCharacterBehaviorParams | undefined
      return {
        type: 'controlCharacter',
        params: {
          targetNodeId: normalizeTargetNodeId(params?.targetNodeId),
        },
      }
    }
    case 'releaseCharacter':
      return {
        type: 'releaseCharacter',
        params: {},
      }
    case 'debus':
      return {
        type: 'debus',
        params: {},
      }
    case 'punch':
      return {
        type: 'punch',
        params: {},
      }
    case 'trigger': {
      const params = binding.params as TriggerBehaviorParams | undefined
      return {
        type: 'trigger',
        params: {
          targetNodeId: params?.targetNodeId ?? null,
          sequenceId: params?.sequenceId ?? null,
        },
      }
    }
    case 'animation': {
      const params = binding.params as AnimationBehaviorParams | undefined
      const loop = Boolean(params?.loop)
      const clipName = params?.clipName && params.clipName.trim().length ? params.clipName.trim() : null
      return {
        type: 'animation',
        params: {
          targetNodeId: params?.targetNodeId ?? null,
          clipName,
          loop,
          waitForCompletion: loop ? false : Boolean(params?.waitForCompletion),
        },
      }
    }
  }
  return binding
}

export function cloneBehavior(input: SceneBehavior): SceneBehavior {
  return {
    id: input.id,
    name: input.name,
    action: input.action,
    sequenceId: normalizeSequenceId(input.sequenceId),
    script: cloneScriptBinding(input.script),
  }
}

export function cloneBehaviorList(list: SceneBehavior[] | null | undefined): SceneBehavior[] {
  if (!Array.isArray(list) || !list.length) {
    return []
  }
  return list.map((entry) => cloneBehavior(entry))
}

export function cloneBehaviorMap(
  map: BehaviorMap | Record<BehaviorEventType, SceneBehavior> | null | undefined,
): BehaviorMap {
  if (!map) {
    return {}
  }
  if (Array.isArray(map)) {
    return behaviorListToMap(map)
  }
  const next: BehaviorMap = {}
  ;(Object.keys(map) as BehaviorEventType[]).forEach((action) => {
    const behaviors = (map as Record<string, SceneBehavior | SceneBehavior[] | undefined>)[action]
    if (!behaviors) {
      return
    }
    const normalized = Array.isArray(behaviors) ? behaviors : [behaviors]
    next[action] = cloneBehaviorList(normalized)
  })
  return next
}

export function behaviorMapToList(map: BehaviorMap | null | undefined): SceneBehavior[] {
  if (!map) {
    return []
  }
  const list: SceneBehavior[] = []
  ;(Object.keys(map) as BehaviorEventType[]).forEach((action) => {
    const behaviors = map[action]
    if (!behaviors || !behaviors.length) {
      return
    }
    const baseSequenceId = normalizeSequenceId(behaviors[0]?.sequenceId)
    behaviors.forEach((behavior) => {
      if (!behavior) {
        return
      }
      const sequenceId = normalizeSequenceId(behavior.sequenceId ?? baseSequenceId)
      list.push(cloneBehavior({ ...behavior, action, sequenceId }))
    })
  })
  return list
}

export function behaviorListToMap(list: SceneBehavior[] | null | undefined): BehaviorMap {
  if (!Array.isArray(list) || !list.length) {
    return {}
  }
  const map: BehaviorMap = {}
  list.forEach((entry) => {
    if (!entry) {
      return
    }
    const action = entry.action
    if (!map[action]) {
      map[action] = []
    }
    map[action]!.push(cloneBehavior(entry))
  })
  return map
}

export function createBehaviorTemplate(
  action: BehaviorEventType = 'click',
  scriptType: BehaviorScriptType = 'showAlert',
  sequenceId?: string,
): SceneBehavior {
  const scriptDefinition = findBehaviorScript(scriptType)
  const params = scriptDefinition ? scriptDefinition.createDefaultParams() : {}
  const binding = ensureBehaviorParams({
    type: scriptType,
    params: params as SceneBehaviorScriptBinding['params'],
  } as SceneBehaviorScriptBinding)
  return {
    id: '',
    name: '',
    action,
    sequenceId: normalizeSequenceId(sequenceId),
    script: binding,
  }
}

export function updateBehaviorScriptType(
  behavior: SceneBehavior,
  scriptType: BehaviorScriptType,
): SceneBehavior {
  const template = cloneBehavior(behavior)
  const definition = findBehaviorScript(scriptType)
  template.script = ensureBehaviorParams({
    type: scriptType,
    params: (definition ? definition.createDefaultParams() : {}) as SceneBehaviorScriptBinding['params'],
  } as SceneBehaviorScriptBinding)
  return template
}

export function ensureBehaviorParams(
  script: SceneBehaviorScriptBinding,
): SceneBehaviorScriptBinding {
  const definition = findBehaviorScript(script.type)
  if (definition) {
    switch (script.type) {
      case 'delay': {
        const params = script.params as Partial<DelayBehaviorParams> | undefined
        return {
          type: 'delay',
          params: {
            seconds: Math.max(0, params?.seconds ?? 0),
          },
        }
      }
      case 'moveTo': {
        const params = script.params as Partial<MoveToBehaviorParams> | undefined
        return {
          type: 'moveTo',
          params: {
            targetNodeId: params?.targetNodeId ?? null,
            duration: Math.max(0, params?.duration ?? 0.6),
          },
        }
      }
      case 'showAlert': {
        const params = script.params as Partial<ShowAlertBehaviorParams>
        return {
          type: 'showAlert',
          params: {
            content: params?.content ?? '',
            contentAssetId: params?.contentAssetId ?? null,
            showConfirm: params?.showConfirm ?? true,
            confirmText: params?.confirmText ?? DEFAULT_CONFIRM_TEXT,
            showCancel: params?.showCancel ?? false,
            cancelText: params?.cancelText ?? DEFAULT_CANCEL_TEXT,
          },
        }
      }
      case 'bubble': {
        const params = script.params as Partial<BubbleBehaviorParams> | undefined
        return {
          type: 'bubble',
          params: {
            content: typeof params?.content === 'string' ? params.content : 'Prompt message',
            contentAssetId: normalizeAssetId(params?.contentAssetId),
            durationSeconds: normalizeNonNegativeNumber(params?.durationSeconds, DEFAULT_BUBBLE_DURATION_SECONDS),
            delaySeconds: normalizeNonNegativeNumber(params?.delaySeconds, DEFAULT_BUBBLE_DELAY_SECONDS),
            anchorMode: normalizeBubbleAnchorMode(params?.anchorMode),
            targetNodeId: normalizeTargetNodeId(params?.targetNodeId),
            repeat: params?.repeat !== false,
            maxDistanceMeters: normalizeNonNegativeNumber(params?.maxDistanceMeters, DEFAULT_BUBBLE_MAX_DISTANCE_METERS),
            styleVariant: normalizeBubbleVariant(params?.styleVariant),
            animationPreset: normalizeBubbleAnimationPreset(params?.animationPreset),
            screenOffsetX: normalizeFiniteNumber(params?.screenOffsetX, DEFAULT_BUBBLE_SCREEN_OFFSET_X),
            screenOffsetY: normalizeFiniteNumber(params?.screenOffsetY, DEFAULT_BUBBLE_SCREEN_OFFSET_Y),
            worldOffsetY: normalizeFiniteNumber(params?.worldOffsetY, DEFAULT_BUBBLE_WORLD_OFFSET_Y),
            requireVisibleInView: params?.requireVisibleInView !== false,
          },
        }
      }
      case 'playSound': {
        const params = script.params as Partial<PlaySoundBehaviorParams> | undefined
        const command = normalizeSoundCommand(params?.command)
        const playbackMode = normalizeSoundPlaybackMode(params?.playbackMode)
        const minIntervalSeconds = normalizeNonNegativeNumber(params?.minIntervalSeconds, DEFAULT_PLAY_SOUND_MIN_INTERVAL_SECONDS)
        const distanceResponseStartMeters = normalizeNonNegativeNumber(
          params?.distanceResponseStartMeters,
          DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_START_METERS,
        )
        return {
          type: 'playSound',
          params: {
            assetId: normalizeAssetId(params?.assetId),
            command,
            instanceKey: normalizeAssetId(params?.instanceKey),
            targetNodeId: normalizeTargetNodeId(params?.targetNodeId),
            spatial: params?.spatial === true,
            playbackMode,
            volume: normalizeClampedNumber(params?.volume, DEFAULT_PLAY_SOUND_VOLUME, 0, 1),
            playbackRate: normalizeClampedNumber(params?.playbackRate, DEFAULT_PLAY_SOUND_PLAYBACK_RATE, 0.25, 4),
            detuneCents: normalizeClampedNumber(params?.detuneCents, DEFAULT_PLAY_SOUND_DETUNE_CENTS, -2400, 2400),
            startDelaySeconds: normalizeNonNegativeNumber(params?.startDelaySeconds, DEFAULT_PLAY_SOUND_START_DELAY_SECONDS),
            durationSeconds: normalizeNonNegativeNumber(params?.durationSeconds, DEFAULT_PLAY_SOUND_DURATION_SECONDS),
            fadeInSeconds: normalizeNonNegativeNumber(params?.fadeInSeconds, DEFAULT_PLAY_SOUND_FADE_IN_SECONDS),
            fadeOutSeconds: normalizeNonNegativeNumber(params?.fadeOutSeconds, DEFAULT_PLAY_SOUND_FADE_OUT_SECONDS),
            minIntervalSeconds,
            maxIntervalSeconds: Math.max(
              minIntervalSeconds,
              normalizeNonNegativeNumber(params?.maxIntervalSeconds, DEFAULT_PLAY_SOUND_MAX_INTERVAL_SECONDS),
            ),
            maxDistanceMeters: normalizeNonNegativeNumber(params?.maxDistanceMeters, DEFAULT_PLAY_SOUND_MAX_DISTANCE_METERS),
            refDistanceMeters: normalizeNonNegativeNumber(params?.refDistanceMeters, DEFAULT_PLAY_SOUND_REF_DISTANCE_METERS),
            rolloffFactor: normalizeNonNegativeNumber(params?.rolloffFactor, DEFAULT_PLAY_SOUND_ROLLOFF_FACTOR),
            distanceResponseMode: normalizeSoundDistanceResponseMode(params?.distanceResponseMode),
            distanceResponseStartMeters,
            distanceResponseEndMeters: Math.max(
              distanceResponseStartMeters,
              normalizeNonNegativeNumber(params?.distanceResponseEndMeters, DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_END_METERS),
            ),
            distanceResponseSuppressedGain: normalizeClampedNumber(
              params?.distanceResponseSuppressedGain,
              DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_SUPPRESSED_GAIN,
              0,
              1,
            ),
            distanceResponseCurvePower: Math.max(
              0.01,
              normalizeNonNegativeNumber(
                params?.distanceResponseCurvePower,
                DEFAULT_PLAY_SOUND_DISTANCE_RESPONSE_CURVE_POWER,
              ),
            ),
            waitForCompletion: command === 'play' && playbackMode === 'once' ? Boolean(params?.waitForCompletion) : false,
          },
        }
      }
      case 'watch': {
        const params = script.params as Partial<WatchBehaviorParams> | undefined
        return {
          type: 'watch',
          params: {
            targetNodeId: params?.targetNodeId ?? null,
            caging: params?.caging === true,
          },
        }
      }
      case 'showPurpose': {
        const params = script.params as Partial<ShowPurposeBehaviorParams> | undefined
        return {
          type: 'showPurpose',
          params: {
            targetNodeId: params?.targetNodeId ?? null,
          },
        }
      }
      case 'hidePurpose':
        return {
          type: 'hidePurpose',
          params: {},
        }
      case 'show': {
        const params = script.params as Partial<ShowBehaviorParams> | undefined
        return {
          type: 'show',
          params: {
            targetNodeId: params?.targetNodeId ?? null,
          },
        }
      }
      case 'hide': {
        const params = script.params as Partial<HideBehaviorParams> | undefined
        return {
          type: 'hide',
          params: {
            targetNodeId: params?.targetNodeId ?? null,
          },
        }
      }
      case 'showInfoBoard': {
        const params = script.params as Partial<InfoBoardBehaviorParams> | undefined
        return {
          type: 'showInfoBoard',
          params: {
            title: typeof params?.title === 'string' ? params.title.trim() : '展示板',
            content: typeof params?.content === 'string' ? params.content : 'Information board content.',
            contentAssetId: normalizeAssetId(params?.contentAssetId),
            audioAssetId: normalizeAssetId(params?.audioAssetId),
          },
        }
      }
      case 'hideInfoBoard':
        return {
          type: 'hideInfoBoard',
          params: {},
        }
      case 'lantern': {
        const params = script.params as Partial<LanternBehaviorParams> | undefined
        return {
          type: 'lantern',
          params: {
            slides: normalizeLanternSlides(params?.slides as LanternSlideDefinition[] | null | undefined),
          },
        }
      }
      case 'look':
        return {
          type: 'look',
          params: {},
        }
      case 'loadScene': {
        const params = script.params as Partial<LoadSceneBehaviorParams> | undefined
        return {
          type: 'loadScene',
          params: {
            scene: normalizeSceneId(params?.scene),
            pushToStack: typeof params?.pushToStack === 'boolean' ? params.pushToStack : true,
          },
        }
      }
      case 'exitScene':
        return {
          type: 'exitScene',
          params: {},
        }
      case 'showCockpit':
        return {
          type: 'showCockpit',
          params: {},
        }
      case 'hideCockpit':
        return {
          type: 'hideCockpit',
          params: {},
        }
      case 'drive': {
        const params = script.params as Partial<DriveBehaviorParams> | undefined
        return {
          type: 'drive',
          params: {
            targetNodeId: normalizeTargetNodeId(params?.targetNodeId),
            seatNodeId: normalizeTargetNodeId(params?.seatNodeId),
          },
        }
      }
      case 'controlCharacter': {
        const params = script.params as Partial<ControlCharacterBehaviorParams> | undefined
        return {
          type: 'controlCharacter',
          params: {
            targetNodeId: normalizeTargetNodeId(params?.targetNodeId),
          },
        }
      }
      case 'releaseCharacter':
        return {
          type: 'releaseCharacter',
          params: {},
        }
      case 'debus':
        return {
          type: 'debus',
          params: {},
        }
      case 'punch':
        return {
          type: 'punch',
          params: {},
        }
      case 'trigger': {
        const params = script.params as Partial<TriggerBehaviorParams> | undefined
        return {
          type: 'trigger',
          params: {
            targetNodeId: params?.targetNodeId ?? null,
            sequenceId: params?.sequenceId ?? null,
          },
        }
      }
      case 'animation': {
        const params = script.params as Partial<AnimationBehaviorParams> | undefined
        const loop = Boolean(params?.loop)
        const clipName = params?.clipName && params.clipName.trim().length ? params.clipName.trim() : null
        return {
          type: 'animation',
          params: {
            targetNodeId: params?.targetNodeId ?? null,
            clipName,
            loop,
            waitForCompletion: loop ? false : Boolean(params?.waitForCompletion),
          },
        }
      }
    }
  }
  return script
}
