// Assembles a ReportPayload from app state. Pure function: all
// dependencies injected so this is testable without stores or workers.

import { EA_IDS } from '../data/emphasisAreas'
import { HSIP_FIELDS } from '../data/hsipWorkcodes'
import { calculateSII } from './calculateSII'
import type {
  Alternative,
  ChosenAlt,
  Countermeasure,
  CrashCostEntry,
  CrashRecord,
  ProjectInfo,
  ReportPayload,
  ReportCrashRef,
  ReportSiteBlock,
  Site,
  SeverityTriplet,
} from '../types'

export type AssembleReportInput = {
  sites: Site[]
  alternatives: Alternative[]
  chosenBySite: Record<string, ChosenAlt>
  crashesBySite: Record<string, CrashRecord[]>
  countermeasureCatalog: Countermeasure[]
  crashCostTable: CrashCostEntry[]
  projectInfo: ProjectInfo
  // crashesBySite must hold only crashes inside this period; see
  // ReportPayload['methods'].
  analysisYears: number
  analysisRange: string
  historyRange: string
  guidelines: string
  buildId: string
  appVersion: string
}

const ZERO: SeverityTriplet = { K: 0, A: 0, B: 0 }

function incrementSeverity(counts: SeverityTriplet, severity: string): void {
  if (severity === 'K') counts.K++
  else if (severity === 'A') counts.A++
  else if (severity === 'B') counts.B++
}

function countBySeverity(crashes: CrashRecord[]): SeverityTriplet {
  const counts = { ...ZERO }
  for (const c of crashes) incrementSeverity(counts, c.severity)
  return counts
}

function countByEA(crashes: CrashRecord[]): Record<string, SeverityTriplet> {
  const counts: Record<string, SeverityTriplet> = {}
  for (const eaId of EA_IDS) counts[eaId] = { ...ZERO }
  for (const crash of crashes) {
    for (const eaId of EA_IDS) {
      if ((crash as Record<string, unknown>)[eaId] === 1) {
        incrementSeverity(counts[eaId], crash.severity)
      }
    }
  }
  return counts
}

function buildSiteBlock(
  site: Site,
  crashes: CrashRecord[],
  siteAlts: Alternative[],
  chosen: ChosenAlt,
  catalogByWorkcode: Map<string, Countermeasure>,
  crashCostTable: CrashCostEntry[],
  dataYears: number,
): ReportSiteBlock {
  const bySeverity = countBySeverity(crashes)
  const byEmphasisArea = countByEA(crashes)

  const byWorkcode: Record<string, SeverityTriplet> = {}
  for (const crash of crashes) {
    for (const field of HSIP_FIELDS) {
      if ((crash as Record<string, unknown>)[field] !== 1) continue
      const wc = field.slice(5)
      byWorkcode[wc] ??= { ...ZERO }
      incrementSeverity(byWorkcode[wc], crash.severity)
    }
  }

  const alternatives = siteAlts
    .map((alt) => {
      const cm = catalogByWorkcode.get(alt.workcode)
      if (!cm) return null
      const addressableCrashes: SeverityTriplet = byWorkcode[alt.workcode]
        ? { ...byWorkcode[alt.workcode] }
        : { ...ZERO }
      const crf = cm.reductionFactor ?? 0
      const expectedReduction: SeverityTriplet = {
        K: addressableCrashes.K * crf,
        A: addressableCrashes.A * crf,
        B: addressableCrashes.B * crf,
      }
      const sii = calculateSII({
        alternative: alt,
        countermeasure: cm,
        crashCounts: addressableCrashes,
        dataYears,
        growthRatePercent: site.growthRatePercent ?? 2,
        crashCostTable,
      })
      return {
        alternative: alt,
        countermeasure: cm,
        addressableCrashes,
        expectedReduction,
        S: sii?.S ?? 0,
        Q: sii?.Q ?? 0,
        B: sii?.B ?? 0,
        C: sii?.C ?? 0,
        SII: sii?.SII ?? null,
        isChosen: alt.id === chosen.altId,
      }
    })
    .filter((a): a is NonNullable<typeof a> => a !== null)

  return {
    site,
    crashCounts: {
      total: crashes.length,
      bySeverity,
      byEmphasisArea,
    },
    alternatives,
    selectedPreventableCrashes: preventableCrashesFor(
      crashes,
      siteAlts.find((a) => a.id === chosen.altId)?.workcode,
    ),
  }
}

const SEVERITY_ORDER: Record<string, number> = { K: 0, A: 1, B: 2 }

// The crashes a work code is credited against, from the site's period
// crashes: the same flag the SII counts, so the IDs listed always add up to
// the alternative's preventable K/A/B counts.
function preventableCrashesFor(crashes: CrashRecord[], workcode: string | undefined): ReportCrashRef[] {
  if (!workcode) return []
  const flag = `HSIP_${workcode}`
  return crashes
    .filter((c) => (c as Record<string, unknown>)[flag] === 1)
    .map((c) => ({ id: c.id, date: c.date, severity: c.severity }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.date.localeCompare(b.date) ||
        a.id.localeCompare(b.id),
    )
}

export function assembleReport(input: AssembleReportInput): ReportPayload {
  const {
    sites,
    alternatives,
    chosenBySite,
    crashesBySite,
    countermeasureCatalog,
    crashCostTable,
    projectInfo,
    analysisYears,
    analysisRange,
    historyRange,
    guidelines,
    buildId,
    appVersion,
  } = input

  const catalogByWorkcode = new Map(
    countermeasureCatalog.map((cm) => [cm.workcode, cm]),
  )

  const includedSites = sites.filter((s) => chosenBySite[s.id] != null)

  const siteBlocks = includedSites.map((site) => {
    const crashes = crashesBySite[site.id] ?? []
    const siteAlts = alternatives.filter((a) => a.siteId === site.id)
    return buildSiteBlock(
      site,
      crashes,
      siteAlts,
      chosenBySite[site.id],
      catalogByWorkcode,
      crashCostTable,
      analysisYears,
    )
  })

  // First-appearance order: collect workcodes in the order sites and
  // their alternatives appear, then pull catalog entries in that order.
  const seenWorkcodes = new Set<string>()
  const orderedWorkcodes: string[] = []
  for (const sb of siteBlocks) {
    for (const a of sb.alternatives) {
      if (!seenWorkcodes.has(a.countermeasure.workcode)) {
        seenWorkcodes.add(a.countermeasure.workcode)
        orderedWorkcodes.push(a.countermeasure.workcode)
      }
    }
  }
  const uniqueCountermeasures = orderedWorkcodes
    .map((wc) => catalogByWorkcode.get(wc))
    .filter((cm): cm is Countermeasure => cm != null)

  return {
    generatedAt: new Date().toISOString(),
    projectInfo,
    sites: siteBlocks,
    countermeasures: uniqueCountermeasures,
    methods: { analysisYears, analysisRange, historyRange, guidelines, crashCostTable },
    metadata: { buildId, appVersion },
  }
}
