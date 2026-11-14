import type {
  FloorVertex2D,
  GeometryType,
  SceneMaterialProps,
  SceneMaterialTextureSlot,
  SceneMaterialType,
  Vector3Like,
} from './core'

export const HARMONY_AGENT_PROTOCOL_VERSION = 1 as const
export const HARMONY_AGENT_DEFAULT_PORT = 8790
export const HARMONY_AGENT_MAX_OPERATIONS = 100
export const HARMONY_AGENT_MAX_ITEM_BYTES = 1_048_576
export const HARMONY_AGENT_OPERATING_POLICY =
  'For every Harmony scene-data read or modification, use the Harmony Editor MCP semantic tools first. '
  + 'Do not replace MCP operations with mouse or coordinate automation, arbitrary JavaScript, direct scene-file edits, or raw JSON Patch. '
  + 'If the required scene operation is missing, first implement or extend the typed MCP/editor command with validation, transaction/history behavior, and tests; then use that operation to complete the task. '
  + 'Use revision checks, read back changed data, verify with a viewport screenshot when visual behavior matters, save explicitly, and undo temporary verification changes.'

export type HarmonyAgentEditMode = 'generic' | 'domain' | 'readonly'
export type HarmonyAgentDomain =
  | 'builder'
  | 'behavior'
  | 'guideRoute'
  | 'terrain'
  | 'actor'
  | 'houseRig'

export type HarmonyAgentErrorCode =
  | 'BAD_REQUEST'
  | 'SESSION_UNAVAILABLE'
  | 'SESSION_CHANGED'
  | 'SCENE_NOT_READY'
  | 'STALE_REVISION'
  | 'WRITE_LEASE_DENIED'
  | 'AUTH_REQUIRED'
  | 'OPERATION_NOT_SUPPORTED'
  | 'FIELD_REQUIRES_DOMAIN_TOOL'
  | 'NODE_NOT_FOUND'
  | 'COMPONENT_NOT_FOUND'
  | 'COMPONENT_NOT_ALLOWED'
  | 'VALIDATION_FAILED'
  | 'TRANSACTION_FAILED'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR'

export interface HarmonyAgentError {
  code: HarmonyAgentErrorCode
  message: string
  details?: unknown
}

export interface HarmonyAgentComponentProfile {
  type: string
  label: string
  description?: string
  category?: string
  editMode: HarmonyAgentEditMode
  domain: HarmonyAgentDomain | null
  tool: string | null
  actions: string[]
  safeFields: string[]
  protectedFields: string[]
  inspector: unknown[]
  notes: string[]
}

export interface HarmonyAgentCapabilities {
  protocolVersion: typeof HARMONY_AGENT_PROTOCOL_VERSION
  operatingPolicy: string
  operations: string[]
  domains: HarmonyAgentDomain[]
  tools: string[]
  componentProfiles: HarmonyAgentComponentProfile[]
  screenshots: boolean
  maxOperations: number
  maxRequestBytes: number
}

export interface HarmonyEditorSessionHello {
  type: 'hello'
  protocolVersion: typeof HARMONY_AGENT_PROTOCOL_VERSION
  sessionId: string
  editorUrl: string
  projectId: string | null
  sceneId: string | null
  sceneName: string | null
  sceneRevision: number
  sceneReady: boolean
  hasUnsavedChanges: boolean
  canUndo: boolean
  canRedo: boolean
  paused: boolean
  capabilities: HarmonyAgentCapabilities
}

export interface HarmonyEditorSessionState {
  sessionId: string
  editorUrl: string
  projectId: string | null
  sceneId: string | null
  sceneName: string | null
  sceneRevision: number
  sceneReady: boolean
  hasUnsavedChanges: boolean
  canUndo: boolean
  canRedo: boolean
  paused: boolean
  connectedAt: string
  lastSeenAt: string
}

export interface HarmonyEditorStatus {
  bridgeVersion: string
  protocolVersion: typeof HARMONY_AGENT_PROTOCOL_VERSION
  session: HarmonyEditorSessionState | null
  writeLease: string | null
}

export interface HarmonyAgentRequest {
  jsonrpc: '2.0'
  id: string
  method: string
  params?: Record<string, unknown>
}

export interface HarmonyAgentSuccess<T = unknown> {
  jsonrpc: '2.0'
  id: string
  result: T
}

export interface HarmonyAgentFailure {
  jsonrpc: '2.0'
  id: string
  error: HarmonyAgentError
}

export type HarmonyAgentResponse<T = unknown> =
  | HarmonyAgentSuccess<T>
  | HarmonyAgentFailure

export interface HarmonyEditorControlMessage {
  type: 'request' | 'response' | 'status' | 'paused'
  payload: unknown
}

export interface HarmonyWorldTransform {
  position?: Vector3Like
  rotation?: Vector3Like
  scale?: Vector3Like
}

export interface HarmonySceneQuery {
  text?: string
  parentId?: string | null
  nodeId?: string
  nodeType?: string
  componentType?: string
  assetId?: string
  includeComponents?: boolean
  includeMaterials?: boolean
  includeGeometry?: boolean
  depth?: number
  limit?: number
  cursor?: string
}

export interface HarmonyNodeSummary {
  id: string
  parentId: string | null
  name: string
  nodeType: string
  position: Vector3Like
  rotation: Vector3Like
  scale: Vector3Like
  visible: boolean
  locked: boolean
  childCount: number
  componentTypes: string[]
  sourceAssetId?: string
  components?: HarmonyComponentSnapshot[]
  materials?: HarmonyMaterialSummary[]
  geometry?: HarmonyGeometrySnapshot
}

export interface HarmonyBounds {
  min: Vector3Like
  max: Vector3Like
  center: Vector3Like
  size: Vector3Like
}

export interface HarmonyGeometrySnapshot {
  localBounds: HarmonyBounds | null
  worldBounds: HarmonyBounds | null
  floorVertices?: FloorVertex2D[]
  worldFloorVertices?: Vector3Like[]
}

export interface HarmonyMaterialSummary {
  id: string
  name: string | null
  type: SceneMaterialType | null
  color: string | null
  sourceMaterialAssetId: string | null
  textureAssetIds: string[]
  props: SceneMaterialProps
  textureOverrides?: SceneMaterialTextureSlot[]
  deviceProfileId?: string | null
}

export interface HarmonyComponentSnapshot {
  id: string
  type: string
  label: string
  enabled: boolean
  editMode: HarmonyAgentEditMode
  domain: HarmonyAgentDomain | null
  props: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface HarmonySceneQueryResult {
  sceneId: string | null
  sceneName: string | null
  sceneRevision: number
  totalMatched: number
  nodes: HarmonyNodeSummary[]
  nextCursor: string | null
}

export interface HarmonyAssetSearchQuery {
  text?: string
  type?: string
  limit?: number
  cursor?: string
}

export interface HarmonyAssetSummary {
  id: string
  name: string
  type: string
  extension: string | null
  category: string | null
  thumbnail: string | null
  downloadUrl: string | null
  source: string | null
}

export interface HarmonyAssetSearchResult {
  assets: HarmonyAssetSummary[]
  nextCursor: string | null
}

export interface HarmonyApplyRequest {
  expectedRevision?: number
  operations: HarmonyOperation[]
  label?: string
  atomic?: boolean
}

export interface HarmonyApplyResult {
  changeSetId: string
  sessionId: string
  sceneId: string
  beforeRevision: number
  afterRevision: number
  applied: number
  warnings: string[]
  pending: string[]
  results: unknown[]
  saved: boolean
  canUndo: boolean
}

export type HarmonyOperation =
  | {
      op: 'node.create'
      nodeId?: string
      nodeType: 'Group' | 'Light' | GeometryType
      lightType?: string
      name?: string
      parentId?: string | null
      local?: HarmonyWorldTransform
      world?: HarmonyWorldTransform
    }
  | {
      op: 'node.update'
      nodeId: string
      name?: string
      visible?: boolean
      locked?: boolean
      local?: HarmonyWorldTransform
      world?: HarmonyWorldTransform
    }
  | { op: 'node.delete'; nodeId: string }
  | { op: 'node.duplicate'; nodeIds: string[]; select?: boolean }
  | {
      op: 'node.move'
      nodeId: string
      targetId: string | null
      position: 'before' | 'after' | 'inside'
    }
  | { op: 'node.select'; nodeIds: string[]; primaryId?: string | null }
  | { op: 'camera.focus'; nodeId: string }
  | { op: 'camera.set'; request: HarmonyCameraSetRequest }
  | { op: 'tool.set_active'; request: HarmonyToolSetRequest }
  | { op: 'component.add'; nodeId: string; componentType: string }
  | {
      op: 'component.patch_simple'
      nodeId: string
      componentId?: string
      componentType?: string
      patch: Record<string, unknown>
    }
  | { op: 'component.remove'; nodeId: string; componentId: string }
  | { op: 'component.set_enabled'; nodeId: string; componentId: string; enabled: boolean }
  | {
      op: 'asset.place'
      assetId: string
      parentId?: string | null
      position: Vector3Like
      rotation?: Vector3Like
      scale?: Vector3Like
    }
  | {
      op: 'material.create'
      name?: string
      type?: SceneMaterialType
      props?: Partial<SceneMaterialProps>
    }
  | {
      op: 'material.update'
      nodeId: string
      nodeMaterialId: string
      type?: SceneMaterialType
      patch?: Partial<SceneMaterialProps> & {
        textureOverrides?: SceneMaterialTextureSlot[]
      }
    }
  | {
      op: 'material.apply_asset'
      nodeId: string
      nodeMaterialId: string
      assetId: string
    }
  | { op: 'scene.patch_environment'; patch: Record<string, unknown> }
  | { op: 'scene.set_device_adaptation'; settings: Record<string, unknown> }
  | { op: 'scene.set_shadows_enabled'; enabled: boolean }
  | {
      op: 'scene.update_ground_settings'
      patch: {
        chunkSizeMeters?: number
        baseHeight?: number
        renderRadiusChunks?: number
        farHorizonEnabled?: boolean
        farHorizonDistanceMeters?: number
        collisionRadiusChunks?: number
      }
    }
  | {
      op: 'domain.apply'
      domain: HarmonyAgentDomain
      action: string
      args: Record<string, unknown>
    }

export interface HarmonyHistoryRequest {
  action: 'undo' | 'redo'
  expectedRevision?: number
}

export interface HarmonyHistoryResult {
  changed: boolean
  beforeRevision: number
  afterRevision: number
  canUndo: boolean
  canRedo: boolean
}

export interface HarmonySaveResult {
  saved: boolean
  sceneId: string | null
  sceneRevision: number
  updatedAt: string | null
}

export interface HarmonyScreenshotResult {
  mimeType: 'image/png' | 'image/jpeg'
  base64: string
  width: number
  height: number
  sceneId: string | null
  sceneRevision: number
}

export type HarmonyCameraProjection = 'perspective' | 'orthographic'
export type HarmonyCameraControlMode = 'map' | 'orbit'
export type HarmonyCameraPreset = 'top' | 'front' | 'back' | 'left' | 'right' | 'isometric'

export interface HarmonyCameraState {
  position: Vector3Like
  target: Vector3Like
  forward: Vector3Like
  fov: number
  distance: number
  azimuthDeg: number
  polarDeg: number
  projection: HarmonyCameraProjection
  controlMode: HarmonyCameraControlMode
}

export interface HarmonyCameraSetRequest {
  position?: Vector3Like
  target?: Vector3Like
  fov?: number
  distance?: number
  azimuthDeg?: number
  polarDeg?: number
  projection?: HarmonyCameraProjection
  controlMode?: HarmonyCameraControlMode
  preset?: HarmonyCameraPreset
  expectedRevision?: number
}

export interface HarmonyCameraSetResult {
  changed: boolean
  beforeRevision: number
  afterRevision: number
  state: HarmonyCameraState
}

export type HarmonyTransformTool = 'select' | 'translate' | 'rotate' | 'scale' | 'transform'
export type HarmonyBuildTool =
  | 'terrain'
  | 'paint'
  | 'scatter'
  | 'wall'
  | 'floor'
  | 'landform'
  | 'region'
  | 'guideRoute'
  | 'road'
  | 'landscapeRoad'
  | 'water'
  | 'boundaryWall'
  | 'modelCollision'
  | 'displayBoard'
  | 'billboard'
  | 'warpGate'

export interface HarmonyToolState {
  activeTransformTool: HarmonyTransformTool
  activeBuildTool: HarmonyBuildTool | null
  buildToolsDisabled: boolean
  selectedNodeIds: string[]
  availableTransformTools: HarmonyTransformTool[]
  availableBuildTools: HarmonyBuildTool[]
}

export interface HarmonyToolSetRequest {
  group: 'transform' | 'build'
  tool: HarmonyTransformTool | HarmonyBuildTool | null
}

export interface HarmonyToolSetResult {
  changed: boolean
  state: HarmonyToolState
}

export const HARMONY_AGENT_METHODS = {
  status: 'editor.status',
  wait: 'editor.wait',
  sceneQuery: 'scene.query',
  catalogSearch: 'catalog.search',
  componentSchema: 'component.schema',
  sceneApply: 'scene.apply',
  history: 'history.apply',
  save: 'scene.save',
  screenshot: 'viewport.screenshot',
  cameraGet: 'camera.get',
  cameraSet: 'camera.set',
  toolGet: 'tool.get',
  toolSet: 'tool.set_active',
} as const

export const HARMONY_AGENT_TOOLS = {
  status: 'harmony_editor_status',
  wait: 'harmony_editor_wait',
  sceneQuery: 'harmony_scene_query',
  catalogSearch: 'harmony_catalog_search',
  componentSchema: 'harmony_component_schema',
  apply: 'harmony_apply_operations',
  history: 'harmony_history',
  save: 'harmony_save_scene',
  screenshot: 'harmony_viewport_screenshot',
  camera: 'harmony_camera_control',
  tool: 'harmony_tool_control',
  builder: 'harmony_builder_edit',
  behavior: 'harmony_behavior_edit',
  guideRoute: 'harmony_guide_route_edit',
  terrain: 'harmony_terrain_edit',
  actor: 'harmony_actor_edit',
  houseRig: 'harmony_house_rig_edit',
} as const

export const HARMONY_AGENT_OPERATION_NAMES = [
  'node.create',
  'node.update',
  'node.delete',
  'node.duplicate',
  'node.move',
  'node.select',
  'camera.focus',
  'camera.set',
  'tool.set_active',
  'component.add',
  'component.patch_simple',
  'component.remove',
  'component.set_enabled',
  'asset.place',
  'material.create',
  'material.update',
  'material.apply_asset',
  'scene.patch_environment',
  'scene.set_device_adaptation',
  'scene.set_shadows_enabled',
  'scene.update_ground_settings',
  'domain.apply',
] as const
