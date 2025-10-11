<script setup lang="ts">
const quickActions = [
  { icon: 'mdi-content-save-outline', label: 'Save' },
  { icon: 'mdi-export-variant', label: 'Export' },
  { icon: 'mdi-play-circle-outline', label: 'Preview' },
]
const emit = defineEmits<{
  (event: 'menu-action', action: string): void
}>()
function handleMenuAction(action: string) {
  emit('menu-action', action)
}
</script>

<template>
  <section class="menu-bar">
      <div class="menu-left">
        <div class="brand">Harmony</div>
        <div class="menu-items">
          <div class="menu-item">
            <v-btn
              class="menu-button"
              variant="text"
              color="rgba(255, 255, 255, 0.72)"
              density="comfortable"
              rounded="xl"
            >
              <v-icon size="18" class="ml-1">mdi-menu-down</v-icon>

                <v-menu>
                <template #activator="{ props }">
                  <span v-bind="props">File</span>
                </template>
                <v-list class="menu-dropdown">
                  <v-list-item @click="handleMenuAction('Open')" class="menu-list-item">
                  Open
                  </v-list-item>
                  <v-list-item @click="handleMenuAction('Save')" class="menu-list-item">
                  Save
                  </v-list-item>
                  <v-divider />
                  <v-menu
                    location="end"
                    offset="8"
                    open-on-hover
                    transition="slide-x-transition"
                  >
                    <template #activator="{ props }">
                      <v-list-item
                        class="menu-list-item has-children"
                        v-bind="props"
                      >
                        Export
                        <template #append>
                          <v-icon size="16">mdi-chevron-right</v-icon>
                        </template>
                      </v-list-item>
                    </template>
                    <v-list class="menu-dropdown menu-submenu">
                      <v-list-item
                        class="menu-list-item"
                        @click="handleMenuAction('Export:PLY')"
                      >
                        PLY
                      </v-list-item>
                      <v-list-item
                        class="menu-list-item"
                        @click="handleMenuAction('Export:OBJ')"
                      >
                        OBJ
                      </v-list-item>
                      <v-list-item
                        class="menu-list-item"
                        @click="handleMenuAction('Export:STL')"
                      >
                        STL
                      </v-list-item>
                    </v-list>
                  </v-menu>
                </v-list>
                </v-menu>

            </v-btn>
            <v-btn
              class="menu-button"
              variant="text"
              color="rgba(255, 255, 255, 0.72)"
              density="comfortable"
              rounded="xl"
              @click="handleMenuAction('Edit')"
            >
              Edit
            </v-btn>
            <v-btn
              class="menu-button"
              variant="text"
              color="rgba(255, 255, 255, 0.72)"
              density="comfortable"
              rounded="xl"
              @click="handleMenuAction('View')"
            >
              View
            </v-btn>
            <v-btn
              class="menu-button"
              variant="text"
              color="rgba(255, 255, 255, 0.72)"
              density="comfortable"
              rounded="xl"
              @click="handleMenuAction('Create')"
            >
              Create
            </v-btn>
            <v-btn
              class="menu-button"
              variant="text"
              color="rgba(255, 255, 255, 0.72)"
              density="comfortable"
              rounded="xl"
              @click="handleMenuAction('Help')"
            >
              Help
            </v-btn>
          </div>



        
        </div>
      </div>
      <div class="menu-right">
        <v-btn
          v-for="action in quickActions"
          :key="action.icon"
          class="action-button"
          variant="tonal"
          color="primary"
          density="comfortable"
          size="small"
          rounded
        >
          <v-icon start>{{ action.icon }}</v-icon>
          {{ action.label }}
        </v-btn>
      </div>
    </section>

</template>

<style scoped>

.menu-bar {
  grid-area: menu;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: rgba(16, 19, 24, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(12px);
}

.menu-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.brand {
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #f4f6fb;
}

.menu-items {
  display: flex;
  gap: 4px;
}

.menu-item {
  position: relative;
}

.menu-button {
  color: rgba(244, 247, 255, 0.76);
  font-weight: 500;
  text-transform: none;
}

.menu-dropdown {
  background: rgba(18, 21, 26, 0.95);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
  padding: 6px;
}

.menu-submenu {
  padding: 6px;
}

.menu-list-item {
  color: rgba(244, 247, 255, 0.9);
  font-size: 0.9rem;
  padding: 12px 18px;
  border-radius: 8px;
  transition: background-color 0.18s ease;
  min-width: 160px;
  
}

.menu-list-item:not(:last-child) {
  margin-bottom: 6px;
}

.menu-list-item:hover {
  background-color: rgba(74, 106, 187, 0.18);
}

.menu-dropdown :deep(.v-divider) {
  margin: 4px 0;
  opacity: 0.32;
}

.menu-list-item.has-children :deep(.v-list-item__append) {
  margin-inline-start: auto;
}

.menu-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-button {
  font-weight: 500;
  text-transform: none;
}

</style>