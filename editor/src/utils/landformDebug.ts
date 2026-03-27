export function isLandformDebugEnabled(): boolean {
return true
}

export function logLandformDebug(message: string, extra?: unknown): void {
  if (!isLandformDebugEnabled()) {
    return
  }
  if (extra !== undefined) {
    console.debug(`[LandformDebug] ${message}`, extra)
    return
  }
  console.debug(`[LandformDebug] ${message}`)
}