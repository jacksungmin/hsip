// Pure crash-set math shared by siteHelpers (query side) and SiteList
// (store-side union recompute). No IO imports: the store can use it
// without a dependency cycle, and tests need no worker mocking.

import type { CrashRef, SeverityTriplet, Site, SitePart } from '../types'
import { inHsipPeriod } from '../data/hsipProgram'

export function tallySeverity(crashes: { severity: string }[]): SeverityTriplet {
  const t: SeverityTriplet = { K: 0, A: 0, B: 0 }
  for (const c of crashes) {
    if (c.severity === 'K') t.K++
    else if (c.severity === 'A') t.A++
    else if (c.severity === 'B') t.B++
  }
  return t
}

// Deduped union of per-part crash sets: a crash inside two overlapping
// part buffers counts once. First occurrence wins; the severity tally
// comes from the deduped set.
export function dedupeCrashUnion<T extends { id: string; severity: string }>(
  rowsPerPart: T[][],
): { records: T[]; crashIds: string[]; crashSeverity: SeverityTriplet } {
  const byId = new Map<string, T>()
  for (const rows of rowsPerPart) {
    for (const r of rows) {
      if (!byId.has(r.id)) byId.set(r.id, r)
    }
  }
  const records = [...byId.values()]
  return { records, crashIds: records.map((r) => r.id), crashSeverity: tallySeverity(records) }
}

// The site's crashes inside the SII analysis period: the deduped union
// across parts, filtered by crash year. This is the crash set planning
// counts (crash history, countermeasure benefits, the report); the site's
// crashIds/crashSeverity stay the full history diagnosis shows. A ref
// without a year (a session captured before refs carried one) is outside
// the period rather than guessed into it.
export function hsipPeriodCrashes(site: Site): { refs: CrashRef[]; severity: SeverityTriplet } {
  const { records } = dedupeCrashUnion(site.parts.map((part) => part.crashes))
  const refs = records.filter((r) => inHsipPeriod(r.year))
  return { refs, severity: tallySeverity(refs) }
}

// Project a site with a replacement part list and its matching deduped
// crash union. Shared by SiteList mutations and the buffer-edit workflow,
// which evaluates the next crash profile before committing state.
export function withSiteParts(site: Site, parts: SitePart[]): Site {
  const { crashIds, crashSeverity } = dedupeCrashUnion(parts.map((part) => part.crashes))
  return { ...site, parts, crashIds, crashSeverity }
}

// One site per part: breaks a group into individual sites, each named after
// its part and analyzed on its own crash set. Used to split an existing
// group and to create separate sites from an uploaded file. Site-level
// assumptions that describe the location (growth rate, owner, functional
// class) carry over; the group's description does not, since it described
// the group. Planning work (alternatives) is the caller's to settle: it was
// costed for the group as a whole and cannot be divided.
export function splitSiteIntoSites(site: Site): Site[] {
  return site.parts.map((part) =>
    withSiteParts(
      {
        id: `site:${crypto.randomUUID()}`,
        name: part.name,
        type: site.type,
        source: site.source,
        parts: [],
        crashIds: [],
        crashSeverity: { K: 0, A: 0, B: 0 },
        ...(site.growthRatePercent !== undefined ? { growthRatePercent: site.growthRatePercent } : {}),
        ...(site.owner !== undefined ? { owner: site.owner } : {}),
        ...(site.functionalClass !== undefined ? { functionalClass: site.functionalClass } : {}),
      },
      [part],
    ),
  )
}
