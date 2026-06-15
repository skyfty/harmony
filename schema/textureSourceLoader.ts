import * as THREE from 'three'
import { createKtx2Loader, createKtx2SupportRenderer, disposeKtx2SupportRenderer, FAST_KTX2_TRANSCODER_PATH } from './ktx2Loader'

function isKtx2Url(url: string): boolean {
  return /\.ktx2(?:\?.*)?$/i.test(url)
}

export async function loadTextureFromSourceUrl(url: string, options: { manager?: THREE.LoadingManager } = {}): Promise<THREE.Texture> {
  const normalized = url.trim()
  if (!normalized) {
    throw new Error('Texture source url is empty')
  }

  if (isKtx2Url(normalized)) {
    const renderer = createKtx2SupportRenderer()
    try {
      const loader = await createKtx2Loader(renderer, { manager: options.manager, transcoderPath: FAST_KTX2_TRANSCODER_PATH })
      return await loader.loadAsync(normalized)
    } finally {
      disposeKtx2SupportRenderer(renderer)
    }
  }

  const loader = new THREE.TextureLoader(options.manager)
  return await loader.loadAsync(normalized)
}
