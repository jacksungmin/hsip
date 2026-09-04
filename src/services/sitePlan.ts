import { all as allCrashCosts } from '../data/crashCostTable'
import { catalogFieldValue, getByWorkcode } from '../data/countermeasureCatalog'
import type { Alternative, ChosenAlt, SeverityTriplet, Site } from '../types'
import { calculateSII } from './calculateSII'
import type { SiteCrashProfile } from './siteCrashProfile'

export type ComputedAlternative = {
  alt: Alternative
  cmName: string
  // null when the catalog carries no real reference figure, so the UI can
  // omit the line rather than print the CSV's "0" placeholder.
  maintenanceRef: string | null
  crf: number | null
  preventable: SeverityTriplet | null
  sii: ReturnType<typeof calculateSII>
}

export function calculateSiteAlternatives(
  site: Site,
  alternatives: Alternative[],
  profile: SiteCrashProfile | null,
): ComputedAlternative[] {
  const crashCosts = allCrashCosts()

  return alternatives.map((alt) => {
    const countermeasure = getByWorkcode(alt.workcode)
    const workcodeCounts = profile?.byWorkcode[alt.workcode]
    const crf = countermeasure?.reductionFactor ?? null
    // These are raw historical counts. The reduction effect is applied when
    // the chosen snapshot is resolved and within the SII calculation.
    const preventable = profile
      ? {
          K: workcodeCounts?.K ?? 0,
          A: workcodeCounts?.A ?? 0,
          B: workcodeCounts?.B ?? 0,
        }
      : null

    const sii = countermeasure && profile
      ? calculateSII({
          alternative: alt,
          countermeasure,
          crashCounts: {
            K: workcodeCounts?.K ?? 0,
            A: workcodeCounts?.A ?? 0,
            B: workcodeCounts?.B ?? 0,
          },
          dataYears: profile.dataYears,
          growthRatePercent: site.growthRatePercent ?? 2,
          crashCostTable: crashCosts,
        })
      : null

    return {
      alt,
      cmName: countermeasure?.name ?? alt.workcode,
      maintenanceRef: catalogFieldValue(countermeasure?.maintenanceCostRef),
      crf,
      preventable,
      sii,
    }
  })
}

// Ranking comparator for alternatives: descending, nulls last, deterministic.
// Every table that ranks by SII uses this. The obvious inline form,
// (b ?? -Infinity) - (a ?? -Infinity), yields NaN when both sides are null,
// and Array.sort with a NaN-returning comparator has engine-dependent order —
// which showed up as the in-app table and the report disagreeing on sites
// where no alternative had a cost entered.
export function compareBySII(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a == null) return 1
  if (b == null) return -1
  return b - a
}

export function resolveChosenAlternative(
  rows: ComputedAlternative[],
  pinnedAlternativeId: string | null,
): ChosenAlt | null {
  let chosenRow: ComputedAlternative | null
  let source: ChosenAlt['source']

  if (pinnedAlternativeId) {
    chosenRow = rows.find((row) => row.alt.id === pinnedAlternativeId) ?? null
    source = 'explicit'
  } else {
    chosenRow = rows
      .filter((row) => row.sii?.SII != null && row.sii.SII > 0)
      .sort((a, b) => compareBySII(a.sii?.SII ?? null, b.sii?.SII ?? null))[0] ?? null
    source = 'auto'
  }

  if (!chosenRow?.preventable || chosenRow.crf == null) return null

  return {
    altId: chosenRow.alt.id,
    source,
    prevented: {
      K: chosenRow.preventable.K * chosenRow.crf,
      A: chosenRow.preventable.A * chosenRow.crf,
      B: chosenRow.preventable.B * chosenRow.crf,
    },
  }
}
