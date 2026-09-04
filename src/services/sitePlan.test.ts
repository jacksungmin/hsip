// Covers site-plan evaluation (chosen-alternative resolution) and the shared
// SII ranking comparator every alternatives table sorts with — the comparator
// must be total and deterministic so the in-app table and the exported report
// never disagree about order.

import { describe, expect, it } from 'vitest'
import type { Alternative, Site, SitePart } from '../types'
import type { SiteCrashProfile } from './siteCrashProfile'
import { calculateSiteAlternatives, compareBySII, resolveChosenAlternative } from './sitePlan'

const part: SitePart = {
  id: 'part-1',
  name: 'Intersection 1',
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
  crashes: [],
}

const site: Site = {
  id: 'site-1',
  name: 'Test site',
  type: 'intersection',
  source: 'draw',
  parts: [part],
  crashIds: [],
  crashSeverity: { K: 0, A: 0, B: 0 },
  growthRatePercent: 2,
}

const alternatives: Alternative[] = [
  {
    id: 'alt-101',
    siteId: site.id,
    workcode: '101',
    constructionCost: 100_000,
    annualMaintenance: 0,
    serviceLife: 15,
  },
  {
    id: 'alt-110',
    siteId: site.id,
    workcode: '110',
    constructionCost: 100_000,
    annualMaintenance: 0,
    serviceLife: 10,
  },
]

function profile(
  byWorkcode: SiteCrashProfile['byWorkcode'],
): SiteCrashProfile {
  return {
    total: { K: 0, A: 0, B: 0 },
    byWorkcode,
    dataYears: 7,
  }
}

describe('site plan evaluation', () => {
  it('changes the automatic choice when the crash profile changes', () => {
    const beforeRows = calculateSiteAlternatives(site, alternatives, profile({
      '101': { K: 10, A: 0, B: 0 },
      '110': { K: 1, A: 0, B: 0 },
    }))
    const afterRows = calculateSiteAlternatives(site, alternatives, profile({
      '101': { K: 1, A: 0, B: 0 },
      '110': { K: 10, A: 0, B: 0 },
    }))

    expect(resolveChosenAlternative(beforeRows, null)?.altId).toBe('alt-101')
    expect(resolveChosenAlternative(afterRows, null)?.altId).toBe('alt-110')
  })

  it('preserves an explicit pin while refreshing its prevented counts', () => {
    const before = resolveChosenAlternative(
      calculateSiteAlternatives(site, alternatives, profile({
        '101': { K: 8, A: 4, B: 2 },
        '110': { K: 20, A: 10, B: 5 },
      })),
      'alt-101',
    )
    const after = resolveChosenAlternative(
      calculateSiteAlternatives(site, alternatives, profile({
        '101': { K: 2, A: 1, B: 4 },
        '110': { K: 20, A: 10, B: 5 },
      })),
      'alt-101',
    )

    expect(before).toEqual({
      altId: 'alt-101',
      source: 'explicit',
      prevented: { K: 1.6, A: 0.8, B: 0.4 },
    })
    expect(after).toEqual({
      altId: 'alt-101',
      source: 'explicit',
      prevented: { K: 0.4, A: 0.2, B: 0.8 },
    })
  })

  it('clears an automatic choice when no alternative has a computable SII', () => {
    const noCostAlternatives = alternatives.map((alternative) => ({
      ...alternative,
      constructionCost: null,
    }))
    const rows = calculateSiteAlternatives(site, noCostAlternatives, profile({
      '101': { K: 2, A: 1, B: 4 },
    }))

    expect(resolveChosenAlternative(rows, null)).toBeNull()
  })
})

describe('compareBySII', () => {
  function sortedIds(values: (number | null)[]): string[] {
    return values
      .map((sii, i) => ({ id: `alt-${i}`, sii }))
      .sort((a, b) => compareBySII(a.sii, b.sii))
      .map((row) => row.id)
  }

  it('orders higher SII first', () => {
    expect(sortedIds([0.5, 3, 1.2])).toEqual(['alt-1', 'alt-2', 'alt-0'])
  })

  it('puts nulls last regardless of which side they land on', () => {
    expect(sortedIds([null, 2, null, 5])).toEqual(['alt-3', 'alt-1', 'alt-0', 'alt-2'])
  })

  it('keeps input order when every value is null', () => {
    expect(sortedIds([null, null, null, null])).toEqual(['alt-0', 'alt-1', 'alt-2', 'alt-3'])
  })

  it('never returns NaN, so sort order is well defined for any pair', () => {
    const values: (number | null)[] = [null, 0, -1.5, 2, Infinity]
    for (const a of values) {
      for (const b of values) {
        expect(compareBySII(a, b)).not.toBeNaN()
      }
    }
  })

  it('is antisymmetric: swapping the arguments flips the sign', () => {
    // Math.sign would do, but it distinguishes 0 from -0 under Object.is.
    const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0)
    const values: (number | null)[] = [null, 0, 1, 4]
    for (const a of values) {
      for (const b of values) {
        expect(sign(compareBySII(a, b))).toBe(sign(-compareBySII(b, a)))
      }
    }
  })
})
