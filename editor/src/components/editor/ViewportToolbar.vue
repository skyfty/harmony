
<template>
  <div class="viewport-toolbar">
    <v-card class="toolbar-card" elevation="6">

      <template v-for="tool in buildToolButtons" :key="tool.id">
        <v-menu
          v-if="tool.id === 'terrain'"
          :model-value="groundTerrainMenuOpen"
          location="bottom"
          :offset="6"
          :open-on-click="false"
          :close-on-content-click="false"
          @update:modelValue="handleGroundTerrainMenuModelUpdate"
        >
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :icon="tool.icon"
              density="compact"
              size="small"
              class="toolbar-button"
              :color="groundTerrainButtonActive ? 'primary' : undefined"
              :variant="groundTerrainButtonActive ? 'flat' : 'text'"
              :title="tool.label"
              :disabled="buildToolsDisabled || !hasGroundNode"
              @click="handleGroundButtonClick('terrain')"
            />
          </template>
          <v-list density="compact" class="ground-terrain-menu">
            <div
              class="ground-tool-menu__card"
              @pointerdown.stop
              @pointerup.stop
              @mousedown.stop
              @mouseup.stop
            >
              <v-toolbar density="compact" class="menu-toolbar" height="36px">
                <div class="toolbar-text">
                  <div class="menu-title">Terrain Tools</div>
                </div>
                <v-spacer />
                <v-btn class="menu-close-btn" icon="mdi-close" size="small" variant="text" @click="emit('update:ground-terrain-menu-open', false)" />
              </v-toolbar>
              <div class="ground-tool-menu__content">
                <TerrainSculptPanel
                  v-model:brush-radius="groundBrushRadiusModel"
                  v-model:brush-strength="groundBrushStrengthModel"
                  v-model:brush-shape="groundBrushShapeModel"
                  v-model:brush-operation="groundBrushOperationModel"
                  v-model:noise-strength="groundNoiseStrengthModel"
                  v-model:noise-mode="groundNoiseModeModel"
                  :has-ground="hasGroundNode"
                  :terrain-operations="terrainOperations"
                  :noise-mode-options="noiseModeOptions"
                />
              </div>
            </div>
          </v-list>
        </v-menu>
        <v-menu
          v-else-if="tool.id === 'paint'"
          :model-value="groundPaintMenuOpen"
          location="bottom"
          :offset="6"
          :open-on-click="false"
          :close-on-content-click="false"
          @update:modelValue="handleGroundPaintMenuModelUpdate"
        >
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :icon="tool.icon"
              density="compact"
              size="small"
              class="toolbar-button"
              :color="groundPaintButtonActive ? 'primary' : undefined"
              :variant="groundPaintButtonActive ? 'flat' : 'text'"
              :title="tool.label"
              :disabled="buildToolsDisabled || !hasGroundNode"
              @click="handleGroundButtonClick('paint')"
            />
          </template>
          <v-list density="compact" class="ground-paint-menu">
            <div
              class="ground-tool-menu__card"
              @pointerdown.stop
              @pointerup.stop
              @mousedown.stop
              @mouseup.stop
            >
              <v-toolbar density="compact" class="menu-toolbar" height="36px">
                <div class="toolbar-text">
                  <div class="menu-title">Terrain Paint</div>
                </div>
                <v-spacer />
                <v-btn class="menu-close-btn" icon="mdi-close" size="small" variant="text" @click="emit('update:ground-paint-menu-open', false)" />
              </v-toolbar>
              <div class="ground-tool-menu__content">
                <TerrainPaintPanel
                  v-model:brush-radius="groundBrushRadiusModel"
                  v-model:smoothness="groundPaintSmoothnessModel"
                  v-model:asset="groundPaintAssetModel"
                  :has-ground="hasGroundNode"
                />
              </div>
            </div>
          </v-list>
        </v-menu>
        <v-menu
          v-else-if="tool.id === 'scatter'"
          :model-value="groundScatterMenuOpen"
          location="bottom"
          :offset="6"
          :open-on-click="false"
          :close-on-content-click="false"
          @update:modelValue="handleGroundScatterMenuModelUpdate"
        >
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :icon="tool.icon"
              density="compact"
              size="small"
              class="toolbar-button"
              :color="groundScatterButtonActive ? 'primary' : undefined"
              :variant="groundScatterButtonActive ? 'flat' : 'text'"
              :title="tool.label"
              :disabled="buildToolsDisabled || !hasGroundNode"
              @click="handleGroundButtonClick('scatter')"
            />
          </template>
          <v-list density="compact" class="ground-scatter-menu">
            <div
              class="ground-tool-menu__card"
              @pointerdown.stop
              @pointerup.stop
              @mousedown.stop
              @mouseup.stop
            >
              <v-toolbar density="compact" class="menu-toolbar" height="36px">
                <div class="toolbar-text">
                  <div class="menu-title">Terrain Scatter</div>
                </div>
                <v-spacer />
                <v-btn class="menu-close-btn" icon="mdi-close" size="small" variant="text" @click="emit('update:ground-scatter-menu-open', false)" />
              </v-toolbar>
              <div class="ground-tool-menu__content">
                <v-tabs v-model="groundScatterCategoryModel" density="compact" :transition="false" class="ground-scatter-tabs">
                  <v-tab v-for="tab in groundScatterTabs" :key="tab.key" :value="tab.key" :title="tab.label">
                    <v-icon :icon="tab.icon" size="16" />
                  </v-tab>
                </v-tabs>

                <div class="scatter-control-row">
                  <div class="scatter-spacing-item scatter-spacing--compact">
                    <div class="scatter-spacing-labels">
                      <span>Brush Radius</span>
                      <span>{{ groundScatterBrushRadiusDisplay }}</span>
                    </div>
                    <v-text-field
                      v-model="groundScatterBrushRadiusInput"
                      type="number"
                      suffix="m"
                      :min="SCATTER_BRUSH_RADIUS_MIN"
                      :max="SCATTER_BRUSH_RADIUS_MAX"
                      :step="SCATTER_RADIUS_STEP"
                      variant="underlined"
                      density="compact"
                      hide-details
                      inputmode="decimal"
                      class="scatter-spacing-input"
                      :disabled="buildToolsDisabled || !hasGroundNode"
                      @blur="commitGroundScatterBrushRadiusInput"
                      @keydown.enter.prevent="commitGroundScatterBrushRadiusInput"
                    />
                  </div>

                  <div class="scatter-spacing-item scatter-spacing--compact">
                    <div class="scatter-spacing-labels">
                      <span>Density</span>
                      <span>{{ groundScatterDensityDisplay }}</span>
                    </div>
                    <v-text-field
                      v-model="groundScatterDensityInput"
                      type="number"
                      suffix="%"
                      :min="SCATTER_DENSITY_MIN"
                      :max="SCATTER_DENSITY_MAX"
                      :step="SCATTER_DENSITY_STEP"
                      variant="underlined"
                      density="compact"
                      hide-details
                      inputmode="numeric"
                      class="scatter-spacing-input"
                      :disabled="buildToolsDisabled || !hasGroundNode"
                      @blur="commitGroundScatterDensityInput"
                      @keydown.enter.prevent="commitGroundScatterDensityInput"
                    />
                  </div>
                </div>

                <GroundAssetPainter
                  :key="groundScatterCategoryModel"
                  :category="groundScatterCategoryModel"
                  :selected-provider-asset-id="groundScatterProviderAssetId ?? null"
                  :thumbnail-size="52"
                  @asset-select="handleGroundScatterAssetSelect"
                />
              </div>
            </div>
          </v-list>
        </v-menu>
        <v-menu
          v-else-if="tool.id === 'floor'"
          :model-value="floorShapeMenuOpen"
          location="bottom"
          :offset="6"
          :open-on-click="false"
          :close-on-content-click="false"
          @update:modelValue="handleFloorShapeMenuModelUpdate"
        >
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :icon="tool.icon"
              density="compact"
              size="small"
              class="toolbar-button"
              :color="activeBuildTool === tool.id ? 'primary' : undefined"
              :variant="activeBuildTool === tool.id ? 'flat' : 'text'"
              :title="tool.label"
              :disabled="buildToolsDisabled"
              @click="handleBuildToolToggle(tool.id)"
            />
          </template>
          <v-list density="compact" class="floor-shape-menu">
            <div
              class="floor-shape-menu__card"
              @pointerdown.stop
              @pointerup.stop
              @mousedown.stop
              @mouseup.stop
            >
              <v-toolbar density="compact" class="menu-toolbar" height="36px">
                <div class="toolbar-text">
                  <div class="menu-title">Floor Brush</div>
                </div>
                <v-spacer />
                <v-btn class="menu-close-btn" icon="mdi-close" size="small" variant="text" @click="emit('update:floor-shape-menu-open', false)" />
              </v-toolbar>

              <div class="floor-shape-grid">
                <v-list-item
                  v-for="shape in floorShapeOptions"
                  :key="shape.id"
                  class="floor-shape-item"
                  @click="() => handleFloorShapeSelect(shape.id)"
                >
                  <v-btn
                    density="compact"
                    size="small"
                    variant="text"
                    :title="shape.label"
                    :class="['floor-shape-btn', shape.id === floorBuildShape ? 'floor-shape-selected' : '']"
                  >
                    <span v-html="shape.svg" />
                  </v-btn>
                </v-list-item>
              </div>

              <v-divider class="floor-shape-menu__divider" />

              <div class="floor-preset-menu__list">
                <AssetPickerList
                  :active="true"
                  assetType="prefab"
                  :extensions="['floor']"
                  :asset-id="floorBrushPresetAssetId"
                  :thumbnailSize="30"
                  :showSearch="true"
                  @update:asset="handleFloorPresetSelect"
                />
              </div>
            </div>
          </v-list>
        </v-menu>
        <v-menu
          v-else-if="tool.id === 'wall'"
          :model-value="wallShapeMenuOpen"
          location="bottom"
          :offset="6"
          :open-on-click="false"
          :close-on-content-click="false"
          @update:modelValue="handleWallShapeMenuModelUpdate"
        >
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :icon="tool.icon"
              density="compact"
              size="small"
              class="toolbar-button"
              :color="activeBuildTool === tool.id ? 'primary' : undefined"
              :variant="activeBuildTool === tool.id ? 'flat' : 'text'"
              :title="tool.label"
              :disabled="buildToolsDisabled"
              @click="handleBuildToolToggle(tool.id)"
            />
          </template>
          <v-list density="compact" class="wall-shape-menu">
            <div
              class="wall-shape-menu__card"
              @pointerdown.stop
              @pointerup.stop
              @mousedown.stop
              @mouseup.stop
            >
              <v-toolbar density="compact" class="menu-toolbar" height="36px">
                <div class="toolbar-text">
                  <div class="menu-title">Wall Brush</div>
                </div>
                <v-spacer />
                <v-btn class="menu-close-btn" icon="mdi-close" size="small" variant="text" @click="emit('update:wall-shape-menu-open', false)" />
              </v-toolbar>

              <div class="floor-shape-grid">
                <v-list-item
                  v-for="shape in wallShapeOptions"
                  :key="shape.id"
                  class="floor-shape-item"
                  @click="() => handleWallShapeSelect(shape.id)"
                >
                  <v-btn
                    density="compact"
                    size="small"
                    variant="text"
                    :title="shape.label"
                    :class="['floor-shape-btn', shape.id === wallBuildShape ? 'floor-shape-selected' : '']"
                  >
                    <span v-html="shape.svg" />
                  </v-btn>
                </v-list-item>
              </div>

              <v-divider class="floor-shape-menu__divider" />

              <AssetPickerList
                :active="true"
                assetType="prefab"
                :extensions="['wall']"
                :asset-id="wallBrushPresetAssetId"
                :thumbnailSize="30"
                :showSearch="true"
                @update:asset="handleWallPresetSelect"
              />
            </div>
          </v-list>
        </v-menu>
        <v-menu
          v-else-if="tool.id === 'water'"
          :model-value="waterShapeMenuOpen"
          location="bottom"
          :offset="6"
          :open-on-click="false"
          :close-on-content-click="false"
          @update:modelValue="handleWaterShapeMenuModelUpdate"
        >
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :icon="tool.icon"
              density="compact"
              size="small"
              class="toolbar-button"
              :color="activeBuildTool === tool.id ? 'primary' : undefined"
              :variant="activeBuildTool === tool.id ? 'flat' : 'text'"
              :title="tool.label"
              :disabled="buildToolsDisabled"
              @click="handleBuildToolToggle(tool.id)"
            />
          </template>
          <v-list density="compact" class="water-shape-menu">
            <div
              class="wall-shape-menu__card"
              @pointerdown.stop
              @pointerup.stop
              @mousedown.stop
              @mouseup.stop
            >
              <v-toolbar density="compact" class="menu-toolbar" height="36px">
                <div class="toolbar-text">
                  <div class="menu-title">Water Brush</div>
                </div>
                <v-spacer />
                <v-btn class="menu-close-btn" icon="mdi-close" size="small" variant="text" @click="emit('update:water-shape-menu-open', false)" />
              </v-toolbar>

              <div class="floor-shape-grid">
                <v-list-item
                  v-for="shape in waterShapeOptions"
                  :key="shape.id"
                  class="floor-shape-item"
                  @click="() => handleWaterShapeSelect(shape.id)"
                >
                  <v-btn
                    density="compact"
                    size="small"
                    variant="text"
                    :title="shape.label"
                    :class="['floor-shape-btn', shape.id === waterBuildShape ? 'floor-shape-selected' : '']"
                  >
                    <span v-html="shape.svg" />
                  </v-btn>
                </v-list-item>
              </div>
            </div>
          </v-list>
        </v-menu>

        <v-btn
          v-else
          :icon="tool.icon"
          density="compact"
          size="small"
          class="toolbar-button"
          :color="activeBuildTool === tool.id ? 'primary' : undefined"
          :variant="activeBuildTool === tool.id ? 'flat' : 'text'"
          :title="tool.label"
          :disabled="buildToolsDisabled"
          @click="handleBuildToolToggle(tool.id)"
          @contextmenu.prevent.stop="handleBuildToolContextMenu(tool.id, $event)"
        />
      </template>
         <v-menu
        :model-value="scatterEraseMenuOpen"
        location="bottom"
        :offset="6"
        :open-on-click="false"
        :close-on-content-click="false"
        @update:modelValue="(value) => emit('update:scatter-erase-menu-open', value)"
      >
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            :icon="scatterEraseButtonIcon"
            density="compact"
            size="small"
            class="toolbar-button"
            :color="scatterEraseModeActive ? 'primary' : undefined"
            :variant="scatterEraseModeActive ? 'flat' : 'text'"
            :disabled="!canEraseScatterEffective"
            :title="scatterEraseButtonTitle"
            @click="handleScatterEraseButtonClick"
            @contextmenu.prevent.stop="handleScatterEraseContextMenu"
          />
        </template>
        <v-list density="compact" class="scatter-erase-menu">
          <div
            class="scatter-erase-menu__card"
            @pointerdown.stop
            @pointerup.stop
            @mousedown.stop
            @mouseup.stop
          >
            <v-toolbar density="compact" class="menu-toolbar" height="36px">
              <div class="toolbar-text">
                <div class="menu-title">Scatter Erase</div>
              </div>
              <v-spacer />
              <v-btn class="menu-close-btn" icon="mdi-close" size="small" variant="text" @click="emit('update:scatter-erase-menu-open', false)" />
            </v-toolbar>

            <div class="scatter-erase-menu__slider" style="padding: 10px">
              <div class="scatter-erase-menu__slider-labels">
                <span>Erase Radius</span>
                <span>{{ scatterEraseRadiusLabel }}</span>
              </div>
              <v-text-field
                v-model="scatterEraseRadiusInput"
                type="number"
                :min="SCATTER_ERASE_RADIUS_MIN"
                :max="SCATTER_BRUSH_RADIUS_MAX"
                :step="SCATTER_RADIUS_STEP"
                variant="underlined"
                density="compact"
                hide-details
                inputmode="decimal"
                class="scatter-erase-input"
                :disabled="!canEraseScatterEffective"
                @blur="commitScatterEraseRadiusInput"
                @keydown.enter.prevent="commitScatterEraseRadiusInput"
              />
            </div>
            <v-divider class="scatter-erase-menu__divider" />
            <v-list-item class="scatter-erase-menu__action">
              <v-btn
                density="compact"
                variant="text"
                color="primary"
                class="scatter-erase-menu__clear"
                :disabled="!canClearAllScatterInstances"
                @click="handleClearScatterMenuAction"
              >
                Clear All Scatter Instances
              </v-btn>
            </v-list-item>
          </div>
        </v-list>
      </v-menu>
      <v-divider vertical />
      <v-btn
        icon="mdi-camera-outline"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Capture Screenshot"
        @click="emit('capture-screenshot')"
      />
      <v-btn
        icon="mdi-group"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Group Selection"
        :disabled="selectionCount < 1"
        @click="handleGroupSelection"
      />
      <v-btn
        icon="mdi-checkbox-marked-circle-outline"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Apply Transform to Nodes"
        :disabled="!canApplyTransformsToGroup"
        @click="handleApplyTransformsToGroup"
      />
      <v-btn
        icon="mdi-crosshairs-gps"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Recalculate Group Origin"
        :disabled="!canRecenterGroupOrigin"
        @click="handleRecenterGroupOrigin"
      />
      <v-btn
        icon="mdi-content-save-cog-outline"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Save as Prefab"
        :disabled="!canSavePrefab || isSavingPrefab"
        @click="handleSavePrefab"
      />
      <v-divider vertical />
      <v-btn
        icon="mdi-arrow-collapse-down"
        density="compact"
        size="small"
        color="undefined"
        variant="text"
        class="toolbar-button"
        title="Drop to Ground"
        :disabled="!canDropSelection"
        @click="emit('drop-to-ground')"
      />
      <v-menu
        v-model="alignMenuOpen"
        location="bottom"
        :offset="6"
        :close-on-content-click="false"
      >
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            icon="mdi-format-align-left"
            density="compact"
            size="small"
            class="toolbar-button"
            title="Align/Arrange/Distribute"
            :disabled="!canAlignSelection"
            :color="alignMenuOpen ? 'primary' : undefined"
            :variant="alignMenuOpen ? 'flat' : 'text'"
          />
        </template>
        <v-list density="compact" class="align-menu">
          <div
            class="popup-menu-card"
            @pointerdown.stop
            @pointerup.stop
            @mousedown.stop
            @mouseup.stop
          >
            <v-toolbar density="compact" class="menu-toolbar" height="36px">
              <div class="toolbar-text">
                <div class="menu-title">Align / Distribute</div>
              </div>
              <v-spacer />
              <v-btn class="menu-close-btn" icon="mdi-close" size="small" variant="text" @click="alignMenuOpen = false" />
            </v-toolbar>
            <div class="popup-menu-card__content">
              <v-list-item
                title="X Axis Alignment (World X)"
                prepend-icon="mdi-axis-arrow"
                :disabled="!canAlignSelection"
                @click="handleAlignCommand('axis-x')"
              />
              <v-list-item
                title="Y Axis Alignment (World Y)"
                prepend-icon="mdi-axis-arrow"
                :disabled="!canAlignSelection"
                @click="handleAlignCommand('axis-y')"
              />
              <v-list-item
                title="Z Axis Alignment (World Z)"
                prepend-icon="mdi-axis-arrow"
                :disabled="!canAlignSelection"
                @click="handleAlignCommand('axis-z')"
              />

              <v-divider v-if="selectionCount >= 2" class="align-menu__divider" />
              <v-list-item
                v-if="selectionCount >= 2"
                title="Fix Primary Selection as Anchor"
                :prepend-icon="fixedPrimaryAsAnchor ? 'mdi-check' : 'mdi-checkbox-blank-outline'"
                @click="toggleFixedPrimaryAsAnchor"
              />

              <template v-if="selectionCount >= 2">
                <v-divider class="align-menu__divider" />
                <v-list-item
                  title="Horizontal Arrange (Right / World X+)"
                  prepend-icon="mdi-format-horizontal-align-left"
                  :disabled="!canAlignSelection"
                  @click="handleAlignCommand({ type: 'arrange', direction: 'horizontal', options: { fixedPrimaryAsAnchor } })"
                />
                <v-list-item
                  title="Vertical Arrange (Up / World Y+)"
                  prepend-icon="mdi-format-vertical-align-top"
                  :disabled="!canAlignSelection"
                  @click="handleAlignCommand({ type: 'arrange', direction: 'vertical', options: { fixedPrimaryAsAnchor } })"
                />
                <v-divider class="align-menu__divider" />
                <v-list-item
                  title="Horizontal Distribute"
                  prepend-icon="mdi-format-horizontal-distribute"
                  :disabled="!canAlignSelection || selectionCount < 3"
                  @click="handleAlignCommand({ type: 'distribute', direction: 'horizontal', options: { fixedPrimaryAsAnchor } })"
                />
                <v-list-item
                  title="Vertical Distribute (World Y)"
                  prepend-icon="mdi-format-vertical-distribute"
                  :disabled="!canAlignSelection || selectionCount < 3"
                  @click="handleAlignCommand({ type: 'distribute', direction: 'vertical', options: { fixedPrimaryAsAnchor } })"
                />
              </template>
            </div>
          </div>
        </v-list>
      </v-menu>
   
      <v-menu v-model="rotationMenuOpen" location="bottom" :offset="8" :close-on-content-click="false">
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            icon="mdi-rotate-3d-variant"
            density="compact"
            size="small"
            class="toolbar-button"
            title="Rotate"
            :disabled="!canRotateSelection"
            :color="rotationMenuOpen ? 'primary' : undefined"
            :variant="rotationMenuOpen ? 'flat' : 'text'"
          />
        </template>
        <v-list density="compact" class="rotation-menu">
          <div
            class="popup-menu-card"
            @pointerdown.stop
            @pointerup.stop
            @mousedown.stop
            @mouseup.stop
          >
            <v-toolbar density="compact" class="menu-toolbar" height="36px">
              <div class="toolbar-text">
                <div class="menu-title">Rotate</div>
              </div>
              <v-spacer />
              <v-btn class="menu-close-btn" icon="mdi-close" size="small" variant="text" @click="rotationMenuOpen = false" />
            </v-toolbar>
            <div class="popup-menu-card__content">
              <template v-for="(section, index) in rotationSections" :key="section.id">
                <v-list-item
                  v-for="action in section.actions"
                  :key="action.id"
                  :title="action.label"
                  @click="handleRotationAction(action)"
                >
                </v-list-item>
                <v-divider v-if="index < rotationSections.length - 1" class="rotation-menu__divider" />
              </template>
            </div>
          </div>
        </v-list>
      </v-menu>
        <v-menu v-model="mirrorMenuOpen" location="bottom" :offset="8" :close-on-content-click="false">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              icon="mdi-mirror-rectangle"
              density="compact"
              size="small"
              color="undefined"
              variant="text"
              class="toolbar-button"
              title="Mirror"
              :disabled="!canMirrorSelection"
            />
          </template>
          <v-list density="compact" class="mirror-menu">
            <div
              class="popup-menu-card"
              @pointerdown.stop
              @pointerup.stop
              @mousedown.stop
              @mouseup.stop
            >
              <v-toolbar density="compact" class="menu-toolbar" height="36px">
                <div class="toolbar-text">
                  <div class="menu-title">Mirror</div>
                </div>
                <v-spacer />
                <v-btn class="menu-close-btn" icon="mdi-close" size="small" variant="text" @click="mirrorMenuOpen = false" />
              </v-toolbar>
              <div class="popup-menu-card__content">
                <v-list-item :active="activeMirrorMode === 'horizontal'" @click="handleMirrorAction('horizontal')">
                  <template #prepend>
                    <v-icon>mdi-flip-horizontal</v-icon>
                  </template>
                  <v-list-item-title>Horizontal Mirror</v-list-item-title>
                </v-list-item>
                <v-list-item :active="activeMirrorMode === 'vertical'" @click="handleMirrorAction('vertical')">
                  <template #prepend>
                    <v-icon>mdi-flip-vertical</v-icon>
                  </template>
                  <v-list-item-title>Vertical Mirror</v-list-item-title>
                </v-list-item>
              </div>
            </div>
          </v-list>
        </v-menu>
      <v-btn
        :icon="vertexSnapEnabled ? 'mdi-magnet-on' : 'mdi-magnet'"
        :color="vertexSnapEnabled ? 'primary' : undefined"
        :variant="vertexSnapEnabled ? 'flat' : 'text'"
        density="compact"
        size="small"
        class="toolbar-button"
        title="Vertex Snap (Hold Shift)"
        @click="toggleVertexSnap"
      />

      <v-divider vertical />
      <v-btn
        :icon="showGrid ? 'mdi-grid' : 'mdi-grid-off'"
        :color="showGrid ? 'primary' : undefined"
        :variant="showGrid ? 'flat' : 'text'"
        density="compact"
        size="small"
        class="toolbar-button"
        title="Toggle Grid"
        @click="toggleGridVisibility"
      />
      <v-btn
        :icon="showAxes ? 'mdi-axis-arrow-info' : 'mdi-axis-arrow'"
        :color="showAxes ? 'primary' : undefined"
        :variant="showAxes ? 'flat' : 'text'"
        density="compact"
        size="small"
        class="toolbar-button"
        title="Toggle Axes"
        @click="toggleAxesVisibility"
      />

      <v-divider vertical />
      <v-btn
        :icon="cameraControlMode === 'map' ? 'mdi-map' : 'mdi-rotate-3d-variant'"
        density="compact"
        size="small"
        class="toolbar-button"
        color="undefined"
        variant="text"
        :title="
          cameraControlMode === 'map'
            ? 'Camera Controls: Map (click to switch to Orbit)'
            : 'Camera Controls: Orbit (click to switch to Map)'
        "
        @click="toggleCameraControlMode"
      />

      <v-menu
        :model-value="cameraResetMenuOpen"
        location="bottom"
        :offset="6"
        :open-on-click="false"
        :close-on-content-click="true"
        @update:modelValue="handleCameraResetMenuModelUpdate"
      >
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            icon="mdi-camera"
            density="compact"
            size="small"
            color="undefined"
            variant="text"
            class="toolbar-button"
            title="Reset to Default View (Shift+F: focus visible; Alt+1..6: directional views)"
            @click="emit('reset-camera')"
            @contextmenu.prevent.stop="handleCameraResetContextMenu"
          />
        </template>
        <v-list density="compact" class="camera-reset-menu">
          <div
            class="popup-menu-card"
            @pointerdown.stop
            @pointerup.stop
            @mousedown.stop
            @mouseup.stop
          >
            <v-toolbar density="compact" class="menu-toolbar" height="36px">
              <div class="toolbar-text">
                <div class="menu-title">Camera View</div>
              </div>
              <v-spacer />
              <v-btn class="menu-close-btn" icon="mdi-close" size="small" variant="text" @click="emit('update:camera-reset-menu-open', false)" />
            </v-toolbar>
            <div class="popup-menu-card__content">
              <v-list-item title="正面 (+X) — Alt+1" @click="handleCameraResetDirectionSelect('pos-x')" />
              <v-list-item title="背面 (-X) — Alt+2" @click="handleCameraResetDirectionSelect('neg-x')" />
              <v-list-item title="上面 (+Y) — Alt+3" @click="handleCameraResetDirectionSelect('pos-y')" />
              <v-list-item title="下面 (-Y) — Alt+4" @click="handleCameraResetDirectionSelect('neg-y')" />
              <v-list-item title="左面 (+Z) — Alt+5" @click="handleCameraResetDirectionSelect('pos-z')" />
              <v-list-item title="右面 (-Z) — Alt+6" @click="handleCameraResetDirectionSelect('neg-z')" />
            </div>
          </div>
        </v-list>
      </v-menu>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue'
import AssetPickerList from '@/components/common/AssetPickerList.vue'
import TerrainSculptPanel from '@/components/inspector/TerrainSculptPanel.vue'
import TerrainPaintPanel from '@/components/inspector/TerrainPaintPanel.vue'
import GroundAssetPainter from '@/components/inspector/GroundAssetPainter.vue'
import type { CameraControlMode } from '@schema'
import type { GroundGenerationMode, GroundSculptOperation } from '@schema'
import type { AlignCommand } from '@/types/scene-viewport-align-command'
import type { AlignMode } from '@/types/scene-viewport-align-mode'
import { useSceneStore } from '@/stores/sceneStore'
import type { BuildTool } from '@/types/build-tool'
import type { FloorBuildShape } from '@/types/floor-build-shape'
import { FLOOR_BUILD_SHAPE_LABELS } from '@/types/floor-build-shape'
import type { WaterBuildShape } from '@/types/water-build-shape'
import { WATER_BUILD_SHAPE_LABELS } from '@/types/water-build-shape'
import type { WallBuildShape } from '@/types/wall-build-shape'
import { WALL_BUILD_SHAPE_LABELS } from '@/types/wall-build-shape'
import type { ProjectAsset } from '@/types/project-asset'
import { SCATTER_BRUSH_RADIUS_MAX, type GroundPanelTab } from '@/stores/terrainStore'
import { isWaterSurfaceNode } from '@/utils/waterBuildShapeUserData'
import type { TerrainScatterCategory } from '@schema/terrain-scatter'
import { terrainScatterPresets } from '@/resources/projectProviders/asset'

const props = withDefaults(
  defineProps<{
  showGrid: boolean
  showAxes: boolean
  vertexSnapEnabled?: boolean
  canDropSelection: boolean
  canAlignSelection: boolean
  canRotateSelection: boolean
  canMirrorSelection: boolean
  canEraseScatter: boolean
  canClearAllScatterInstances: boolean
  hasGroundNode: boolean
  activeBuildTool: BuildTool | null
  buildToolsDisabled?: boolean
  scatterEraseModeActive: boolean
  scatterEraseRepairActive?: boolean
  scatterEraseRadius: number
  scatterEraseMenuOpen: boolean
  cameraResetMenuOpen: boolean
  floorShapeMenuOpen: boolean
  wallShapeMenuOpen: boolean
  waterShapeMenuOpen: boolean
  groundTerrainMenuOpen: boolean
  groundPaintMenuOpen: boolean
  groundScatterMenuOpen: boolean
  floorBuildShape: FloorBuildShape
  wallBuildShape: WallBuildShape
  waterBuildShape: WaterBuildShape
  floorBrushPresetAssetId?: string
  wallBrushPresetAssetId?: string
  groundPanelTab: GroundPanelTab
  groundBrushRadius: number
  groundBrushStrength: number
  groundBrushShape: 'circle' | 'square' | 'star'
  groundBrushOperation: GroundSculptOperation | null
  groundNoiseStrength: number
  groundNoiseMode: GroundGenerationMode
  groundPaintSmoothness: number
  groundPaintAsset: ProjectAsset | null
  groundScatterCategory: TerrainScatterCategory
  groundScatterBrushRadius: number
  groundScatterDensityPercent: number
  groundScatterProviderAssetId?: string | null
  }>(),
  {
    buildToolsDisabled: false,
    vertexSnapEnabled: false,
    scatterEraseRepairActive: false,
  },
)

const emit = defineEmits<{
  (event: 'reset-camera'): void
  (event: 'drop-to-ground'): void
  (event: 'align-selection', command: AlignCommand | AlignMode): void
  (event: 'rotate-selection', payload: { axis: RotationAxis; degrees: number }): void
  (event: 'mirror-selection', payload: { mode: MirrorMode }): void
  (event: 'capture-screenshot'): void
  (event: 'change-build-tool', tool: BuildTool | null): void
  (event: 'open-wall-preset-picker', anchor: { x: number; y: number }): void
  (event: 'select-wall-preset', asset: any): void
  (event: 'select-floor-preset', asset: any): void
  (event: 'toggle-scatter-erase'): void
  (event: 'update-scatter-erase-radius', value: number): void
  (event: 'clear-all-scatter-instances'): void
  (event: 'reset-camera-direction', direction: CameraResetDirection): void
  (event: 'update:camera-reset-menu-open', value: boolean): void
  (event: 'update:scatter-erase-menu-open', value: boolean): void
  (event: 'update:floor-shape-menu-open', value: boolean): void
  (event: 'update:wall-shape-menu-open', value: boolean): void
  (event: 'update:water-shape-menu-open', value: boolean): void
  (event: 'update:ground-terrain-menu-open', value: boolean): void
  (event: 'update:ground-paint-menu-open', value: boolean): void
  (event: 'update:ground-scatter-menu-open', value: boolean): void
  (event: 'select-floor-build-shape', shape: FloorBuildShape): void
  (event: 'select-wall-build-shape', shape: WallBuildShape): void
  (event: 'select-water-build-shape', shape: WaterBuildShape): void
  (event: 'activate-ground-tab', tab: GroundPanelTab): void
  (event: 'update:ground-brush-radius', value: number): void
  (event: 'update:ground-brush-strength', value: number): void
  (event: 'update:ground-brush-shape', value: 'circle' | 'square' | 'star'): void
  (event: 'update:ground-brush-operation', value: GroundSculptOperation | null): void
  (event: 'update:ground-noise-strength', value: number): void
  (event: 'update:ground-noise-mode', value: GroundGenerationMode): void
  (event: 'update:ground-paint-smoothness', value: number): void
  (event: 'update:ground-paint-asset', value: ProjectAsset | null): void
  (event: 'update:ground-scatter-category', value: TerrainScatterCategory): void
  (event: 'update:ground-scatter-brush-radius', value: number): void
  (event: 'update:ground-scatter-density-percent', value: number): void
  (event: 'ground-scatter-asset-select', payload: { category: TerrainScatterCategory; asset: ProjectAsset; providerAssetId: string }): void
}>()

const {
  showGrid,
  showAxes,
  vertexSnapEnabled,
  canDropSelection,
  canAlignSelection,
  canRotateSelection,
  canMirrorSelection,
  canEraseScatter,
  canClearAllScatterInstances,
  hasGroundNode,
  scatterEraseModeActive,
  scatterEraseRepairActive,
  activeBuildTool,
  buildToolsDisabled,
  scatterEraseRadius,
  scatterEraseMenuOpen,
  cameraResetMenuOpen,
  floorShapeMenuOpen,
  wallShapeMenuOpen,
  waterShapeMenuOpen,
  groundTerrainMenuOpen,
  groundPaintMenuOpen,
  groundScatterMenuOpen,
  floorBuildShape,
  wallBuildShape,
  waterBuildShape,
  floorBrushPresetAssetId,
  wallBrushPresetAssetId,
  groundPanelTab,
  groundBrushRadius,
  groundBrushStrength,
  groundBrushShape,
  groundBrushOperation,
  groundNoiseStrength,
  groundNoiseMode,
  groundPaintSmoothness,
  groundPaintAsset,
  groundScatterCategory,
  groundScatterBrushRadius,
  groundScatterDensityPercent,
  groundScatterProviderAssetId,
} = toRefs(props)
const sceneStore = useSceneStore()

const cameraControlMode = computed(() => sceneStore.viewportSettings.cameraControlMode)

function toggleCameraControlMode() {
  const next: CameraControlMode = cameraControlMode.value === 'map' ? 'orbit' : 'map'
  sceneStore.setCameraControlMode(next)
}

const selectionCount = computed(() => (sceneStore.selectedNodeIds ? sceneStore.selectedNodeIds.length : 0))
const activeNode = computed(() => sceneStore.selectedNode)
const isSavingPrefab = ref(false)
const rotationMenuOpen = ref(false)
const mirrorMenuOpen = ref(false)
const alignMenuOpen = ref(false)
const fixedPrimaryAsAnchor = ref(true)

const SCATTER_BRUSH_RADIUS_MIN = 0.1
const SCATTER_ERASE_RADIUS_MIN = 0.1
const SCATTER_RADIUS_STEP = 0.1
const SCATTER_DENSITY_MIN = 0
const SCATTER_DENSITY_MAX = 100
const SCATTER_DENSITY_STEP = 1

const groundScatterBrushRadiusInput = ref(groundScatterBrushRadius.value.toFixed(2))
const groundScatterDensityInput = ref(Math.round(groundScatterDensityPercent.value).toString())
const scatterEraseRadiusInput = ref(scatterEraseRadius.value.toFixed(2))

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function snapToStep(value: number, step: number): number {
  const steps = Math.round(value / step)
  return steps * step
}

function parseAndNormalize(
  raw: string,
  fallback: number,
  min: number,
  max: number,
  step: number,
  precision: number,
): number {
  const parsed = Number.parseFloat(raw)
  const base = Number.isFinite(parsed) ? parsed : fallback
  const clamped = clampValue(base, min, max)
  const stepped = snapToStep(clamped, step)
  const normalized = Number(stepped.toFixed(precision))
  return clampValue(normalized, min, max)
}

function commitGroundScatterBrushRadiusInput() {
  const normalized = parseAndNormalize(
    groundScatterBrushRadiusInput.value,
    groundScatterBrushRadius.value,
    SCATTER_BRUSH_RADIUS_MIN,
    SCATTER_BRUSH_RADIUS_MAX,
    SCATTER_RADIUS_STEP,
    2,
  )
  emit('update:ground-scatter-brush-radius', normalized)
  groundScatterBrushRadiusInput.value = normalized.toFixed(2)
}

function commitGroundScatterDensityInput() {
  const normalized = parseAndNormalize(
    groundScatterDensityInput.value,
    groundScatterDensityPercent.value,
    SCATTER_DENSITY_MIN,
    SCATTER_DENSITY_MAX,
    SCATTER_DENSITY_STEP,
    0,
  )
  emit('update:ground-scatter-density-percent', normalized)
  groundScatterDensityInput.value = Math.round(normalized).toString()
}

function commitScatterEraseRadiusInput() {
  const normalized = parseAndNormalize(
    scatterEraseRadiusInput.value,
    scatterEraseRadius.value,
    SCATTER_ERASE_RADIUS_MIN,
    SCATTER_BRUSH_RADIUS_MAX,
    SCATTER_RADIUS_STEP,
    2,
  )
  emit('update-scatter-erase-radius', normalized)
  scatterEraseRadiusInput.value = normalized.toFixed(2)
}

watch(groundScatterBrushRadius, (value) => {
  groundScatterBrushRadiusInput.value = value.toFixed(2)
})

watch(groundScatterDensityPercent, (value) => {
  groundScatterDensityInput.value = Math.round(value).toString()
})

watch(scatterEraseRadius, (value) => {
  scatterEraseRadiusInput.value = value.toFixed(2)
})

const scatterEraseRadiusLabel = computed(() => `${scatterEraseRadius.value.toFixed(2)} m`)

const scatterEraseButtonIcon = computed(() => (scatterEraseRepairActive.value ? 'mdi-hammer' : 'mdi-broom'))
const scatterEraseButtonTitle = computed(() => (scatterEraseRepairActive.value ? 'Repair / Restore (Hold Shift)' : 'Scatter Erase'))

const groundTerrainButtonActive = computed(() => isGroundButtonActive('terrain'))
const groundPaintButtonActive = computed(() => isGroundButtonActive('paint'))
const groundScatterButtonActive = computed(() => isGroundButtonActive('scatter'))

const groundScatterTabs = computed(() =>
  (Object.keys(terrainScatterPresets) as TerrainScatterCategory[]).map((key) => ({
    key,
    label: terrainScatterPresets[key].label,
    icon: terrainScatterPresets[key].icon,
  })),
)

const groundBrushRadiusModel = computed({
  get: () => groundBrushRadius.value,
  set: (value: number) => emit('update:ground-brush-radius', Number(value)),
})

const groundBrushStrengthModel = computed({
  get: () => groundBrushStrength.value,
  set: (value: number) => emit('update:ground-brush-strength', Number(value)),
})

const groundBrushShapeModel = computed({
  get: () => groundBrushShape.value,
  set: (value: 'circle' | 'square' | 'star') => emit('update:ground-brush-shape', value),
})

const groundBrushOperationModel = computed({
  get: () => groundBrushOperation.value,
  set: (value: GroundSculptOperation | null) => emit('update:ground-brush-operation', value),
})

const groundNoiseStrengthModel = computed({
  get: () => groundNoiseStrength.value,
  set: (value: number) => emit('update:ground-noise-strength', Number(value)),
})

const groundNoiseModeModel = computed({
  get: () => groundNoiseMode.value,
  set: (value: GroundGenerationMode) => emit('update:ground-noise-mode', value),
})

const groundPaintSmoothnessModel = computed({
  get: () => groundPaintSmoothness.value,
  set: (value: number) => emit('update:ground-paint-smoothness', Number(value)),
})

const groundPaintAssetModel = computed<ProjectAsset | null>({
  get: () => groundPaintAsset.value,
  set: (value) => emit('update:ground-paint-asset', value),
})

const groundScatterCategoryModel = computed<TerrainScatterCategory>({
  get: () => {
    if (groundPanelTab.value !== 'terrain' && groundPanelTab.value !== 'paint') {
      return groundPanelTab.value
    }
    return groundScatterCategory.value
  },
  set: (value) => {
    emit('update:ground-scatter-category', value)
    emit('activate-ground-tab', value)
  },
})

const groundScatterBrushRadiusDisplay = computed(() => `${groundScatterBrushRadius.value.toFixed(2)} m`)
const groundScatterDensityDisplay = computed(() => `${Math.round(groundScatterDensityPercent.value)}%`)

const terrainOperations: Array<{ value: GroundSculptOperation; label: string; icon: string }> = [
  { value: 'depress', label: 'Depress', icon: 'mdi-tray-arrow-down' },
  { value: 'smooth', label: 'Smooth', icon: 'mdi-water-percent' },
  { value: 'flatten', label: 'Flatten', icon: 'mdi-ruler' },
  { value: 'flatten-zero', label: 'Flatten to Zero', icon: 'mdi-border-bottom-variant' },
  { value: 'raise', label: 'Raise', icon: 'mdi-tray-arrow-up' },
]

const noiseModeOptions: Array<{ value: GroundGenerationMode; label: string; icon: string }> = [
  { value: 'simple', label: 'Simple Noise', icon: 'mdi-wave-sine' },
  { value: 'perlin', label: 'Perlin Noise', icon: 'mdi-grain' },
  { value: 'ridge', label: 'Ridge Noise', icon: 'mdi-mountain' },
  { value: 'voronoi', label: 'Voronoi Noise', icon: 'mdi-shape-polygon-plus' },
  { value: 'flat', label: 'Flat', icon: 'mdi-border-horizontal' },
]

type RotationAxis = 'x' | 'y'

type MirrorMode = 'horizontal' | 'vertical'

type CameraResetDirection = 'pos-x' | 'neg-x' | 'pos-y' | 'neg-y' | 'pos-z' | 'neg-z'

type RotationAction = {
  id: string
  label: string
  axis: RotationAxis
  degrees: number
}

const rotationSections = [
  {
    id: 'vertical',
    label: 'Vertical Rotation',
    actions: [
      { id: 'vertical-45', label: 'Vertical Rotation 45°', axis: 'x', degrees: 45 },
      { id: 'vertical-90', label: 'Vertical Rotation 90°', axis: 'x', degrees: 90 },
      { id: 'vertical-180', label: 'Vertical Rotation 180°', axis: 'x', degrees: 180 },
    ],
  },
  {
    id: 'horizontal',
    label: 'Horizontal Rotation',
    actions: [
      { id: 'horizontal-45', label: 'Horizontal Rotation 45°', axis: 'y', degrees: 45 },
      { id: 'horizontal-90', label: 'Horizontal Rotation 90°', axis: 'y', degrees: 90 },
      { id: 'horizontal-180', label: 'Horizontal Rotation 180°', axis: 'y', degrees: 180 },
    ],
  },
] satisfies Array<{ id: string; label: string; actions: RotationAction[] }>

watch(canRotateSelection, (enabled) => {
  if (!enabled && rotationMenuOpen.value) {
    rotationMenuOpen.value = false
  }
})

watch(canMirrorSelection, (enabled) => {
  if (!enabled && mirrorMenuOpen.value) {
    mirrorMenuOpen.value = false
  }
})

watch(canEraseScatter, (enabled) => {
  if (!enabled) {
    emit('update:scatter-erase-menu-open', false)
  }
})

const canEraseScatterEffective = computed(() => {
  // Enable scatter erase either when parent allows it, or when the active node is a Wall dynamic mesh.
  try {
    const node = activeNode.value as any
    const isWall = Boolean(node && node.dynamicMesh && (node.dynamicMesh as any).type === 'Wall')
    return Boolean(canEraseScatter.value) || isWall
  } catch (_e) {
    return Boolean(canEraseScatter.value)
  }
})

const activeMirrorMode = computed<MirrorMode | null>(() => {
  const node = activeNode.value as any
  const m = node?.mirror
  return m === 'horizontal' || m === 'vertical' ? m : null
})

watch(canEraseScatterEffective, (enabled) => {
  if (!enabled) {
    emit('update:scatter-erase-menu-open', false)
  }
})

watch(buildToolsDisabled, (disabled) => {
  if (disabled && groundTerrainMenuOpen.value) {
    emit('update:ground-terrain-menu-open', false)
  }
  if (disabled && groundPaintMenuOpen.value) {
    emit('update:ground-paint-menu-open', false)
  }
  if (disabled && groundScatterMenuOpen.value) {
    emit('update:ground-scatter-menu-open', false)
  }
  if (disabled && floorShapeMenuOpen.value) {
    emit('update:floor-shape-menu-open', false)
  }
  if (disabled && wallShapeMenuOpen.value) {
    emit('update:wall-shape-menu-open', false)
  }
  if (disabled && waterShapeMenuOpen.value) {
    emit('update:water-shape-menu-open', false)
  }
})

watch(hasGroundNode, (available) => {
  if (available) {
    return
  }
  emit('update:ground-terrain-menu-open', false)
  emit('update:ground-paint-menu-open', false)
  emit('update:ground-scatter-menu-open', false)
})

// Mutual exclusivity helpers
function closeExternalMenus() {
  emit('update:ground-terrain-menu-open', false)
  emit('update:ground-paint-menu-open', false)
  emit('update:ground-scatter-menu-open', false)
  emit('update:scatter-erase-menu-open', false)
  emit('update:camera-reset-menu-open', false)
  emit('update:floor-shape-menu-open', false)
  emit('update:wall-shape-menu-open', false)
  emit('update:water-shape-menu-open', false)
}

function closeAllMenus() {
  alignMenuOpen.value = false
  rotationMenuOpen.value = false
  mirrorMenuOpen.value = false
  closeExternalMenus()
}

// Close all other menus when a locally-controlled menu opens
watch(alignMenuOpen, (open) => {
  if (open) {
    rotationMenuOpen.value = false
    mirrorMenuOpen.value = false
    closeExternalMenus()
  }
})

watch(rotationMenuOpen, (open) => {
  if (open) {
    alignMenuOpen.value = false
    mirrorMenuOpen.value = false
    closeExternalMenus()
  }
})

watch(mirrorMenuOpen, (open) => {
  if (open) {
    alignMenuOpen.value = false
    rotationMenuOpen.value = false
    closeExternalMenus()
  }
})

watch(selectionCount, (count) => {
  if (count === 0) {
    alignMenuOpen.value = false
  }
})

function handleRotationAction(action: RotationAction) {
  if (!canRotateSelection.value) {
    rotationMenuOpen.value = false
    return
  }
  emit('rotate-selection', { axis: action.axis, degrees: action.degrees })
  rotationMenuOpen.value = false
}

function handleMirrorAction(mode: MirrorMode) {
  if (!canMirrorSelection.value) {
    mirrorMenuOpen.value = false
    return
  }
  emit('mirror-selection', { mode })
  mirrorMenuOpen.value = false
}

const canSavePrefab = computed(() => {
  const node = activeNode.value
  if (!node) {
    return false
  }
  return node.canPrefab !== false
})

const canApplyTransformsToGroup = computed(() => {
  const node = activeNode.value
  if (!node || node.nodeType !== 'Group') {
    return false
  }
  return Array.isArray(node.children) && node.children.length > 0
})

const canRecenterGroupOrigin = computed(() => {
  const node = activeNode.value
  if (!node || node.nodeType !== 'Group') {
    return false
  }
  return Array.isArray(node.children) && node.children.length > 0
})

function handleGroupSelection() {
  if ((selectionCount.value ?? 0) < 1) return
  // call the store action to group selected nodes
  const result = sceneStore.groupSelection()
  if (!result) {
    // grouping failed or invalid selection
    return
  }
}

async function handleSavePrefab() {
  if (isSavingPrefab.value) {
    return
  }
  const node = activeNode.value
  const nodeId = node?.id ?? null
  if (!nodeId || node?.canPrefab === false) {
    return
  }
  isSavingPrefab.value = true
  try {
    await sceneStore.saveNodePrefab(nodeId)
  } catch (error) {
    console.warn('Failed to save prefab asset', error)
  } finally {
    isSavingPrefab.value = false
  }
}

function handleApplyTransformsToGroup() {
  const node = activeNode.value
  if (!node || node.nodeType !== 'Group') {
    return
  }
  sceneStore.applyTransformsToGroup(node.id)
}

function handleRecenterGroupOrigin() {
  const node = activeNode.value
  if (!node || node.nodeType !== 'Group') {
    return
  }
  sceneStore.recenterGroupOrigin(node.id)
}

const buildToolButtons = [
  { id: 'terrain', icon: 'mdi-image-edit-outline', label: 'Terrain Tools' },
  { id: 'paint', icon: 'mdi-brush-variant', label: 'Terrain Paint' },
  { id: 'scatter', icon: 'mdi-sprout', label: 'Terrain Scatter' },
  { id: 'wall', icon: 'mdi-wall', label: 'Wall Brush' },
  { id: 'floor', icon: 'mdi-floor-plan', label: 'Floor Brush' },
  { id: 'road', icon: 'mdi-road-variant', label: 'Road Tool (Left Mouse)' },
  { id: 'water', icon: 'mdi-waves', label: 'Water Tool (Left Mouse)' },
  { id: 'displayBoard', icon: 'mdi-billboard', label: 'Display Board Tool (Left Mouse Drag)' },
  { id: 'warpGate', icon: 'mdi-gate', label: 'Warp Gate Tool (Left Mouse)' },
] satisfies Array<{ id: BuildTool; icon: string; label: string }>

const floorShapeOptions = (Object.keys(FLOOR_BUILD_SHAPE_LABELS) as FloorBuildShape[]).map((id) => ({
  id,
  label: FLOOR_BUILD_SHAPE_LABELS[id],
  svg:
    id === 'polygon'
      ? '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon fill="currentColor" points="12,3 2,21 22,21"/></svg>'
      : id === 'rectangle'
      ? '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="16" height="12" fill="currentColor" rx="1" ry="1"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>',
}))

const wallShapeOptions = (Object.keys(WALL_BUILD_SHAPE_LABELS) as WallBuildShape[]).map((id) => ({
  id,
  label: WALL_BUILD_SHAPE_LABELS[id],
  svg:
    id === 'polygon'
      ? '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon fill="currentColor" points="12,3 2,21 22,21"/></svg>'
      : id === 'rectangle'
      ? '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="16" height="12" fill="currentColor" rx="1" ry="1"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>',
}))

const waterShapeOptions = (Object.keys(WATER_BUILD_SHAPE_LABELS) as WaterBuildShape[]).map((id) => ({
  id,
  label: WATER_BUILD_SHAPE_LABELS[id],
  svg:
    id === 'polygon'
      ? '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon fill="currentColor" points="12,3 2,21 22,21"/></svg>'
      : id === 'rectangle'
      ? '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="6" width="16" height="12" fill="currentColor" rx="1" ry="1"/></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>',
}))

function toggleFixedPrimaryAsAnchor() {
  fixedPrimaryAsAnchor.value = !fixedPrimaryAsAnchor.value
}

function handleAlignCommand(command: AlignCommand | AlignMode) {
  emit('align-selection', command)
  alignMenuOpen.value = false
}

function handleBuildToolToggle(tool: BuildTool) {
  if (buildToolsDisabled.value) {
    return
  }
  const next = activeBuildTool.value === tool ? null : tool

  const selectionIds = sceneStore.selectedNodeIds ?? []
  const primaryNode = activeNode.value as any
  const primaryId = primaryNode?.id as string | undefined
  const isSingleSelection = selectionIds.length === 1 && typeof primaryId === 'string' && selectionIds.includes(primaryId)

  const expectedDynamicMeshType = tool === 'wall' ? 'Wall' : tool === 'floor' ? 'Floor' : tool === 'road' ? 'Road' : null
  const primaryDynamicMeshType = primaryNode?.dynamicMesh?.type as string | undefined
  const toolMatchesPrimarySelection = tool === 'water'
    ? isWaterSurfaceNode(primaryNode)
    : Boolean(expectedDynamicMeshType && primaryDynamicMeshType === expectedDynamicMeshType)

  const selectionLocked = primaryId ? sceneStore.isNodeSelectionLocked(primaryId) : false
  const nodeLocked = Boolean(primaryNode?.locked)

  const shouldKeepSelectionForEdit = Boolean(next && isSingleSelection && toolMatchesPrimarySelection && !selectionLocked && !nodeLocked)

  // By default, when enabling a build tool, clear selection to avoid accidental operations.
  // Exception: if the primary selection is a single, matching, unlocked node, keep it so the user
  // immediately enters edit mode for that node.
  if (next && !shouldKeepSelectionForEdit) {
    sceneStore.setSelection([])
  }
  emit('change-build-tool', next)

  if (tool === 'wall' || tool === 'floor' || tool === 'water') {
    if (next) {
      closeAllMenus()
      setBuildToolMenuOpen(tool, true)
      return
    }
    setBuildToolMenuOpen(tool, false)
  }
}

function handleBuildToolContextMenu(tool: BuildTool, event: MouseEvent) {
  void tool
  void event
  if (buildToolsDisabled.value) {
    return
  }
  return
}

type GroundMenuKind = 'terrain' | 'paint' | 'scatter'

function isGroundButtonActive(kind: GroundMenuKind) {
  return activeBuildTool.value === kind
}

function resolveGroundTargetTab(kind: GroundMenuKind, source: 'button' | 'menu'): GroundPanelTab | null {
  if (kind === 'terrain') {
    return 'terrain'
  }
  if (kind === 'paint') {
    return 'paint'
  }
  if (source === 'menu' && groundPanelTab.value !== 'terrain' && groundPanelTab.value !== 'paint') {
    return null
  }
  return groundScatterCategoryModel.value
}

function handleGroundButtonClick(kind: GroundMenuKind) {
  if (buildToolsDisabled.value || !hasGroundNode.value) {
    return
  }

  if (isGroundButtonActive(kind)) {
    emit('change-build-tool', null)
    setGroundMenuOpen(kind, false)
    return
  }

  closeAllMenus()
  const tab = resolveGroundTargetTab(kind, 'button')
  emit('change-build-tool', kind)
  if (tab) {
    emit('activate-ground-tab', tab)
  }
  setGroundMenuOpen(kind, true)
}

function setBuildToolMenuOpen(tool: BuildTool, open: boolean) {
  if (tool === 'wall') {
    emit('update:wall-shape-menu-open', open)
    return
  }
  if (tool === 'floor') {
    emit('update:floor-shape-menu-open', open)
    return
  }
  if (tool === 'water') {
    emit('update:water-shape-menu-open', open)
  }
}

function setGroundMenuOpen(kind: GroundMenuKind, open: boolean) {
  if (kind === 'terrain') {
    emit('update:ground-terrain-menu-open', open)
    return
  }
  if (kind === 'paint') {
    emit('update:ground-paint-menu-open', open)
    return
  }
  emit('update:ground-scatter-menu-open', open)
}

function activateGroundTabForMenu(kind: GroundMenuKind) {
  const tab = resolveGroundTargetTab(kind, 'menu')
  if (tab) {
    emit('activate-ground-tab', tab)
  }
}

function handleGroundMenuModelUpdate(kind: GroundMenuKind, value: boolean) {
  const open = Boolean(value)
  if (open) {
    closeAllMenus()
    activateGroundTabForMenu(kind)
  }
  setGroundMenuOpen(kind, open)
}

function handleGroundTerrainMenuModelUpdate(value: boolean) {
  handleGroundMenuModelUpdate('terrain', value)
}

function handleGroundPaintMenuModelUpdate(value: boolean) {
  handleGroundMenuModelUpdate('paint', value)
}

function handleGroundScatterMenuModelUpdate(value: boolean) {
  handleGroundMenuModelUpdate('scatter', value)
}

function handleGroundScatterAssetSelect(payload: { asset: ProjectAsset; providerAssetId: string }) {
  const category = groundScatterCategoryModel.value
  emit('ground-scatter-asset-select', {
    category,
    asset: payload.asset,
    providerAssetId: payload.providerAssetId,
  })
}

function handleWallShapeMenuModelUpdate(value: boolean) {
  const open = Boolean(value)
  if (open) {
    closeAllMenus()
  }
  emit('update:wall-shape-menu-open', open)
}

function handleWallPresetSelect(asset: any) {
  // propagate selection to parent; parent will handle activating the wall tool
  emit('select-wall-preset', asset)
}

function handleWallShapeSelect(shape: WallBuildShape) {
  if (buildToolsDisabled.value) {
    emit('update:wall-shape-menu-open', false)
    return
  }
  emit('select-wall-build-shape', shape)
}

function handleFloorPresetSelect(asset: any) {
  // propagate selection to parent; parent will handle storing brush + activating the floor tool
  emit('select-floor-preset', asset)
}

function handleFloorShapeMenuModelUpdate(value: boolean) {
  const open = Boolean(value)
  if (open) {
    closeAllMenus()
  }
  emit('update:floor-shape-menu-open', open)
}

function handleFloorShapeSelect(shape: FloorBuildShape) {
  if (buildToolsDisabled.value) {
    emit('update:floor-shape-menu-open', false)
    return
  }
  emit('select-floor-build-shape', shape)
}

function handleWaterShapeMenuModelUpdate(value: boolean) {
  const open = Boolean(value)
  if (open) {
    closeAllMenus()
  }
  emit('update:water-shape-menu-open', open)
}

function handleWaterShapeSelect(shape: WaterBuildShape) {
  if (buildToolsDisabled.value) {
    emit('update:water-shape-menu-open', false)
    return
  }
  emit('select-water-build-shape', shape)
}

function handleScatterEraseButtonClick() {
  emit('toggle-scatter-erase')
  // Left click only toggles the tool; do not auto-open the settings menu.
  emit('update:scatter-erase-menu-open', false)
}

function handleScatterEraseContextMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (!canEraseScatterEffective.value) {
    return
  }
  closeAllMenus()
  emit('update:scatter-erase-menu-open', true)
}

function handleCameraResetContextMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  closeAllMenus()
  emit('update:camera-reset-menu-open', true)
}

function handleCameraResetMenuModelUpdate(value: boolean) {
  emit('update:camera-reset-menu-open', Boolean(value))
}

function handleCameraResetDirectionSelect(direction: CameraResetDirection) {
  emit('reset-camera-direction', direction)
  emit('update:camera-reset-menu-open', false)
}

function toggleGridVisibility() {
  sceneStore.toggleViewportGridVisible()
}

function toggleAxesVisibility() {
  sceneStore.toggleViewportAxesVisible()
}

function toggleVertexSnap() {
  sceneStore.toggleViewportVertexSnap()
}

function handleClearScatterMenuAction() {
  if (!canClearAllScatterInstances.value) {
    return
  }
  emit('clear-all-scatter-instances')
  emit('update:scatter-erase-menu-open', false)
}
</script>

<style scoped>
.viewport-toolbar {
  position: relative;
}

.toolbar-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  background-color: rgba(18, 21, 26, 0.72);
  border-radius: 12px;
  padding: 8px;
  gap: 4px;
  backdrop-filter: blur(10px);
  border: 1px solid rgba(77, 208, 225, 0.24);
}

.toolbar-button {
  border-radius: 3px;
  min-width: 22px;
  height: 22px;
}

.scatter-erase-menu {
  min-width: 220px;
  padding: 0;
}

.ground-terrain-menu,
.ground-paint-menu,
.ground-scatter-menu {
  width: 360px;
  max-width: min(360px, 90vw);
  padding: 4px;
}

.align-menu {
  min-width: 280px;
  padding: 0;
}

.camera-reset-menu {
  min-width: 170px;
  padding: 0;
}

.rotation-menu {
  min-width: 260px;
  padding: 0;
}

.mirror-menu {
  min-width: 180px;
  padding: 0;
}

.floor-shape-menu {
  width: 352px;
  max-width: min(352px, 90vw);
  padding: 6px;
}

.floor-shape-menu__divider {
  margin: 10px 0;
}

.floor-preset-menu__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 4px 6px;
}

.floor-preset-menu__title {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
}

/* Floor preset picker: match wall preset picker layout. */
.floor-preset-menu__list :deep(.asset-picker-list__body) {
  height: 360px;
}

.floor-preset-menu__list :deep(.asset-picker-list__grid) {
  grid-template-columns: repeat(4, 72px) !important;
  grid-auto-rows: 72px;
}

.floor-preset-menu__list :deep(.asset-picker-list__tile) {
  width: 72px;
  height: 72px;
  aspect-ratio: auto;
}

.wall-shape-menu {
  width: 352px;
  max-width: min(352px, 90vw);
  padding: 3px;
}

.wall-shape-menu__card {
  border-radius: 1px;
  padding: 3px;
}

/* Wall preset picker: fixed 4-column grid (72x72 tiles) and fixed scroll height. */
.wall-shape-menu__card :deep(.asset-picker-list__body) {
  height: 360px;
}

.wall-shape-menu__card :deep(.asset-picker-list__grid) {
  grid-template-columns: repeat(4, 72px) !important;
  grid-auto-rows: 72px;
}

.wall-shape-menu__card :deep(.asset-picker-list__tile) {
  width: 72px;
  height: 72px;
  aspect-ratio: auto;
}

.floor-shape-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 6px 6px 2px;
}
.floor-shape-item {
  padding: 0 !important;
  min-height: unset !important;
}

.floor-shape-item :deep(.v-list-item__content) {
  padding: 0 !important;
}

.floor-shape-item :deep(.v-list-item__spacer) {
  display: none;
}

.floor-shape-btn {
  width: 36px;
  height: 36px;
  min-width: 36px;
  padding: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.floor-shape-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
}
.floor-shape-selected {
  color: #4dd0e1;
  background: rgba(77, 208, 225, 0.12);
  border-color: rgba(77, 208, 225, 0.28);
}
.floor-shape-item span svg {
  display: block;
}

.popup-menu-card {
  position: relative;
  border-radius: 12px;
  padding: 0;
  background-color: rgba(18, 22, 28, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.popup-menu-card__content {
  padding: 4px 0;
}

.floor-shape-menu__card,
.wall-shape-menu__card {
  position: relative;
  border-radius: 12px;
  padding: 0;
  background-color: rgba(18, 22, 28, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.ground-tool-menu__card {
  position: relative;
  border-radius: 12px;
  padding: 0;
  background-color: rgba(18, 22, 28, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.ground-tool-menu__content {
  padding: 8px;
}

.ground-scatter-tabs :deep(.v-tab) {
  min-height: 26px;
  min-width: 26px;
  padding: 0;
  justify-content: center;
}

.ground-scatter-settings {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 6px;
}

.scatter-spacing-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.scatter-control-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.scatter-spacing--compact {
  flex: 1;
}

.scatter-spacing-input {
  max-width: 140px;
}

.scatter-spacing-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.menu-toolbar {
  background-color: transparent;
  color: #e9ecf1;
  min-height: 20px;
  padding: 0 8px;
  display: flex;
  align-items: center;
}

.menu-title {
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(233, 236, 241, 0.94);
}

.menu-close-btn {
  color: rgba(233, 236, 241, 0.72);
}

.scatter-erase-menu__card {
  position: relative;
  border-radius: 12px;
  padding: 0;
  background-color: rgba(18, 22, 28, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.scatter-erase-menu__slider {
  display: flex;
  flex-direction: column;
  gap: 6px;
}


.scatter-erase-menu__slider-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
}

.scatter-erase-menu__action {
  padding: 0;
}

.scatter-erase-menu__clear {
  justify-content: flex-start;
  width: 100%;
  font-size: 13px;
  border-radius: 8px;
  padding-left: 8px;
}

.scatter-erase-menu__divider {
  margin: 12px 0;
}

.align-menu__divider {
  margin: 6px 0;
}
</style>
