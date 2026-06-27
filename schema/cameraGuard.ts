let programmaticCameraMutationDepth = 0

export function runWithProgrammaticCameraMutation<T>(callback: () => T, onComplete?: () => void): T {
  programmaticCameraMutationDepth += 1
  try {
    return callback()
  } finally {
    programmaticCameraMutationDepth = Math.max(0, programmaticCameraMutationDepth - 1)
    if (programmaticCameraMutationDepth === 0) {
      try {
        onComplete?.()
      } catch {
        // swallow errors from onComplete
      }
    }
  }
}

export function isProgrammaticCameraMutationActive(): boolean {
  return programmaticCameraMutationDepth > 0
}
