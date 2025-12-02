import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useTerrainStore = defineStore('terrain', () => {
  const brushRadius = ref(15)
  const brushStrength = ref(1.5)
  const brushShape = ref<'circle' | 'square' | 'star'>('circle')
  const isDigging = ref(false)
  
  return {
    brushRadius,
    brushStrength,
    brushShape,
    isDigging
  }
})
