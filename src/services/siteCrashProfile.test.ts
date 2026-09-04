// Pins the SiteCrashProfile projection (docs/06): a pure synchronous tally of
// already-loaded crash rows into KAB totals and per-HSIP-workcode counts, with
// the exposure period passed in rather than read from ambient state. The
// profile feeds the SII calculation, so dataYears must arrive from the caller's
// manifest and pass through unaltered — a profile that quietly substituted its
// own year count would scale every benefit figure downstream.

import { describe, expect, it } from 'vitest'
import { buildSiteCrashProfile } from './siteCrashProfile'

describe('buildSiteCrashProfile', () => {
  it('synchronously tallies KAB totals and HSIP workcode counts', () => {
    const profile = buildSiteCrashProfile(
      [
        { severity: 'K', HSIP_101: 1, HSIP_108: 1 },
        { severity: 'A', HSIP_101: 1 },
        { severity: 'B', HSIP_108: 1 },
      ],
      7,
    )

    expect(profile.total).toEqual({ K: 1, A: 1, B: 1 })
    expect(profile.byWorkcode['101']).toEqual({ K: 1, A: 1, B: 0 })
    expect(profile.byWorkcode['108']).toEqual({ K: 1, A: 0, B: 1 })
  })

  it('passes the caller-supplied exposure period through untouched', () => {
    const profile = buildSiteCrashProfile([{ severity: 'K' }], 6)
    expect(profile.dataYears).toBe(6)
  })
})
