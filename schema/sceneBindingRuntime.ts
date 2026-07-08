export type SceneBindingKind = 'rigidbody' | 'vehicle' | 'character'

export type SceneBindingEntryLike = {
  bindingKind?: SceneBindingKind | null
}

export function resolveBindingEntry<TBinding>(
  bindings: Map<string, TBinding> | null | undefined,
  nodeId: string | null | undefined,
): TBinding | null {
  if (!bindings || typeof nodeId !== 'string') {
    return null
  }
  const normalized = nodeId.trim()
  if (!normalized.length) {
    return null
  }
  return bindings.get(normalized) ?? null
}

export function resolveBindingKind(binding: SceneBindingEntryLike | null | undefined): SceneBindingKind | null {
  const kind = binding?.bindingKind ?? null
  if (kind === 'rigidbody' || kind === 'vehicle' || kind === 'character') {
    return kind
  }
  return null
}

export function isBindingKind(
  binding: SceneBindingEntryLike | null | undefined,
  kind: SceneBindingKind,
): boolean {
  return resolveBindingKind(binding) === kind
}
