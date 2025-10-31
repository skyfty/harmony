import type {
  BehaviorActionType,
  BehaviorComponentProps,
  BehaviorScriptType,
  SceneBehavior,
  SceneBehaviorMap,
  SceneBehaviorScriptBinding,
  ShowAlertBehaviorParams,
} from '../index'

export interface BehaviorActionDefinition {
  id: BehaviorActionType
  label: string
  description?: string
}

export interface BehaviorScriptDefinition<TParams = unknown> {
  id: BehaviorScriptType
  label: string
  description?: string
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
]

const scriptDefinitions: BehaviorScriptDefinition[] = [
  {
    id: 'showAlert',
    label: 'Show Alert',
    description: 'Display an overlay message when the behavior fires.',
    createDefaultParams(): ShowAlertBehaviorParams {
      return {
        title: 'Notice',
        message: 'This behavior has been triggered.',
      }
    },
  },
]

export function listBehaviorActions(): BehaviorActionDefinition[] {
  return actionDefinitions
}

export function listBehaviorScripts(): BehaviorScriptDefinition[] {
  return scriptDefinitions
}

export function findBehaviorAction(id: BehaviorActionType): BehaviorActionDefinition | null {
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
    behaviors: {},
  }
}

function cloneScriptBinding(binding: SceneBehaviorScriptBinding): SceneBehaviorScriptBinding {
  switch (binding.type) {
    case 'showAlert':
      return {
        type: 'showAlert',
        params: {
          title: binding.params?.title ?? '',
          message: binding.params?.message ?? '',
        },
      }
    default:
      return { ...binding }
  }
}

export function cloneBehavior(input: SceneBehavior): SceneBehavior {
  return {
    id: input.id,
    name: input.name,
    action: input.action,
    script: cloneScriptBinding(input.script),
  }
}

export function cloneBehaviorMap(map: BehaviorMap | null | undefined): BehaviorMap {
  if (!map) {
    return {}
  }
  if (Array.isArray(map)) {
    return behaviorListToMap(map)
  }
  const next: BehaviorMap = {}
  ;(Object.keys(map) as BehaviorActionType[]).forEach((action) => {
    const behavior = map[action]
    if (!behavior) {
      return
    }
    next[action] = cloneBehavior(behavior)
  })
  return next
}

export function behaviorMapToList(map: BehaviorMap | null | undefined): SceneBehavior[] {
  if (!map) {
    return []
  }
  if (Array.isArray(map)) {
    return map.map((entry) => cloneBehavior(entry))
  }
  const list: SceneBehavior[] = []
  ;(Object.keys(map) as BehaviorActionType[]).forEach((action) => {
    const behavior = map[action]
    if (!behavior) {
      return
    }
    list.push(cloneBehavior(behavior))
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
    map[entry.action] = cloneBehavior(entry)
  })
  return map
}

export function createBehaviorTemplate(
  action: BehaviorActionType = 'click',
  scriptType: BehaviorScriptType = 'showAlert',
): SceneBehavior {
  const scriptDefinition = findBehaviorScript<ShowAlertBehaviorParams>(scriptType)
  const params = scriptDefinition ? scriptDefinition.createDefaultParams() : { message: '', title: '' }
  return {
    id: '',
    name: '',
    action,
    script: {
      type: scriptType,
      params,
    },
  }
}

export function updateBehaviorScriptType(
  behavior: SceneBehavior,
  scriptType: BehaviorScriptType,
): SceneBehavior {
  const template = cloneBehavior(behavior)
  const definition = findBehaviorScript(scriptType)
  template.script = {
    type: scriptType,
    params: definition ? definition.createDefaultParams() : {},
  } as SceneBehaviorScriptBinding
  return template
}

export function ensureBehaviorParams(
  script: SceneBehaviorScriptBinding,
): SceneBehaviorScriptBinding {
  const definition = findBehaviorScript(script.type)
  if (!definition) {
    return script
  }
  if (script.type === 'showAlert') {
    const params = script.params as Partial<ShowAlertBehaviorParams>
    return {
      type: 'showAlert',
      params: {
        title: params?.title ?? '',
        message: params?.message ?? '',
      },
    }
  }
  return script
}
