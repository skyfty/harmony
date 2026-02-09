export interface SceneJsonExportDocument {
  id: string;
  name: string;
  nodes: unknown[];
  materials: unknown[];
  [key: string]: unknown;
}
