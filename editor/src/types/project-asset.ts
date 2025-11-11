export interface ProjectAsset {
  id: string
  name: string
  type: 'model' | 'image' | 'texture' | 'material' | 'behavior' | 'prefab' | 'file'
  description?: string
  downloadUrl: string
  previewColor: string
  thumbnail?: string | null
  tags?: string[]
  tagIds?: string[]
  gleaned: boolean
}
