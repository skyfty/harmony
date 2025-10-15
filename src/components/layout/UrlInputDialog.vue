<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  initialUrl?: string
  title?: string
  confirmText?: string
  cancelText?: string
  label?: string
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'confirm', value: string): void
  (event: 'cancel', value: null): void
}>()

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const urlValue = ref(props.initialUrl ?? '')
const errorMessage = ref('')

function resetState() {
  urlValue.value = props.initialUrl ?? ''
  errorMessage.value = ''
}

watch(
  () => props.initialUrl,
  (value) => {
    if (!dialogOpen.value) {
      urlValue.value = value ?? ''
    }
  },
)

watch(dialogOpen, (open) => {
  if (open) {
    resetState()
    nextTick(() => {
      const input = document.getElementById('url-input-field') as HTMLInputElement | null
      input?.focus()
      input?.select()
    })
  } else {
    resetState()
  }
})

function validateUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    errorMessage.value = '请输入 URL'
    return false
  }
  try {
    const parsed = new URL(trimmed)
    if (!parsed.protocol || !parsed.host) {
      throw new TypeError('Invalid URL structure')
    }
    errorMessage.value = ''
    return true
  } catch (error) {
    console.warn('Invalid URL input', error)
    errorMessage.value = '请输入有效的 URL'
    return false
  }
}

function handleConfirm() {
  if (!validateUrl(urlValue.value)) return
  const trimmed = urlValue.value.trim()
  emit('confirm', trimmed)
  dialogOpen.value = false
}

function handleCancel() {
  emit('cancel', null)
  dialogOpen.value = false
}

</script>

<template>
  <v-dialog v-model="dialogOpen" max-width="480">
    <v-card>
      <v-card-title>{{ title ?? '输入 URL' }}</v-card-title>
      <v-card-text>
        <v-text-field
          id="url-input-field"
          v-model="urlValue"
          :label="label ?? 'URL 地址'"
          type="url"
          variant="outlined"
          density="comfortable"
          :error="!!errorMessage"
          :error-messages="errorMessage ? [errorMessage] : []"
          @keydown.enter.prevent="handleConfirm"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="handleCancel">{{ cancelText ?? '取消' }}</v-btn>
        <v-btn color="primary" variant="flat" @click="handleConfirm">{{ confirmText ?? '确认' }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
#url-input-field {
  min-width: 100%;
}
</style>
