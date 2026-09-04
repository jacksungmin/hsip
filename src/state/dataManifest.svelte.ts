// DataManifest store per docs/06. Loaded once at boot before any
// data store or tile layer; holds the manifest in $state so template
// gates ({#if dataManifest.current}) flip when it arrives. Artifact
// URLs are content-hashed, so a URL fully identifies its bytes —
// consumers never hardcode data filenames.

import {
  loadManifest,
  type ArtifactKey,
  type DataManifest,
  type OverlayTileset,
} from '../services/loadManifest'

const MANIFEST_URL = `${import.meta.env.BASE_URL}manifest.json`

let current = $state<DataManifest | null>(null)
let loadPromise: Promise<DataManifest> | null = null

export const dataManifest = {
  get current(): DataManifest | null {
    return current
  },

  // Memoised in-flight: boot and any data store that races it (e.g.
  // RegionPanel kicks off jurisdictionStore.list() at mount) share
  // one fetch. Data stores await this themselves before resolving
  // URLs, so correctness never depends on call order.
  async load(): Promise<DataManifest> {
    if (current) return current
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      const manifest = await loadManifest(MANIFEST_URL)
      console.log(`[manifest] buildId ${manifest.buildId}, built ${manifest.builtAt}`)
      current = manifest
      return manifest
    })()
    loadPromise.catch(() => {
      loadPromise = null // allow retry after a failed fetch
    })
    return loadPromise
  },

  // Synchronous by design, for contexts that cannot await (tile layer
  // component init); those are mount-gated on `current` being set.
  // Async consumers should await load() first.
  artifactUrl(key: ArtifactKey): string {
    if (!current) throw new Error('data manifest not loaded yet')
    return `${import.meta.env.BASE_URL}${current.artifacts[key]}`
  },

  // Exposure period for the SII benefit calculation: how many distinct years
  // of crash data the published data set actually holds. Counted from the
  // year list rather than its span, so a gap in the source export cannot
  // inflate the denominator and understate crash rates.
  get dataYears(): number {
    if (!current) throw new Error('data manifest not loaded yet')
    return current.crashData.years.length
  },

  // Display label for the crash-data period, e.g. "2018-2024". Derived from
  // the same list as dataYears so the two can never contradict each other in
  // a report.
  get dataRange(): string {
    if (!current) throw new Error('data manifest not loaded yet')
    const years = current.crashData.years
    return `${years[0]}-${years[years.length - 1]}`
  },

  // Overlay tilesets are keyed by whatever build-config declares, so the name
  // is a config string rather than a checked ArtifactKey. Returns undefined for
  // an overlay the published data no longer has, which is a layer to skip
  // rather than a boot failure.
  overlay(name: string): (OverlayTileset & { url: string }) | undefined {
    const entry = current?.overlays[name]
    if (!entry) return undefined
    return { ...entry, url: `${import.meta.env.BASE_URL}${entry.file}` }
  },
}
