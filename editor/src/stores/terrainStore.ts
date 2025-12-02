import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { GroundSculptOperation } from '@harmony/schema'

export const useTerrainStore = defineStore('terrain', () => {
  const brushRadius = ref(15)
  const brushStrength = ref(1.5)
  const brushShape = ref<'circle' | 'square' | 'star'>('circle')
  const brushOperation = ref<GroundSculptOperation>('raise')
  const isDigging = computed(() => brushOperation.value === 'depress')
  
  return {
    brushRadius,
    brushStrength,
    brushShape,
    brushOperation,
    isDigging
  }
})
