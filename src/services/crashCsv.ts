// Pure builder for the crash-level CSV export (see crashExport.ts for the
// store-driven download). Kept free of stores and the database so it can be
// tested directly.
//
// One row per crash per site (a crash inside two sites appears under each),
// all years the data holds, with a column marking the SII analysis period so
// the HSIP subset is one filter away.

import type { CrashRecord, Site } from '../types'
import { EA_IDS, EA_LABELS } from '../data/emphasisAreas'
import { HSIP_FIELDS } from '../data/hsipWorkcodes'
import { crashYear, inHsipPeriod } from '../data/hsipProgram'

export type CrashExportSite = {
  site: Site
  crashes: CrashRecord[] // all years, as querySiteCrashes returns them
  selectedWorkcode: string | null // the chosen alternative's work code
}

export type CrashExportInput = {
  sites: CrashExportSite[]
  countyNames: Record<string, string> // county id -> name
  cityNames: Record<string, string> // city id -> name
}

export const CRASH_CSV_COLUMNS = [
  'site_name',
  'site_type',
  'site_parts',
  'crash_id',
  'crash_date',
  'crash_year',
  'severity',
  'in_sii_period',
  'latitude',
  'longitude',
  'county',
  'city',
  'emphasis_areas',
  'preventable_work_codes',
  'selected_work_code',
  'counted_in_selected_sii',
] as const

// RFC 4180 quoting: a field with a comma, quote or line break is quoted,
// with inner quotes doubled.
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

// Site and part names are typed or uploaded by users. A spreadsheet runs a
// cell starting with = + - @ as a formula, so such text gets a leading
// apostrophe and stays text. Applied only to user-entered text: numbers such
// as a negative longitude must stay numbers.
function userText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

const yesNo = (b: boolean) => (b ? 'Yes' : 'No')

export function buildCrashCsv(input: CrashExportInput): string {
  const lines: string[] = [CRASH_CSV_COLUMNS.join(',')]

  for (const { site, crashes, selectedWorkcode } of input.sites) {
    // Which of the site's parts each crash lies in (a crash inside two
    // overlapping part buffers belongs to both).
    const partsByCrash = new Map<string, string[]>()
    for (const part of site.parts) {
      for (const ref of part.crashes) {
        const names = partsByCrash.get(ref.id) ?? []
        names.push(part.name)
        partsByCrash.set(ref.id, names)
      }
    }

    const sorted = [...crashes].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    for (const crash of sorted) {
      const flags = crash as Record<string, unknown>
      const eas = EA_IDS.filter((id) => flags[id] === 1).map((id) => EA_LABELS[id])
      const codes = HSIP_FIELDS.filter((f) => flags[f] === 1).map((f) => f.slice(5))
      const inPeriod = inHsipPeriod(crashYear(crash.date))
      const row = [
        userText(site.name),
        site.type,
        userText((partsByCrash.get(crash.id) ?? []).join('; ')),
        crash.id,
        crash.date,
        String(crashYear(crash.date)),
        crash.severity,
        yesNo(inPeriod),
        crash.lat.toFixed(6),
        crash.lon.toFixed(6),
        input.countyNames[crash.countyId] ?? crash.countyId,
        crash.cityId ? (input.cityNames[crash.cityId] ?? crash.cityId) : '',
        eas.join('; '),
        codes.join('; '),
        selectedWorkcode ?? '',
        // Yes only for crashes the selected countermeasure's SII counts: its
        // criteria match AND the crash is in the analysis period. So these
        // rows add up to the report's preventable figures and Appendix C;
        // preventable_work_codes shows criteria matches in every year.
        selectedWorkcode ? yesNo(inPeriod && codes.includes(selectedWorkcode)) : '',
      ]
      lines.push(row.map(csvField).join(','))
    }
  }

  // CRLF per RFC 4180; Excel and other tools read it as expected.
  return lines.join('\r\n') + '\r\n'
}
