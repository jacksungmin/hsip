// DataManifest store per docs/06. Loaded once at boot before any
// data store or tile layer; holds the manifest in $state so template
// gates ({#if dataManifest.current}) flip when it arrives. Artifact
// URLs are content-hashed, so a URL fully identifies its bytes —
// consumers never hardcode data filenames.

import {
  checkFlagLayout,
  loadManifest,
  type ArtifactKey,
  type DataManifest,
  type OverlayTileset,
} from '../services/loadManifest'
import { HSIP_FIELDS } from '../data/hsipWorkcodes'
import { EA_IDS } from '../data/emphasisAreas'
import { HSIP_PERIOD_YEARS } from '../data/hsipProgram'

// Checks the published crash data against what this app build expects. The
// build plugin runs the same checks against public/manifest.json, but data
// can be republished without rebuilding the app, so boot repeats them: a
// mismatch here would not fail anywhere else, it would show wrong numbers.
function checkAgainstApp(manifest: DataManifest): void {
  checkFlagLayout(manifest.crashData, { hsipFields: HSIP_FIELDS, eaFields: EA_IDS })
  const missing = HSIP_PERIOD_YEARS.filter((y) => !manifest.crashData.years.includes(y))
  if (missing.length > 0) {
    throw new Error(
      `the SII analysis years ${missing.join(', ')} (config/hsip/hsip_program.yaml) are not in ` +
        `the published crash data (${manifest.crashData.years.join(', ')})`,
    )
  }
}

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
      checkAgainstApp(manifest)
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

  // How many distinct years of crash history the published data set holds.
  // Counted from the year list rather than its span, so a gap in the source
  // export cannot misstate it. This is the full history diagnosis shows; the
  // SII divides by the analysis period instead (HSIP_PERIOD_LENGTH in
  // src/data/hsipProgram.ts), which is a subset of these years.
  get dataYears(): number {
    if (!current) throw new Error('data manifest not loaded yet')
    return current.crashData.years.length
  },

  // Display label for the full crash history, e.g. "2018-2025". Derived from
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
