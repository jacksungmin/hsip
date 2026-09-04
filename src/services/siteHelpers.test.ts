// Pins site/part naming transitions (docs/06 Site/SitePart) and the
// querySiteCrashes read contract: views resolve stored crashIds by id
// (reference resolution per docs/06 Site), never by spatial requery.
// Crash-union math is pinned separately in crashUnion.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Point, Polygon } from 'geojson'
import type { CrashRecord, Site, SitePart } from '../types'

// sqliteClient spawns its worker at import time, which node lacks; the
// mock also lets tests observe which query path is taken.
vi.mock('./db/sqliteClient', () => ({ queryByPolygon: vi.fn(), queryByIds: vi.fn() }))

import { queryByIds, queryByPolygon } from './db/sqliteClient'
import { bufferRange, createSite, demoteRenames, isAutoName, nextGroupName, nextPartName, partCountLabel, partNameBase, querySiteCrashes, singleSitePromotionRenames, siteBadgeLabel, siteBreakdownByEA } from './siteHelpers'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('partNameBase', () => {
  it('names roadway parts "Segment" and intersection parts "Intersection"', () => {
    expect(partNameBase('roadway')).toBe('Segment')
    expect(partNameBase('intersection')).toBe('Intersection')
  })
})

describe('nextPartName', () => {
  it('numbers from the part count with the given base', () => {
    expect(nextPartName([{ name: 'Segment 1' }], 'Segment')).toBe('Segment 2')
    expect(nextPartName([{ name: 'Intersection 1' }], 'Intersection')).toBe('Intersection 2')
  })

  it('skips names still in use after deletions', () => {
    // "Segment 2" deleted from a 3-part site, then a part appended:
    // count-based numbering alone would duplicate "Segment 3".
    expect(nextPartName([{ name: 'Segment 1' }, { name: 'Segment 3' }], 'Segment')).toBe('Segment 4')
  })

  it('ignores user-renamed parts', () => {
    expect(nextPartName([{ name: 'Main St leg' }, { name: 'Oak Ave leg' }], 'Segment')).toBe('Segment 3')
  })
})

describe('typed UI labels', () => {
  it('partCountLabel pluralizes the typed member noun', () => {
    expect(partCountLabel('intersection', 1)).toBe('1 intersection')
    expect(partCountLabel('intersection', 3)).toBe('3 intersections')
    expect(partCountLabel('roadway', 2)).toBe('2 segments')
  })

  it('siteBadgeLabel appends GROUP only at 2+ parts', () => {
    expect(siteBadgeLabel('intersection', 1)).toBe('INT')
    expect(siteBadgeLabel('intersection', 2)).toBe('INT GROUP')
    expect(siteBadgeLabel('roadway', 1)).toBe('RDWY')
    expect(siteBadgeLabel('roadway', 3)).toBe('RDWY GROUP')
  })

  it('bufferRange collapses uniform buffers and ranges mixed ones', () => {
    expect(bufferRange({ parts: [{ bufferFeet: 300 }, { bufferFeet: 300 }] } as Site)).toBe('300')
    expect(bufferRange({ parts: [{ bufferFeet: 250 }, { bufferFeet: 500 }] } as Site)).toBe('250–500')
  })
})

describe('isAutoName', () => {
  it('recognizes current and legacy auto bases', () => {
    expect(isAutoName('Segment 1')).toBe(true)
    expect(isAutoName('Intersection 3')).toBe(true)
    expect(isAutoName('Part 1')).toBe(true)
    expect(isAutoName('Location 2')).toBe(true)
  })

  it('rejects user-typed names', () => {
    expect(isAutoName('Main St @ 5th')).toBe(false)
    expect(isAutoName('Part')).toBe(false)
    expect(isAutoName('Segment')).toBe(false)
    expect(isAutoName('')).toBe(false)
  })
})

describe('nextGroupName', () => {
  it('numbers from 1 and skips existing', () => {
    expect(nextGroupName([], 'intersection')).toBe('Intersection group 1')
    expect(nextGroupName([{ name: 'Intersection group 1' }], 'intersection')).toBe('Intersection group 2')
    expect(nextGroupName([], 'roadway')).toBe('Roadway group 1')
  })
})

describe('createSite', () => {
  it('preserves independent site and first-part names', async () => {
    vi.mocked(queryByPolygon).mockResolvedValue([])

    const site = await createSite({
      siteName: 'Priority intersection group',
      partName: 'Main at First',
      type: 'intersection',
      drawnGeometry: point,
      bufferFeet: 150,
    })

    expect(site.name).toBe('Priority intersection group')
    expect(site.parts[0].name).toBe('Main at First')
  })
})

describe('singleSitePromotionRenames', () => {
  it('seeds part name from site name when part is auto-named', () => {
    const site: Site = {
      id: 's1', name: 'Main @ 5th', type: 'intersection', source: 'draw',
      parts: [{ ...makePart('p1'), name: 'Intersection 1' }],
      crashIds: [], crashSeverity: { K: 0, A: 0, B: 0 },
    }
    const result = singleSitePromotionRenames(site, [site])
    expect(result).toEqual({ siteName: 'Intersection group 1', partName: 'Main @ 5th' })
  })

  it('returns null when part is user-named', () => {
    const site: Site = {
      id: 's1', name: 'Low light intersections', type: 'intersection', source: 'draw',
      parts: [{ ...makePart('p1'), name: '5th @ Main' }],
      crashIds: [], crashSeverity: { K: 0, A: 0, B: 0 },
    }
    expect(singleSitePromotionRenames(site, [site])).toBeNull()
  })

  it('returns null for multi-part sites', () => {
    const site: Site = {
      id: 's1', name: 'group', type: 'roadway', source: 'draw',
      parts: [makePart('p1'), makePart('p2')],
      crashIds: [], crashSeverity: { K: 0, A: 0, B: 0 },
    }
    expect(singleSitePromotionRenames(site, [site])).toBeNull()
  })
})

describe('demoteRenames', () => {
  it('transfers survivor name up and resets survivor to auto', () => {
    const site: Site = {
      id: 's1', name: 'Low light intersections', type: 'intersection', source: 'draw',
      parts: [{ ...makePart('p1'), name: '5th @ Main' }, { ...makePart('p2'), name: 'Elm @ 12th' }],
      crashIds: [], crashSeverity: { K: 0, A: 0, B: 0 },
    }
    expect(demoteRenames(site, 'p1')).toEqual({ siteName: '5th @ Main', partName: 'Intersection 1' })
  })

  it('transfers unconditionally so a group name never lingers on a single', () => {
    // Auto-named survivor: old rule kept "Intersection group 1" as the
    // site name, which a later append then shoved onto part 1.
    const site: Site = {
      id: 's1', name: 'Intersection group 1', type: 'intersection', source: 'draw',
      parts: [{ ...makePart('p1'), name: 'Intersection 1' }, { ...makePart('p2'), name: 'Intersection 2' }],
      crashIds: [], crashSeverity: { K: 0, A: 0, B: 0 },
    }
    expect(demoteRenames(site, 'p1')).toEqual({ siteName: 'Intersection 1', partName: 'Intersection 1' })
  })

  it('serves the abandoned group flow (single-part site)', () => {
    const site: Site = {
      id: 's1', name: 'Roadway group 1', type: 'roadway', source: 'draw',
      parts: [{ ...makePart('p1'), name: 'Segment 1' }],
      crashIds: [], crashSeverity: { K: 0, A: 0, B: 0 },
    }
    expect(demoteRenames(site, 'p1')).toEqual({ siteName: 'Segment 1', partName: 'Segment 1' })
  })

  it('round-trips: demote then promote matches an uninterrupted group flow', () => {
    // Group flow abandoned at one part, demoted, then appended later:
    // the promote must regenerate the same group/part naming the
    // uninterrupted flow would have produced.
    const site: Site = {
      id: 's1', name: 'Intersection group 1', type: 'intersection', source: 'draw',
      parts: [{ ...makePart('p1'), name: 'Intersection 1' }],
      crashIds: [], crashSeverity: { K: 0, A: 0, B: 0 },
    }
    const demoted = demoteRenames(site, 'p1')!
    const after: Site = {
      ...site,
      name: demoted.siteName,
      parts: [{ ...site.parts[0], name: demoted.partName }],
    }
    expect(singleSitePromotionRenames(after, [after])).toEqual({ siteName: 'Intersection group 1', partName: 'Intersection 1' })
  })

  it('returns null for an unknown survivor id', () => {
    const site: Site = {
      id: 's1', name: 'group', type: 'roadway', source: 'draw',
      parts: [{ ...makePart('p1'), name: 'Seg A' }],
      crashIds: [], crashSeverity: { K: 0, A: 0, B: 0 },
    }
    expect(demoteRenames(site, 'nope')).toBeNull()
  })
})

const square: Polygon = {
  type: 'Polygon',
  coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
}
const point: Point = { type: 'Point', coordinates: [0.5, 0.5] }

function makePart(id: string): SitePart {
  return {
    id,
    name: id,
    drawnGeometry: point,
    bufferFeet: 150,
    bufferedGeometry: square,
    crashes: [],
  }
}

function makeSite(parts: SitePart[], crashIds: string[]): Site {
  return {
    id: 's1',
    name: 's1',
    type: 'intersection',
    source: 'draw',
    parts,
    crashIds,
    crashSeverity: { K: 0, A: 0, B: 0 },
  }
}

describe('querySiteCrashes', () => {
  it('resolves the stored crash ids and runs no spatial query', async () => {
    const rows = [{ id: 'c1', severity: 'K' }, { id: 'c2', severity: 'B' }] as CrashRecord[]
    vi.mocked(queryByIds).mockResolvedValue(rows)
    const site = makeSite([makePart('p1'), makePart('p2')], ['c1', 'c2'])
    const result = await querySiteCrashes(site)
    expect(vi.mocked(queryByIds)).toHaveBeenCalledWith(['c1', 'c2'])
    expect(result).toBe(rows)
    expect(vi.mocked(queryByPolygon)).not.toHaveBeenCalled()
  })
})

describe('siteBreakdownByEA', () => {
  it('counts each EA flag across the stored site crash set', async () => {
    vi.mocked(queryByIds).mockResolvedValue([
      { id: 'c1', severity: 'K', EA_01_Speed: 1, EA_08_Ped: 1 },
      { id: 'c2', severity: 'B', EA_01_Speed: 1, EA_08_Ped: 0 },
    ] as unknown as CrashRecord[])
    const site = makeSite([makePart('p1')], ['c1', 'c2'])

    const result = await siteBreakdownByEA(site)

    expect(result.totalCrashes).toBe(2)
    expect(result.counts.EA_01_Speed).toBe(2)
    expect(result.counts.EA_08_Ped).toBe(1)
    expect(vi.mocked(queryByIds)).toHaveBeenCalledWith(['c1', 'c2'])
    expect(vi.mocked(queryByPolygon)).not.toHaveBeenCalled()
  })
})
