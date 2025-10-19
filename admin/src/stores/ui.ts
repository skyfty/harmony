import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const drawerOpen = ref(true)
  const resourceDialogOpen = ref(false)

  function toggleDrawer(): void {
    drawerOpen.value = !drawerOpen.value
  }

  function openResourceDialog(): void {
    resourceDialogOpen.value = true
  }

  function closeResourceDialog(): void {
    resourceDialogOpen.value = false
  }

  return {
    drawerOpen,
    resourceDialogOpen,
    toggleDrawer,
    openResourceDialog,
    closeResourceDialog,
  }
})
