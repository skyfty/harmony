<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  initialName?: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', name: string): void
}>()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const sceneName = ref('New Scene')

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      sceneName.value = props.initialName?.trim().length
        ? props.initialName.trim()
        : 'New Scene'
      await nextTick()
      const input = document.getElementById('new-scene-name') as HTMLInputElement | null
      input?.focus()
      input?.select()
    } else {
      sceneName.value = 'New Scene'
    }
  },
  { immediate: true },
)

function confirm() {
  const trimmed = sceneName.value.trim()
  const name = trimmed.length ? trimmed : 'New Scene'
  emit('confirm', name)
  emit('update:modelValue', false)
}

function cancel() {
  emit('update:modelValue', false)
}

</script>

<template>
  <v-dialog v-model="dialogOpen" max-width="420">
    <v-card>
      <v-card-title>New Scene</v-card-title>
      <v-card-text>
        <v-text-field
          id="new-scene-name"
          v-model="sceneName"
          label="Scene Name"
          variant="outlined"
          density="comfortable"
          autofocus
          @keydown.enter.prevent="confirm"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="cancel">Cancel</v-btn>
        <v-btn color="primary" variant="flat" @click="confirm">Create</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
