// Verifies RegionState current/reference mutation invariants from docs/06-contracts.md.

import { beforeEach, describe, expect, it } from 'vitest'
import type { Polygon } from 'geojson'
import { regionState } from './regionState.svelte'
import type { Region } from '../types'

const sampleRegion: Region = {
  id: 'jurisdiction:county:test-county',
  name: 'Test County',
  source: 'jurisdiction',
  jurisdictionType: 'county',
  jurisdictionId: 'test-county',
  geometry: {
    type: 'Polygon',
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  } as Polygon,
}

const peerRegion: Region = {
  ...sampleRegion,
  id: 'jurisdiction:county:peer-county',
  name: 'Peer County',
  jurisdictionId: 'peer-county',
}

beforeEach(() => {
  regionState.setCurrent(null)
  for (const reference of regionState.get().references) {
    regionState.removeReference(reference.id)
  }
})

describe('regionState', () => {
  it('get() returns the current value', () => {
    const v = regionState.get()
    expect(v.current).toBeNull()
    expect(v.references).toEqual([])
  })

  it('setCurrent(null) round-trips back to null', () => {
    regionState.setCurrent(sampleRegion)
    regionState.setCurrent(null)
    expect(regionState.get().current).toBeNull()
  })

  it('setCurrent(region) updates get()', () => {
    regionState.setCurrent(sampleRegion)
    expect(regionState.get().current).toBe(sampleRegion)
  })

  it('adds and removes a reference by its opaque id', () => {
    regionState.addReference(peerRegion)
    expect(regionState.get().references).toEqual([peerRegion])

    regionState.removeReference(peerRegion.id)
    expect(regionState.get().references).toEqual([])
  })

  it('ignores duplicate references', () => {
    regionState.addReference(peerRegion)
    regionState.addReference(peerRegion)
    expect(regionState.get().references).toEqual([peerRegion])
  })

  it('does not add the current region as a reference', () => {
    regionState.setCurrent(sampleRegion)
    regionState.addReference(sampleRegion)
    expect(regionState.get().references).toEqual([])
  })

  it('removes a reference that becomes the current region', () => {
    regionState.addReference(sampleRegion)
    regionState.addReference(peerRegion)

    regionState.setCurrent(sampleRegion)

    expect(regionState.get().references).toEqual([peerRegion])
  })
})
