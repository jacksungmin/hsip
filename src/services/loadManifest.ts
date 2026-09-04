// DataManifest per docs/06: the mutable pointer to content-hashed
// data artifacts, written by tools/data-build (output/publish.py)
// and fetched fresh each boot with cache: 'no-cache' (revalidate,
// not skip-cache). Artifact filenames embed a content hash, so a URL
// fully identifies its bytes; everything downstream keys freshness
// off URL equality.
//
// The pure parser is exported separately from the fetch so the
// contract is testable without network mocking. It fails loudly on
// anything malformed (a partial manifest must never hand out URLs)
// and ignores unknown keys so additive schema evolution stays free.

// Artifacts app code names by hand. Closed set, and every one is required:
// a manifest missing any of them cannot boot the app.
export const ARTIFACT_KEYS = ['appDb', 'crashTiles', 'jurisdictions'] as const
export type ArtifactKey = (typeof ARTIFACT_KEYS)[number]

export const MANIFEST_SCHEMA_VERSION = 3

// Overlay tilesets live in their own open-ended section rather than in
// `artifacts`, because which ones exist is a data-build config decision the
// app must not have an opinion about. The client can add or retire an overlay
// without the app needing a matching key, and a retired one must not brick
// boot the way a missing required artifact does.
export type OverlayTileset = {
  file: string
  // The tileset's internal layer name, i.e. MapLibre's `source-layer`.
  sourceLayer: string
  // The fields that actually reached the tiles. Only the app build reads this,
  // to check config/overlays.yaml against what the tiles contain; parsed here
  // so the shape is validated in one place.
  fields: string[]
}

// Provenance of the published crash data, emitted by the build from the years
// it actually ingested. Not a setting: the exposure period is whatever is in
// the data, and it divides every SII benefit calculation.
//
// A list rather than a count, because the count is not always the span — a
// year missing from the source export gives seven years spanning 2018-2025,
// and dividing by the span would understate every crash rate. Count and label
// are both derived from this one field, so they cannot disagree.
export type CrashDataProvenance = {
  years: number[]
}

export type DataManifest = {
  schemaVersion: number
  buildId: string
  builtAt: string
  artifacts: Record<ArtifactKey, string>
  overlays: Record<string, OverlayTileset>
  crashData: CrashDataProvenance
}

export function parseManifest(json: unknown): DataManifest {
  if (typeof json !== 'object' || json === null) {
    throw new Error('manifest is not an object (HTML error page served instead?)')
  }
  const m = json as Record<string, unknown>
  if (m.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `manifest schemaVersion ${String(m.schemaVersion)} is not supported ` +
      `(app expects ${MANIFEST_SCHEMA_VERSION}; data build and app are out of sync)`,
    )
  }
  if (typeof m.buildId !== 'string' || m.buildId === '') {
    throw new Error('manifest missing buildId')
  }
  if (typeof m.artifacts !== 'object' || m.artifacts === null) {
    throw new Error('manifest missing artifacts map')
  }
  const raw = m.artifacts as Record<string, unknown>
  const artifacts = {} as Record<ArtifactKey, string>
  for (const key of ARTIFACT_KEYS) {
    const filename = raw[key]
    if (typeof filename !== 'string' || filename === '') {
      throw new Error(`manifest missing artifact '${key}'`)
    }
    artifacts[key] = filename
  }
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    buildId: m.buildId,
    builtAt: typeof m.builtAt === 'string' ? m.builtAt : '',
    artifacts,
    overlays: parseOverlays(m.overlays),
    crashData: parseCrashData(m.crashData),
  }
}

// Required and strict, unlike `overlays` where an absent section is legitimate.
// This one feeds the SII denominator, so there is no tolerant reading of it:
// defaulting a missing value would scale every benefit figure in the report by
// a wrong constant and report success.
function parseCrashData(raw: unknown): CrashDataProvenance {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('manifest missing crashData (data build is older than this app)')
  }
  const years = (raw as Record<string, unknown>).years
  if (!Array.isArray(years) || years.length === 0) {
    throw new Error('manifest crashData.years must be a non-empty array')
  }
  if (!years.every((y): y is number => typeof y === 'number' && Number.isInteger(y))) {
    throw new Error('manifest crashData.years must contain only integers')
  }
  return { years: [...years].sort((a, b) => a - b) }
}

// A malformed overlay entry is a hard error like any other: the app build
// validated config/overlays.yaml against these, so a half-written entry means
// a layer would silently draw nothing. An absent `overlays` section is fine —
// a build can legitimately publish no overlays at all.
function parseOverlays(raw: unknown): Record<string, OverlayTileset> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object') throw new Error('manifest `overlays` is not an object')

  const overlays: Record<string, OverlayTileset> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Record<string, unknown> | null
    if (entry === null || typeof entry !== 'object') {
      throw new Error(`manifest overlay '${name}' is not an object`)
    }
    if (typeof entry.file !== 'string' || entry.file === '') {
      throw new Error(`manifest overlay '${name}' missing file`)
    }
    if (typeof entry.sourceLayer !== 'string' || entry.sourceLayer === '') {
      throw new Error(`manifest overlay '${name}' missing sourceLayer`)
    }
    const fields = Array.isArray(entry.fields) ? entry.fields : []
    overlays[name] = {
      file: entry.file,
      sourceLayer: entry.sourceLayer,
      fields: fields.filter((f): f is string => typeof f === 'string'),
    }
  }
  return overlays
}

export async function loadManifest(url: string): Promise<DataManifest> {
  const resp = await fetch(url, { cache: 'no-cache' })
  if (!resp.ok) {
    throw new Error(`manifest fetch failed: HTTP ${resp.status}`)
  }
  return parseManifest(await resp.json())
}
