// TxDOT HSIP program-call settings, authored in config/hsip/hsip_program.yaml
// and validated into JSON at build time by vite-plugin-csv-config.
//
// The SII analysis period is the set of crash years planning counts: the
// site crash history in planning mode, every countermeasure benefit, and the
// report. Diagnosis mode and the map keep the full crash history the data
// build published (dataManifest.dataRange). Both periods are shown wherever
// they could be confused, so a count never appears without its years.

import program from './generated/hsip-program.json'

// The guidelines edition the criteria, reduction factors and crash costs
// follow, e.g. "2027 TxDOT HSIP Guidelines". Printed on the report.
export const HSIP_GUIDELINES: string = program.guidelines

// Consecutive, oldest first; checked by the build plugin and again against
// the published crash years at startup (dataManifest.load).
export const HSIP_PERIOD_YEARS: readonly number[] = Object.freeze([...program.analysisYears])

// Exposure period for the SII benefit calculation: S divides by this.
export const HSIP_PERIOD_LENGTH = HSIP_PERIOD_YEARS.length

// Display label, e.g. "2023-2025", or "2025" for a single year.
export const HSIP_PERIOD_LABEL =
  HSIP_PERIOD_LENGTH === 1
    ? String(HSIP_PERIOD_YEARS[0])
    : `${HSIP_PERIOD_YEARS[0]}-${HSIP_PERIOD_YEARS[HSIP_PERIOD_LENGTH - 1]}`

const periodSet = new Set(HSIP_PERIOD_YEARS)

export function inHsipPeriod(year: number | undefined): boolean {
  return year !== undefined && periodSet.has(year)
}

// Year of a crash from its ISO date ("2024-03-17"), the form the crash
// database stores.
export function crashYear(date: string): number {
  return Number(date.slice(0, 4))
}
