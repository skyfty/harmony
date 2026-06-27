const BROWSER_PUNCH_PROGRESS_STORAGE_KEY = 'harmony:browser-punch-progress'
const BROWSER_PUNCH_PROGRESS_VERSION = 1

type BrowserPunchProgressEnvelope = {
  version: number
  scenes: Record<string, string[]>
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function normalizeNodeIdList(nodeIds: Iterable<string> | null | undefined): string[] {
  const normalized = new Set<string>()
  if (!nodeIds) {
    return []
  }
  for (const nodeId of nodeIds) {
    if (typeof nodeId !== 'string') {
      continue
    }
    const trimmed = nodeId.trim()
    if (trimmed) {
      normalized.add(trimmed)
    }
  }
  return Array.from(normalized)
}

function normalizeSceneId(sceneId: string | null | undefined): string {
  return typeof sceneId === 'string' ? sceneId.trim() : ''
}

function readBrowserPunchProgressEnvelope(): BrowserPunchProgressEnvelope {
  if (!isBrowserStorageAvailable()) {
    return { version: BROWSER_PUNCH_PROGRESS_VERSION, scenes: {} }
  }

  try {
    const raw = window.localStorage.getItem(BROWSER_PUNCH_PROGRESS_STORAGE_KEY)
    if (!raw) {
      return { version: BROWSER_PUNCH_PROGRESS_VERSION, scenes: {} }
    }
    const parsed = JSON.parse(raw) as Partial<BrowserPunchProgressEnvelope> | null
    const scenes = parsed && typeof parsed === 'object' && parsed.scenes && typeof parsed.scenes === 'object'
      ? Object.fromEntries(
        Object.entries(parsed.scenes).map(([sceneId, nodeIds]) => [normalizeSceneId(sceneId), normalizeNodeIdList(nodeIds)]),
      )
      : {}
    return {
      version: BROWSER_PUNCH_PROGRESS_VERSION,
      scenes,
    }
  } catch {
    return { version: BROWSER_PUNCH_PROGRESS_VERSION, scenes: {} }
  }
}

function writeBrowserPunchProgressEnvelope(envelope: BrowserPunchProgressEnvelope): void {
  if (!isBrowserStorageAvailable()) {
    return
  }

  try {
    window.localStorage.setItem(BROWSER_PUNCH_PROGRESS_STORAGE_KEY, JSON.stringify(envelope))
  } catch {
    // Ignore storage write failures so runtime punch state still works in-memory.
  }
}

export function loadStoredPunchedNodeIds(sceneId: string | null | undefined): string[] {
  const normalizedSceneId = normalizeSceneId(sceneId)
  if (!normalizedSceneId) {
    return []
  }
  return readBrowserPunchProgressEnvelope().scenes[normalizedSceneId] ?? []
}

export function saveStoredPunchedNodeIds(sceneId: string | null | undefined, nodeIds: Iterable<string>): string[] {
  const normalizedSceneId = normalizeSceneId(sceneId)
  if (!normalizedSceneId) {
    return []
  }

  const normalizedNodeIds = normalizeNodeIdList(nodeIds)
  const envelope = readBrowserPunchProgressEnvelope()
  if (normalizedNodeIds.length) {
    envelope.scenes[normalizedSceneId] = normalizedNodeIds
  } else {
    delete envelope.scenes[normalizedSceneId]
  }
  writeBrowserPunchProgressEnvelope(envelope)
  return normalizedNodeIds
}

export function mergeStoredPunchedNodeId(sceneId: string | null | undefined, nodeId: string | null | undefined): string[] {
  const normalizedSceneId = normalizeSceneId(sceneId)
  const normalizedNodeId = typeof nodeId === 'string' ? nodeId.trim() : ''
  if (!normalizedSceneId || !normalizedNodeId) {
    return loadStoredPunchedNodeIds(normalizedSceneId)
  }

  const merged = new Set(loadStoredPunchedNodeIds(normalizedSceneId))
  merged.add(normalizedNodeId)
  return saveStoredPunchedNodeIds(normalizedSceneId, merged)
}

export function pruneStoredPunchedNodeIds(sceneId: string | null | undefined, validNodeIds: Iterable<string>): string[] {
  const normalizedSceneId = normalizeSceneId(sceneId)
  if (!normalizedSceneId) {
    return []
  }

  const valid = new Set(normalizeNodeIdList(validNodeIds))
  if (!valid.size) {
    return saveStoredPunchedNodeIds(normalizedSceneId, [])
  }

  const current = loadStoredPunchedNodeIds(normalizedSceneId)
  const next = current.filter((nodeId) => valid.has(nodeId))
  return saveStoredPunchedNodeIds(normalizedSceneId, next)
}