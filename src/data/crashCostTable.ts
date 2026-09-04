// Static crash cost table. One entry per severity level (K, A, B) from TxDOT.
// Loaded from build-generated JSON (source: config/hsip/crash_costs.csv).

import rawData from './generated/crash-costs.json'
import type { Severity, CrashCostEntry } from '../types'

const entries: CrashCostEntry[] = rawData as CrashCostEntry[]
const bySeverity = new Map<Severity, number>(
  entries.map((e) => [e.severity, e.dollarValue]),
)

export function get(severity: Severity): number {
  const value = bySeverity.get(severity)
  if (value === undefined) throw new Error(`Unknown severity: ${severity}`)
  return value
}

export function all(): CrashCostEntry[] {
  return entries
}
