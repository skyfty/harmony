export interface StoredSceneDocumentPayload {
  id: string
  name: string
  thumbnail?: string | null
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}
