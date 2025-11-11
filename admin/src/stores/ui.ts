import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const drawerOpen = ref(true)

  function toggleDrawer(): void {
    drawerOpen.value = !drawerOpen.value
  }

  return {
    drawerOpen,
    toggleDrawer,
  }
})
