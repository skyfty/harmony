import type { EditorTool } from '@/types/editor-tool'

export type TransformToolDefinition = {
  label: string
  icon: string
  value: EditorTool
  key: string
}

export const TRANSFORM_TOOLS: TransformToolDefinition[] = [
  { label: 'Select', icon: 'mdi-hand-back-right', value: 'select', key: 'KeyQ' },
  { label: 'Move', icon: 'mdi-axis-arrow', value: 'translate', key: 'KeyW' },
  { label: 'Rotate', icon: 'mdi-rotate-3d-variant', value: 'rotate', key: 'KeyE' },
  { label: 'Scale', icon: 'mdi-cube-scan', value: 'scale', key: 'KeyR' },
]
