import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type {
  ModelCollisionDynamicMesh,
  ModelCollisionFace,
  SceneNode,
  SceneNodeComponentState,
} from '../../index'

export const MODEL_COLLISION_COMPONENT_TYPE = 'modelCollision'

export interface ModelCollisionComponentProps {
  faces: ModelCollisionFace[]
  defaultThickness?: number
}

const DEFAULT_THICKNESS = 0.05

function normalizeFace(face: Partial<ModelCollisionFace> | null | undefined, index: number): ModelCollisionFace | null {
  if (!face) {
    return null
  }
  const id = typeof face.id === 'string' && face.id.trim().length ? face.id : `modelCollisionFace_${index + 1}`
  const vertices = Array.isArray(face.vertices)
    ? face.vertices
      .map((vertex) => ({
        x: Number(vertex?.x),
        y: Number(vertex?.y),
        z: Number(vertex?.z),
      }))
      .filter((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y) && Number.isFinite(vertex.z))
    : []
  if (vertices.length < 3) {
    return null
  }
  const thickness = typeof face.thickness === 'number' && Number.isFinite(face.thickness)
    ? Math.max(0.01, face.thickness)
    : undefined
  return {
    id,
    vertices,
    thickness,
  }
}

export function clampModelCollisionComponentProps(
  props: Partial<ModelCollisionComponentProps> | null | undefined,
): ModelCollisionComponentProps {
  const faces = Array.isArray(props?.faces)
    ? props.faces
      .map((face, index) => normalizeFace(face as Partial<ModelCollisionFace>, index))
      .filter((face): face is ModelCollisionFace => Boolean(face))
    : []
  const defaultThickness = typeof props?.defaultThickness === 'number' && Number.isFinite(props.defaultThickness)
    ? Math.max(0.01, props.defaultThickness)
    : DEFAULT_THICKNESS
  return {
    faces,
    defaultThickness,
  }
}

export function cloneModelCollisionComponentProps(props: ModelCollisionComponentProps): ModelCollisionComponentProps {
  return {
    defaultThickness: props.defaultThickness,
    faces: props.faces.map((face) => ({
      id: face.id,
      thickness: face.thickness,
      vertices: face.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y, z: vertex.z })),
    })),
  }
}

export function resolveModelCollisionComponentPropsFromNode(node: SceneNode | null | undefined): ModelCollisionComponentProps | null {
  if (!node) {
    return null
  }

  const component = node.components?.[MODEL_COLLISION_COMPONENT_TYPE] as
    | SceneNodeComponentState<ModelCollisionComponentProps>
    | undefined
  if (component?.props) {
    return clampModelCollisionComponentProps(component.props)
  }

  const userDataMesh = node.userData && typeof node.userData === 'object'
    ? (node.userData as Record<string, unknown>).modelCollision
    : null
  if (userDataMesh && typeof userDataMesh === 'object' && (userDataMesh as { type?: unknown }).type === 'ModelCollision') {
    const mesh = userDataMesh as ModelCollisionDynamicMesh
    return clampModelCollisionComponentProps({
      defaultThickness: mesh.defaultThickness,
      faces: mesh.faces as ModelCollisionComponentProps['faces'],
    })
  }

  if (node.dynamicMesh?.type === 'ModelCollision') {
    const mesh = node.dynamicMesh as ModelCollisionDynamicMesh
    return clampModelCollisionComponentProps({
      defaultThickness: mesh.defaultThickness,
      faces: mesh.faces as ModelCollisionComponentProps['faces'],
    })
  }

  return null
}

class ModelCollisionComponent extends Component<ModelCollisionComponentProps> {
  constructor(context: ComponentRuntimeContext<ModelCollisionComponentProps>) {
    super(context)
  }
}

const modelCollisionComponentDefinition: ComponentDefinition<ModelCollisionComponentProps> = {
  type: MODEL_COLLISION_COMPONENT_TYPE,
  label: 'Model Collision Faces',
  icon: 'mdi-shield-half-full',
  order: 152,
  inspector: [],
  canAttach(node: SceneNode) {
    const nodeType = node.nodeType ?? ''
    const hasSourceAsset = typeof node.sourceAssetId === 'string' && node.sourceAssetId.trim().length > 0
    return hasSourceAsset && (nodeType === 'Mesh' || nodeType === 'Group')
  },
  createDefaultProps(node: SceneNode) {
    return resolveModelCollisionComponentPropsFromNode(node) ?? clampModelCollisionComponentProps(null)
  },
  createInstance(context) {
    return new ModelCollisionComponent(context)
  },
}

componentManager.registerDefinition(modelCollisionComponentDefinition)

export function createModelCollisionComponentState(
  node: SceneNode,
  overrides?: Partial<ModelCollisionComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<ModelCollisionComponentProps> {
  const defaults = modelCollisionComponentDefinition.createDefaultProps(node)
  const merged = clampModelCollisionComponentProps({
    ...defaults,
    ...overrides,
  })
  return {
    id: options.id ?? '',
    type: MODEL_COLLISION_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { modelCollisionComponentDefinition }