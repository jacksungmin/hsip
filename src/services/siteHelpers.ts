import type { LineString, Point, Polygon } from 'geojson'
import turfBuffer from '@turf/buffer'
import { queryByIds, queryByPolygon } from './db/sqliteClient'
import type { BreakdownResult, CrashRecord, CrashRef, Site, SitePart } from '../types'
import type { PartBufferFields } from '../state/siteList.svelte'
import { dedupeCrashUnion } from './crashUnion'
import { EA_IDS } from '../data/emphasisAreas'
import { buildSiteCrashProfile, type SiteCrashProfile } from './siteCrashProfile'
import { dataManifest } from '../state/dataManifest.svelte'

export type { SiteCrashProfile } from './siteCrashProfile'

function toCrashRefs(rows: CrashRecord[]): CrashRef[] {
  return rows.map((r) => ({ id: r.id, severity: r.severity }))
}

function bufferGeometry(drawnGeometry: LineString | Point, bufferFeet: number): Polygon {
  const buffered = turfBuffer(drawnGeometry, bufferFeet, { units: 'feet' })
  if (!buffered) throw new Error('Buffer computation failed')
  return buffered.geometry as Polygon
}

// Auto part names are typed: pieces of a roadway site are "Segment N",
// point locations of an intersection site are "Intersection N". The
// word "part" never appears in the UI (issue #5, 2026-07-10).
export function partNameBase(type: 'roadway' | 'intersection'): string {
  return type === 'intersection' ? 'Intersection' : 'Segment'
}

// Lowercase member noun for running copy ("Grouped intersections...").
export function partNoun(type: 'roadway' | 'intersection'): string {
  return type === 'intersection' ? 'intersection' : 'segment'
}

// Typed member count for badges and dialogs: "3 intersections".
export function partCountLabel(type: 'roadway' | 'intersection', count: number): string {
  return `${count} ${partNoun(type)}${count === 1 ? '' : 's'}`
}

// Site type badge; "group" is an adjective for multi-part sites.
export function siteBadgeLabel(type: 'roadway' | 'intersection', partCount: number): string {
  const base = type === 'intersection' ? 'INT' : 'RDWY'
  return partCount > 1 ? `${base} GROUP` : base
}

// Buffers can differ per part, so site-level displays collapse to a
// single value when uniform and a min–max range otherwise.
export function bufferRange(site: Site): string {
  const vals = site.parts.map((p) => p.bufferFeet)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  return min === max ? `${min}` : `${min}–${max}`
}

// Old and new auto-name bases, for recognizing persisted sessions.
const AUTO_BASES = ['Part', 'Location', 'Segment', 'Intersection']

// True when a part name is an auto-generated placeholder (any era).
export function isAutoName(name: string): boolean {
  return AUTO_BASES.some((b) => new RegExp(`^${b} \\d+$`).test(name))
}

// Generic group name base for the 1→2 transition.
function groupNameBase(type: 'roadway' | 'intersection'): string {
  return type === 'intersection' ? 'Intersection group' : 'Roadway group'
}

// Next generic group name, same skip-existing logic as nextPartName.
export function nextGroupName(sites: { name: string }[], type: 'roadway' | 'intersection'): string {
  const base = groupNameBase(type)
  const taken = new Set(sites.map((s) => s.name))
  let n = 1
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

// Rename decisions when an organic append promotes a single site to a
// group. If part 1 is auto-named, its name gets the site's name and the
// site gets a generic group name. Explicit group creation bypasses this
// helper because its site and first-part names are already final.
export function singleSitePromotionRenames(
  site: Site,
  allSites: { name: string }[],
): { siteName: string; partName: string } | null {
  if (site.parts.length !== 1) return null
  const part = site.parts[0]
  if (!isAutoName(part.name)) return null
  return { siteName: nextGroupName(allSites, site.type), partName: site.name }
}

// Rename decisions when a site demotes to single-part: the survivor's
// name moves up to the site and the survivor resets to auto.
// Unconditional — a group name never outlives the group, so demote +
// later promote round-trips cleanly. Callers gate on the boundary
// (delete to 1, or group draw flow abandoned at 1).
export function demoteRenames(
  site: Site,
  survivorId: string,
): { siteName: string; partName: string } | null {
  const survivor = site.parts.find((p) => p.id === survivorId)
  if (!survivor) return null
  return { siteName: survivor.name, partName: `${partNameBase(site.type)} 1` }
}

// Next auto part name: "<base> N" from the part count, bumped past any
// existing name so deletion + re-append never duplicates a name.
export function nextPartName(parts: { name: string }[], base: string): string {
  const taken = new Set(parts.map((p) => p.name))
  let n = parts.length + 1
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

// Buffer a geometry and run the one spatial crash query it needs —
// the shared step behind part creation, buffer edits, and redraws.
async function computePartFields(drawnGeometry: LineString | Point, bufferFeet: number): Promise<PartBufferFields> {
  const bufferedGeometry = bufferGeometry(drawnGeometry, bufferFeet)
  const rows = await queryByPolygon(bufferedGeometry)
  return { drawnGeometry, bufferFeet, bufferedGeometry, crashes: toCrashRefs(rows) }
}

// Build a part from a drawn geometry. Used for the first part of a new
// site and for appended parts alike; SiteList recomputes the site union
// from stored crash refs, so unchanged parts are never requeried.
export async function createPart(input: {
  name: string
  drawnGeometry: LineString | Point
  bufferFeet: number
}): Promise<SitePart> {
  return {
    id: `part:${crypto.randomUUID()}`,
    name: input.name,
    ...(await computePartFields(input.drawnGeometry, input.bufferFeet)),
  }
}

export async function createSite(input: {
  siteName: string
  partName: string
  type: 'roadway' | 'intersection'
  drawnGeometry: LineString | Point
  bufferFeet: number
}): Promise<Site> {
  const part = await createPart({
    name: input.partName,
    drawnGeometry: input.drawnGeometry,
    bufferFeet: input.bufferFeet,
  })
  const { crashIds, crashSeverity } = dedupeCrashUnion([part.crashes])

  return {
    id: `site:${crypto.randomUUID()}`,
    name: input.siteName,
    type: input.type,
    source: 'draw' as const,
    parts: [part],
    crashIds,
    crashSeverity,
    growthRatePercent: 2,
  }
}

// Recompute one part's buffer and crash set. Only the changed part is
// queried; the caller hands the result to SiteList.updatePartBuffer,
// which recomputes the site union from stored crash refs.
export function requeryPartBuffer(part: SitePart, bufferFeet: number): Promise<PartBufferFields> {
  return computePartFields(part.drawnGeometry, bufferFeet)
}

// Recompute all parts' buffers at a uniform distance. Parallel spatial
// queries; the caller hands the result array to SiteList.updateSiteBuffer.
export function requerySiteBuffer(parts: SitePart[], bufferFeet: number): Promise<PartBufferFields[]> {
  return Promise.all(parts.map((p) => computePartFields(p.drawnGeometry, bufferFeet)))
}

// Redraw: new geometry, same buffer distance. Part id and name are
// untouched; the caller routes the result through the same
// SiteList.updatePartBuffer mutation as a buffer edit.
export function replacePartGeometry(part: SitePart, drawnGeometry: LineString | Point): Promise<PartBufferFields> {
  return computePartFields(drawnGeometry, part.bufferFeet)
}

// Crash records for a whole site, for views needing full records
// (EA/HSIP flags), which sites deliberately don't store: the planning
// panel, siteCrashProfile, and siteBreakdownByEA. Resolves the stored
// crashIds by id — the reference-resolution read the Site entity
// prescribes. Spatial queries happen only when geometry changes
// (createPart, requeryPartBuffer).
export function querySiteCrashes(site: Site): Promise<CrashRecord[]> {
  return queryByIds(site.crashIds)
}

export async function siteCrashProfile(site: Site): Promise<SiteCrashProfile> {
  const crashes = await querySiteCrashes(site)
  return buildSiteCrashProfile(crashes, dataManifest.dataYears)
}

export async function siteBreakdownByEA(site: Site): Promise<BreakdownResult> {
  const crashes = await querySiteCrashes(site)
  const counts: Record<string, number> = {}
  for (const eaId of EA_IDS) counts[eaId] = 0

  for (const crash of crashes) {
    for (const eaId of EA_IDS) {
      if ((crash as Record<string, unknown>)[eaId] === 1) counts[eaId]++
    }
  }

  return { totalCrashes: crashes.length, counts }
}
