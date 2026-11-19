// The coordinate systems an upload can be converted from, checked against
// PROJ (pyproj) reference conversions at three locations across the region
// (projections.fixture.json, written by tools/crs/generate_projections.py).

import { describe, expect, it } from 'vitest'
import proj4 from 'proj4'
import { PROJECTIONS } from './projections'
import { nad27ToNad83 } from '../services/parseUploadedFile'
import fixture from './projections.fixture.json'

type Ref = { code: number; nad27: boolean; lon: number; lat: number; x: number; y: number }
const refs = fixture as Ref[]

describe('PROJECTIONS', () => {
  it('has a reference conversion for every system', () => {
    const tested = new Set(refs.map((r) => String(r.code)))
    expect([...tested].sort()).toEqual(Object.keys(PROJECTIONS).sort())
  })

  // 1e-7 degree is about 1 cm.
  it.each(refs.filter((r) => !r.nad27))('EPSG:$code matches PROJ at $lon, $lat', (r) => {
    const [lon, lat] = proj4(PROJECTIONS[String(r.code)].proj4).inverse([r.x, r.y])
    expect(lon).toBeCloseTo(r.lon, 7)
    expect(lat).toBeCloseTo(r.lat, 7)
  })

  // NAD27 is checked end to end: projection plus the datum shift against
  // NOAA's grid. 1e-6 degree is about 0.1 m.
  it.each(refs.filter((r) => r.nad27))('NAD27 EPSG:$code lands on the NAD83 position at $lon, $lat', (r) => {
    const [lon27, lat27] = proj4(PROJECTIONS[String(r.code)].proj4).inverse([r.x, r.y])
    const shifted = nad27ToNad83(lon27, lat27)
    expect(shifted).not.toBeNull()
    expect(shifted![0]).toBeCloseTo(r.lon, 6)
    expect(shifted![1]).toBeCloseTo(r.lat, 6)
  })
})

describe('nad27ToNad83', () => {
  it('returns null outside the H-GAC grid rather than guessing', () => {
    expect(nad27ToNad83(-100, 32)).toBeNull()
  })

  it('shifts about 30 m in Houston, the size of the error it fixes', () => {
    const [lon, lat] = nad27ToNad83(-95.37, 29.76)!
    const metres = Math.hypot((lon + 95.37) * 96500, (lat - 29.76) * 110900)
    expect(metres).toBeGreaterThan(25)
    expect(metres).toBeLessThan(40)
  })
})
