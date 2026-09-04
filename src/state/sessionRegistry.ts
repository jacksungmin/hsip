// Registration half of the docs/06 SessionStore contract. Each persisted
// store opts in at module scope via register(key, getSnapshot,
// applySnapshot), so this registry never knows stores by name.
// captureAll/applyAll compose and route composite SessionSnapshots;
// consumers today are the dev debug menu (fixture capture/load), and the
// future SessionStore persistence layer (IndexedDB load/save/clear,
// debounce) builds on the same registrations.

import type { SessionSnapshot } from '../types'

const SNAPSHOT_VERSION = 1

type RegistryEntry = {
  getSnapshot: () => unknown
  applySnapshot: (v: unknown) => void
  // The store's pristine state, captured at registration (module init,
  // before any user interaction). applyAll resets to this when a
  // snapshot has no slice for the store, making a load replace-all
  // rather than a merge with whatever the session held before.
  initial: unknown
}

const entries = new Map<string, RegistryEntry>()

// Last registration wins so a Vite HMR re-run of a store module
// replaces its entry instead of throwing.
export function register(
  key: string,
  getSnapshot: () => unknown,
  applySnapshot: (v: unknown) => void,
): void {
  entries.set(key, { getSnapshot, applySnapshot, initial: getSnapshot() })
}

export function captureAll(): SessionSnapshot {
  const stores: Record<string, unknown> = {}
  for (const [key, entry] of entries) stores[key] = entry.getSnapshot()
  return { version: SNAPSHOT_VERSION, stores }
}

// Replace-all semantics: every registered store ends up in the state the
// snapshot describes — its slice when present, its initial state when
// absent (a fixture captured before a store registered must not leave
// that store carrying the previous session). Unknown keys warn and skip.
export function applyAll(snapshot: SessionSnapshot): void {
  for (const key of Object.keys(snapshot.stores)) {
    if (!entries.has(key)) {
      console.warn(`sessionRegistry: no store registered for key "${key}", skipping`)
    }
  }
  for (const [key, entry] of entries) {
    const slice = key in snapshot.stores ? snapshot.stores[key] : entry.initial
    // Clone so stores never alias the caller's object: fixture JSON
    // modules are cached by the bundler, and a second load of the same
    // fixture must apply pristine data.
    entry.applySnapshot(structuredClone(slice))
  }
}
