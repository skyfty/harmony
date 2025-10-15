export interface ProjectAsset {
  id: string
  name: string
  type: 'model' | 'texture' | 'image' | 'audio' | 'file'
  description?: string
  downloadUrl: string
  previewColor: string
  thumbnail?: string | null
}
