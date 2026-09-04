// Tests the ReportPayload assembly contract (docs/06 ReportPayload).
// assembleReport is a pure function: all dependencies injected, no store reads.

import { describe, it, expect } from 'vitest'
import { assembleReport, type AssembleReportInput } from './assembleReport'
import type { Site, Alternative, Countermeasure, CrashCostEntry, CrashRecord, ProjectInfo } from '../types'
import type { EaFlagKey } from '../data/emphasisAreas'
import type { HsipFlagKey } from '../data/hsipWorkcodes'

function makeSite(overrides: Partial<Site> = {}): Site {
  return {
    id: 'site:1',
    name: 'Test Site',
    type: 'roadway',
    source: 'draw' as const,
    parts: [],
    crashIds: ['c1', 'c2'],
    crashSeverity: { K: 1, A: 0, B: 1 },
    growthRatePercent: 2,
    ...overrides,
  }
}

function makeAlt(overrides: Partial<Alternative> = {}): Alternative {
  return {
    id: 'alt:1',
    siteId: 'site:1',
    workcode: '101',
    constructionCost: 100000,
    annualMaintenance: 500,
    serviceLife: 15,
    ...overrides,
  }
}

function makeCm(overrides: Partial<Countermeasure> = {}): Countermeasure {
  return {
    workcode: '101',
    name: 'Install Warning Signs',
    definition: 'Test definition',
    emphasisAreas: ['0. All'],
    facilitySubset: null,
    typeOfWork: 'Other',
    reductionFactor: 0.2,
    serviceLife: 15,
    maintenanceCostRef: '0',
    subGroup: 'Crosscutting - Signs and Markings',
    additionalDocs: null,
    ...overrides,
  }
}

function makeCrash(overrides: Partial<CrashRecord> = {}): CrashRecord {
  const base: Record<string, unknown> = {
    id: 'c1',
    date: '2022-01-01',
    severity: 'K' as const,
    lon: -95.3,
    lat: 29.7,
    location: { type: 'Point', coordinates: [-95.3, 29.7] },
    countyId: '101',
    cityId: null,
  }
  const eaFlags: Partial<Record<EaFlagKey, 0 | 1>> = {
    EA_01_Speed: 1,
    EA_02_Impaired: 0,
    EA_03_Distracted: 0,
    EA_04_OccProt: 0,
    EA_05_WrongWay: 0,
    EA_06_Young: 0,
    EA_07_Old: 0,
    EA_08_Ped: 0,
    EA_09_Bike: 0,
    EA_10_Motorcycle: 0,
    EA_11_Int: 0,
    EA_12_DepartRdwy: 0,
    EA_13_DepartLn: 0,
    EA_14_Dark: 0,
  }
  const hsipFlags: Partial<Record<HsipFlagKey, 0 | 1>> = {
    HSIP_101: 1,
  }
  return { ...base, ...eaFlags, ...hsipFlags, ...overrides } as CrashRecord
}

const defaultCosts: CrashCostEntry[] = [
  { severity: 'K', label: 'Fatal', dollarValue: 1500000 },
  { severity: 'A', label: 'Incapacitating', dollarValue: 1500000 },
  { severity: 'B', label: 'Non-incapacitating', dollarValue: 200000 },
]

const defaultProjectInfo: ProjectInfo = {
  projectName: 'Test Project',
  organization: 'Test Org',
  analyst: 'Jane',
  countyLocality: 'Harris County',
  notes: '',
}

function makeInput(overrides: Partial<AssembleReportInput> = {}): AssembleReportInput {
  const site = makeSite()
  const alt = makeAlt()
  const cm = makeCm()
  return {
    sites: [site],
    alternatives: [alt],
    chosenBySite: { 'site:1': { altId: 'alt:1', source: 'auto', prevented: { K: 0.2, A: 0, B: 0.2 } } },
    crashesBySite: { 'site:1': [makeCrash(), makeCrash({ id: 'c2', severity: 'B' as const })] },
    countermeasureCatalog: [cm],
    crashCostTable: defaultCosts,
    projectInfo: defaultProjectInfo,
    dataYears: 7,
    dataRange: '2018-2024',
    buildId: 'abc123',
    appVersion: '0.1.0',
    ...overrides,
  }
}

describe('assembleReport', () => {
  it('includes only sites with a chosen alternative', () => {
    const site1 = makeSite({ id: 'site:1' })
    const site2 = makeSite({ id: 'site:2', name: 'Unplanned Site', crashIds: [] })
    const alt = makeAlt({ siteId: 'site:1' })
    const input = makeInput({
      sites: [site1, site2],
      alternatives: [alt],
      chosenBySite: { 'site:1': { altId: 'alt:1', source: 'auto', prevented: { K: 0.2, A: 0, B: 0 } } },
      crashesBySite: {
        'site:1': [makeCrash()],
        'site:2': [],
      },
    })
    const result = assembleReport(input)
    expect(result.sites).toHaveLength(1)
    expect(result.sites[0].site.id).toBe('site:1')
  })

  it('populates per-site crash counts by severity and EA with severity breakdown', () => {
    const crash1 = makeCrash({ id: 'c1', severity: 'K' as const, EA_01_Speed: 1 as const, EA_11_Int: 1 as const })
    const crash2 = makeCrash({ id: 'c2', severity: 'B' as const, EA_01_Speed: 0 as const, EA_11_Int: 1 as const })
    const input = makeInput({
      crashesBySite: { 'site:1': [crash1, crash2] },
    })
    const result = assembleReport(input)
    const counts = result.sites[0].crashCounts
    expect(counts.total).toBe(2)
    expect(counts.bySeverity).toEqual({ K: 1, A: 0, B: 1 })
    expect(counts.byEmphasisArea['EA_01_Speed']).toEqual({ K: 1, A: 0, B: 0 })
    expect(counts.byEmphasisArea['EA_11_Int']).toEqual({ K: 1, A: 0, B: 1 })
    expect(counts.byEmphasisArea['EA_02_Impaired']).toEqual({ K: 0, A: 0, B: 0 })
  })

  it('computes SII, addressable crashes, and expected reduction per alternative', () => {
    const result = assembleReport(makeInput())
    const alt = result.sites[0].alternatives[0]
    expect(alt.isChosen).toBe(true)
    expect(alt.S).toBeTypeOf('number')
    expect(alt.SII).toBeTypeOf('number')
    expect(alt.addressableCrashes).toEqual({ K: 1, A: 0, B: 1 })
    expect(alt.expectedReduction).toEqual({ K: 0.2, A: 0, B: 0.2 })
  })

  it('builds unique countermeasure list in first-appearance order', () => {
    const cm101 = makeCm({ workcode: '101' })
    const cm107 = makeCm({ workcode: '107', name: 'Install Traffic Signal' })
    const site1 = makeSite({ id: 'site:1' })
    const site2 = makeSite({ id: 'site:2', crashIds: ['c3'] })
    const alt1 = makeAlt({ id: 'alt:1', siteId: 'site:1', workcode: '107' })
    const alt2 = makeAlt({ id: 'alt:2', siteId: 'site:2', workcode: '101' })
    const input = makeInput({
      sites: [site1, site2],
      alternatives: [alt1, alt2],
      chosenBySite: {
        'site:1': { altId: 'alt:1', source: 'auto', prevented: { K: 0, A: 0, B: 0 } },
        'site:2': { altId: 'alt:2', source: 'auto', prevented: { K: 0, A: 0, B: 0 } },
      },
      crashesBySite: {
        'site:1': [makeCrash()],
        'site:2': [makeCrash({ id: 'c3' })],
      },
      countermeasureCatalog: [cm101, cm107],
    })
    const result = assembleReport(input)
    expect(result.countermeasures).toHaveLength(2)
    expect(result.countermeasures[0].workcode).toBe('107')
    expect(result.countermeasures[1].workcode).toBe('101')
  })

  it('includes methods and metadata', () => {
    const result = assembleReport(makeInput())
    expect(result.methods.dataYears).toBe(7)
    expect(result.methods.dataRange).toBe('2018-2024')
    expect(result.methods.crashCostTable).toEqual(defaultCosts)
    expect(result.metadata.buildId).toBe('abc123')
    expect(result.metadata.appVersion).toBe('0.1.0')
  })

  it('returns empty sites array when no site has a chosen alternative', () => {
    const input = makeInput({ chosenBySite: {} })
    const result = assembleReport(input)
    expect(result.sites).toHaveLength(0)
    expect(result.countermeasures).toHaveLength(0)
  })

  it('skips alternatives whose countermeasure is not in catalog', () => {
    const alt = makeAlt({ workcode: '999' })
    const input = makeInput({
      alternatives: [alt],
      chosenBySite: { 'site:1': { altId: 'alt:1', source: 'auto', prevented: { K: 0, A: 0, B: 0 } } },
    })
    const result = assembleReport(input)
    expect(result.sites[0].alternatives).toHaveLength(0)
  })

  it('zeros addressable crashes when workcode has no tagged crashes', () => {
    const cm200 = makeCm({ workcode: '200', reductionFactor: 0.3 })
    const alt = makeAlt({ workcode: '200' })
    const input = makeInput({
      alternatives: [alt],
      countermeasureCatalog: [cm200],
    })
    const result = assembleReport(input)
    const reportAlt = result.sites[0].alternatives[0]
    expect(reportAlt.addressableCrashes).toEqual({ K: 0, A: 0, B: 0 })
    expect(reportAlt.expectedReduction).toEqual({ K: 0, A: 0, B: 0 })
  })
})
