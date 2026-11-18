// Crash-level CSV export: every crash inside every site's buffer, joined to
// the site, for analysis outside the tool and the detail an HSIP application
// needs. The rows are built by crashCsv.ts; this module gathers the inputs
// from the stores and hands the file to the browser.

import { siteList } from '../state/siteList.svelte'
import { projectState } from '../state/projectState.svelte'
import { projectInfoState } from '../state/projectInfoState.svelte'
import { jurisdictionStore } from '../state/jurisdictionStore.svelte'
import { querySiteCrashes } from './siteHelpers'
import { buildCrashCsv, type CrashExportSite } from './crashCsv'

function fileName(projectName: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'hsip'}-site-crashes-${date}.csv`
}

function download(name: string, text: string): void {
  // The byte-order mark makes Excel open the file as UTF-8, so names with
  // accents or dashes survive.
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Gathers every site's crashes and its selected work code, and downloads the
// CSV. Returns the row count and file name for the caller's confirmation.
export async function exportCrashesCsv(): Promise<{ rows: number; file: string }> {
  const sites = siteList.get()
  if (sites.length === 0) throw new Error('There are no sites to export yet.')

  const [jurisdictions, crashesPerSite] = await Promise.all([
    jurisdictionStore.list(),
    Promise.all(sites.map((site) => querySiteCrashes(site))),
  ])
  const countyNames: Record<string, string> = {}
  const cityNames: Record<string, string> = {}
  for (const j of jurisdictions) {
    if (j.type === 'county') countyNames[j.id] = j.name
    else if (j.type === 'city') cityNames[j.id] = j.name
  }

  const exportSites: CrashExportSite[] = sites.map((site, i) => {
    const chosen = projectState.getChosen(site.id)
    const selected = chosen
      ? (projectState.getAlternatives(site.id).find((a) => a.id === chosen.altId)?.workcode ?? null)
      : null
    return { site, crashes: crashesPerSite[i], selectedWorkcode: selected }
  })

  const csv = buildCrashCsv({ sites: exportSites, countyNames, cityNames })
  const file = fileName(projectInfoState.value.projectName)
  download(file, csv)
  return { rows: exportSites.reduce((n, s) => n + s.crashes.length, 0), file }
}
