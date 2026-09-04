// JurisdictionStore per docs/06 contract.
//
// Backed by the static jurisdictions geojson built by tools/data-build,
// fetched once per session (from its content-hashed URL, resolved via
// the data manifest) and held in memory. No app-side cache layer: the
// hashed name makes ordinary browser HTTP caching safe, and offline
// is out of scope.

import type { Jurisdiction } from '../types'
import { loadJurisdictions } from '../services/loadJurisdictions'
import { NotFoundError } from '../services/errors'
import { dataManifest } from './dataManifest.svelte'

export interface JurisdictionStore {
  list(): Promise<Jurisdiction[]>
  getByName(name: string): Promise<Jurisdiction>
  isLoading: { get(): boolean }
  error: { get(): string | null }
}

class JurisdictionStoreImpl implements JurisdictionStore {
  #data: Jurisdiction[] | null = null
  #loadPromise: Promise<Jurisdiction[]> | null = null

  #isLoadingValue = $state<boolean>(false)
  #errorValue = $state<string | null>(null)

  isLoading = {
    get: () => this.#isLoadingValue,
  }

  error = {
    get: () => this.#errorValue,
  }

  async list(): Promise<Jurisdiction[]> {
    if (this.#data) return this.#data
    if (this.#loadPromise) return this.#loadPromise

    this.#isLoadingValue = true
    this.#errorValue = null
    const tStart = performance.now()
    this.#loadPromise = (async () => {
      await dataManifest.load()
      const data = await loadJurisdictions(dataManifest.artifactUrl('jurisdictions'))
      console.log(
        `[jurisdictions] loaded ${data.length} from static file in ${(performance.now() - tStart).toFixed(0)}ms`,
      )
      this.#data = data
      return data
    })().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[jurisdictions] load failed:', msg)
      this.#errorValue = msg
      return [] as Jurisdiction[]
    }).finally(() => {
      this.#isLoadingValue = false
      this.#loadPromise = null
    })
    return this.#loadPromise
  }

  async getByName(name: string): Promise<Jurisdiction> {
    const data = await this.list()
    const found = data.find((j) => j.name === name)
    if (!found) {
      throw new NotFoundError(`Jurisdiction not found: ${name}`)
    }
    return found
  }
}

export const jurisdictionStore: JurisdictionStore = new JurisdictionStoreImpl()
