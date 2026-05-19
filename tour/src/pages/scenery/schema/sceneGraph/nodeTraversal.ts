import type { SceneNodeWithExtras } from './types';

export function findGroundNodeInNodes(nodes: SceneNodeWithExtras[]): SceneNodeWithExtras | null {
  const stack: SceneNodeWithExtras[] = Array.isArray(nodes) ? [...nodes] : [];
  while (stack.length) {
    const node = stack.pop()!;
    const mesh = node.dynamicMesh as unknown;
    if (mesh && (mesh as any).type === 'Ground') {
      return node;
    }

    const children = Array.isArray((node as any).children) ? ((node as any).children as SceneNodeWithExtras[]) : [];
    if (children.length) {
      for (const child of children) {
        stack.push(child);
      }
    }
  }
  return null;
}
