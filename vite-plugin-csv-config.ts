// Vite plugin: reads config/hsip CSVs at build start, writes JSON to
// src/data/generated/. During dev, watches CSV files and re-generates
// on change. The generated JSON files are gitignored.

import { readFileSync, writeFileSync, mkdirSync, existsSync, watchFile, unwatchFile } from 'node:fs'
import { resolve, join } from 'node:path'
import Papa from 'papaparse'
import type { Plugin } from 'vite'

const CONFIG_DIR = resolve('config/hsip')
const OUT_DIR = resolve('src/data/generated')

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

function generate(): void {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const countermeasures = buildCountermeasures()
  const crashCosts = buildCrashCosts()
  writeFileSync(
    join(OUT_DIR, 'countermeasures.json'),
    JSON.stringify(countermeasures, null, 2) + '\n',
  )
  writeFileSync(
    join(OUT_DIR, 'crash-costs.json'),
    JSON.stringify(crashCosts, null, 2) + '\n',
  )
  console.log(
    `[csv-config] generated ${countermeasures.length} countermeasures, ${crashCosts.length} crash cost entries`,
  )
}

export function csvConfigPlugin(): Plugin {
  const csvFiles = [
    join(CONFIG_DIR, 'countermeasures.csv'),
    join(CONFIG_DIR, 'crash_costs.csv'),
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
          generate()
        })
      }

      return () => {
        for (const file of csvFiles) unwatchFile(file)
      }
    },
  }
}
