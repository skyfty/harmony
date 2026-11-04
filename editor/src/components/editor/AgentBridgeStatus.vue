<script setup lang="ts">
import { computed } from 'vue'
import { useSceneStore } from '@/stores/sceneStore'
import {
  setAgentBridgePaused,
  useAgentBridgeState,
} from '@/agent/bridgeClient'

const sceneStore = useSceneStore()
const agentBridge = useAgentBridgeState()

const statusLabel = computed(() => {
  if (agentBridge.status === 'disabled') return 'Agent bridge off'
  if (agentBridge.status === 'connecting') return 'Agent connecting'
  if (agentBridge.status === 'disconnected') return 'Agent offline'
  return agentBridge.paused ? 'Agent paused' : 'Agent connected'
})

const statusColor = computed(() => {
  if (agentBridge.status === 'connected') return agentBridge.paused ? 'warning' : 'success'
  if (agentBridge.status === 'connecting') return 'info'
  return 'default'
})

function togglePaused(): void {
  setAgentBridgePaused(!agentBridge.paused)
}

async function undoLastAction(): Promise<void> {
  await sceneStore.undo()
}
</script>

<template>
  <div v-if="agentBridge.enabled" class="agent-bridge-status">
    <v-menu location="top end" :close-on-content-click="false">
      <template #activator="{ props }">
        <v-chip
          v-bind="props"
          :color="statusColor"
          variant="flat"
          size="small"
          class="agent-bridge-status__chip"
        >
          <v-icon start size="15">mdi-robot-outline</v-icon>
          {{ statusLabel }}
        </v-chip>
      </template>
      <v-card class="agent-bridge-card" min-width="360" max-width="440">
        <v-card-title class="agent-bridge-card__title">
          Agent Bridge
          <v-chip size="x-small" variant="tonal">
            rev {{ sceneStore.sceneRevision }}
          </v-chip>
        </v-card-title>
        <v-card-subtitle>
          {{ sceneStore.currentSceneMeta?.name || 'No scene' }}
          · {{ sceneStore.hasUnsavedChanges ? 'unsaved changes' : 'saved' }}
        </v-card-subtitle>
        <v-card-text class="agent-bridge-card__body">
          <div class="agent-bridge-card__policy">
            MCP-first scene edits · UI automation is a last resort
          </div>
          <div v-if="agentBridge.lastError" class="agent-bridge-card__error">
            {{ agentBridge.lastError }}
          </div>
          <div class="agent-bridge-card__actions">
            <v-btn
              size="small"
              variant="tonal"
              :prepend-icon="agentBridge.paused ? 'mdi-play' : 'mdi-pause'"
              :disabled="agentBridge.status !== 'connected'"
              @click="togglePaused"
            >
              {{ agentBridge.paused ? 'Resume writes' : 'Pause writes' }}
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-undo"
              :disabled="sceneStore.undoStack.length === 0"
              @click="undoLastAction"
            >
              Undo last
            </v-btn>
          </div>
          <div class="agent-bridge-card__section-title">Recent activity</div>
          <div v-if="!agentBridge.audit.length" class="agent-bridge-card__empty">
            Waiting for an Agent request.
          </div>
          <div
            v-for="entry in agentBridge.audit.slice(0, 8)"
            :key="entry.id"
            class="agent-bridge-card__entry"
          >
            <v-icon :color="entry.ok ? 'success' : 'error'" size="14">
              {{ entry.ok ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline' }}
            </v-icon>
            <span class="agent-bridge-card__method">{{ entry.method }}</span>
            <span class="agent-bridge-card__summary">{{ entry.summary }}</span>
          </div>
        </v-card-text>
      </v-card>
    </v-menu>
  </div>
</template>

<style scoped>
.agent-bridge-status {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 30;
}

.agent-bridge-status__chip {
  cursor: pointer;
  backdrop-filter: blur(10px);
}

.agent-bridge-card {
  background: rgba(18, 23, 31, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.agent-bridge-card__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.95rem;
}

.agent-bridge-card__body {
  display: grid;
  gap: 12px;
}

.agent-bridge-card__policy {
  padding: 7px 9px;
  border-radius: 8px;
  background: rgba(0, 172, 193, 0.12);
  color: rgba(204, 241, 255, 0.9);
  font-size: 0.76rem;
}

.agent-bridge-card__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.agent-bridge-card__section-title {
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agent-bridge-card__entry {
  display: grid;
  grid-template-columns: 16px minmax(110px, auto) 1fr;
  align-items: center;
  gap: 7px;
  font-size: 0.78rem;
}

.agent-bridge-card__method {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: rgba(255, 255, 255, 0.86);
}

.agent-bridge-card__summary,
.agent-bridge-card__empty {
  color: rgba(255, 255, 255, 0.6);
}

.agent-bridge-card__error {
  color: rgb(255, 138, 128);
  font-size: 0.8rem;
  white-space: pre-wrap;
}
</style>
