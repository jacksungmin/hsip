// Vite plugin: reads the config/hsip CSVs and hsip_program.yaml at build
// start, writes JSON to src/data/generated/. During dev, watches those files
// and re-generates on change. The generated JSON files are gitignored.
//
// It also cross-checks config/hsip against the crash data the data build
// published (public/manifest.json), so two mistakes that otherwise produce
// plausible wrong numbers fail the build instead:
//   - a work-code list that differs from the one the database was packed with
//     (each crash's HSIP flags are bits read by position in this list), and
//   - an SII analysis year the published crash data does not contain.
// The app repeats both checks at startup (src/state/dataManifest.svelte.ts)
// for data swapped in after the app was built.

import { readFileSync, writeFileSync, mkdirSync, existsSync, watchFile, unwatchFile } from 'node:fs'
import { resolve, join } from 'node:path'
import Papa from 'papaparse'
import { load as loadYaml } from 'js-yaml'
import type { Plugin } from 'vite'

const CONFIG_DIR = resolve('config/hsip')
const OUT_DIR = resolve('src/data/generated')
const PROGRAM_FILE = join(CONFIG_DIR, 'hsip_program.yaml')
const MANIFEST_FILE = resolve('public/manifest.json')

function fail(where: string, message: string): never {
  throw new Error(`[csv-config] ${where}: ${message}`)
}

function readCsv(filename: string): Record<string, string>[] {
  const text = readFileSync(join(CONFIG_DIR, filename), 'utf-8')
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })
  if (result.errors.length > 0) {
    throw new Error(`CSV parse errors in ${filename}: ${JSON.stringify(result.errors)}`)
  }
  return result.data
}

type CountermeasureJson = {
  workcode: string
  name: string
  definition: string
  emphasisAreas: string[]
  facilitySubset: string | null
  typeOfWork: string
  reductionFactor: number | null
  serviceLife: number
  maintenanceCostRef: string
  subGroup: string
  additionalDocs: string | null
}

type CrashCostJson = {
  severity: string
  label: string
  dollarValue: number
}

function buildCountermeasures(): CountermeasureJson[] {
  const rows = readCsv('countermeasures.csv')
  const result: CountermeasureJson[] = []
  for (const row of rows) {
    const code = (row['Work Code'] ?? '').trim()
    if (!code.match(/^\d+$/)) continue
    const eas = [row['Emphasis Area_1'], row['Emphasis Area_2'], row['Emphasis Area_3']]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
    const rfRaw = (row['Reduction Factor'] ?? '').trim()
    const rf = rfRaw === 'TBD' ? null : Number(rfRaw)
    result.push({
      workcode: code,
      name: (row['Description'] ?? '').trim(),
      definition: (row['Definition'] ?? '').trim(),
      emphasisAreas: eas,
      facilitySubset: (row['Facility Subset'] ?? '').trim() || null,
      typeOfWork: (row['Type of Work'] ?? '').trim(),
      reductionFactor: rf,
      serviceLife: Number((row['Service Life'] ?? '0').trim()),
      maintenanceCostRef: (row['Maintenance Cost'] ?? '').trim(),
      subGroup: (row['SubGroup'] ?? '').trim(),
      additionalDocs: (row['Additional Docs'] ?? '').trim() || null,
    })
  }
  return result
}

function buildCrashCosts(): CrashCostJson[] {
  const rows = readCsv('crash_costs.csv')
  return rows
    .filter((row) => (row['Severity'] ?? '').trim())
    .map((row) => ({
      severity: row['Severity'].trim(),
      label: row['Label'].trim(),
      dollarValue: Number(row['Cost'].trim()),
    }))
}

type HsipProgramJson = {
  guidelines: string
  analysisYears: number[]
}

function buildHsipProgram(): HsipProgramJson {
  const where = 'config/hsip/hsip_program.yaml'
  const doc = loadYaml(readFileSync(PROGRAM_FILE, 'utf-8'))
  if (doc === null || typeof doc !== 'object') fail(where, 'file is empty or not a mapping')
  const raw = doc as Record<string, unknown>

  const guidelines = raw.guidelines
  if (typeof guidelines !== 'string' || guidelines.trim() === '') {
    fail(where, '`guidelines` is required and must be a non-empty string')
  }

  const years = raw.analysisYears
  if (!Array.isArray(years) || years.length === 0) {
    fail(where, '`analysisYears` is required and must be a non-empty list, e.g. [2023, 2024, 2025]')
  }
  if (!years.every((y): y is number => typeof y === 'number' && Number.isInteger(y))) {
    fail(where, '`analysisYears` must contain only whole years, unquoted')
  }
  // Consecutive and ascending: a typo such as [2023, 2025] would otherwise
  // divide by 2 and quietly drop a year from every SII.
  for (let i = 1; i < years.length; i++) {
    if (years[i] !== years[i - 1] + 1) {
      fail(where, `\`analysisYears\` must be consecutive years, oldest first (got ${JSON.stringify(years)})`)
    }
  }
  return { guidelines: guidelines.trim(), analysisYears: years }
}

// Same derivation as the data build's derive_hsip_fields: one flag per
// work code, in CSV row order.
function hsipFieldsFor(countermeasures: CountermeasureJson[]): string[] {
  return countermeasures.map((cm) => `HSIP_${cm.workcode}`)
}

function crossCheckManifest(hsipFields: string[], program: HsipProgramJson): void {
  if (!existsSync(MANIFEST_FILE)) {
    console.warn('[csv-config] no public/manifest.json; skipped crash-data checks')
    return
  }
  const where = 'public/manifest.json'
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf-8'))
  const crashData = manifest.crashData ?? {}
  const rebuild = 'Rebuild the crash data (tools/data-build: python build.py --only crashes).'

  const published: unknown = crashData.hsipFields
  if (!Array.isArray(published)) {
    fail(where, `the crash data does not record its work-code layout (built before manifest v4). ${rebuild}`)
  }
  const first = hsipFields.findIndex((f, i) => published[i] !== f)
  if (first !== -1 || published.length !== hsipFields.length) {
    const at = first !== -1 ? first : Math.min(published.length, hsipFields.length)
    fail(
      where,
      `the crash database was built for a different work-code list than config/hsip/countermeasures.csv ` +
        `(${published.length} vs ${hsipFields.length} codes; first difference at position ${at + 1}: ` +
        `database ${String(published[at] ?? 'none')}, CSV ${hsipFields[at] ?? 'none'}). ` +
        `Each crash's work-code flags are read by position, so this would credit countermeasures ` +
        `with the wrong crashes. ${rebuild}`,
    )
  }

  const years: unknown = crashData.years
  const have = new Set(Array.isArray(years) ? years : [])
  const missing = program.analysisYears.filter((y) => !have.has(y))
  if (missing.length > 0) {
    fail(
      'config/hsip/hsip_program.yaml',
      `analysisYears ${JSON.stringify(missing)} are not in the published crash data ` +
        `(${JSON.stringify(years)}). Publish crash data for those years or change analysisYears.`,
    )
  }
}

function generate(): void {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const countermeasures = buildCountermeasures()
  const crashCosts = buildCrashCosts()
  const program = buildHsipProgram()
  crossCheckManifest(hsipFieldsFor(countermeasures), program)
  writeFileSync(
    join(OUT_DIR, 'countermeasures.json'),
    JSON.stringify(countermeasures, null, 2) + '\n',
  )
  writeFileSync(
    join(OUT_DIR, 'crash-costs.json'),
    JSON.stringify(crashCosts, null, 2) + '\n',
  )
  writeFileSync(
    join(OUT_DIR, 'hsip-program.json'),
    JSON.stringify(program, null, 2) + '\n',
  )
  const yrs = program.analysisYears
  console.log(
    `[csv-config] generated ${countermeasures.length} countermeasures, ${crashCosts.length} crash cost entries, ` +
      `SII period ${yrs[0]}-${yrs[yrs.length - 1]}`,
  )
}

export function csvConfigPlugin(): Plugin {
  const csvFiles = [
    join(CONFIG_DIR, 'countermeasures.csv'),
    join(CONFIG_DIR, 'crash_costs.csv'),
    PROGRAM_FILE,
  ]

  return {
    name: 'csv-config',

    buildStart() {
      generate()
    },

    configureServer() {
      for (const file of csvFiles) {
        watchFile(file, { interval: 1000 }, () => {
          console.log(`[csv-config] ${file} changed, regenerating...`)
          try {
            generate()
          } catch (error) {
            // Keep the dev server alive so the next save can fix the file.
            console.error((error as Error).message)
          }
        })
      }

      return () => {
        for (const file of csvFiles) unwatchFile(file)
      }
    },
  }
}
