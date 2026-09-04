// Pins the SiteList part-ops contract from docs/06-contracts.md: parts
// store their crash refs ({id, severity} pairs), the store recomputes
// the site-level deduped union inside every part mutation, and a site
// never drops below one part.

import { beforeEach, describe, expect, it } from 'vitest'
import type { Point, Polygon } from 'geojson'
import { siteList } from './siteList.svelte'
import type { CrashRef, Site, SitePart } from '../types'

const square: Polygon = {
  type: 'Polygon',
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
}
const point: Point = { type: 'Point', coordinates: [0.5, 0.5] }

function makePart(id: string, crashes: CrashRef[]): SitePart {
  return {
    id,
    name: id,
    drawnGeometry: point,
    bufferFeet: 150,
    bufferedGeometry: square,
    crashes,
  }
}

function makeSite(id: string, parts: SitePart[]): Site {
  // Fixture union is naive (no overlap in add() fixtures); mutations
  // recompute it properly, which is what the tests assert.
  const all = parts.flatMap((p) => p.crashes)
  return {
    id,
    name: id,
    type: 'intersection',
    source: 'draw',
    parts,
    crashIds: all.map((c) => c.id),
    crashSeverity: { K: 0, A: 0, B: 0 },
  }
}

function getSite(id: string): Site {
  const s = siteList.get().find((s) => s.id === id)
  if (!s) throw new Error(`site ${id} not in list`)
  return s
}

beforeEach(() => {
  for (const s of [...siteList.get()]) siteList.remove(s.id)
})

describe('siteList part ops', () => {
  it('add() and get() round-trip a single-part site', () => {
    siteList.add(makeSite('s1', [makePart('p1', [{ id: 'c1', severity: 'K' }])]))
    expect(getSite('s1').parts).toHaveLength(1)
    expect(getSite('s1').parts[0].id).toBe('p1')
  })

  it('addPart() appends the part and recomputes the deduped union', () => {
    siteList.add(makeSite('s1', [makePart('p1', [{ id: 'c1', severity: 'K' }, { id: 'c2', severity: 'B' }])]))
    // c2 also falls in the new part's buffer: overlap must count once.
    siteList.addPart('s1', makePart('p2', [{ id: 'c2', severity: 'B' }, { id: 'c3', severity: 'A' }]))
    const s = getSite('s1')
    expect(s.parts.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(s.crashIds).toEqual(['c1', 'c2', 'c3'])
    expect(s.crashSeverity).toEqual({ K: 1, A: 1, B: 1 })
  })

  it('removePart() drops the part and recomputes the union from remaining parts', () => {
    siteList.add(makeSite('s1', [
      makePart('p1', [{ id: 'c1', severity: 'K' }]),
      makePart('p2', [{ id: 'c2', severity: 'A' }]),
    ]))
    siteList.removePart('s1', 'p2')
    const s = getSite('s1')
    expect(s.parts.map((p) => p.id)).toEqual(['p1'])
    expect(s.crashIds).toEqual(['c1'])
    expect(s.crashSeverity).toEqual({ K: 1, A: 0, B: 0 })
  })

  it('removePart() keeps crashes still covered by another part', () => {
    siteList.add(makeSite('s1', [
      makePart('p1', [{ id: 'c1', severity: 'K' }, { id: 'c2', severity: 'B' }]),
      makePart('p2', [{ id: 'c2', severity: 'B' }]),
    ]))
    siteList.removePart('s1', 'p2')
    const s = getSite('s1')
    expect(s.crashIds).toEqual(['c1', 'c2'])
    expect(s.crashSeverity).toEqual({ K: 1, A: 0, B: 1 })
  })

  it('removePart() refuses to remove the last part (min-1 invariant)', () => {
    siteList.add(makeSite('s1', [makePart('p1', [{ id: 'c1', severity: 'K' }])]))
    siteList.removePart('s1', 'p1')
    const s = getSite('s1')
    expect(s.parts).toHaveLength(1)
    expect(s.crashIds).toEqual(['c1'])
  })

  it('removePart() with an unknown partId leaves the site untouched', () => {
    siteList.add(makeSite('s1', [
      makePart('p1', [{ id: 'c1', severity: 'K' }]),
      makePart('p2', [{ id: 'c2', severity: 'A' }]),
    ]))
    const before = getSite('s1')
    siteList.removePart('s1', 'nope')
    expect(getSite('s1')).toEqual(before)
  })

  it('updatePartBuffer() updates the target part and recomputes the union, other parts untouched', () => {
    siteList.add(makeSite('s1', [
      makePart('p1', [{ id: 'c1', severity: 'K' }]),
      makePart('p2', [{ id: 'c2', severity: 'A' }]),
    ]))
    const wider: Polygon = {
      type: 'Polygon',
      coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    }
    siteList.updatePartBuffer('s1', 'p1', {
      drawnGeometry: point,
      bufferFeet: 300,
      bufferedGeometry: wider,
      crashes: [{ id: 'c1', severity: 'K' }, { id: 'c3', severity: 'B' }],
    })
    const s = getSite('s1')
    const p1 = s.parts.find((p) => p.id === 'p1')!
    expect(p1.bufferFeet).toBe(300)
    expect(p1.bufferedGeometry).toBe(wider)
    expect(s.parts.find((p) => p.id === 'p2')!.bufferFeet).toBe(150)
    expect(s.crashIds).toEqual(['c1', 'c3', 'c2'])
    expect(s.crashSeverity).toEqual({ K: 1, A: 1, B: 1 })
  })

  it('updatePartBuffer() replaces drawn geometry (redraw), keeping id and name', () => {
    siteList.add(makeSite('s1', [
      makePart('p1', [{ id: 'c1', severity: 'K' }]),
      makePart('p2', [{ id: 'c2', severity: 'A' }]),
    ]))
    const moved: Point = { type: 'Point', coordinates: [3, 3] }
    const movedBuffer: Polygon = {
      type: 'Polygon',
      coordinates: [[[2.5, 2.5], [3.5, 2.5], [3.5, 3.5], [2.5, 3.5], [2.5, 2.5]]],
    }
    siteList.updatePartBuffer('s1', 'p1', {
      drawnGeometry: moved,
      bufferFeet: 150,
      bufferedGeometry: movedBuffer,
      crashes: [{ id: 'c4', severity: 'B' }],
    })
    const s = getSite('s1')
    const p1 = s.parts.find((p) => p.id === 'p1')!
    expect(p1.drawnGeometry).toBe(moved)
    expect(p1.name).toBe('p1')
    expect(s.crashIds).toEqual(['c4', 'c2'])
    expect(s.crashSeverity).toEqual({ K: 0, A: 1, B: 1 })
  })

  it('updatePart() renames a part without touching crash fields', () => {
    siteList.add(makeSite('s1', [makePart('p1', [{ id: 'c1', severity: 'K' }])]))
    const before = getSite('s1')
    siteList.updatePart('s1', 'p1', { name: 'Main St leg' })
    const s = getSite('s1')
    expect(s.parts[0].name).toBe('Main St leg')
    expect(s.crashIds).toEqual(before.crashIds)
  })

  it('updateSite() still updates planning fields', () => {
    siteList.add(makeSite('s1', [makePart('p1', [])]))
    siteList.updateSite('s1', { name: 'Renamed', growthRatePercent: 3 })
    const s = getSite('s1')
    expect(s.name).toBe('Renamed')
    expect(s.growthRatePercent).toBe(3)
  })
})
