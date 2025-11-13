<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

type LogLevel = 'info' | 'warn' | 'error'

interface LogEntry {
  id: number
  level: LogLevel
  timestamp: number
  message: string
}

const MAX_LOG_ENTRIES = 500
let nextEntryId = 0
const activeLevels = ref<LogLevel[]>(['info', 'warn', 'error'])
const entries = ref<LogEntry[]>([])
const logListRef = ref<HTMLElement | null>(null)
const restoreConsoleFns: Array<() => void> = []

const levelDefinitions: Array<{ level: LogLevel; label: string; icon: string }> = [
  { level: 'info', label: 'Info', icon: 'mdi-information-outline' },
  { level: 'warn', label: 'Warn', icon: 'mdi-alert-outline' },
  { level: 'error', label: 'Error', icon: 'mdi-alert-circle-outline' },
]

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const filteredEntries = computed(() => {
  const visibleLevels = new Set(activeLevels.value)
  return entries.value.filter((entry) => {
    if (!visibleLevels.has(entry.level)) {
      return false
    }
    return true
  })
})

function toggleLevel(level: LogLevel): void {
  if (activeLevels.value.includes(level)) {
    activeLevels.value = activeLevels.value.filter((item) => item !== level)
    return
  }
  activeLevels.value = [...activeLevels.value, level]
}

function clearLogs(): void {
  entries.value = []
}

function formatTimestamp(value: number): string {
  return timeFormatter.format(new Date(value))
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg
  }
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}`
  }
  try {
    return JSON.stringify(arg)
  } catch (error) {
    return String(arg)
  }
}

function pushEntry(level: LogLevel, payload: unknown[]): void {
  const message = payload.map(formatArg).join(' ')
  const timestamp = Date.now()
  const record: LogEntry = {
    id: ++nextEntryId,
    level,
    timestamp,
    message,
  }
  entries.value = [...entries.value.slice(-MAX_LOG_ENTRIES + 1), record]
}

watch(entries, () => {
  nextTick(() => {
    const element = logListRef.value
    if (!element) {
      return
    }
    element.scrollTop = element.scrollHeight
  })
})

// Mirror console output into local log history while preserving native behavior.
onMounted(() => {
  if (typeof window === 'undefined') {
    return
  }
  const target = window.console
  const consoleMap = target as unknown as Record<string, (...values: unknown[]) => unknown>
  const patchers: Array<{ method: keyof Console; level: LogLevel }> = [
    { method: 'log', level: 'info' },
    { method: 'info', level: 'info' },
    { method: 'warn', level: 'warn' },
    { method: 'error', level: 'error' },
  ]
  patchers.forEach(({ method, level }) => {
    const methodName = method as string
    const original = consoleMap[methodName]
    if (typeof original !== 'function') {
      return
    }
    const patched = (...args: unknown[]) => {
      pushEntry(level, args)
      return original.apply(target, args)
    }
    consoleMap[methodName] = patched
    restoreConsoleFns.push(() => {
      consoleMap[methodName] = original
    })
  })
})

onBeforeUnmount(() => {
  restoreConsoleFns.forEach((restore) => restore())
  restoreConsoleFns.length = 0
})
</script>

<template>
  <div class="console-panel">
    <div class="console-toolbar">
      <div class="console-toolbar__filters">
        <v-btn
          v-for="definition in levelDefinitions"
          :key="definition.level"
          class="console-toolbar__filter"
          :class="{ 'is-active': activeLevels.includes(definition.level) }"
          variant="text"
          density="compact"
          size="small"
          @click="toggleLevel(definition.level)"
        >
          <v-icon :icon="definition.icon" size="16" />
          <span class="console-toolbar__filter-label">{{ definition.label }}</span>
        </v-btn>
      </div>
      <v-spacer />
      <v-btn
        class="console-toolbar__clear"
        variant="text"
        size="small"
        color="primary"
        @click="clearLogs"
      >
        <v-icon icon="mdi-delete-outline" size="18" />
        Clear
      </v-btn>
    </div>
    <v-divider />
    <div ref="logListRef" class="console-log-list">
      <template v-if="filteredEntries.length">
        <div
          v-for="entry in filteredEntries"
          :key="entry.id"
          class="console-log-entry"
          :class="`is-${entry.level}`"
        >
          <div class="console-log-entry__meta">
            <span class="console-log-entry__level">{{ entry.level }}</span>
            <span class="console-log-entry__time">{{ formatTimestamp(entry.timestamp) }}</span>
          </div>
          <div class="console-log-entry__message">{{ entry.message }}</div>
        </div>
      </template>
      <div v-else class="console-empty-state">
        <v-icon icon="mdi-console-line" size="28" />
        <p>No console output yet.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.console-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background-color: rgba(11, 15, 22, 0.8);
}

.console-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 2px 11px;
}

.console-toolbar__filters {
  display: flex;
  gap: 8px;
}

.console-toolbar__filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  position: relative;
  color: rgba(233, 236, 241, 0.72);
  text-transform: none;
}

.console-toolbar__filter.is-active {
  color: #f5fbff;
}

.console-toolbar__filter.is-active::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -4px;
  height: 2px;
  background-color: rgba(0, 169, 255, 0.85);
}

.console-toolbar__filter-label {
  font-size: 0.76rem;
  letter-spacing: 0.04em;
}

.console-toolbar__search {
  max-width: 200px;
  flex: 0 0 auto;
}

.console-toolbar__clear {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-transform: none;
}

.console-log-list {
  position: relative;
  flex: 1;
  overflow: auto;
  padding: 12px 16px 16px;
  font-family: 'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.78rem;
  line-height: 1.5;
  color: rgba(233, 236, 241, 0.92);
}

.console-log-entry {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 6px;
  background: rgba(19, 25, 35, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.04);
  margin-bottom: 10px;
}

.console-log-entry:last-child {
  margin-bottom: 0;
}

.console-log-entry__meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.console-log-entry__level {
  color: rgba(233, 236, 241, 0.65);
}

.console-log-entry__time {
  color: rgba(233, 236, 241, 0.45);
}

.console-log-entry__message {
  white-space: pre-wrap;
  word-break: break-word;
}

.console-log-entry.is-warn {
  border-color: rgba(255, 166, 0, 0.35);
  background: rgba(255, 166, 0, 0.08);
}

.console-log-entry.is-error {
  border-color: rgba(255, 82, 82, 0.4);
  background: rgba(255, 82, 82, 0.1);
}

.console-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: rgba(233, 236, 241, 0.55);
}

.console-empty-state p {
  margin: 0;
}
</style>
