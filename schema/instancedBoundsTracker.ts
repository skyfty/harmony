import * as THREE from 'three';

const instancedBoundsDirtyMeshes = new Set<THREE.InstancedMesh>();
let instancedBoundsUpdateAccumSeconds = 0;
const INSTANCED_BOUNDS_UPDATE_INTERVAL_SECONDS = 0.15;

export function addMesh(mesh: THREE.InstancedMesh): void {
  if (mesh && (mesh as any).isInstancedMesh) {
    instancedBoundsDirtyMeshes.add(mesh);
  }
}

export function addMeshes(meshes: Iterable<THREE.InstancedMesh> | null | undefined): void {
  if (!meshes) return;
  for (const m of meshes) {
    addMesh(m);
  }
}

export function hasPending(): boolean {
  return instancedBoundsDirtyMeshes.size > 0;
}

export function flush(): void {
  if (!instancedBoundsDirtyMeshes.size) return;
  try {
    instancedBoundsDirtyMeshes.forEach((mesh) => {
      try {
        mesh.computeBoundingSphere();
      } catch (_e) {
        // ignore per-mesh failures
      }
    });
  } finally {
    instancedBoundsDirtyMeshes.clear();
    instancedBoundsUpdateAccumSeconds = 0;
  }
}

export function tick(deltaSeconds: number): void {
  if (!instancedBoundsDirtyMeshes.size) {
    instancedBoundsUpdateAccumSeconds = 0;
    return;
  }
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
  instancedBoundsUpdateAccumSeconds += deltaSeconds;
  if (instancedBoundsUpdateAccumSeconds >= INSTANCED_BOUNDS_UPDATE_INTERVAL_SECONDS) {
    flush();
  }
}

export function clear(): void {
  instancedBoundsDirtyMeshes.clear();
  instancedBoundsUpdateAccumSeconds = 0;
}
