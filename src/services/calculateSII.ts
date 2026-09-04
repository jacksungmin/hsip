// TxDOT HSIP Safety Investment Index (SII) formula.
// Pure function, no state or subscriptions.

import type {
  Alternative,
  Countermeasure,
  CrashCostEntry,
  Severity,
  SeverityTriplet,
} from '../types'

const DISCOUNT_RATE = 0.06

// Service lives in the TxDOT catalog run 5-30 years. 100 is a generous
// ceiling that keeps the present-value loop bounded. Enforced here rather
// than only at the input, because session restore and dev fixtures write
// straight into projectState and never pass through the workbench input.
export const MAX_SERVICE_LIFE = 100

// Clamp to a finite integer in [0, MAX_SERVICE_LIFE]. 0 is allowed (some
// catalog rows carry no service life and parse to 0, giving B = 0); the
// point is only that the loop below cannot run unboundedly.
export function clampServiceLife(years: number): number {
  if (!Number.isFinite(years)) return 0
  return Math.min(Math.max(0, Math.floor(years)), MAX_SERVICE_LIFE)
}

type SIIInput = {
  alternative: Alternative
  countermeasure: Countermeasure
  crashCounts: SeverityTriplet
  dataYears: number
  growthRatePercent: number
  crashCostTable: CrashCostEntry[]
}

type SIIResult = {
  S: number
  Q: number
  B: number
  C: number
  SII: number | null
}

function costForSeverity(table: CrashCostEntry[], severity: Severity): number {
  const entry = table.find((e) => e.severity === severity)
  if (!entry) throw new Error(`Missing crash cost entry for severity: ${severity}`)
  return entry.dollarValue
}

export function calculateSII(input: SIIInput): SIIResult | null {
  const { alternative, countermeasure, crashCounts, dataYears, growthRatePercent, crashCostTable } = input

  const R = countermeasure.reductionFactor
  if (R === null) return null

  // Per-severity weights. TxDOT's published formula uses one combined KA
  // figure; equal K and A costs here reproduce it exactly.
  const Ck = costForSeverity(crashCostTable, 'K')
  const Ca = costForSeverity(crashCostTable, 'A')
  const Cb = costForSeverity(crashCostTable, 'B')
  const M = alternative.annualMaintenance ?? 0
  const L = clampServiceLife(alternative.serviceLife)
  const g = growthRatePercent / 100
  const d = 1 + DISCOUNT_RATE

  const weightedCrashes =
    Ck * crashCounts.K + Ca * crashCounts.A + Cb * crashCounts.B
  const S = (R * weightedCrashes) / dataYears - M

  const Q = g === 0 ? 0 : (((1 + g) ** L - 1) / L) * S

  let B = 0
  for (let i = 1; i <= L; i++) {
    B += (S + (i - 0.5) * Q) / d ** i
  }

  const C = alternative.constructionCost ?? 0
  const SII = C > 0 ? B / C : null

  return { S, Q, B, C, SII }
}
