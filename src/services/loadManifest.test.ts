// Pins the DataManifest parsing contract (docs/06): the manifest is
// the mutable pointer to content-hashed artifacts, so a malformed or
// incomplete one must fail loudly at boot naming what's wrong, never
// hand back partial URLs. Unknown extra keys are ignored (additive
// schema evolution); a schemaVersion mismatch is a hard error.

import { describe, expect, it } from 'vitest'
import { parseManifest } from './loadManifest'

const valid = {
  schemaVersion: 3,
  buildId: 'afde19eb',
  builtAt: '2026-07-06T19:21:46+00:00',
  artifacts: {
    appDb: 'app-40d0b929.db',
    crashTiles: 'crashes_kab-4c724030.pmtiles',
    jurisdictions: 'jurisdictions-242c34cf.geojson',
  },
  overlays: {
    roads: {
      file: 'roads-dfcf455d.pmtiles',
      sourceLayer: 'roads',
      fields: ['f_system', 'county_id'],
    },
  },
  crashData: { years: [2018, 2019, 2020, 2021, 2022, 2023, 2024] },
}

describe('parseManifest', () => {
  it('parses a valid manifest', () => {
    expect(parseManifest(valid)).toEqual(valid)
  })

  it('ignores unknown keys, so the data build can publish extras', () => {
    const withExtra = { ...valid, futureKey: { anything: true } }
    expect(parseManifest(withExtra)).toEqual(valid)
  })

  it('rejects a schemaVersion it does not understand', () => {
    expect(() => parseManifest({ ...valid, schemaVersion: 1 })).toThrow(/schemaVersion/)
    expect(() => parseManifest({ ...valid, schemaVersion: undefined })).toThrow(/schemaVersion/)
  })

  it('rejects a missing or non-string artifact entry, naming the key', () => {
    const { crashTiles: _dropped, ...partial } = valid.artifacts
    expect(() => parseManifest({ ...valid, artifacts: partial })).toThrow(/crashTiles/)
    expect(() =>
      parseManifest({ ...valid, artifacts: { ...valid.artifacts, appDb: 42 } }),
    ).toThrow(/appDb/)
  })

  it('rejects non-object input and a missing artifacts map', () => {
    expect(() => parseManifest(null)).toThrow(/not an object/)
    expect(() => parseManifest('<!doctype html>')).toThrow(/not an object/)
    expect(() => parseManifest({ schemaVersion: 3, buildId: 'x' })).toThrow(/artifacts/)
  })

  // Unlike overlays, this section is required and strictly checked: the year
  // count is the denominator of every SII benefit figure and the range is
  // printed on the report cover, so a tolerant reading would publish
  // plausible wrong numbers rather than stopping.
  it('rejects a missing or empty crashData section', () => {
    const { crashData: _none, ...withoutCrashData } = valid
    expect(() => parseManifest(withoutCrashData)).toThrow(/crashData/)
    expect(() => parseManifest({ ...valid, crashData: { years: [] } })).toThrow(/years/)
    expect(() => parseManifest({ ...valid, crashData: { years: [2018, '2019'] } })).toThrow(
      /integers/,
    )
  })

  it('sorts crash years ascending, so count and range never depend on build order', () => {
    const parsed = parseManifest({ ...valid, crashData: { years: [2020, 2018, 2019] } })
    expect(parsed.crashData.years).toEqual([2018, 2019, 2020])
  })

  // Overlay tilesets are open-ended on purpose: the data build decides which
  // exist, so an absent section parses to none rather than failing, and a
  // retired overlay costs the app a skipped layer, not a failed boot.
  it('accepts a manifest with no overlays section', () => {
    const { overlays: _none, ...withoutOverlays } = valid
    expect(parseManifest(withoutOverlays).overlays).toEqual({})
  })

  it('rejects a half-written overlay entry, naming the overlay', () => {
    const bad = (entry: unknown) => () =>
      parseManifest({ ...valid, overlays: { hin: entry } })
    expect(bad({ sourceLayer: 'hin', fields: [] })).toThrow(/hin.*file/)
    expect(bad({ file: 'hin-1234abcd.pmtiles', fields: [] })).toThrow(/hin.*sourceLayer/)
    expect(bad('hin-1234abcd.pmtiles')).toThrow(/hin.*not an object/)
  })

  it('defaults an overlay with no field list to an empty one', () => {
    const parsed = parseManifest({
      ...valid,
      overlays: { hin: { file: 'hin-1234abcd.pmtiles', sourceLayer: 'hin' } },
    })
    expect(parsed.overlays.hin.fields).toEqual([])
  })
})
