const GROUND_PERSISTENCE_DEBUG_MAX_DEPTH = 3
const GROUND_PERSISTENCE_DEBUG_MAX_KEYS = 12
const GROUND_PERSISTENCE_DEBUG_MAX_ARRAY_SAMPLE = 8
const GROUND_PERSISTENCE_DEBUG_MAX_STRING_LENGTH = 240

function truncateGroundPersistenceString(value: string): string {
  return value.length > GROUND_PERSISTENCE_DEBUG_MAX_STRING_LENGTH
    ? `${value.slice(0, GROUND_PERSISTENCE_DEBUG_MAX_STRING_LENGTH)}...`
    : value
}

function summarizeGroundPersistenceObject(
  value: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const keys = Object.keys(value)
  const limitedKeys = keys.slice(0, GROUND_PERSISTENCE_DEBUG_MAX_KEYS)
  const summary: Record<string, unknown> = {}

  for (const key of limitedKeys) {
    summary[key] = normalizeGroundPersistenceValue(value[key], depth + 1, seen)
  }

  if (keys.length > limitedKeys.length) {
    summary.__truncatedKeys = keys.length - limitedKeys.length
  }

  return summary
}

function normalizeGroundPersistenceValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value === 'string') {
    return truncateGroundPersistenceString(value)
  }
  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateGroundPersistenceString(value.message),
      stack: value.stack ? truncateGroundPersistenceString(value.stack) : null,
    }
  }
  if (value instanceof ArrayBuffer) {
    return {
      type: 'ArrayBuffer',
      byteLength: value.byteLength,
    }
  }
  if (ArrayBuffer.isView(value)) {
    return {
      type: value.constructor?.name ?? 'TypedArray',
      length: 'length' in value && typeof value.length === 'number' ? value.length : undefined,
      byteLength: value.byteLength,
      sample: Array.from(
        value instanceof DataView
          ? new Uint8Array(value.buffer, value.byteOffset, Math.min(value.byteLength, GROUND_PERSISTENCE_DEBUG_MAX_ARRAY_SAMPLE))
          : (value as ArrayLike<unknown>),
      ).slice(0, GROUND_PERSISTENCE_DEBUG_MAX_ARRAY_SAMPLE),
    }
  }
  if (value instanceof Map) {
    return {
      type: 'Map',
      size: value.size,
      entries: Array.from(value.entries())
        .slice(0, GROUND_PERSISTENCE_DEBUG_MAX_ARRAY_SAMPLE)
        .map(([key, entryValue]) => [
          normalizeGroundPersistenceValue(key, depth + 1, seen),
          normalizeGroundPersistenceValue(entryValue, depth + 1, seen),
        ]),
    }
  }
  if (value instanceof Set) {
    return {
      type: 'Set',
      size: value.size,
      values: Array.from(value.values())
        .slice(0, GROUND_PERSISTENCE_DEBUG_MAX_ARRAY_SAMPLE)
        .map((entryValue) => normalizeGroundPersistenceValue(entryValue, depth + 1, seen)),
    }
  }
  if (Array.isArray(value)) {
    if (depth >= GROUND_PERSISTENCE_DEBUG_MAX_DEPTH) {
      return {
        type: 'Array',
        length: value.length,
      }
    }
    return value.length > GROUND_PERSISTENCE_DEBUG_MAX_ARRAY_SAMPLE
      ? {
        type: 'Array',
        length: value.length,
        sample: value
          .slice(0, GROUND_PERSISTENCE_DEBUG_MAX_ARRAY_SAMPLE)
          .map((entryValue) => normalizeGroundPersistenceValue(entryValue, depth + 1, seen)),
      }
      : value.map((entryValue) => normalizeGroundPersistenceValue(entryValue, depth + 1, seen))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  if (seen.has(value)) {
    return '[Circular]'
  }
  if (depth >= GROUND_PERSISTENCE_DEBUG_MAX_DEPTH) {
    return {
      type: value.constructor?.name ?? 'Object',
      keyCount: Object.keys(value as Record<string, unknown>).length,
    }
  }
  seen.add(value)
  return summarizeGroundPersistenceObject(value as Record<string, unknown>, depth, seen)
}

export function formatGroundPersistenceDebug(value: unknown): string {
  try {
    return JSON.stringify(normalizeGroundPersistenceValue(value))
  } catch (error) {
    return JSON.stringify({
      formatterError: error instanceof Error ? error.message : String(error),
    })
  }
}

export function logGroundPersistenceDebug(scope: string, event: string, payload?: unknown): void {
  const suffix = payload === undefined ? '' : ` ${formatGroundPersistenceDebug(payload)}`
  console.info(`[GroundPersistence][${scope}] ${event}${suffix}`)
}