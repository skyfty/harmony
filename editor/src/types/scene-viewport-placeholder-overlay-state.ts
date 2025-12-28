export interface PlaceholderOverlayState {
  id: string
  name: string
  thumbnail: string | null
  progress: number
  error: string | null
  visible: boolean
  x: number
  y: number
}
