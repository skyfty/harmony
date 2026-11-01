import { describe, expect, it } from 'vitest'
import { createGltfLoader } from '@schema/loader'

describe('GLTF loader Meshopt support', () => {
  it('configures the decoder before the loader can parse compressed GLBs', async () => {
    const loader = await createGltfLoader()

    expect(loader.meshoptDecoder).toMatchObject({
      decodeGltfBuffer: expect.any(Function),
      decodeGltfBufferAsync: expect.any(Function),
      ready: expect.any(Promise),
      supported: expect.any(Boolean),
    })
  })
})
