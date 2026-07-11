import * as THREE from 'three'
import type { Object3D } from 'three'
import { Component, type ComponentRuntimeContext } from '../Component'
import { componentManager, type ComponentDefinition } from '../componentManager'
import type { SceneNode, SceneNodeComponentState } from '../../index'

export const VIEW_POINT_COMPONENT_TYPE = 'viewPoint'
export const VIEW_POINT_DEFAULT_INITIAL_VISIBILITY = true
export const VIEW_POINT_DEFAULT_CAMERA_LOCAL_POSITION_X = 0
export const VIEW_POINT_DEFAULT_CAMERA_LOCAL_POSITION_Y = 0
export const VIEW_POINT_DEFAULT_CAMERA_LOCAL_POSITION_Z = 5
export const VIEW_POINT_DEFAULT_CAMERA_LOCAL_ROTATION_X = 0
export const VIEW_POINT_DEFAULT_CAMERA_LOCAL_ROTATION_Y = 0
export const VIEW_POINT_DEFAULT_CAMERA_LOCAL_ROTATION_Z = 0
export const VIEW_POINT_DEFAULT_CAMERA_FOV = 60
export const VIEW_POINT_DEFAULT_CAMERA_NEAR = 0.1
export const VIEW_POINT_DEFAULT_CAMERA_FAR = 5000
export const VIEW_POINT_DEFAULT_CAMERA_ZOOM = 1
export const VIEW_POINT_CAMERA_FOV_MIN = 1
export const VIEW_POINT_CAMERA_FOV_MAX = 179
export const VIEW_POINT_CAMERA_NEAR_MIN = 0.001
export const VIEW_POINT_CAMERA_FAR_MIN = 0.01
export const VIEW_POINT_CAMERA_ZOOM_MIN = 0.01
export const VIEW_POINT_CAMERA_ZOOM_MAX = 100
export const VIEW_POINT_RUNTIME_METADATA_KEY = '__harmonyViewPointCamera'

const viewPointWorldMatrixHelper = new THREE.Matrix4()
const viewPointDecomposeScaleHelper = new THREE.Vector3()
const viewPointForwardHelper = new THREE.Vector3()

export interface ViewPointComponentProps {
  initiallyVisible: boolean
  cameraLocalPositionX: number
  cameraLocalPositionY: number
  cameraLocalPositionZ: number
  cameraLocalRotationX: number
  cameraLocalRotationY: number
  cameraLocalRotationZ: number
  cameraFov: number
  cameraNear: number
  cameraFar: number
  cameraZoom: number
}

export interface ViewPointCameraWorldPose {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  up: THREE.Vector3
  target: THREE.Vector3
  fov: number
  near: number
  far: number
  zoom: number
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function normalizeClampedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = normalizeFiniteNumber(value, fallback)
  return Math.min(max, Math.max(min, numeric))
}

export function clampViewPointComponentProps(
  props: Partial<ViewPointComponentProps> | null | undefined,
): ViewPointComponentProps {
  return {
    initiallyVisible: props?.initiallyVisible !== false,
    cameraLocalPositionX: normalizeFiniteNumber(props?.cameraLocalPositionX, VIEW_POINT_DEFAULT_CAMERA_LOCAL_POSITION_X),
    cameraLocalPositionY: normalizeFiniteNumber(props?.cameraLocalPositionY, VIEW_POINT_DEFAULT_CAMERA_LOCAL_POSITION_Y),
    cameraLocalPositionZ: normalizeFiniteNumber(props?.cameraLocalPositionZ, VIEW_POINT_DEFAULT_CAMERA_LOCAL_POSITION_Z),
    cameraLocalRotationX: normalizeFiniteNumber(props?.cameraLocalRotationX, VIEW_POINT_DEFAULT_CAMERA_LOCAL_ROTATION_X),
    cameraLocalRotationY: normalizeFiniteNumber(props?.cameraLocalRotationY, VIEW_POINT_DEFAULT_CAMERA_LOCAL_ROTATION_Y),
    cameraLocalRotationZ: normalizeFiniteNumber(props?.cameraLocalRotationZ, VIEW_POINT_DEFAULT_CAMERA_LOCAL_ROTATION_Z),
    cameraFov: normalizeClampedNumber(
      props?.cameraFov,
      VIEW_POINT_DEFAULT_CAMERA_FOV,
      VIEW_POINT_CAMERA_FOV_MIN,
      VIEW_POINT_CAMERA_FOV_MAX,
    ),
    cameraNear: Math.max(
      VIEW_POINT_CAMERA_NEAR_MIN,
      normalizeFiniteNumber(props?.cameraNear, VIEW_POINT_DEFAULT_CAMERA_NEAR),
    ),
    cameraFar: Math.max(
      VIEW_POINT_CAMERA_FAR_MIN,
      normalizeFiniteNumber(props?.cameraFar, VIEW_POINT_DEFAULT_CAMERA_FAR),
    ),
    cameraZoom: normalizeClampedNumber(
      props?.cameraZoom,
      VIEW_POINT_DEFAULT_CAMERA_ZOOM,
      VIEW_POINT_CAMERA_ZOOM_MIN,
      VIEW_POINT_CAMERA_ZOOM_MAX,
    ),
  }
}

export function cloneViewPointComponentProps(props: ViewPointComponentProps): ViewPointComponentProps {
  return {
    initiallyVisible: props.initiallyVisible,
    cameraLocalPositionX: props.cameraLocalPositionX,
    cameraLocalPositionY: props.cameraLocalPositionY,
    cameraLocalPositionZ: props.cameraLocalPositionZ,
    cameraLocalRotationX: props.cameraLocalRotationX,
    cameraLocalRotationY: props.cameraLocalRotationY,
    cameraLocalRotationZ: props.cameraLocalRotationZ,
    cameraFov: props.cameraFov,
    cameraNear: props.cameraNear,
    cameraFar: props.cameraFar,
    cameraZoom: props.cameraZoom,
  }
}

export function getViewPointCameraMetadata(
  props: Partial<ViewPointComponentProps> | null | undefined,
): Record<string, number> {
  const normalized = clampViewPointComponentProps(props)
  return {
    cameraFov: normalized.cameraFov,
    cameraNear: normalized.cameraNear,
    cameraFar: normalized.cameraFar,
    cameraZoom: normalized.cameraZoom,
  }
}

export function resolveViewPointComponentProps(
  state: SceneNodeComponentState<ViewPointComponentProps> | null | undefined,
): ViewPointComponentProps | null {
  if (!state?.enabled) {
    return null
  }
  return clampViewPointComponentProps(state.props as Partial<ViewPointComponentProps> | undefined)
}

export function resolveViewPointComponentPropsFromNode(node: SceneNode | null | undefined): ViewPointComponentProps | null {
  if (!node) {
    return null
  }
  const state = node.components?.[VIEW_POINT_COMPONENT_TYPE] as SceneNodeComponentState<ViewPointComponentProps> | undefined
  return resolveViewPointComponentProps(state)
}

export function applyViewPointCameraProjection(
  camera: THREE.PerspectiveCamera,
  props: Partial<ViewPointComponentProps> | null | undefined,
): ViewPointComponentProps {
  const normalized = clampViewPointComponentProps(props)
  camera.fov = normalized.cameraFov
  camera.near = normalized.cameraNear
  camera.far = Math.max(normalized.cameraNear + 1e-3, normalized.cameraFar)
  camera.zoom = normalized.cameraZoom
  camera.updateProjectionMatrix()
  return normalized
}

export function resolveViewPointWorldCameraPose(
  nodeWorldMatrix: THREE.Matrix4,
  props: Partial<ViewPointComponentProps> | null | undefined,
  out?: Partial<ViewPointCameraWorldPose>,
): ViewPointCameraWorldPose {
  const normalized = clampViewPointComponentProps(props)
  const position = out?.position ?? new THREE.Vector3()
  const quaternion = out?.quaternion ?? new THREE.Quaternion()
  const up = out?.up ?? new THREE.Vector3()
  const target = out?.target ?? new THREE.Vector3()

  viewPointWorldMatrixHelper.copy(nodeWorldMatrix)
  viewPointWorldMatrixHelper.decompose(position, quaternion, viewPointDecomposeScaleHelper)

  up.set(0, 1, 0).applyQuaternion(quaternion).normalize()
  viewPointForwardHelper.set(0, 0, -1).applyQuaternion(quaternion).normalize()
  target.copy(position).add(viewPointForwardHelper)

  return {
    position,
    quaternion,
    up,
    target,
    fov: normalized.cameraFov,
    near: normalized.cameraNear,
    far: Math.max(normalized.cameraNear + 1e-3, normalized.cameraFar),
    zoom: normalized.cameraZoom,
  }
}

class ViewPointComponent extends Component<ViewPointComponentProps> {
  constructor(context: ComponentRuntimeContext<ViewPointComponentProps>) {
    super(context)
  }

  private applyRuntimeState(object: Object3D | null): void {
    if (!object) {
      return
    }

    const props = this.context.getProps()
    const userData = object.userData ?? (object.userData = {})
    const shouldControlMarkerVisibility = userData.editorOnly === true || object.name === 'Editor Marker'

    if (!this.context.isEnabled()) {
      if (userData.viewPoint) {
        userData.viewPoint = false
      }
      delete userData[VIEW_POINT_RUNTIME_METADATA_KEY]
      if (shouldControlMarkerVisibility) {
        object.visible = false
      }
      return
    }

    userData.viewPoint = true
    userData[VIEW_POINT_RUNTIME_METADATA_KEY] = getViewPointCameraMetadata(props)
    if (typeof userData.viewPointBaseScale !== 'object' || userData.viewPointBaseScale === null) {
      userData.viewPointBaseScale = {
        x: object.scale?.x ?? 1,
        y: object.scale?.y ?? 1,
        z: object.scale?.z ?? 1,
      }
    }
    if (shouldControlMarkerVisibility) {
      object.visible = props.initiallyVisible === true
    }
  }

  onRuntimeAttached(object: Object3D | null): void {
    this.applyRuntimeState(object)
  }

  onPropsUpdated(): void {
    this.applyRuntimeState(this.context.getRuntimeObject())
  }

  onEnabledChanged(_enabled: boolean): void {
    this.applyRuntimeState(this.context.getRuntimeObject())
  }
}

const viewPointComponentDefinition: ComponentDefinition<ViewPointComponentProps> = {
  type: VIEW_POINT_COMPONENT_TYPE,
  label: 'View Point',
  icon: 'mdi-eye',
  order: 45,
  inspector: [
    {
      id: 'visibility',
      label: 'Visibility',
      fields: [
        {
          kind: 'boolean',
          key: 'initiallyVisible',
          label: 'Initially Visible',
        },
      ],
    },
    {
      id: 'projection',
      label: 'Projection',
      fields: [
        { kind: 'number', key: 'cameraFov', label: 'FOV', min: VIEW_POINT_CAMERA_FOV_MIN, max: VIEW_POINT_CAMERA_FOV_MAX, step: 1, precision: 2, unit: 'deg' },
        { kind: 'number', key: 'cameraNear', label: 'Near', min: VIEW_POINT_CAMERA_NEAR_MIN, step: 0.01, precision: 3 },
        { kind: 'number', key: 'cameraFar', label: 'Far', min: VIEW_POINT_CAMERA_FAR_MIN, step: 1, precision: 3 },
        { kind: 'number', key: 'cameraZoom', label: 'Zoom', min: VIEW_POINT_CAMERA_ZOOM_MIN, max: VIEW_POINT_CAMERA_ZOOM_MAX, step: 0.1, precision: 3 },
      ],
    },
  ],
  canAttach(node: SceneNode) {
    return Boolean(node?.id)
  },
  createDefaultProps(_node: SceneNode) {
    return {
      initiallyVisible: VIEW_POINT_DEFAULT_INITIAL_VISIBILITY,
      cameraLocalPositionX: VIEW_POINT_DEFAULT_CAMERA_LOCAL_POSITION_X,
      cameraLocalPositionY: VIEW_POINT_DEFAULT_CAMERA_LOCAL_POSITION_Y,
      cameraLocalPositionZ: VIEW_POINT_DEFAULT_CAMERA_LOCAL_POSITION_Z,
      cameraLocalRotationX: VIEW_POINT_DEFAULT_CAMERA_LOCAL_ROTATION_X,
      cameraLocalRotationY: VIEW_POINT_DEFAULT_CAMERA_LOCAL_ROTATION_Y,
      cameraLocalRotationZ: VIEW_POINT_DEFAULT_CAMERA_LOCAL_ROTATION_Z,
      cameraFov: VIEW_POINT_DEFAULT_CAMERA_FOV,
      cameraNear: VIEW_POINT_DEFAULT_CAMERA_NEAR,
      cameraFar: VIEW_POINT_DEFAULT_CAMERA_FAR,
      cameraZoom: VIEW_POINT_DEFAULT_CAMERA_ZOOM,
    }
  },
  createInstance(context) {
    return new ViewPointComponent(context)
  },
}

componentManager.registerDefinition(viewPointComponentDefinition)

export function createViewPointComponentState(
  node: SceneNode,
  overrides?: Partial<ViewPointComponentProps>,
  options: { id?: string; enabled?: boolean } = {},
): SceneNodeComponentState<ViewPointComponentProps> {
  const defaults = viewPointComponentDefinition.createDefaultProps(node)
  const merged = clampViewPointComponentProps({
    initiallyVisible: overrides?.initiallyVisible ?? defaults.initiallyVisible,
    cameraLocalPositionX: overrides?.cameraLocalPositionX ?? defaults.cameraLocalPositionX,
    cameraLocalPositionY: overrides?.cameraLocalPositionY ?? defaults.cameraLocalPositionY,
    cameraLocalPositionZ: overrides?.cameraLocalPositionZ ?? defaults.cameraLocalPositionZ,
    cameraLocalRotationX: overrides?.cameraLocalRotationX ?? defaults.cameraLocalRotationX,
    cameraLocalRotationY: overrides?.cameraLocalRotationY ?? defaults.cameraLocalRotationY,
    cameraLocalRotationZ: overrides?.cameraLocalRotationZ ?? defaults.cameraLocalRotationZ,
    cameraFov: overrides?.cameraFov ?? defaults.cameraFov,
    cameraNear: overrides?.cameraNear ?? defaults.cameraNear,
    cameraFar: overrides?.cameraFar ?? defaults.cameraFar,
    cameraZoom: overrides?.cameraZoom ?? defaults.cameraZoom,
  })
  return {
    id: options.id ?? '',
    type: VIEW_POINT_COMPONENT_TYPE,
    enabled: options.enabled ?? true,
    props: merged,
  }
}

export { viewPointComponentDefinition }
