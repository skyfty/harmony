export interface SceneJsonExportDocument {
  id: string;
  name: string;
  nodes: unknown[];
  materials: unknown[];
  loadProgressHints?: {
    nodeCount: number;
    previewIndexNodeCount: number;
    physicsRelevantNodeCount: number;
    vehicleNodeCount: number;
    terrainScatterGroundCount: number;
    terrainScatterLayerCount: number;
    terrainScatterInstanceCount: number;
  };
  [key: string]: unknown;
}
