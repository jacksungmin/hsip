// Pins the OverlayState contract (docs/06): overlay visibility and per-class
// filtering are seeded from config/overlays.yaml, and every configured layer
// has an entry so callers holding a config def never handle a missing one.
//
// The load-bearing assertion is that `classes` is seeded from legendRows()
// rather than invented keys. The whole overlay design rests on paint, legend,
// and filter deriving from one declaration; if this store minted its own keys
// they would stop matching the values compileFilter emits, and a checkbox
// would silently filter nothing.
//
// The store is a module-scope singleton seeded once at import, so the tests
// that mutate it put back what they changed rather than resetting everything.

import { describe, it, expect } from 'vitest'
import { overlayState } from './overlayState.svelte'
import { legendRows } from '../services/overlayStyle'
import * as overlayConfig from '../data/overlayConfig'

const layers = overlayConfig.all()
const categorical = layers.find((def) => def.style.type === 'categorical')!

describe('overlayState', () => {
  it('seeds an entry for every configured layer', () => {
    expect(layers.length).toBeGreaterThan(0)
    for (const def of layers) {
      expect(overlayState.entry(def.id)).toBeDefined()
    }
  })

  it('seeds visibility from each layer`s configured default', () => {
    for (const def of layers) {
      expect(overlayState.entry(def.id).on).toBe(def.visible)
    }
  })

  it('seeds every class on, keyed by the legend rows', () => {
    for (const def of layers) {
      expect(overlayState.entry(def.id).classes).toEqual(
        legendRows(def).map((row) => row.key),
      )
    }
  })

  it('setVisible flips the layer switch', () => {
    overlayState.setVisible(categorical.id, true)
    expect(overlayState.entry(categorical.id).on).toBe(true)

    overlayState.setVisible(categorical.id, false)
    expect(overlayState.entry(categorical.id).on).toBe(false)

    overlayState.setVisible(categorical.id, categorical.visible)
  })

  it('toggleClass removes then restores one class, leaving the others alone', () => {
    const [first, second] = legendRows(categorical).map((row) => row.key)

    overlayState.toggleClass(categorical.id, first)
    expect(overlayState.entry(categorical.id).classes).not.toContain(first)
    expect(overlayState.entry(categorical.id).classes).toContain(second)

    overlayState.toggleClass(categorical.id, first)
    expect(overlayState.entry(categorical.id).classes).toContain(first)
  })
})
