export function buildGuideRouteInputDraftKey(
  routeNodeId: string,
  componentId: string,
  owner: readonly (string | number)[],
  field: string,
): string {
  return JSON.stringify([routeNodeId, componentId, ...owner, field])
}

export function readGuideRouteInputDraft(
  drafts: ReadonlyMap<string, string>,
  key: string,
  committedValue: string | number,
): string {
  return drafts.get(key) ?? String(committedValue)
}

export function writeGuideRouteInputDraft(
  drafts: Map<string, string>,
  key: string,
  value: unknown,
): void {
  drafts.set(key, value == null ? '' : String(value))
}

export function parseGuideRouteDecimalInput(value: unknown): number | null {
  const text = value == null ? '' : String(value).trim()
  if (!text || !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    return null
  }
  const numeric = Number(text)
  return Number.isFinite(numeric) ? numeric : null
}

export function normalizeGuideRouteStopNameInput(value: unknown): string {
  return value == null ? '' : String(value).trim()
}
