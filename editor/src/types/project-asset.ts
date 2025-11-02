export interface ProjectAsset {
  id: string
  name: string
  type: 'model' | 'image' | 'texture' | 'material' | 'behavior' | 'file'
  description?: string
  downloadUrl: string
  previewColor: string
  thumbnail?: string | null
  gleaned: boolean
}
