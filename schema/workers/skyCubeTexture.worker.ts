import { extractSkycubeZipFaces } from '../skyCubeTexture'

type ExtractRequest = {
  type: 'extract'
  requestId: number
  zip: ArrayBuffer
}

type ExtractResponse =
  | {
      type: 'result'
      requestId: number
      result: {
        facesInOrder: Array<{
          key: 'positiveX' | 'negativeX' | 'positiveY' | 'negativeY' | 'positiveZ' | 'negativeZ'
          filename: string
          bytes: ArrayBuffer
          mimeType: string | null
        } | null>
        missingFaces: Array<'positiveX' | 'negativeX' | 'positiveY' | 'negativeY' | 'positiveZ' | 'negativeZ'>
        discarded: Array<{ key: 'positiveX' | 'negativeX' | 'positiveY' | 'negativeY' | 'positiveZ' | 'negativeZ'; filename: string }>
      }
    }
  | {
      type: 'error'
      requestId: number
      message: string
    }

function post(message: ExtractResponse, transfer?: Transferable[]) {
  ;(self as unknown as Worker).postMessage(message, transfer ?? [])
}

;(self as unknown as Worker).addEventListener('message', (event: MessageEvent<ExtractRequest>) => {
  const message = event.data
  if (!message || typeof message !== 'object' || message.type !== 'extract') {
    return
  }

  try {
    const extracted = extractSkycubeZipFaces(message.zip)
    const transfer: Transferable[] = []
    const facesInOrder = extracted.facesInOrder.map((face) => {
      if (!face) {
        return null
      }
      const bytes = face.bytes.slice().buffer
      transfer.push(bytes)
      return {
        key: face.key,
        filename: face.filename,
        bytes,
        mimeType: face.mimeType,
      }
    })
    post(
      {
        type: 'result',
        requestId: message.requestId,
        result: {
          facesInOrder,
          missingFaces: [...extracted.missingFaces],
          discarded: extracted.discarded.map((item) => ({ key: item.key, filename: item.filename })),
        },
      },
      transfer,
    )
  } catch (error) {
    post({
      type: 'error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
