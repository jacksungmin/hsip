// Tests the TxDOT SII (Safety Investment Index) formula from docs/06-contracts.md.
// Pure function, no mocks needed. Expected values computed independently in Python.

import { describe, expect, it } from 'vitest'
import { calculateSII, clampServiceLife, MAX_SERVICE_LIFE } from './calculateSII'
import type { Alternative, Countermeasure, CrashCostEntry } from '../types'

// K and A carry the same figure, as the shipped config does. That makes the
// three-term weighting reduce to TxDOT's combined-KA arithmetic, so the
// expected values below stay valid regardless of how a case splits its
// K and A counts.
const crashCostTable: CrashCostEntry[] = [
  { severity: 'K', label: 'Fatal injury', dollarValue: 4_290_000 },
  { severity: 'A', label: 'Incapacitating injury', dollarValue: 4_290_000 },
  { severity: 'B', label: 'Non-incapacitating injury', dollarValue: 360_000 },
]

function makeAlternative(overrides: Partial<Alternative> = {}): Alternative {
  return {
    id: 'alt-1',
    siteId: 'site-1',
    workcode: '108',
    constructionCost: 500_000,
    annualMaintenance: 1_300,
    serviceLife: 10,
    ...overrides,
  }
}

function makeCountermeasure(overrides: Partial<Countermeasure> = {}): Countermeasure {
  return {
    workcode: '108',
    name: 'Improve Traffic Signals',
    definition: '',
    emphasisAreas: ['11. Intersection Related'],
    facilitySubset: 'Signal',
    typeOfWork: 'Intersection',
    subGroup: 'Intersections',
    reductionFactor: 0.2,
    serviceLife: 10,
    maintenanceCostRef: '$1,300',
    additionalDocs: null,
    ...overrides,
  }
}

describe('calculateSII', () => {
  it('computes full SII for a typical case', () => {
    const result = calculateSII({
      alternative: makeAlternative(),
      countermeasure: makeCountermeasure(),
      crashCounts: { K: 2, A: 3, B: 10 },
      dataYears: 7,
      growthRatePercent: 2,
      crashCostTable,
    })

    expect(result).not.toBeNull()
    expect(result!.S).toBeCloseTo(714_414.29, 0)
    expect(result!.Q).toBeCloseTo(15_645.27, 0)
    expect(result!.B).toBeCloseTo(5_778_863.06, 0)
    expect(result!.C).toBe(500_000)
    expect(result!.SII).toBeCloseTo(11.5577, 2)
  })

  // The point of per-severity cost rows: a config that prices a fatal crash
  // above an incapacitating one must yield a larger benefit at a site whose
  // crashes skew fatal. Under the old single combined-KA figure the two cases
  // below were indistinguishable.
  it('weights K and A independently when the config prices them differently', () => {
    const splitCosts: CrashCostEntry[] = [
      { severity: 'K', label: 'Fatal injury', dollarValue: 10_000_000 },
      { severity: 'A', label: 'Incapacitating injury', dollarValue: 1_000_000 },
      { severity: 'B', label: 'Non-incapacitating injury', dollarValue: 360_000 },
    ]
    const base = {
      alternative: makeAlternative({ annualMaintenance: 0 }),
      countermeasure: makeCountermeasure(),
      dataYears: 7,
      growthRatePercent: 0,
      crashCostTable: splitCosts,
    }

    const fatalHeavy = calculateSII({ ...base, crashCounts: { K: 2, A: 0, B: 0 } })
    const injuryHeavy = calculateSII({ ...base, crashCounts: { K: 0, A: 2, B: 0 } })

    expect(fatalHeavy!.S).toBeCloseTo((0.2 * 2 * 10_000_000) / 7, 0)
    expect(injuryHeavy!.S).toBeCloseTo((0.2 * 2 * 1_000_000) / 7, 0)
    expect(fatalHeavy!.SII!).toBeGreaterThan(injuryHeavy!.SII!)
  })

  // Equal K and A costs must collapse to TxDOT's combined-KA arithmetic, so
  // the shipped config produces the same numbers the two-group table did.
  it('is insensitive to the K/A split when K and A cost the same', () => {
    const base = {
      alternative: makeAlternative(),
      countermeasure: makeCountermeasure(),
      dataYears: 7,
      growthRatePercent: 2,
      crashCostTable,
    }

    expect(calculateSII({ ...base, crashCounts: { K: 5, A: 0, B: 10 } })).toEqual(
      calculateSII({ ...base, crashCounts: { K: 0, A: 5, B: 10 } }),
    )
  })

  it('handles zero growth rate (Q = 0)', () => {
    const result = calculateSII({
      alternative: makeAlternative({
        workcode: '113',
        constructionCost: 200_000,
        annualMaintenance: 0,
        serviceLife: 5,
      }),
      countermeasure: makeCountermeasure({
        workcode: '113',
        reductionFactor: 0.1,
        serviceLife: 5,
      }),
      crashCounts: { K: 1, A: 2, B: 5 },
      dataYears: 7,
      growthRatePercent: 0,
      crashCostTable,
    })

    expect(result).not.toBeNull()
    expect(result!.Q).toBe(0)
    expect(result!.S).toBeCloseTo(209_571.43, 0)
    expect(result!.B).toBeCloseTo(882_791.10, 0)
    expect(result!.SII).toBeCloseTo(4.414, 2)
  })

  it('returns null when reductionFactor is null (TBD workcode)', () => {
    const result = calculateSII({
      alternative: makeAlternative({ workcode: '220' }),
      countermeasure: makeCountermeasure({ workcode: '220', reductionFactor: null }),
      crashCounts: { K: 2, A: 3, B: 10 },
      dataYears: 7,
      growthRatePercent: 2,
      crashCostTable,
    })

    expect(result).toBeNull()
  })

  it('returns SII null when constructionCost is null', () => {
    const result = calculateSII({
      alternative: makeAlternative({ constructionCost: null }),
      countermeasure: makeCountermeasure(),
      crashCounts: { K: 2, A: 3, B: 10 },
      dataYears: 7,
      growthRatePercent: 2,
      crashCostTable,
    })

    expect(result).not.toBeNull()
    expect(result!.S).toBeCloseTo(714_414.29, 0)
    expect(result!.B).toBeCloseTo(5_778_863.06, 0)
    expect(result!.C).toBe(0)
    expect(result!.SII).toBeNull()
  })

  it('returns SII null when constructionCost is zero', () => {
    const result = calculateSII({
      alternative: makeAlternative({ constructionCost: 0 }),
      countermeasure: makeCountermeasure(),
      crashCounts: { K: 2, A: 3, B: 10 },
      dataYears: 7,
      growthRatePercent: 2,
      crashCostTable,
    })

    expect(result).not.toBeNull()
    expect(result!.C).toBe(0)
    expect(result!.SII).toBeNull()
  })

  it('handles zero crashes (negative S from maintenance)', () => {
    const result = calculateSII({
      alternative: makeAlternative(),
      countermeasure: makeCountermeasure(),
      crashCounts: { K: 0, A: 0, B: 0 },
      dataYears: 7,
      growthRatePercent: 2,
      crashCostTable,
    })

    expect(result).not.toBeNull()
    expect(result!.S).toBeCloseTo(-1_300, 0)
    expect(result!.B).toBeLessThan(0)
  })

  it('uses annualMaintenance null as zero', () => {
    const result = calculateSII({
      alternative: makeAlternative({ annualMaintenance: null }),
      countermeasure: makeCountermeasure(),
      crashCounts: { K: 2, A: 3, B: 10 },
      dataYears: 7,
      growthRatePercent: 2,
      crashCostTable,
    })

    expect(result).not.toBeNull()
    expect(result!.S).toBeCloseTo(714_414.29 + 1_300, 0)
  })

  // The present-value loop runs once per year of service life. Nothing
  // downstream of the workbench input validates it, so the formula itself
  // has to stay bounded for restored sessions and dev fixtures.
  describe('service life bound', () => {
    function withServiceLife(serviceLife: number) {
      return calculateSII({
        alternative: makeAlternative({ serviceLife }),
        countermeasure: makeCountermeasure(),
        crashCounts: { K: 2, A: 3, B: 10 },
        dataYears: 7,
        growthRatePercent: 2,
        crashCostTable,
      })
    }

    it('caps an absurd service life at MAX_SERVICE_LIFE instead of looping', () => {
      expect(MAX_SERVICE_LIFE).toBe(100)
      expect(withServiceLife(99_999)).toEqual(withServiceLife(MAX_SERVICE_LIFE))
    })

    it('returns a finite result for a service life of Infinity', () => {
      const result = withServiceLife(Infinity)
      expect(result).not.toBeNull()
      expect(Number.isFinite(result!.B)).toBe(true)
    })

    it('leaves realistic service lives untouched', () => {
      for (const years of [1, 5, 10, 30, MAX_SERVICE_LIFE]) {
        expect(clampServiceLife(years)).toBe(years)
      }
    })

    it('floors fractional years and treats non-numbers as zero', () => {
      expect(clampServiceLife(10.9)).toBe(10)
      expect(clampServiceLife(-5)).toBe(0)
      expect(clampServiceLife(NaN)).toBe(0)
    })
  })
})
