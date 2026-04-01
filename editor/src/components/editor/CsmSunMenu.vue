<template>
  <v-menu
    :activator="menuActivators.sun"
    :model-value="csmMenuOpen"
    location="bottom"
    :offset="6"
    :open-on-click="false"
    :close-on-content-click="false"
    @update:modelValue="handleCsmMenuModelUpdate"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        :ref="(el: unknown) => setMenuActivator('sun', el)"
        icon="mdi-white-balance-sunny"
        density="compact"
        size="small"
        class="toolbar-button"
        :color="csmMenuOpen ? 'primary' : undefined"
        :variant="csmMenuOpen ? 'flat' : 'text'"
        title="CSM Sun & Shadow"
        @click="emit('update:csm-menu-open', true)"
      />
    </template>
    <v-list density="compact" class="csm-sun-menu">
      <div
        class="popup-menu-card csm-sun-menu__card"
        @pointerdown.stop
        @pointerup.stop
        @mousedown.stop
        @mouseup.stop
      >
        <v-toolbar density="compact" class="menu-toolbar" height="36px">
          <div class="toolbar-text">
            <div class="menu-title">CSM Sun</div>
          </div>
          <v-spacer />
          <v-btn class="menu-close-btn" icon="mdi-close" size="small" variant="text" @click="emit('update:csm-menu-open', false)" />
        </v-toolbar>
        <div class="popup-menu-card__content csm-sun-menu__content">
          <v-switch
            :model-value="csmEnabled"
            density="compact"
            hide-details
            inset
            color="primary"
            label="Enable CSM"
            @update:model-value="(value) => emit('update:csm-enabled', Boolean(value))"
          />
          <div class="csm-sun-grid">
            <v-text-field
              :model-value="csmLightColor"
              label="Light Color"
              density="compact"
              variant="underlined"
              hide-details
              @update:model-value="(value) => emit('update:csm-light-color', String(value ?? ''))"
            />
            <v-text-field
              :model-value="csmLightIntensity"
              type="number"
              min="0"
              max="16"
              step="0.05"
              label="Intensity"
              density="compact"
              variant="underlined"
              hide-details
              @update:model-value="(value) => emit('update:csm-light-intensity', Number(value))"
            />
            <v-text-field
              :model-value="csmSunAzimuthDeg"
              type="number"
              min="-180"
              max="180"
              step="1"
              label="Azimuth (deg)"
              density="compact"
              variant="underlined"
              hide-details
              @update:model-value="(value) => emit('update:csm-sun-azimuth-deg', Number(value))"
            />
            <v-text-field
              :model-value="csmSunElevationDeg"
              type="number"
              min="-10"
              max="89"
              step="1"
              label="Elevation (deg)"
              density="compact"
              variant="underlined"
              hide-details
              @update:model-value="(value) => emit('update:csm-sun-elevation-deg', Number(value))"
            />
            <v-select
              :model-value="csmCascades"
              :items="csmCascadeOptions"
              item-title="label"
              item-value="value"
              label="Cascades"
              density="compact"
              variant="underlined"
              hide-details
              @update:model-value="(value) => emit('update:csm-cascades', Number(value))"
            />
            <v-text-field
              :model-value="csmMaxFar"
              type="number"
              min="1"
              max="10000"
              step="10"
              label="Max Far"
              density="compact"
              variant="underlined"
              hide-details
              @update:model-value="(value) => emit('update:csm-max-far', Number(value))"
            />
            <v-select
              :model-value="csmShadowMapSize"
              :items="csmShadowMapSizeOptions"
              item-title="label"
              item-value="value"
              label="Shadow Map"
              density="compact"
              variant="underlined"
              hide-details
              @update:model-value="(value) => emit('update:csm-shadow-map-size', Number(value))"
            />
            <v-text-field
              :model-value="csmShadowBias"
              type="number"
              min="-0.01"
              max="0.01"
              step="0.00005"
              label="Shadow Bias"
              density="compact"
              variant="underlined"
              hide-details
              @update:model-value="(value) => emit('update:csm-shadow-bias', Number(value))"
            />
          </div>
        </div>
      </div>
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
const emit = defineEmits([
  'update:csm-menu-open',
  'update:csm-enabled',
  'update:csm-light-color',
  'update:csm-light-intensity',
  'update:csm-sun-azimuth-deg',
  'update:csm-sun-elevation-deg',
  'update:csm-cascades',
  'update:csm-max-far',
  'update:csm-shadow-map-size',
  'update:csm-shadow-bias',
])

defineProps({
  menuActivators: Object,
  csmMenuOpen: Boolean,
  csmEnabled: Boolean,
  csmLightColor: String,
  csmLightIntensity: Number,
  csmSunAzimuthDeg: Number,
  csmSunElevationDeg: Number,
  csmCascades: Number,
  csmCascadeOptions: Array,
  csmMaxFar: Number,
  csmShadowMapSize: Number,
  csmShadowMapSizeOptions: Array,
  csmShadowBias: Number,
  handleCsmMenuModelUpdate: Function,
  setMenuActivator: Function,
})
</script>

<style scoped>
.csm-sun-menu__card {
  min-width: 320px;
}
.csm-sun-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin-top: 8px;
}
</style>
