import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  collectDescriptorBuffers,
  serializeParsedGltfScene,
} from '@harmony/schema/gltfParseSerialize'

const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

type ParseRequest = { type: 'parse'; requestId: number; buffer: ArrayBuffer }

scope.addEventListener('message', (event) => {
  const message = event.data as ParseRequest | undefined
  if (!message || typeof message !== 'object' || message.type !== 'parse') {
    return
  }

  const requestId = message.requestId
  void (async () => {
    try {
      const loader = new GLTFLoader()
      const gltf = await loader.parseAsync(message.buffer, '')
      if (!gltf.scene) {
        scope.postMessage({ type: 'error', requestId, message: 'GLB parse produced no scene' })
        return
      }
      gltf.scene.updateMatrixWorld(true)
      // Animation clips must travel with the descriptor: the main thread rebuild
      // has no access to gltf.animations, and a rebuilt model without clips
      // silently loses every animation (character control clips included).
      const descriptor = await serializeParsedGltfScene(gltf.scene, gltf.animations ?? [])
      if (!descriptor) {
        scope.postMessage({ type: 'unsupported', requestId, reason: 'unsupported-model-features' })
        return
      }
      scope.postMessage(
        { type: 'result', requestId, descriptor },
        collectDescriptorBuffers(descriptor),
      )
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      scope.postMessage({ type: 'error', requestId, message: messageText })
    }
  })()
})
