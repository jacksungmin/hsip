// The SII is computed on two paths: the planning screens (siteCrashProfile ->
// calculateSiteAlternatives) and the exported report (assembleReport). Both
// must count the same crashes and divide by the same exposure period, the SII
// analysis period from config/hsip/hsip_program.yaml. This pins both facts,
// because a mismatch would not fail anywhere: the report would simply print
// different numbers from the screen the analyst checked.

import { describe, expect, it } from 'vitest'
import { assembleReport } from './assembleReport'
import { buildSiteCrashProfile } from './siteCrashProfile'
import { calculateSiteAlternatives } from './sitePlan'
import { calculateSII } from './calculateSII'
import { list as listCatalog, getByWorkcode } from '../data/countermeasureCatalog'
import { all as allCrashCosts } from '../data/crashCostTable'
import { HSIP_FIELDS } from '../data/hsipWorkcodes'
import { EA_IDS } from '../data/emphasisAreas'
import { HSIP_PERIOD_LABEL, HSIP_PERIOD_LENGTH } from '../data/hsipProgram'
import type { Alternative, CrashRecord, Site } from '../types'

function crash(id: string, severity: 'K' | 'A' | 'B', flagged: string[]): CrashRecord {
  const flags: Record<string, 0 | 1> = {}
  for (const f of [...EA_IDS, ...HSIP_FIELDS]) flags[f] = flagged.includes(f) ? 1 : 0
  return {
    id,
    date: '2024-06-01',
    severity,
    lon: -95.3,
    lat: 29.7,
    location: { type: 'Point', coordinates: [-95.3, 29.7] },
    countyId: '101',
    cityId: null,
    ...flags,
  } as CrashRecord
}

const site: Site = {
  id: 'site-1',
  name: 'Test site',
  type: 'intersection',
  source: 'draw',
  parts: [],
  crashIds: ['c1', 'c2', 'c3'],
  crashSeverity: { K: 1, A: 1, B: 1 },
  growthRatePercent: 2,
}

const alt: Alternative = {
  id: 'alt-1',
  siteId: site.id,
  workcode: '109',
  constructionCost: 250_000,
  annualMaintenance: 1_000,
  serviceLife: 10,
}

// Two pedestrian crashes the LPI countermeasure (109) addresses, one it does not.
const crashes = [
  crash('c1', 'K', ['HSIP_109']),
  crash('c2', 'B', ['HSIP_109']),
  crash('c3', 'A', []),
]

describe('SII consistency between planning and the report', () => {
  it('gives the same SII on both paths for the same period crashes', () => {
    const profile = buildSiteCrashProfile(crashes, HSIP_PERIOD_LENGTH)
    const [row] = calculateSiteAlternatives(site, [alt], profile)

    const report = assembleReport({
      sites: [site],
      alternatives: [alt],
      chosenBySite: { [site.id]: { altId: alt.id, source: 'auto', prevented: { K: 0, A: 0, B: 0 } } },
      crashesBySite: { [site.id]: crashes },
      countermeasureCatalog: listCatalog(),
      crashCostTable: allCrashCosts(),
      projectInfo: { projectName: 'Test', organization: '', analyst: '', countyLocality: '', notes: '' },
      analysisYears: HSIP_PERIOD_LENGTH,
      analysisRange: HSIP_PERIOD_LABEL,
      historyRange: '2018-2025',
      guidelines: '2027 TxDOT HSIP Guidelines',
      buildId: 'test',
      appVersion: 'test',
    })
    const reported = report.sites[0].alternatives[0]

    expect(row.sii?.SII).not.toBeNull()
    expect(reported.SII).toBeCloseTo(row.sii!.SII!, 9)
    expect(reported.S).toBeCloseTo(row.sii!.S, 9)
  })

  it('divides by the analysis period, not the full crash history', () => {
    const profile = buildSiteCrashProfile(crashes, HSIP_PERIOD_LENGTH)
    const [row] = calculateSiteAlternatives(site, [alt], profile)
    const cm = getByWorkcode('109')!
    const expected = calculateSII({
      alternative: alt,
      countermeasure: cm,
      crashCounts: { K: 1, A: 0, B: 1 },
      dataYears: HSIP_PERIOD_LENGTH,
      growthRatePercent: 2,
      crashCostTable: allCrashCosts(),
    })
    expect(profile.dataYears).toBe(HSIP_PERIOD_LENGTH)
    expect(row.sii?.S).toBeCloseTo(expected!.S, 9)
  })
})
