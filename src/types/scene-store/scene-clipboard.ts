import type { Object3D } from 'three'
import type { ClipboardEntry } from './clipboard-entry'

export interface SceneClipboard {
  entries: ClipboardEntry[]
  runtimeSnapshots: Map<string, Object3D>
  cut: boolean
}
