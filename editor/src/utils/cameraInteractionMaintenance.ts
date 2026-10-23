export function shouldRunCameraInteractionMaintenance(options: {
  active: boolean
  ended: boolean
  nowMs: number
  lastRunAtMs: number
  intervalMs: number
}): boolean {
  if (!options.active || options.ended) {
    return true
  }
  return options.nowMs - options.lastRunAtMs >= Math.max(0, options.intervalMs)
}
