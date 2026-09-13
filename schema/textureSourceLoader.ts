import * as THREE from 'three'
import { FAST_KTX2_TRANSCODER_PATH, loadSharedKtx2Texture } from './ktx2Loader'

function isKtx2Url(url: string): boolean {
  return /\.ktx2(?:\?.*)?$/i.test(url)
}

export async function loadTextureFromSourceUrl(url: string, options: { manager?: THREE.LoadingManager } = {}): Promise<THREE.Texture> {
  const normalized = url.trim()
  if (!normalized) {
    throw new Error('Texture source url is empty')
  }

  if (isKtx2Url(normalized)) {
    // Shared loader: one transcoder download + worker pool per session instead of
    // one per texture, and no throwaway WebGL context per texture.
    return await loadSharedKtx2Texture(normalized, {
      manager: options.manager,
      transcoderPath: FAST_KTX2_TRANSCODER_PATH,
    })
  }

  const loader = new THREE.TextureLoader(options.manager)
  return await loader.loadAsync(normalized)
}
