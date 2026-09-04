// Report generation shared by ExportDialog (user path) and the dev
// debug menu (fixture teleport path). Preparation gathers live store
// state and SQLite rows, captures transient map assets, then printReport
// mounts the completed report off-screen and opens print preview.

import { mount, unmount } from 'svelte'
import { projectInfoState } from '../state/projectInfoState.svelte'
import { siteList } from '../state/siteList.svelte'
import { projectState } from '../state/projectState.svelte'
import { dataManifest } from '../state/dataManifest.svelte'
import { list as listCatalog } from '../data/countermeasureCatalog'
import { all as allCrashCosts } from '../data/crashCostTable'
import { querySiteCrashes } from './siteHelpers'
import { assembleReport } from './assembleReport'
import { captureReportMaps, createReportMapJobs } from './captureMaps'
import { version as appVersion } from '../../package.json'
import type { CrashRecord, ReportAssets, ReportPayload } from '../types'
import ReportDocument from '../components/report/ReportDocument.svelte'

export type ReportGenerationProgress = {
  phase: 'assembling' | 'maps' | 'finalizing' | 'ready'
  message: string
  completed?: number
  total?: number
}

type PreparedReportData = {
  payload: ReportPayload
  crashesBySite: Record<string, CrashRecord[]>
}

export async function prepareReportDataFromStores(): Promise<PreparedReportData> {
  const allSites = siteList.get()
  const includedSites = allSites.filter((s) => projectState.getChosen(s.id) != null)

  const crashesBySite: Record<string, CrashRecord[]> = {}
  await Promise.all(
    includedSites.map(async (site) => {
      crashesBySite[site.id] = await querySiteCrashes(site)
    }),
  )

  const chosenBySite: Record<string, NonNullable<ReturnType<typeof projectState.getChosen>>> = {}
  for (const site of includedSites) {
    const chosen = projectState.getChosen(site.id)
    if (chosen) chosenBySite[site.id] = chosen
  }

  const allAlternatives = includedSites.flatMap((s) =>
    projectState.getAlternatives(s.id),
  )

  const manifest = dataManifest.current
  if (!manifest) throw new Error('Data manifest not loaded; cannot generate report without data provenance.')

  const payload = assembleReport({
    sites: allSites,
    alternatives: allAlternatives,
    chosenBySite,
    crashesBySite,
    countermeasureCatalog: listCatalog(),
    crashCostTable: allCrashCosts(),
    projectInfo: projectInfoState.value,
    dataYears: dataManifest.dataYears,
    dataRange: dataManifest.dataRange,
    buildId: manifest.buildId,
    appVersion,
  })

  return { payload, crashesBySite }
}

export async function assembleReportFromStores(): Promise<ReportPayload> {
  return (await prepareReportDataFromStores()).payload
}

export async function preparePrintableReport(
  onProgress?: (progress: ReportGenerationProgress) => void,
): Promise<{ payload: ReportPayload; assets: ReportAssets }> {
  onProgress?.({ phase: 'assembling', message: 'Preparing report data' })
  const { payload, crashesBySite } = await prepareReportDataFromStores()
  await document.fonts.ready
  const total = createReportMapJobs(payload).length
  onProgress?.({
    phase: 'maps',
    message: 'Starting map renderer',
    completed: 0,
    total,
  })

  const assets = await captureReportMaps({
    payload,
    crashesBySite,
    onProgress: ({ completed, total: mapTotal, label }) => {
      onProgress?.({
        phase: 'maps',
        message: label,
        completed,
        total: mapTotal,
      })
    },
  })

  onProgress?.({
    phase: 'finalizing',
    message: 'Finalizing report',
    completed: total,
    total,
  })
  return { payload, assets }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

export async function printReport(payload: ReportPayload, assets?: ReportAssets): Promise<void> {
  const container = document.createElement('div')
  container.className = 'report-print-container'
  document.body.appendChild(container)

  const component = mount(ReportDocument, { target: container, props: { payload, assets } })

  function cleanup() {
    window.removeEventListener('afterprint', cleanup)
    unmount(component)
    container.remove()
  }
  window.addEventListener('afterprint', cleanup)

  try {
    const images = Array.from(container.querySelectorAll('img'))
    await Promise.all([
      document.fonts.ready,
      ...images.map((image) => image.decode()),
    ])
    await nextFrame()
    await nextFrame()
    window.print()
  } catch (error) {
    cleanup()
    throw error
  }
}
