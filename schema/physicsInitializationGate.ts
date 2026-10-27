/**
 * Tracks independent asynchronous initialization leases. Dynamic physics may
 * run only while no lease is active. Every lease has its own id, so finishing
 * a stale scene-load request cannot open the gate for a newer request.
 */
export type PhysicsInitializationGate = {
  begin(): number
  finish(leaseId: number): boolean
  hasPending(): boolean
  clear(): void
}

export function createPhysicsInitializationGate(): PhysicsInitializationGate {
  const activeLeases = new Set<number>()
  let nextLeaseId = 0

  return {
    begin(): number {
      nextLeaseId += 1
      activeLeases.add(nextLeaseId)
      return nextLeaseId
    },
    finish(leaseId: number): boolean {
      return activeLeases.delete(leaseId)
    },
    hasPending(): boolean {
      return activeLeases.size > 0
    },
    clear(): void {
      activeLeases.clear()
    },
  }
}
