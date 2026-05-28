<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { SceneNodeComponentState } from '@schema/core'
import { useSceneStore } from '@/stores/sceneStore'
import {
  COUPON_COMPONENT_TYPE,
  clampCouponComponentProps,
  parseCouponComponentSpec,
  type CouponComponentProps,
} from '@schema/components'

const sceneStore = useSceneStore()
const { selectedNode, selectedNodeId } = storeToRefs(sceneStore)

const couponComponent = computed(
  () =>
    selectedNode.value?.components?.[COUPON_COMPONENT_TYPE] as
      | SceneNodeComponentState<CouponComponentProps>
      | undefined,
)

const componentEnabled = computed(() => couponComponent.value?.enabled !== false)
const couponProps = computed(() => clampCouponComponentProps(couponComponent.value?.props))
const couponSpec = computed(() => parseCouponComponentSpec(couponProps.value.couponJson))
const couponJsonStatus = computed(() => {
  if (!couponProps.value.couponJson.trim()) {
    return 'Please paste the coupon JSON here.'
  }
  return couponSpec.value ? `Resolved coupon id: ${couponSpec.value.id}` : 'Invalid coupon JSON.'
})

const localValues = reactive({
  couponJson: '',
})

watch(
  () => couponProps.value.couponJson,
  (value) => {
    localValues.couponJson = value ?? ''
  },
  { immediate: true },
)

function updateComponentProps(next: Partial<CouponComponentProps>): void {
  const component = couponComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.updateNodeComponentProps(nodeId, component.id, next)
}

function handleToggleComponent(): void {
  const component = couponComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.toggleNodeComponentEnabled(nodeId, component.id)
}

function handleRemoveComponent(): void {
  const component = couponComponent.value
  const nodeId = selectedNodeId.value
  if (!component || !nodeId) {
    return
  }
  sceneStore.removeNodeComponent(nodeId, component.id)
}

function handleCouponJsonChange(value: string): void {
  localValues.couponJson = value
  updateComponentProps({ couponJson: value })
}

function handleHideExpiredChange(value: boolean | null): void {
  if (value === null) {
    return
  }
  updateComponentProps({ hideExpired: value })
}

function handleHideOwnedChange(value: boolean | null): void {
  if (value === null) {
    return
  }
  updateComponentProps({ hideOwned: value })
}
</script>

<template>
  <v-expansion-panel :value="COUPON_COMPONENT_TYPE">
    <v-expansion-panel-title>
      <div class="coupon-panel__header">
        <span class="coupon-panel__title">Coupon</span>
        <v-spacer />
        <v-menu
          v-if="couponComponent"
          location="bottom end"
          origin="auto"
          transition="fade-transition"
        >
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon
              variant="text"
              size="small"
              class="component-menu-btn"
              @click.stop
            >
              <v-icon size="18">mdi-dots-vertical</v-icon>
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item @click.stop="handleToggleComponent()">
              <v-list-item-title>{{ componentEnabled ? 'Disable' : 'Enable' }}</v-list-item-title>
            </v-list-item>
            <v-divider class="component-menu-divider" inset />
            <v-list-item @click.stop="handleRemoveComponent()">
              <v-list-item-title>Remove</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-expansion-panel-title>
    <v-expansion-panel-text>
      <div class="coupon-panel__body">
        <v-textarea
          label="Coupon JSON"
          density="compact"
          variant="outlined"
          auto-grow
          rows="5"
          persistent-hint
          :hint="couponJsonStatus"
          :model-value="localValues.couponJson"
          :disabled="!componentEnabled"
          placeholder='{"id":"coupon-id","validUntil":"2026-12-31","type":"reward"}'
          @update:modelValue="handleCouponJsonChange"
        />
        <div class="coupon-panel__flags">
          <v-switch
            label="Hide when expired"
            color="primary"
            density="compact"
            hide-details
            :model-value="couponProps.hideExpired"
            :disabled="!componentEnabled"
            @update:modelValue="handleHideExpiredChange"
          />
          <v-switch
            label="Hide when already owned"
            color="primary"
            density="compact"
            hide-details
            :model-value="couponProps.hideOwned"
            :disabled="!componentEnabled"
            @update:modelValue="handleHideOwnedChange"
          />
        </div>
        <div v-if="couponSpec" class="coupon-panel__summary">
          <div class="coupon-panel__summary-title">Parsed Coupon</div>
          <div class="coupon-panel__summary-line">ID: {{ couponSpec.id }}</div>
          <div class="coupon-panel__summary-line">Type: {{ couponSpec.type ?? 'n/a' }}</div>
          <div class="coupon-panel__summary-line">Name: {{ couponSpec.name ?? 'n/a' }}</div>
          <div class="coupon-panel__summary-line">Expires: {{ couponSpec.validUntil ?? 'n/a' }}</div>
        </div>
      </div>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>

<style scoped>
.coupon-panel__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
}

.coupon-panel__title {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.component-menu-btn {
  color: rgba(233, 236, 241, 0.82);
}

.component-menu-divider {
  margin-inline: 0.6rem;
}

.coupon-panel__body {
  display: grid;
  gap: 0.75rem;
}

.coupon-panel__flags {
  display: grid;
  gap: 0.25rem;
}

.coupon-panel__summary {
  display: grid;
  gap: 0.2rem;
  padding: 0.65rem 0.75rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.coupon-panel__summary-title {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.8;
  margin-bottom: 0.1rem;
}

.coupon-panel__summary-line {
  font-size: 0.84rem;
  color: rgba(233, 236, 241, 0.88);
  word-break: break-word;
}
</style>
