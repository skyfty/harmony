import type {
  BehaviorEventType,
  BehaviorComponentProps,
  BehaviorScriptType,
  DelayBehaviorParams,
  LookBehaviorParams,
  MoveToBehaviorParams,
  MoveToFacingDirection,
  SceneBehavior,
  SceneBehaviorMap,
  SceneBehaviorScriptBinding,
  ShowAlertBehaviorParams,
  ShowBehaviorParams,
  LanternBehaviorParams,
  LanternSlideDefinition,
  LanternSlideLayout,
  HideBehaviorParams,
  WatchBehaviorParams,
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
    label: 'Move To Node',
    description: 'Slide the camera to the node and orient it relative to the node.',
    icon: 'mdi-camera-control',
    createDefaultParams(): MoveToBehaviorParams {
      return {
        speed: 2,
        facing: 'front',
        offset: 2,
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
        showConfirm: true,
        confirmText: DEFAULT_CONFIRM_TEXT,
        showCancel: false,
        cancelText: DEFAULT_CANCEL_TEXT,
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
      }
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
      const facing: MoveToFacingDirection = params?.facing ?? 'front'
      return {
        type: 'moveTo',
        params: {
          speed: Math.max(0, params?.speed ?? 0),
          facing,
          offset: Math.max(0, params?.offset ?? 0),
        },
      }
    }
    case 'showAlert':
      return {
        type: 'showAlert',
        params: {
          content: binding.params?.content ?? '',
          showConfirm: binding.params?.showConfirm ?? true,
          confirmText: binding.params?.confirmText ?? DEFAULT_CONFIRM_TEXT,
          showCancel: binding.params?.showCancel ?? false,
          cancelText: binding.params?.cancelText ?? DEFAULT_CANCEL_TEXT,
        },
      }
    case 'watch': {
      const params = binding.params as WatchBehaviorParams | undefined
      return {
        type: 'watch',
        params: {
          targetNodeId: params?.targetNodeId ?? null,
        },
      }
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
        const facing: MoveToFacingDirection = params?.facing ?? 'front'
        return {
          type: 'moveTo',
          params: {
            speed: Math.max(0, params?.speed ?? 0),
            facing,
            offset: Math.max(0, params?.offset ?? 0),
          },
        }
      }
      case 'showAlert': {
        const params = script.params as Partial<ShowAlertBehaviorParams>
        return {
          type: 'showAlert',
          params: {
            content: params?.content ?? '',
            showConfirm: params?.showConfirm ?? true,
            confirmText: params?.confirmText ?? DEFAULT_CONFIRM_TEXT,
            showCancel: params?.showCancel ?? false,
            cancelText: params?.cancelText ?? DEFAULT_CANCEL_TEXT,
          },
        }
      }
      case 'watch': {
        const params = script.params as Partial<WatchBehaviorParams> | undefined
        return {
          type: 'watch',
          params: {
            targetNodeId: params?.targetNodeId ?? null,
          },
        }
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
    }
  }
  return script
}
