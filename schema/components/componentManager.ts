import type { Object3D } from 'three'
import type {
  SceneNode,
  ComponentInspectorSection,
  NodeComponentType,
  SceneNodeComponentState,
  SceneNodeComponentMap,
} from '../index'

import { stableSerialize } from '../stableSerialize'

import { Component, type ComponentRuntimeContext } from './Component'

export interface ComponentDefinition<TProps = Record<string, unknown>> {
  type: NodeComponentType
  label: string
  icon?: string
  description?: string
  category?: string
  order?: number
  inspector?: ComponentInspectorSection<TProps>[]

  /**
   * If true, the component instance is fully destroyed and recreated when props change.
   * Useful for components that spawn runtime children and need a clean teardown.
   */
  recreateOnPropsChange?: boolean

  canAttach(node: SceneNode): boolean
  createDefaultProps(node: SceneNode): TProps
  createInstance(context: ComponentRuntimeContext<TProps>): Component<TProps>
}

type AnyComponentDefinition = ComponentDefinition<any>

type AnySceneNodeComponentState = SceneNodeComponentState<any>

type ComponentInstanceWrapper = {
  definition: AnyComponentDefinition
  state: AnySceneNodeComponentState
  propsSignature: string
  context: ComponentContextImpl<any>
  instance: Component<any>
}

type NodeComponentBundle = {
  runtimeObject: Object3D | null
  instances: Map<string, ComponentInstanceWrapper>
}

export const COMPONENT_ARTIFACT_KEY = '__harmonyComponentArtifact'
export const COMPONENT_ARTIFACT_NODE_ID_KEY = '__harmonyComponentArtifactNodeId'
export const COMPONENT_ARTIFACT_COMPONENT_ID_KEY = '__harmonyComponentArtifactComponentId'

class ComponentContextImpl<TProps> implements ComponentRuntimeContext<TProps> {
  private runtimeObject: Object3D | null
  private props: Readonly<TProps>
  private enabled: boolean
  private dirty = false
  private readonly nodeIdValue: string
  private readonly componentIdValue: string

  constructor(
    nodeId: string,
    componentId: string,
    initialProps: TProps,
    isEnabled: boolean,
  ) {
    this.nodeIdValue = nodeId
    this.componentIdValue = componentId
    this.runtimeObject = null
    this.props = initialProps
    this.enabled = isEnabled
  }

  get nodeId(): string {
    return this.nodeIdValue
  }

  get componentId(): string {
    return this.componentIdValue
  }

  getRuntimeObject(): Object3D | null {
    return this.runtimeObject
  }

  setRuntimeObject(object: Object3D | null) {
    if (this.runtimeObject !== object) {
      this.runtimeObject = object
      this.markDirty()
    }
  }

  getProps(): Readonly<TProps> {
    return this.props
  }

  setProps(props: TProps) {
    this.props = props
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean) {
    if (this.enabled !== enabled) {
      this.enabled = enabled
      this.markDirty()
    }
  }

  markDirty(): void {
    this.dirty = true
  }

  consumeDirtyFlag(): boolean {
    const current = this.dirty
    this.dirty = false
    return current
  }
}

export class ComponentManager {
  private readonly definitions = new Map<NodeComponentType, AnyComponentDefinition>()
  private readonly nodeBundles = new Map<string, NodeComponentBundle>()

  registerDefinition<TProps>(definition: ComponentDefinition<TProps>): void {
    this.definitions.set(definition.type, definition as AnyComponentDefinition)
  }

  getDefinition<TProps = Record<string, unknown>>(type: NodeComponentType): ComponentDefinition<TProps> | null {
    return (this.definitions.get(type) as ComponentDefinition<TProps> | undefined) ?? null
  }

  listDefinitions(): ComponentDefinition[] {
    return Array.from(this.definitions.values()).sort((a, b) => {
      const orderA = a.order ?? Number.POSITIVE_INFINITY
      const orderB = b.order ?? Number.POSITIVE_INFINITY
      if (orderA !== orderB) {
        return orderA - orderB
      }
      return a.label.localeCompare(b.label, 'en')
    })
  }

  reset(): void {
    this.nodeBundles.forEach((bundle) => {
      bundle.instances.forEach((wrapper) => {
        try {
          wrapper.instance.onDestroy()
        } catch (error) {
          console.warn('Component onDestroy failed', error)
        }

        this.cleanupTaggedArtifacts(bundle.runtimeObject, wrapper.context.nodeId, wrapper.context.componentId)
      })
    })
    this.nodeBundles.clear()
  }

  syncScene(nodes: SceneNode[]): void {
    const visit = (list: SceneNode[]) => {
      list.forEach((node) => {
        this.syncNode(node)
        if (node.children?.length) {
          visit(node.children)
        }
      })
    }
    visit(nodes)
  }

  syncNode(node: SceneNode): void {
    const bundle = this.ensureBundle(node.id)
    const statesSource: SceneNodeComponentMap | undefined = node.components ?? undefined
    const states = statesSource
      ? (Object.values(statesSource).filter((state): state is AnySceneNodeComponentState => Boolean(state)) ?? [])
      : []

    const activeStateIds = new Set<string>()

    states.forEach((state) => {
      if (!state || typeof state.id !== 'string' || !state.id) {
        return
      }
      if (!state.enabled) {
        this.destroyInstance(node.id, state.id)
        return
      }
      const definition = this.definitions.get(state.type)
      if (!definition) {
        console.warn(`Unknown component type '${state.type}' on node ${node.id}`)
        return
      }
      activeStateIds.add(state.id)
      const existing = bundle.instances.get(state.id) ?? null
      if (!existing) {
        const context = new ComponentContextImpl(node.id, state.id, state.props, true)
        context.setRuntimeObject(bundle.runtimeObject)
        const instance = definition.createInstance(context)
        const propsSignature = stableSerialize(state.props)
        bundle.instances.set(state.id, {
          definition,
          state,
          propsSignature,
          context,
          instance,
        })
        try {
          instance.onInit()
        } catch (error) {
          console.warn('Component onInit failed', error)
        }
        try {
          instance.onRuntimeAttached(bundle.runtimeObject)
        } catch (error) {
          console.warn('Component onRuntimeAttached failed', error)
        }
        return
      }

      // NOTE: Component state/props may be mutated in-place by the editor.
      // Relying solely on reference changes would miss updates.
      const previousEnabled = existing.context.isEnabled()
      const nextEnabled = Boolean(state.enabled)
      const previousProps = existing.context.getProps()
      const nextProps = state.props
      const nextPropsSignature = stableSerialize(nextProps)

      existing.state = state
      existing.context.setProps(nextProps)
      existing.context.setEnabled(nextEnabled)

      if (previousEnabled !== nextEnabled) {
        try {
          existing.instance.onEnabledChanged(nextEnabled)
        } catch (error) {
          console.warn('Component onEnabledChanged failed', error)
        }
      }

      if (existing.propsSignature !== nextPropsSignature) {
        // If requested, fully recreate component instance on props change.
        if (existing.definition.recreateOnPropsChange) {
          this.destroyInstance(node.id, state.id)

          const context = new ComponentContextImpl(node.id, state.id, nextProps, true)
          context.setRuntimeObject(bundle.runtimeObject)
          const instance = existing.definition.createInstance(context)
          bundle.instances.set(state.id, {
            definition: existing.definition,
            state,
            propsSignature: nextPropsSignature,
            context,
            instance,
          })
          try {
            instance.onInit()
          } catch (error) {
            console.warn('Component onInit failed', error)
          }
          try {
            instance.onRuntimeAttached(bundle.runtimeObject)
          } catch (error) {
            console.warn('Component onRuntimeAttached failed', error)
          }
          return
        }

        existing.propsSignature = nextPropsSignature
        try {
          existing.instance.onPropsUpdated(nextProps, previousProps)
        } catch (error) {
          console.warn('Component onPropsUpdated failed', error)
        }
      }
    })

    const bundleInstances = Array.from(bundle.instances.entries())
    bundleInstances.forEach(([componentId]) => {
      if (!activeStateIds.has(componentId)) {
        this.destroyInstance(node.id, componentId)
      }
    })
  }

  attachRuntime(node: SceneNode, runtimeObject: Object3D | null): void {
    const bundle = this.ensureBundle(node.id)
    bundle.runtimeObject = runtimeObject ?? null
    bundle.instances.forEach((wrapper) => {
      wrapper.context.setRuntimeObject(bundle.runtimeObject)
      try {
        wrapper.instance.onRuntimeAttached(bundle.runtimeObject)
      } catch (error) {
        console.warn('Component onRuntimeAttached failed', error)
      }
    })
    this.syncNode(node)
  }

  detachRuntime(nodeId: string): void {
    const bundle = this.nodeBundles.get(nodeId)
    if (!bundle) {
      return
    }
    bundle.runtimeObject = null
    bundle.instances.forEach((wrapper) => {
      wrapper.context.setRuntimeObject(null)
      try {
        wrapper.instance.onRuntimeAttached(null)
      } catch (error) {
        console.warn('Component onRuntimeAttached failed', error)
      }
    })
  }

  removeNode(nodeId: string): void {
    const bundle = this.nodeBundles.get(nodeId)
    if (!bundle) {
      return
    }
    bundle.instances.forEach((wrapper) => {
      try {
        wrapper.instance.onDestroy()
      } catch (error) {
        console.warn('Component onDestroy failed', error)
      }

      this.cleanupTaggedArtifacts(bundle.runtimeObject, wrapper.context.nodeId, wrapper.context.componentId)
    })
    this.nodeBundles.delete(nodeId)
  }

  update(deltaTime: number): void {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      return
    }
    this.nodeBundles.forEach((bundle) => {
      bundle.instances.forEach((wrapper) => {
        if (!wrapper.state.enabled) {
          return
        }
        try {
          wrapper.instance.onUpdate(deltaTime)
        } catch (error) {
          console.warn('Component onUpdate failed', error)
        }
      })
    })
  }

  private ensureBundle(nodeId: string): NodeComponentBundle {
    let bundle = this.nodeBundles.get(nodeId)
    if (!bundle) {
      bundle = {
        runtimeObject: null,
        instances: new Map(),
      }
      this.nodeBundles.set(nodeId, bundle)
    }
    return bundle
  }

  private destroyInstance(nodeId: string, componentId: string): void {
    const bundle = this.nodeBundles.get(nodeId)
    if (!bundle) {
      return
    }
    const wrapper = bundle.instances.get(componentId)
    if (!wrapper) {
      return
    }
    bundle.instances.delete(componentId)
    try {
      wrapper.instance.onDestroy()
    } catch (error) {
      console.warn('Component onDestroy failed', error)
    }

    this.cleanupTaggedArtifacts(bundle.runtimeObject, nodeId, componentId)
  }

  private cleanupTaggedArtifacts(runtimeObject: Object3D | null, nodeId: string, componentId: string): void {
    if (!runtimeObject) {
      return
    }

    const toRemove: Object3D[] = []
    runtimeObject.traverse((object) => {
      const userData = (object as any).userData as Record<string, unknown> | undefined
      if (!userData) {
        return
      }
      if (userData[COMPONENT_ARTIFACT_KEY] !== true) {
        return
      }
      if (userData[COMPONENT_ARTIFACT_NODE_ID_KEY] !== nodeId) {
        return
      }
      if (userData[COMPONENT_ARTIFACT_COMPONENT_ID_KEY] !== componentId) {
        return
      }
      toRemove.push(object)
    })

    toRemove.forEach((object) => {
      object.parent?.remove(object)
    })
  }
}

export const componentManager = new ComponentManager()
