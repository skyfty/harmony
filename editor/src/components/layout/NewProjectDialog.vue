<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ modelValue: boolean; initialName?: string }>()
const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', payload: { name: string }): void
}>()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const name = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      name.value = props.initialName?.trim() || 'New Project'
    }
  },
  { immediate: true },
)

function handleCancel() {
  dialogOpen.value = false
}

function handleConfirm() {
  const trimmed = name.value.trim()
  emit('confirm', { name: trimmed.length ? trimmed : 'New Project' })
  dialogOpen.value = false
}
</script>

<template>
  <v-dialog v-model="dialogOpen" max-width="520">
    <v-card>
      <v-card-title class="text-h6">New Project</v-card-title>
      <v-card-text>
        <v-text-field v-model="name" label="Project Name" variant="outlined" density="comfortable" clearable />
        <div class="text-caption mt-2" style="opacity: 0.7">
          An empty project will be created with a default scene generated automatically when opened.
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="handleCancel">Cancel</v-btn>
        <v-btn color="primary" variant="flat" @click="handleConfirm">Create and Open</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
