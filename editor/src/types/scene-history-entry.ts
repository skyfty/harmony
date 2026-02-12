import type { SceneNode, GroundSettings, Vector3Like } from '@harmony/schema'
import type { SceneMaterial } from '@/types/material'

export type SceneHistoryTransformSnapshot = {
  id: string
  position: Vector3Like
  rotation: Vector3Like
  scale: Vector3Like
}

export type SceneHistoryGroundRegionBounds = {
  minRow: number
  maxRow: number
  minColumn: number
  maxColumn: number
}

export type SceneHistoryGroundManualHeightEntry = {
  row: number
  column: number
  value: number
}

export type SceneHistoryNodeBasicsSnapshot = {
  id: string
  name?: string
  visible?: boolean | null
  locked?: boolean | null
  userData?: Record<string, unknown> | null
}

export type SceneHistoryNodeLocation = {
  parentId: string | null
  index: number
}

export type SceneHistoryNodeStructureOp =
  | {
      type: 'insert'
      location: SceneHistoryNodeLocation
      subtree: SceneNode
    }
  | {
      type: 'remove'
      location: SceneHistoryNodeLocation
      nodeId: string
    }

// New history model: content-only undo/redo entries.
// Explicitly excludes: selection, camera, viewport, panels, assets, planning, environment/skybox/shadows.
export type SceneHistoryEntry =
  | {
      kind: 'content-snapshot'
      nodes: SceneNode[]
      materials: SceneMaterial[]
      groundSettings: GroundSettings
    }
  | {
      kind: 'batch'
      entries: SceneHistoryEntry[]
    }
  | {
      kind: 'node-basics'
      snapshots: SceneHistoryNodeBasicsSnapshot[]
    }
  | {
      kind: 'node-structure'
      ops: SceneHistoryNodeStructureOp[]
    }
  | {
      kind: 'ground-settings'
      groundSettings: GroundSettings
    }
  | {
      kind: 'ground-texture'
      nodeId: string
      dataUrl: string | null
      name: string | null
    }
  | {
      kind: 'node-transform'
      transforms: SceneHistoryTransformSnapshot[]
    }
  | {
      kind: 'node-dynamic-mesh'
      nodeId: string
      dynamicMesh: unknown
    }
  | {
      kind: 'ground-manual-height-region'
      nodeId: string
      bounds: SceneHistoryGroundRegionBounds
      entries: SceneHistoryGroundManualHeightEntry[]
    }
