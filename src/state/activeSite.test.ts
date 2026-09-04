// Pins the ActiveSite part-selection contract from docs/06-contracts.md:
// part selection exists only within an active site, selecting a site
// clears it, and deselecting a part falls back to the site selection.

import { beforeEach, describe, expect, it } from 'vitest'
import { activeSite } from './activeSite.svelte'

beforeEach(() => {
  activeSite.set(null)
})

describe('activeSite part selection', () => {
  it('setPart() selects a part within the active site', () => {
    activeSite.set('s1')
    activeSite.setPart('p1')
    expect(activeSite.get()).toBe('s1')
    expect(activeSite.getPart()).toBe('p1')
  })

  it('setPart() is ignored when no site is active', () => {
    activeSite.setPart('p1')
    expect(activeSite.getPart()).toBeNull()
  })

  it('setPart(null) deselects the part but keeps the site active', () => {
    activeSite.set('s1')
    activeSite.setPart('p1')
    activeSite.setPart(null)
    expect(activeSite.get()).toBe('s1')
    expect(activeSite.getPart()).toBeNull()
  })

  it('set() clears any part selection, including re-set of the same site', () => {
    activeSite.set('s1')
    activeSite.setPart('p1')
    activeSite.set('s2')
    expect(activeSite.getPart()).toBeNull()

    activeSite.setPart('p2')
    activeSite.set(null)
    expect(activeSite.getPart()).toBeNull()
  })
})
