// CrashStore per docs/06 contract.
//
// load() pulls the pre-built .db (tools/data-build output) from its
// content-hashed URL (resolved via the data manifest) through the
// SQLite worker; freshness is URL equality handled worker-side (the
// stored source URL matching means no network request at all).
//
// Public API takes Region (or null for all crashes). Store translates
// Region -> query strategy internally:
//   JurisdictionRegion -> countyId/cityId filter (SQL indexed equality)
//   CustomRegion       -> R*Tree bbox + Turf PIP (polygon spatial query)
//   null               -> no filter (all rows, used for HGAC reference)
//
// Callers never see CrashFilter or column names.

import type { CrashRecord, Region, BreakdownResult } from '../types'
import { dataManifest } from './dataManifest.svelte'
import {
  loadCrashDb,
  queryCrashes,
  countByEA as workerCountByEA,
  queryByPolygon,
  countByEAPolygon,
} from '../services/db/sqliteClient'

export type CrashLoadHooks = {
  onDownloadProgress?: (loaded: number, total: number | null) => void
}

export interface CrashStore {
  load(hooks?: CrashLoadHooks): Promise<void>
  queryAll(): Promise<CrashRecord[]>
  query(region: Region | null): Promise<CrashRecord[]>
  countByEA(region: Region | null): Promise<BreakdownResult>
  isLoading: { get(): boolean }
  error: { get(): string | null }
}

function regionToFilter(region: Region | null): { countyId?: string; cityId?: string } {
  if (!region) return {}
  if (region.source !== 'jurisdiction') return {}
  if (region.jurisdictionType === 'city') return { cityId: region.jurisdictionId }
  if (region.jurisdictionType === 'county') return { countyId: region.jurisdictionId }
  return {}
}

class CrashStoreImpl implements CrashStore {
  #loaded = false
  #loadPromise: Promise<void> | null = null

  #isLoadingValue = $state<boolean>(false)
  #errorValue = $state<string | null>(null)

  isLoading = {
    get: () => this.#isLoadingValue,
  }

  error = {
    get: () => this.#errorValue,
  }

  async load(hooks?: CrashLoadHooks): Promise<void> {
    if (this.#loaded) return
    if (this.#loadPromise) return this.#loadPromise

    this.#isLoadingValue = true
    this.#errorValue = null
    const tStart = performance.now()
    this.#loadPromise = (async () => {
      await dataManifest.load()
      const result = await loadCrashDb(dataManifest.artifactUrl('appDb'), hooks?.onDownloadProgress)
      console.log(
        `[crashes] db ${result.source === 'cache' ? 'cache fresh (url match/offline)' : 'downloaded'}, ` +
        `${result.rowCount} rows in ${(performance.now() - tStart).toFixed(0)}ms`,
      )
      this.#loaded = true
    })().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[crashes] load failed:', msg)
      this.#errorValue = msg
    }).finally(() => {
      this.#isLoadingValue = false
      this.#loadPromise = null
    })
    return this.#loadPromise
  }

  async queryAll(): Promise<CrashRecord[]> {
    if (!this.#loaded) return []
    return queryCrashes({})
  }

  async query(region: Region | null): Promise<CrashRecord[]> {
    if (!this.#loaded) return []
    if (region && (region.source === 'draw' || region.source === 'upload')) {
      return queryByPolygon(region.geometry)
    }
    return queryCrashes(regionToFilter(region))
  }

  async countByEA(region: Region | null): Promise<BreakdownResult> {
    if (!this.#loaded) return { totalCrashes: 0, counts: {} }
    if (region && (region.source === 'draw' || region.source === 'upload')) {
      return countByEAPolygon(region.geometry)
    }
    return workerCountByEA(regionToFilter(region))
  }
}

export const crashStore: CrashStore = new CrashStoreImpl()
