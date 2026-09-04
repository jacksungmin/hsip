import { HSIP_FIELDS, type HsipFlagKey } from '../data/hsipWorkcodes'
import type { CrashRecord, Severity, SeverityTriplet } from '../types'

export type SiteCrashProfile = {
  total: SeverityTriplet
  byWorkcode: Record<string, SeverityTriplet>
  dataYears: number
}

type ProfileCrash = Pick<CrashRecord, 'severity'> & Partial<Record<HsipFlagKey, 0 | 1>>

function incrementSeverity(counts: SeverityTriplet, severity: Severity): void {
  if (severity === 'K') counts.K++
  else if (severity === 'A') counts.A++
  else if (severity === 'B') counts.B++
}

// Synchronous projection of already-loaded crash rows. Database access stays
// at the caller, allowing buffer edits to query once and immediately refresh
// planning metrics from the same crash set. `dataYears` is passed in for the
// same reason: it is provenance of the published data, read from the manifest
// by the caller, and this function stays a pure projection with no ambient
// dependency on which data set happens to be loaded.
export function buildSiteCrashProfile(
  crashes: ProfileCrash[],
  dataYears: number,
): SiteCrashProfile {
  const total: SeverityTriplet = { K: 0, A: 0, B: 0 }
  const byWorkcode: Record<string, SeverityTriplet> = {}

  for (const crash of crashes) {
    incrementSeverity(total, crash.severity)

    for (const field of HSIP_FIELDS) {
      if (crash[field] !== 1) continue
      const workcode = field.slice(5)
      byWorkcode[workcode] ??= { K: 0, A: 0, B: 0 }
      incrementSeverity(byWorkcode[workcode], crash.severity)
    }
  }

  return { total, byWorkcode, dataYears }
}
