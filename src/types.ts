// Shared entity types, grown piecemeal alongside the code that uses them.
// Source of truth is docs/06-contracts.md. When code and contract diverge,
// update both in the same commit.

import type { Point, LineString, Polygon, MultiPolygon } from 'geojson'
import type { EaFlagKey } from './data/emphasisAreas'
import type { HsipFlagKey } from './data/hsipWorkcodes'

export type JurisdictionType = 'county' | 'city' | 'hgac-region'

// A list entry for the region-picking dropdown. Sourced from
// JurisdictionStore.list().
//
// Widening: docs/06 originally specified Polygon. Real boundary data
// has multipolygon counties (Galveston, mainland + barrier islands),
// so the contract was widened to Polygon | MultiPolygon.
export type Jurisdiction = {
  id: string
  name: string
  type: JurisdictionType
  geometry: Polygon | MultiPolygon
}

// The user's picked area of analysis. Same shape for current and reference.
//
// Region.id is an opaque app/session identity. It is safe for UI keys,
// reference removal, and persistence, but callers must not parse it for
// data queries. Jurisdiction-backed queries use jurisdictionType +
// jurisdictionId instead. Upload/draw constructors are Phase 2.
export type JurisdictionRegion = {
  id: `jurisdiction:${JurisdictionType}:${string}`
  name: string
  source: 'jurisdiction'
  jurisdictionType: JurisdictionType
  jurisdictionId: string
  geometry: Polygon | MultiPolygon
}

export type CustomRegion = {
  id: `upload:${string}` | `draw:${string}`
  name: string
  source: 'upload' | 'draw'
  geometry: Polygon | MultiPolygon
}

export type Region = JurisdictionRegion | CustomRegion

export type Severity = 'K' | 'A' | 'B'

// Unified crash entity. Carries both flat coords (lon/lat for SQL
// storage and R*Tree) and GeoJSON Point (for MapLibre/Turf). EA and
// HSIP flags are per-column (0|1), matching the upstream ESRI source
// and SQLite schema 1:1 — no string-array round-trip.
//
// Contract change from docs/06 original: emphasisAreas:string[] and
// workcodes:string[] replaced by per-flag columns. Rationale: every
// consumer iterates flags to count or filter; the array was a
// materialization step no caller actually needed.
export type CrashRecord = {
  id: string                  // numeric string; parsed to int at SQLite boundary
  date: string                // ISO YYYY-MM-DD
  severity: Severity
  lon: number
  lat: number
  location: Point
  countyId: string
  cityId: string | null
} & {
  [K in EaFlagKey]: 0 | 1
} & {
  [K in HsipFlagKey]: 0 | 1
}

// A crash reference held on a site part: id plus the severity needed
// to recompute the site union without requerying unchanged parts.
export type CrashRef = { id: string; severity: Severity }

// One drawn geometry within a site, with its own buffer and crash set.
// A site always has at least one part; SiteList enforces the minimum.
export type SitePart = {
  id: string
  name: string
  drawnGeometry: LineString | Point
  bufferFeet: number
  bufferedGeometry: Polygon
  crashes: CrashRef[]
}

// Site-level crashIds/crashSeverity are the deduped union across parts
// (a crash inside two overlapping part buffers counts once). Recomputed
// by SiteList from the parts' stored crash refs inside every part
// mutation, so no spatial requery of unchanged parts is ever needed.
export type Site = {
  id: string
  name: string
  type: 'roadway' | 'intersection'
  source: 'draw' | 'upload'
  parts: SitePart[]
  crashIds: string[]
  crashSeverity: SeverityTriplet
  description?: string
  owner?: string
  growthRatePercent?: number
  functionalClass?: string
}

export type DrawResult =
  | { type: 'region'; geometry: Polygon }
  | { type: 'roadway'; geometry: LineString }
  | { type: 'intersection'; geometry: Point }

export type CrashFilter = {
  countyId?: string
  cityId?: string
}

// Per-emphasis-area crash counts for a region. Matches docs/06
// BreakdownResult. Counts may sum to more than total because a
// crash can carry multiple EA tags.
export type BreakdownResult = {
  totalCrashes: number
  counts: Record<string, number>  // emphasisAreaId -> crash count
}

export type Countermeasure = {
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

export type Alternative = {
  id: string
  siteId: string
  workcode: string
  constructionCost: number | null
  annualMaintenance: number | null
  serviceLife: number
  note?: string
}

// The resolved preferred alternative for a site, refreshed when planning
// inputs or the site's crash set changes.
// `source` records how it was chosen (user pin vs SII auto-pick); `prevented`
// is the crf-applied expected reduction in historical K/A/B crashes for the
// chosen countermeasure's workcode at that site.
export type ChosenAlt = {
  altId: string
  source: 'auto' | 'explicit'
  prevented: { K: number; A: number; B: number }
}

export type SeverityTriplet = { K: number; A: number; B: number }

// One dollar figure per severity level. TxDOT publishes a single combined
// figure for K and A; the config carries them as separate rows so an agency
// can weight fatal above incapacitating. Equal values reproduce TxDOT's
// combined-KA arithmetic exactly.
export type CrashCostEntry = {
  severity: Severity
  label: string
  dollarValue: number
}

export type ProjectInfo = {
  projectName: string
  organization: string
  analyst: string
  countyLocality: string
  notes: string
}

// Composite of every registered store's snapshot, keyed by store key.
// Matches docs/06 SessionSnapshot. version bumps on breaking shape
// changes (Phase 1: version 1, no migrations).
export type SessionSnapshot = {
  version: number
  stores: Record<string, unknown>
}

export type ReportSiteBlock = {
  site: Site
  crashCounts: {
    total: number
    bySeverity: SeverityTriplet
    byEmphasisArea: Record<string, SeverityTriplet>
  }
  alternatives: Array<{
    alternative: Alternative
    countermeasure: Countermeasure
    addressableCrashes: SeverityTriplet
    expectedReduction: SeverityTriplet
    S: number
    Q: number
    B: number
    C: number
    SII: number | null
    isChosen: boolean
  }>
}

export type ReportPayload = {
  generatedAt: string
  projectInfo: ProjectInfo
  sites: ReportSiteBlock[]
  countermeasures: Countermeasure[]
  methods: {
    dataYears: number
    dataRange: string
    crashCostTable: CrashCostEntry[]
  }
  metadata: {
    buildId: string
    appVersion: string
  }
}

// Transient rendered assets carried beside ReportPayload during one export.
// They are deliberately excluded from the semantic/persistable payload.
export type ReportMapAsset = {
  src: string
  pixelWidth: number
  pixelHeight: number
  scaleLabel: string
  scaleWidthPercent: number
}

export type ReportAssets = {
  overviewMap: ReportMapAsset | null
  siteMaps: Record<string, ReportMapAsset>
  partMaps: Record<string, Record<string, ReportMapAsset>>
}

// App presentation, authored by hand in config/app.yaml and converted at build
// time by vite-plugin-app-config: the identity strings to JSON the components
// import, the theme colours to a stylesheet that overrides the tokens in
// src/app.css. Mirrors config/schemas/app.schema.json; change both together.
//
// Colours are hex strings and validated as such by the plugin, because they
// are written verbatim into generated CSS.
export type AppConfig = {
  identity: {
    appName: string // navbar heading and browser tab title
    subtitle: string // small line under the navbar heading
    fullName: string // splash screen heading, the long form
  }
  support: {
    email: string // shown on error screens as a mailto: link
  }
  theme: {
    primary: string // brand colour; white text is drawn on it
    primaryPlanning: string // replaces primary while in the planning phase
    foreground: string // body text and headings
    destructive: string // errors and destructive actions
  }
  basemap: {
    // Either a vector style URL or a raster {z}/{x}/{y} template. Which one it
    // is gets sniffed from the URL at use, not declared here: a raster
    // template is exactly the URL that names those placeholders.
    url: string
    attribution: string
    // Raster only; ignored for a vector style, which carries its own.
    maxZoom: number
    tileSize: number
  }
}

// Overlay layers, authored by hand in config/overlays.yaml and converted to
// JSON at build time by vite-plugin-overlay-config. These types mirror the
// JSON Schema in config/schemas/overlays.schema.json; change both together.
//
// An overlay is display-only: it draws from a PMTiles tileset and is never
// queried analytically, so overlay attributes exist only in the tiles.

export type OverlayValue = string | number | boolean

// MapLibre `match` labels are string or number only, so categories exclude
// boolean. A boolean column is still filterable via `where`.
export type OverlayCategory = {
  value: string | number
  label: string
  color: string
}

// Categorical hides values it does not list unless `other` is present, which
// is what keeps un-tiered segments off the map without a second filter.
export type OverlayStyle =
  | { type: 'simple'; color: string }
  | {
      type: 'categorical'
      column: string
      categories: OverlayCategory[]
      other?: { label: string; color: string }
    }

export type OverlayLayerDef = {
  id: string
  label: string
  // Names an overlay tileset in the data manifest's `overlays` section, i.e. a
  // key under `overlays` in tools/data-build/build-config.yaml. Validated at
  // build time. The layer name inside the tileset comes from the manifest, not
  // from here: one tileset holds one layer, and one name covers both.
  source: string
  draw: 'line' | 'point' | 'polygon'
  visible: boolean
  width: number
  opacity: number
  where?: { column: string; equals: OverlayValue }
  style: OverlayStyle
}

// One switchable row under a layer in the Layers panel. Derived from the
// style so paint, legend, and filter can never disagree.
export type OverlayLegendRow = {
  key: string
  label: string
  color: string
}
