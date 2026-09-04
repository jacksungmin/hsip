// Pins the crash-union math behind multi-part sites (docs/06 Site):
// a crash inside two overlapping part buffers counts once in the
// site-level union, and the severity tally comes from the deduped set.

import { describe, expect, it } from 'vitest'
import type { Site, SitePart } from '../types'
import { dedupeCrashUnion, withSiteParts } from './crashUnion'

const row = (id: string, severity: string) => ({ id, severity })

describe('dedupeCrashUnion', () => {
  it('counts a crash appearing in multiple parts once', () => {
    const partA = [row('c1', 'K'), row('c2', 'A')]
    const partB = [row('c2', 'A'), row('c3', 'B')]
    const u = dedupeCrashUnion([partA, partB])
    expect(u.crashIds).toEqual(['c1', 'c2', 'c3'])
    expect(u.records).toHaveLength(3)
    expect(u.crashSeverity).toEqual({ K: 1, A: 1, B: 1 })
  })

  it('tallies only K/A/B severities', () => {
    const u = dedupeCrashUnion([[row('c1', 'K'), row('c2', 'C'), row('c3', 'O')]])
    expect(u.crashSeverity).toEqual({ K: 1, A: 0, B: 0 })
    expect(u.crashIds).toHaveLength(3)
  })

  it('returns an empty union for no parts and for empty parts', () => {
    expect(dedupeCrashUnion([]).crashIds).toEqual([])
    const u = dedupeCrashUnion([[], []])
    expect(u.crashIds).toEqual([])
    expect(u.crashSeverity).toEqual({ K: 0, A: 0, B: 0 })
  })
})

describe('withSiteParts', () => {
  it('projects replacement parts and their deduped crash union together', () => {
    const part = (id: string, crashes: SitePart['crashes']): SitePart => ({
      id,
      name: id,
      drawnGeometry: { type: 'Point', coordinates: [-95.4, 29.7] },
      bufferFeet: 150,
      bufferedGeometry: {
        type: 'Polygon',
        coordinates: [[
          [-95.401, 29.699],
          [-95.399, 29.699],
          [-95.399, 29.701],
          [-95.401, 29.701],
          [-95.401, 29.699],
        ]],
      },
      crashes,
    })
    const site: Site = {
      id: 'site-1',
      name: 'Test site',
      type: 'intersection',
      source: 'draw',
      parts: [],
      crashIds: [],
      crashSeverity: { K: 0, A: 0, B: 0 },
    }

    const projected = withSiteParts(site, [
      part('part-1', [{ id: 'c1', severity: 'K' }, { id: 'c2', severity: 'A' }]),
      part('part-2', [{ id: 'c2', severity: 'A' }, { id: 'c3', severity: 'B' }]),
    ])

    expect(projected.parts).toHaveLength(2)
    expect(projected.crashIds).toEqual(['c1', 'c2', 'c3'])
    expect(projected.crashSeverity).toEqual({ K: 1, A: 1, B: 1 })
  })
})
