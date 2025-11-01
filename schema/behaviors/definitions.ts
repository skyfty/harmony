import type {
  BehaviorEventType,
  BehaviorComponentProps,
  BehaviorScriptType,
  DelayBehaviorParams,
  FailureBehaviorParams,
  LookBehaviorParams,
  MoveToBehaviorParams,
  MoveToFacingDirection,
  SceneBehavior,
  SceneBehaviorMap,
  SceneBehaviorScriptBinding,
  ShowAlertBehaviorParams,
  SuccessBehaviorParams,
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
    id: 'hover',
    label: 'On Hover',
    description: 'Triggered while the pointer hovers over the node.',
  },
  {
    id: 'drag',
    label: 'On Drag',
    description: 'Triggered when the node starts dragging.',
  },
  {
    id: 'perform',
    label: 'Perform',
    description: 'Triggered manually to run a scripted sequence.',
  },
]

const DEFAULT_CONFIRM_TEXT = 'Confirm'
const DEFAULT_CANCEL_TEXT = 'Cancel'

const scriptDefinitions: BehaviorScriptDefinition[] = [
  {
    id: 'success',
    label: 'Success',
    description: 'Stop the sequence immediately and mark it as successful.',
    icon: 'mdi-check-circle-outline',
    createDefaultParams(): SuccessBehaviorParams {
      return {}
    },
  },
  {
    id: 'failure',
    label: 'Failure',
    description: 'Stop the sequence immediately and mark it as failed.',
    icon: 'mdi-close-circle-outline',
    createDefaultParams(): FailureBehaviorParams {
      return {}
    },
  },
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
    label: 'Watch Node',
    description: 'Aim the camera at a chosen target node.',
    icon: 'mdi-eye-outline',
    createDefaultParams(): WatchBehaviorParams {
      return {
        targetNodeId: null,
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
    case 'success':
      return {
        type: 'success',
        params: {},
      }
    case 'failure':
      return {
        type: 'failure',
        params: {},
      }
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
      case 'success':
        return { type: 'success', params: {} }
      case 'failure':
        return { type: 'failure', params: {} }
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
      case 'look':
        return {
          type: 'look',
          params: {},
        }
    }
  }
  return script
}
