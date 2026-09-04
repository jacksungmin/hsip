// Pins the registration half of the docs/06 SessionStore contract:
// stores opt in via register(key, getSnapshot, applySnapshot); the
// registry composes captureAll() into a SessionSnapshot and routes
// applyAll() slices back to the registered stores. Persistence
// (IndexedDB load/save/clear) layers on top of this later.

import { describe, expect, it, vi } from 'vitest'
import { applyAll, captureAll, register } from './sessionRegistry'

// Minimal stand-in for a persisted store: holds a plain value.
function makeStub(initial: unknown) {
  return {
    value: initial,
    getSnapshot() {
      return this.value
    },
    applySnapshot(v: unknown) {
      this.value = v
    },
  }
}

describe('sessionRegistry', () => {
  it('captureAll() composes registered stores into a versioned snapshot', () => {
    const a = makeStub({ n: 1 })
    const b = makeStub(['x'])
    register('stubA', () => a.getSnapshot(), (v) => a.applySnapshot(v))
    register('stubB', () => b.getSnapshot(), (v) => b.applySnapshot(v))

    const snap = captureAll()
    expect(snap.version).toBe(1)
    expect(snap.stores.stubA).toEqual({ n: 1 })
    expect(snap.stores.stubB).toEqual(['x'])
  })

  it('applyAll() routes each slice to the matching store', () => {
    const a = makeStub(null)
    const b = makeStub(null)
    register('stubA', () => a.getSnapshot(), (v) => a.applySnapshot(v))
    register('stubB', () => b.getSnapshot(), (v) => b.applySnapshot(v))

    applyAll({ version: 1, stores: { stubA: { n: 42 }, stubB: ['y'] } })
    expect(a.value).toEqual({ n: 42 })
    expect(b.value).toEqual(['y'])
  })

  it('applyAll() skips unknown keys without throwing and still applies known ones', () => {
    const a = makeStub(null)
    register('stubA', () => a.getSnapshot(), (v) => a.applySnapshot(v))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() =>
      applyAll({ version: 1, stores: { ghost: { gone: true }, stubA: { n: 7 } } }),
    ).not.toThrow()
    expect(a.value).toEqual({ n: 7 })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('applyAll() resets registered stores absent from the snapshot to their initial state (replace-all)', () => {
    // A fixture captured before a store registered must not leave that
    // store carrying the previous session's state.
    const a = makeStub('init')
    register('stubA', () => a.getSnapshot(), (v) => a.applySnapshot(v))
    a.applySnapshot('dirty from previous session')

    applyAll({ version: 1, stores: {} })
    expect(a.value).toBe('init')
  })

  it('applyAll() hands the store a copy, not the caller-owned object', () => {
    // Fixture JSON modules are cached by the bundler: a second load of
    // the same fixture must apply pristine data even if the store
    // mutated what it received the first time.
    const a = makeStub(null)
    register('stubA', () => a.getSnapshot(), (v) => a.applySnapshot(v))

    const source = { version: 1, stores: { stubA: { list: [1, 2] } } }
    applyAll(source)
    ;(a.value as { list: number[] }).list.push(3)
    expect((source.stores.stubA as { list: number[] }).list).toEqual([1, 2])
  })

  it('re-registering a key replaces the entry (HMR re-run of a store module)', () => {
    const first = makeStub('old')
    const second = makeStub('new')
    register('stubA', () => first.getSnapshot(), (v) => first.applySnapshot(v))
    register('stubA', () => second.getSnapshot(), (v) => second.applySnapshot(v))

    expect(captureAll().stores.stubA).toBe('new')
  })
})
