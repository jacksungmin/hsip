// Pins the crash-level CSV export: what each row says about a crash and its
// site, and that the file stays safe and parseable in a spreadsheet.

import { describe, expect, it } from 'vitest'
import { buildCrashCsv, CRASH_CSV_COLUMNS, type CrashExportSite } from './crashCsv'
import { EA_IDS, EA_LABELS } from '../data/emphasisAreas'
import { HSIP_FIELDS } from '../data/hsipWorkcodes'
import { HSIP_PERIOD_YEARS } from '../data/hsipProgram'
import type { CrashRecord, Site, SitePart } from '../types'

const inPeriod = HSIP_PERIOD_YEARS[0]
const beforePeriod = HSIP_PERIOD_YEARS[0] - 1

function crash(id: string, date: string, set: string[] = [], extra: Partial<CrashRecord> = {}): CrashRecord {
  const flags: Record<string, 0 | 1> = {}
  for (const f of [...EA_IDS, ...HSIP_FIELDS]) flags[f] = set.includes(f) ? 1 : 0
  return {
    id,
    date,
    severity: 'K',
    lon: -95.36981,
    lat: 29.76043,
    location: { type: 'Point', coordinates: [-95.36981, 29.76043] },
    countyId: '101',
    cityId: '208',
    ...flags,
    ...extra,
  } as CrashRecord
}

function part(id: string, name: string, crashIds: string[]): SitePart {
  return {
    id,
    name,
    drawnGeometry: { type: 'Point', coordinates: [0, 0] },
    bufferFeet: 250,
    bufferedGeometry: { type: 'Polygon', coordinates: [] },
    crashes: crashIds.map((c) => ({ id: c, severity: 'K', year: inPeriod })),
  }
}

function site(name: string, parts: SitePart[]): Site {
  return {
    id: 'site-1',
    name,
    type: 'intersection',
    source: 'draw',
    parts,
    crashIds: [],
    crashSeverity: { K: 0, A: 0, B: 0 },
  }
}

// Minimal CSV reader for the tests: handles quoted fields with commas,
// doubled quotes and line breaks.
function parse(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\r') continue
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else field += ch
  }
  return rows
}

function rowsOf(sites: CrashExportSite[]) {
  const [header, ...rows] = parse(
    buildCrashCsv({ sites, countyNames: { '101': 'Harris County' }, cityNames: { '208': 'Houston' } }),
  )
  return { header, rows: rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))) }
}

describe('buildCrashCsv', () => {
  it('writes the documented columns, one row per crash, oldest first', () => {
    const s = site('Main St', [part('p1', 'Main at 1st', ['c2', 'c1'])])
    const { header, rows } = rowsOf([
      { site: s, crashes: [crash('c2', `${inPeriod}-05-01`), crash('c1', `${beforePeriod}-03-01`)], selectedWorkcode: null },
    ])
    expect(header).toEqual([...CRASH_CSV_COLUMNS])
    expect(rows.map((r) => r.crash_id)).toEqual(['c1', 'c2'])
  })

  it('describes each crash: period, location, names, emphasis areas and work codes', () => {
    const s = site('Main St', [part('p1', 'Main at 1st', ['c1'])])
    const { rows } = rowsOf([
      {
        site: s,
        crashes: [crash('c1', `${inPeriod}-05-01`, ['EA_08_Ped', 'EA_14_Dark', 'HSIP_109', 'HSIP_403'])],
        selectedWorkcode: '109',
      },
    ])
    expect(rows[0]).toMatchObject({
      site_name: 'Main St',
      site_type: 'intersection',
      site_parts: 'Main at 1st',
      crash_year: String(inPeriod),
      severity: 'K',
      in_sii_period: 'Yes',
      latitude: '29.760430',
      longitude: '-95.369810',
      county: 'Harris County',
      city: 'Houston',
      emphasis_areas: `${EA_LABELS.EA_08_Ped}; ${EA_LABELS.EA_14_Dark}`,
      preventable_work_codes: '109; 403',
      selected_work_code: '109',
      counted_in_selected_sii: 'Yes',
    })
  })

  it('marks crashes outside the SII period, and ones the selection does not cover', () => {
    const s = site('Main St', [part('p1', 'P1', ['old'])])
    const { rows } = rowsOf([
      { site: s, crashes: [crash('old', `${beforePeriod}-01-15`, ['HSIP_403'])], selectedWorkcode: '109' },
    ])
    expect(rows[0].in_sii_period).toBe('No')
    expect(rows[0].counted_in_selected_sii).toBe('No')
  })

  // Found in the end-to-end test: counting criteria matches in every year
  // gave 28 "Yes" rows where the report listed 15 preventable crashes.
  it('counts a crash for the selected SII only inside the analysis period', () => {
    const s = site('Main St', [part('p1', 'P1', ['old', 'new'])])
    const { rows } = rowsOf([
      {
        site: s,
        crashes: [crash('old', `${beforePeriod}-06-01`, ['HSIP_109']), crash('new', `${inPeriod}-06-01`, ['HSIP_109'])],
        selectedWorkcode: '109',
      },
    ])
    const byId = Object.fromEntries(rows.map((r) => [r.crash_id, r]))
    expect(byId.old.preventable_work_codes).toBe('109')
    expect(byId.old.counted_in_selected_sii).toBe('No')
    expect(byId.new.counted_in_selected_sii).toBe('Yes')
  })

  it('leaves the selection columns blank when the site has no selected countermeasure', () => {
    const { rows } = rowsOf([
      { site: site('S', [part('p1', 'P1', ['c1'])]), crashes: [crash('c1', `${inPeriod}-01-01`)], selectedWorkcode: null },
    ])
    expect(rows[0].selected_work_code).toBe('')
    expect(rows[0].counted_in_selected_sii).toBe('')
  })

  it('lists every part a crash falls in, and leaves city blank when there is none', () => {
    const s = site('Corridor', [part('p1', 'Segment 1', ['c1']), part('p2', 'Segment 2', ['c1'])])
    const { rows } = rowsOf([
      { site: s, crashes: [crash('c1', `${inPeriod}-01-01`, [], { cityId: null })], selectedWorkcode: null },
    ])
    expect(rows[0].site_parts).toBe('Segment 1; Segment 2')
    expect(rows[0].city).toBe('')
  })

  it('quotes commas and quotes, and keeps user text from running as a formula', () => {
    const s = site('=HYPERLINK("x"), Main', [part('p1', '@risk, "north"', ['c1'])])
    const { rows } = rowsOf([{ site: s, crashes: [crash('c1', `${inPeriod}-01-01`)], selectedWorkcode: null }])
    expect(rows[0].site_name).toBe(`'=HYPERLINK("x"), Main`)
    expect(rows[0].site_parts).toBe(`'@risk, "north"`)
    // A negative longitude is a number, not user text, and stays unprefixed.
    expect(rows[0].longitude.startsWith('-')).toBe(true)
  })
})
