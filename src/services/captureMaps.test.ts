import { describe, expect, it } from 'vitest'
import { createReportMapData, createReportMapJobs } from './captureMaps'
import type { CrashRecord, ReportPayload, Site, SitePart } from '../types'

function square(west: number, south: number, east: number, north: number) {
  return {
    type: 'Polygon' as const,
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  }
}

function makePart(
  id: string,
  bounds: [number, number, number, number],
  crashIds: string[] = [],
): SitePart {
  const [west, south, east, north] = bounds
  return {
    id,
    name: id,
    drawnGeometry: {
      type: 'Point',
      coordinates: [(west + east) / 2, (south + north) / 2],
    },
    bufferFeet: 150,
    bufferedGeometry: square(west, south, east, north),
    crashes: crashIds.map((crashId) => ({ id: crashId, severity: 'B' })),
  }
}

function makeSite(id: string, type: Site['type'], parts: SitePart[]): Site {
  return {
    id,
    name: id,
    type,
    source: 'draw',
    parts,
    crashIds: [...new Set(parts.flatMap((part) => part.crashes.map((crash) => crash.id)))],
    crashSeverity: { K: 0, A: 0, B: 0 },
  }
}

function makePayload(sites: Site[]): ReportPayload {
  return {
    generatedAt: '2026-07-17T00:00:00.000Z',
    projectInfo: {
      projectName: 'Test',
      organization: '',
      analyst: '',
      countyLocality: '',
      notes: '',
    },
    sites: sites.map((site) => ({
      site,
      crashCounts: {
        total: site.crashIds.length,
        bySeverity: { K: 0, A: 0, B: site.crashIds.length },
        byEmphasisArea: {},
      },
      alternatives: [],
    })),
    countermeasures: [],
    methods: { dataYears: 7, dataRange: '2018-2024', crashCostTable: [] },
    metadata: { buildId: 'test', appVersion: '0.0.0' },
  }
}

function makeCrash(id: string, coordinates: [number, number]): CrashRecord {
  return {
    id,
    date: '2024-01-01',
    severity: 'B',
    lon: coordinates[0],
    lat: coordinates[1],
    location: { type: 'Point', coordinates },
    countyId: '1',
    cityId: null,
  } as unknown as CrashRecord
}

const intersection = makeSite('site:int', 'intersection', [
  makePart('part:i1', [0, 0, 1, 1], ['c1']),
  makePart('part:i2', [2, 2, 3, 3]),
  makePart('part:i3', [4, 4, 5, 5], ['c2']),
])
const roadway = makeSite('site:road', 'roadway', [
  makePart('part:r1', [10, 10, 11, 11], ['c3']),
  makePart('part:r2', [11, 11, 12, 12], ['c4']),
])
const payload = makePayload([intersection, roadway])
const crashesBySite = {
  'site:int': [makeCrash('c1', [0.5, 0.5]), makeCrash('c2', [4.5, 4.5])],
  'site:road': [makeCrash('c3', [10.5, 10.5]), makeCrash('c4', [11.5, 11.5])],
}

describe('report map capture planning', () => {
  it('returns no jobs for a report with no sites', () => {
    expect(createReportMapJobs(makePayload([]))).toEqual([])
  })

  it('orders overview, site, and part jobs and uses type-specific part sizes', () => {
    const jobs = createReportMapJobs(payload)
    expect(jobs.map((job) => job.kind)).toEqual([
      'overview',
      'site', 'site-part', 'site-part', 'site-part',
      'site', 'site-part', 'site-part',
    ])
    expect(jobs[3]).toMatchObject({ siteId: 'site:int', partId: 'part:i2', width: 300, height: 126 })
    expect(jobs[6]).toMatchObject({ siteId: 'site:road', partId: 'part:r1', width: 600, height: 300 })
  })

  it('builds overview footprints, ordered labels, and combined bounds without crashes', () => {
    const overview = createReportMapData(payload, crashesBySite, createReportMapJobs(payload)[0])
    expect(overview.geometries.features).toHaveLength(5)
    expect(overview.crashes.features).toHaveLength(0)
    expect(overview.labels).toEqual([
      { coordinates: [0.5, 0.5], text: 'S1' },
      { coordinates: [2.5, 2.5], text: 'S1' },
      { coordinates: [4.5, 4.5], text: 'S1' },
      { coordinates: [10.5, 10.5], text: 'S2' },
      { coordinates: [11.5, 11.5], text: 'S2' },
    ])
    expect(overview.bounds).toEqual([0, 0, 12, 12])
  })

  it('includes the full site crash union on a site map', () => {
    const siteJob = createReportMapJobs(payload).find(
      (job) => job.kind === 'site' && job.siteId === 'site:int',
    )!
    const data = createReportMapData(payload, crashesBySite, siteJob)
    expect(data.crashes.features.map((feature) => feature.properties?.severity)).toEqual(['B', 'B'])
    expect(data.bounds).toEqual([0, 0, 5, 5])
  })

  it('filters a part map to that part crash set', () => {
    const partJob = createReportMapJobs(payload).find(
      (job) => job.kind === 'site-part' && job.partId === 'part:i3',
    )!
    const data = createReportMapData(payload, crashesBySite, partJob)
    expect(data.geometries.features).toHaveLength(1)
    expect(data.crashes.features).toHaveLength(1)
    expect(data.crashes.features[0].geometry.coordinates).toEqual([4.5, 4.5])
    expect(data.bounds).toEqual([4, 4, 5, 5])
  })
})
