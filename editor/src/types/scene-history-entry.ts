import type {
  AssetManifest,
  GroundSettings,
  SceneAssetRegistryEntry,
  SceneNode,
  Vector3Like,
} from '@schema/core'
import type { SceneMaterial } from '@/types/material'
import type { ProjectAsset } from '@/types/project-asset'

export type SceneHistoryTransformSnapshot = {
  id: string
  position: Vector3Like
  rotation: Vector3Like
  scale: Vector3Like
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

export type SceneAssetCatalogSnapshot = {
  assetCatalog: Record<string, ProjectAsset[]>
  assetManifest: AssetManifest | null
  assetRegistry: Record<string, SceneAssetRegistryEntry>
  activeDirectoryId: string | null
  selectedAssetId: string | null
}

// New history model: content-only undo/redo entries.
// Explicitly excludes: selection, camera, viewport, panels, planning, environment/shadows.
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
      assetId: string | null
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
      kind: 'asset-catalog'
      snapshot: SceneAssetCatalogSnapshot
    }
