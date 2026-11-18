// Map search parsing and matching (KH suggestion 4, local-only version).

import { describe, expect, it } from 'vitest'
import { parseCoordinates, searchPlaces } from './mapSearch'
import type { Jurisdiction } from '../types'

const square = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
const place = (id: string, name: string, type: Jurisdiction['type']): Jurisdiction =>
  ({ id, name, type, geometry: square }) as Jurisdiction

describe('parseCoordinates', () => {
  it('reads latitude-first pairs, as map sites show them', () => {
    expect(parseCoordinates('29.7604, -95.3698')).toEqual({ lat: 29.7604, lon: -95.3698 })
    expect(parseCoordinates('  29.7604 -95.3698 ')).toEqual({ lat: 29.7604, lon: -95.3698 })
  })

  it('also reads longitude-first pairs when the longitude is beyond ±90', () => {
    expect(parseCoordinates('-95.3698,29.7604')).toEqual({ lat: 29.7604, lon: -95.3698 })
  })

  it('rejects text, single numbers and out-of-range values', () => {
    expect(parseCoordinates('Houston')).toBeNull()
    expect(parseCoordinates('29.76')).toBeNull()
    expect(parseCoordinates('29.76, -195.3')).toBeNull()
    expect(parseCoordinates('120, 200')).toBeNull()
  })
})

describe('searchPlaces', () => {
  const places = [
    place('101', 'Harris County', 'county'),
    place('208', 'Houston', 'city'),
    place('11', 'Alvin', 'city'),
    place('300', 'South Houston', 'city'),
    place('hgac', 'H-GAC region', 'hgac-region'),
  ]

  it('ranks names starting with the query before names containing it', () => {
    expect(searchPlaces('hou', places).map((m) => m.jurisdiction.name)).toEqual(['Houston', 'South Houston'])
  })

  it('labels cities and counties, and skips the region entry', () => {
    expect(searchPlaces('har', places)).toEqual([{ jurisdiction: places[0], label: 'County' }])
    expect(searchPlaces('h-gac', places)).toEqual([])
  })

  it('waits for two characters and is case-insensitive', () => {
    expect(searchPlaces('h', places)).toEqual([])
    expect(searchPlaces('ALV', places).map((m) => m.jurisdiction.name)).toEqual(['Alvin'])
  })
})
