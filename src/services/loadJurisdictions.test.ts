// Pins the geojson -> Jurisdiction mapping used by JurisdictionStore:
// properties (id, name, jurisdictionType) map to the docs/06 Jurisdiction
// entity, counties sort before cities (alphabetical within each), and
// malformed features fail loudly rather than producing partial data.

import { describe, expect, it } from 'vitest'
import type { FeatureCollection, Polygon } from 'geojson'
import { mapJurisdictions } from './loadJurisdictions'

const square: Polygon = {
  type: 'Polygon',
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
}

function fc(
  entries: Array<{ id?: unknown; name?: unknown; jurisdictionType?: unknown; geometry?: Polygon | null }>,
): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: entries.map((e) => ({
      type: 'Feature',
      properties: { id: e.id, name: e.name, jurisdictionType: e.jurisdictionType },
      geometry: 'geometry' in e ? (e.geometry as Polygon) : square,
    })),
  }
}

describe('mapJurisdictions', () => {
  it('maps properties to Jurisdiction with string ids', () => {
    const result = mapJurisdictions(
      fc([{ id: '20', name: 'Brazoria County', jurisdictionType: 'county' }]),
    )
    expect(result).toEqual([
      { id: '20', name: 'Brazoria County', type: 'county', geometry: square },
    ])
  })

  it('sorts counties before cities, alphabetical within each', () => {
    const result = mapJurisdictions(
      fc([
        { id: '1', name: 'Baytown', jurisdictionType: 'city' },
        { id: '2', name: 'Waller County', jurisdictionType: 'county' },
        { id: '3', name: 'Aldine', jurisdictionType: 'city' },
        { id: '4', name: 'Brazoria County', jurisdictionType: 'county' },
      ]),
    )
    expect(result.map((j) => j.name)).toEqual([
      'Brazoria County',
      'Waller County',
      'Aldine',
      'Baytown',
    ])
  })

  it('throws on a feature missing required properties', () => {
    expect(() =>
      mapJurisdictions(fc([{ id: '1', jurisdictionType: 'city' }])),
    ).toThrow(/missing name/)
    expect(() =>
      mapJurisdictions(fc([{ id: '1', name: 'Aldine', jurisdictionType: 'town' }])),
    ).toThrow(/unknown jurisdictionType/)
    expect(() =>
      mapJurisdictions(fc([{ id: '1', name: 'Aldine', jurisdictionType: 'city', geometry: null }])),
    ).toThrow(/missing geometry/)
  })
})
