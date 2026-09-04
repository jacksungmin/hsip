// Static countermeasure catalog. Loaded from build-generated JSON
// (source: config/hsip/countermeasures.csv). Sync access only.

import rawData from './generated/countermeasures.json'
import type { Countermeasure } from '../types'
import type { HsipFlagKey } from './hsipWorkcodes'

const catalog: Countermeasure[] = rawData as Countermeasure[]
const byWorkcode = new Map<string, Countermeasure>(
  catalog.map((cm) => [cm.workcode, cm]),
)

export function list(): Countermeasure[] {
  return catalog
}

// The source CSV uses "0" as a not-applicable placeholder in free-text
// reference columns, most visibly Maintenance Cost (73 of 88 rows). Rendered
// verbatim it reads as a real figure of zero dollars. Returns null for "no
// value here" so callers can pick their own placeholder or omit the field.
// "TBD" is deliberately not treated as absent: the catalog is saying the
// value is pending, which is worth showing.
export function catalogFieldValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '' || trimmed === '0') return null
  return trimmed
}

export function getByWorkcode(workcode: string): Countermeasure | undefined {
  return byWorkcode.get(workcode)
}

// Given a set of HSIP flag keys that are active (value=1) for a crash set,
// return countermeasures whose workcode matches any active flag.
export function filterByApplicableWorkcodes(activeFlags: Set<HsipFlagKey>): Countermeasure[] {
  return catalog.filter((cm) => activeFlags.has(`HSIP_${cm.workcode}` as HsipFlagKey))
}
