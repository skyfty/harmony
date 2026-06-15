import * as THREE from 'three'
import { createKtx2Loader, createKtx2SupportRenderer, disposeKtx2SupportRenderer, FAST_KTX2_TRANSCODER_PATH } from '@schema/ktx2Loader'

function isKtx2File(file: File): boolean {
  const name = file.name.toLowerCase()
  return name.endsWith('.ktx2') || file.type.toLowerCase().includes('ktx2')
}

async function loadTextureWithTextureLoader(blobUrl: string): Promise<THREE.Texture> {
  const loader = new THREE.TextureLoader()
  return await loader.loadAsync(blobUrl)
}

async function loadTextureWithKtx2Loader(blobUrl: string): Promise<THREE.Texture> {
  const renderer = createKtx2SupportRenderer()
  try {
    const loader = await createKtx2Loader(renderer, { transcoderPath: FAST_KTX2_TRANSCODER_PATH })
    return await loader.loadAsync(blobUrl)
  } finally {
    disposeKtx2SupportRenderer(renderer)
  }
}

export async function loadTextureFromFile(file: File): Promise<THREE.Texture> {
  const blobUrl = URL.createObjectURL(file)
  try {
    if (isKtx2File(file)) {
      return await loadTextureWithKtx2Loader(blobUrl)
    }
    return await loadTextureWithTextureLoader(blobUrl)
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}
