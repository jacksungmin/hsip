# Contracts

Where the parts of the app meet: the shape of the data they pass
around, the methods each store offers, what the state containers hold
and how they change, and the signals that travel between components.

## Ground rules

### How shapes are written

In TypeScript type syntax, which is a compact way to write down the
shape of a value.

### What returns a promise and what does not

A store reading a downloaded file returns a promise, because the data
may not have arrived yet. A store reading data built into the app
(the countermeasure catalog, the crash cost table, the overlay
definitions) returns its answer straight away, because that data is
there before anything renders. Reading and changing a state container
is always immediate.

### How components notice changes

State containers, and the `isLoading` and `error` fields on
downloading stores, are read through a `get()` method built on
Svelte's `$state`. When a component calls `get()` while it renders,
Svelte quietly records that it depends on that container, and
re-renders it later when the value changes. Nothing has to be
subscribed to or unsubscribed from by hand.

A few containers use a plain getter property instead of `get()`. Each
one says so where it appears below.

### Errors

A failed download or query comes back as a rejected promise carrying
one of the named error types in `services/errors.ts`. Looking up a
missing key in built-in data returns `undefined` instead of
throwing, because a missing key there is a normal answer rather than
a failure. Nothing catches an error and quietly ignores it: a caught
failure is passed to `reportError`, which puts it on one of the two
surfaces held by `ErrorState` below.

### Loading state

Every downloading store exposes `isLoading: { get(): boolean }`
separately from its query methods, so a component can show a
placeholder while waiting.

### Shapes and coordinates

Shapes follow GeoJSON. Coordinates are written `[longitude,
latitude]` in that order, using WGS84, the coordinate system GPS and
web maps use. For a polygon, the outer ring comes first and any holes
follow it.

### Units

A field name says its own unit: `bufferFeet`, `dollarValue`. Nothing
converts units silently as values pass between parts.

---

## Entities

### Geometry primitives

```ts
type Point      = { type: 'Point',      coordinates: [number, number] }
type LineString = { type: 'LineString', coordinates: [number, number][] }
type Polygon    = { type: 'Polygon',    coordinates: [number, number][][] }
```

### Severity

The three most serious levels of the standard KABCO injury scale,
which is the scope TxDOT HSIP uses.
The build pipeline filters to KAB at ingest; C and O crashes
never enter the app.

```ts
type Severity =
  | 'K'   // Fatal
  | 'A'   // Suspected Serious Injury
  | 'B'   // Suspected Minor Injury
```

### EmphasisArea

One entry per emphasis area on TxDOT's official list. The label is
used word for word, with nothing renamed or merged.

```ts
type EmphasisArea = {
  id: string      // stable id matching the crash record column key
  label: string   // TxDOT official display name
}
```

### Region

An area the user picked. The same type covers both the area being
worked on and an area chosen for comparison.

Treat `Region.id` as a label with no meaning inside it. Compare it,
store it, use it as a list key, hand it to a container method — but
never pull it apart to work out what to query. The pieces needed for
querying have their own fields: a city or county area queries by
`jurisdictionType` and `jurisdictionId`, and a drawn area queries by
its shape.

```ts
type JurisdictionType = 'county' | 'city' | 'hgac-region'

type JurisdictionRegion = {
  id: `jurisdiction:${JurisdictionType}:${string}`
  name: string
  source: 'jurisdiction'
  jurisdictionType: JurisdictionType
  jurisdictionId: string
  geometry: Polygon | MultiPolygon
}

type CustomRegion = {
  id: `upload:${string}` | `draw:${string}`
  name: string
  source: 'upload' | 'draw'
  geometry: Polygon | MultiPolygon
}

type Region = JurisdictionRegion | CustomRegion
```

A drawn area gets its id when it is created, as
`draw:${crypto.randomUUID()}`, and a name generated at the same time
("Drawn area 1", "Drawn area 2", and so on).

The `'upload'` source appears in the type but nothing creates one:
areas can only be drawn. Uploading applies to sites, not areas. See
`08-future-ideas.md`.

### Jurisdiction

One row in the city and county picker. The whole H-GAC region appears
in the list too, with `type: 'hgac-region'`.

```ts
type Jurisdiction = {
  id: string
  name: string
  type: JurisdictionType
  geometry: Polygon | MultiPolygon
}
```

`Jurisdiction.id` comes from the source data and is only unique
within its own `type`, so a county and a city can share the same id
string. Turning a jurisdiction into a `Region` therefore builds an id
with the type written into it, and keeps the original id in
`Region.jurisdictionId`.

`MultiPolygon` is needed because real boundaries come in pieces:
Galveston County is the mainland plus Galveston Island and other
barrier islands.

Filtering crashes by city or county does not use these shapes at all.
It uses the `countyId` and `cityId` columns already stamped onto each
crash row, which is far faster. The shapes are still kept at full
detail, because working out which city and county a site sits in does
compare the site's shape against them.

### CrashRecord

The part of a CRIS crash row the app actually uses.

The position appears twice, in two forms. `lon` and `lat` are plain
numbers, which is what SQLite and its spatial index need. `location`
is the same point as GeoJSON, which is what MapLibre and Turf expect.
Keeping both saves converting on every row.

Emphasis area and workcode tags are one column each holding 0 or 1,
matching the source data and the database table exactly.

```ts
type CrashRecord = {
  id: string
  date: string                      // ISO YYYY-MM-DD
  severity: Severity
  lon: number
  lat: number
  location: Point                   // { type: 'Point', coordinates: [lon, lat] }
  countyId: string                  // pre-tagged from upstream SS4A spatial join
  cityId: string | null             // null for unincorporated areas
  // Per-EA flag columns (0|1), keyed by EA_IDS (e.g. EA_01_Speed).
  [eaFlagKey: string]: 0 | 1
  // Per-HSIP flag columns (0|1), keyed by HSIP_FIELDS (e.g. HSIP_108).
  [hsipFlagKey: string]: 0 | 1
}
```

The tags are separate 0/1 columns rather than a list of names
because everything that reads them is counting or filtering, and
walking the columns does that directly. Building a list of names
first would be a conversion step that no caller has any use for.

### Countermeasure

One catalog entry, read from `config/hsip/countermeasures.json`,
which the build generates from a CSV file.

There is one reduction factor per countermeasure rather than one per
severity level, which is how TxDOT publishes them.

```ts
type Countermeasure = {
  workcode: string
  name: string
  definition: string                // long description from TxDOT catalog
  emphasisAreas: string[]           // up to 3 EA ids this CM addresses
  facilitySubset?: string           // e.g. "Signal", "Curve"
  typeOfWork: string                // "Intersection", "Corridor", "Other"
  reductionFactor: number | null    // null for TBD workcodes (benefit not calculable)
  serviceLife: number               // years, from TxDOT catalog
  maintenanceCostRef: string        // reference string for display (e.g. "$1,300 per approach")
  subGroup: string                  // library grouping (e.g. "Intersection - Signal")
  additionalDocs: string | null     // required documentation (e.g. "Overhead Intersection Layout")
}
```

### Overlay features

Overlay features have no type in the app at all. MapLibre reads them
from the tile files and colors them by their attributes, and they
never become objects the app code touches. That is why no shape for
them appears here.

Which attributes a layer has is declared in `config/overlays.yaml`,
and the app build checks those declarations against the manifest's
list of what actually reached the tiles, so a typo fails the build
instead of shipping a layer that draws nothing.

`OverlayLayerDef` in `src/types.ts` is the shape of a layer's
*declaration*, and mirrors `config/schemas/overlays.schema.json`.

### BreakdownResult

Crash counts per emphasis area for one area. It does not carry the
area back, because whoever asked already knows what they asked
about.

```ts
type BreakdownResult = {
  totalCrashes: number
  counts: Record<string, number>    // emphasisAreaId -> crash count
  // share per EA = counts[eaId] / totalCrashes, computed by the view
}
```

### CrashCostEntry

Dollar figures from the TxDOT crash cost table, one per severity
level.

TxDOT publishes a single combined figure covering K and A together.
They are kept as two separate rows here so an agency that wants to
price a fatal crash higher than a serious injury can do so. Give the
two rows the same value, as the shipped configuration does, and the
arithmetic comes out identical to TxDOT's combined figure.

```ts
type CrashCostEntry = {
  severity: Severity
  label: string
  dollarValue: number
}
```

### Site

A place the user wants to improve. Created by drawing on the map or
by uploading a shape file.

A site holds one or more **parts**. Each part is a single drawn or
uploaded shape with its own buffer distance and its own list of
crashes. Parts exist only during picking: everything afterwards —
countermeasures, pins, the report — works with the site as a whole
and never looks inside at the parts.

A site stores crash *ids*, not whole crash records. The records live
in `CrashStore` and are fetched when something needs them.

```ts
type CrashRef = { id: string; severity: Severity }

type SitePart = {
  id: string
  name: string                        // auto at creation, user-editable
  drawnGeometry: LineString | Point   // LineString for roadway, Point for intersection
  bufferFeet: number
  bufferedGeometry: Polygon           // derived from drawnGeometry + bufferFeet
  crashes: CrashRef[]                 // crashes within this part's buffer, id + severity
}

type Site = {
  id: string
  name: string                        // user-editable, auto-generated at creation
  type: 'roadway' | 'intersection'    // site-level; parts never mix types
  source: 'draw' | 'upload'           // controls editability
  parts: SitePart[]                   // min length 1
  crashIds: string[]                  // deduped union across parts
  crashSeverity: SeverityTriplet      // tallied from the deduped union
  description?: string                // user context for the report
  owner?: string                      // road owner, user-selected
  growthRatePercent?: number          // annual traffic growth, feeds SII calculation; default 2%
  functionalClass?: string            // optional, for report context
}
```

`source` decides what the user can do to the site afterwards. A
drawn site allows everything. An uploaded site can be renamed,
deleted, have a part deleted, and have its buffer changed, but its
shapes cannot be redrawn and no new part can be added to it, because
those shapes came from the user's own file.

Uploading accepts points (making an intersection site) or lines
(making a roadway site). A file holding several shapes is split up,
one part per shape. One file always produces exactly one site. Files
holding polygons, or mixing points and lines, are rejected.

### Alternative

One countermeasure being considered at one site.

This holds only what the user typed. The benefit, the cost, and the
SII score are worked out by `calculateSII` whenever they are needed
and are never stored here.

```ts
type Alternative = {
  id: string
  siteId: string
  workcode: string
  constructionCost: number | null   // null until the user enters a value
  annualMaintenance: number | null  // null until the user enters a value
  serviceLife: number               // pre-filled from Countermeasure catalog, user-editable
  note?: string                     // optional application note
}
```

### ReportPayload

Built by `assembleReport()`, which the export dialog calls directly.

It carries the planning data per site, plus enough detail to trace
every number back to what produced it. Only sites that have a chosen
countermeasure appear, whether the user pinned it or the app picked
the best score.

```ts
type ReportPayload = {
  generatedAt: string                               // ISO timestamp
  projectInfo: ProjectInfo
  sites: ReportSiteBlock[]
  countermeasures: Countermeasure[]                  // unique across all site alternatives (Appendix A)
  methods: {
    dataYears: number
    dataRange: string                               // display string, e.g. "2018-2024"
    crashCostTable: CrashCostEntry[]
  }
  metadata: {
    buildId: string                                 // from DataManifest; says which data build this came from
    appVersion: string
  }
}

type ReportSiteBlock = {
  site: Site
  crashCounts: {
    total: number
    bySeverity: SeverityTriplet
    byEmphasisArea: Record<string, SeverityTriplet> // emphasisAreaId -> K/A/B counts
  }
  alternatives: Array<{
    alternative: Alternative
    countermeasure: Countermeasure                   // full entry for traceability
    addressableCrashes: SeverityTriplet              // crashes tagged for this workcode
    expectedReduction: SeverityTriplet               // addressable * reductionFactor
    S: number
    Q: number
    B: number
    C: number
    SII: number | null
    isChosen: boolean
  }>
}
```

The map images are temporary. They are not part of the report's data
and are never stored, so they travel alongside the payload rather
than inside it, just long enough to be rendered and printed:

```ts
type ReportMapAsset = {
  src: string                       // transient image URI
  pixelWidth: number
  pixelHeight: number
  scaleLabel: string
  scaleWidthPercent: number
}

type ReportAssets = {
  overviewMap: ReportMapAsset | null
  siteMaps: Record<string, ReportMapAsset>                 // siteId -> image
  partMaps: Record<string, Record<string, ReportMapAsset>> // siteId -> partId -> image
}
```

### SessionSnapshot

Round-trip container for whole-app state slices. Registered
containers serialize into `stores[key]`. See "Snapshot registry"
below for how slices are composed and applied, and for the fact
that nothing persists them.

```ts
type SessionSnapshot = {
  version: number                    // schema version, bumped on breaking shape changes
  stores: Record<string, unknown>    // storeKey -> slice
}
```

### DataManifest

The one file that says which data files are current. Everything else
has a hashed name that never changes its contents; this file changes,
and points at them. Only the build pipeline writes it.

```ts
type ArtifactKey = 'appDb' | 'crashTiles' | 'jurisdictions'

type OverlayTileset = {
  file: string                          // content-hashed filename
  sourceLayer: string                   // the tileset's internal layer name
  fields: string[]                      // fields that actually reached the tiles
}

type DataManifest = {
  schemaVersion: number                 // parser rejects versions it doesn't know
  buildId: string                       // derived from artifact hashes; identifies the exact
                                        // data set a user sees, recorded in reports
  builtAt: string                       // ISO timestamp of the manifest write
  artifacts: Record<ArtifactKey, string>  // logical key -> content-hashed filename,
                                          // relative to the app's base URL
  overlays: Record<string, OverlayTileset> // open-ended: keyed by whatever the data
                                           // build declares as an overlay
  crashData: {
    years: number[]                     // every distinct crash year in the published data,
                                        // ascending; the app derives the exposure-period
                                        // count and the display range from it
  }
}
```

**Why the crash years live here.** They are a fact about the
published data, not a setting: the exposure period is however many
years the build actually ingested. They belong to the manifest for
the same reason the artifact filenames do — the manifest is the only
part of the data set that changes when the data is refreshed, so
anything derived from the data has to travel in it or it will drift.

The drift is not hypothetical, and it is silent. The exposure period
divides crash counts in every SII calculation and is stated on the
report cover page. A hand-maintained copy that says seven years,
sitting beside data that now holds eight, produces benefit-cost
numbers that are uniformly wrong by a seventh and look entirely
plausible — in a document that goes into a funding application.
Emitting it from the build is what makes that failure impossible
rather than merely unlikely.

The list is published rather than a count and a label because the
count is not always the span. If a year is missing from the source
export, seven distinct years may span 2018 to 2025, and dividing by
the span would understate every crash rate. The app takes the count
from the list's length and the label from its ends, so the two can
never disagree, and the build warns when the list has a gap.

A build that does not rebuild crashes carries this section forward
from the previous manifest, exactly as it carries forward the
artifacts it did not touch. A build that can do neither fails, since
there is no safe value to invent.

**Why `artifacts` and `overlays` are separate.** `artifacts` holds
the files the app's own code asks for by name, so the list is fixed
and every entry must be present. `overlays` holds background map
layers, and which of those exist is a data decision, not a code one:
the client adds one by putting a file in `input_data/`, adding an
entry to the build config, and adding a layer to the overlay config.
No code changes, so there is no name for the code to add.

Keeping overlays in `artifacts` would have blocked that in both
directions. A new overlay would have no valid key until someone
edited the app's type, and a *removed* overlay would stop the app
from starting at all, because a missing required entry is a hard
error. Under `overlays`, a removed overlay costs its own layer a
console warning and is skipped; the rest of the map is unaffected.

**One name, end to end.** The key in the build config is also the
published filename, the layer name inside the tile file, the key in
this manifest, and the `source` value the overlay config points at.
Because there is only ever one name, there is no second name that can
drift out of step with it. The app build also checks every `source`,
`style.column`, and `where.column` against this manifest, so a typo
fails the build rather than shipping a layer that quietly draws
nothing.

**How it is used.** Fetched at startup with `cache: 'no-cache'`,
which means "check with the server" rather than "skip the cache",
before any store loads or any map layer appears. Stores wait for it
before working out their URLs; map layers, which cannot wait, simply
do not appear until it has arrived.

Reading it fails loudly if an entry is missing or the
`schemaVersion` is one this app does not know, because handing out
URLs from a half-understood manifest would be worse than stopping.
Extra keys it does not recognize are ignored, so a later version can
add fields without forcing a version change.

Everything asks `artifactUrl(key)` for a URL and nothing hardcodes a
filename. Because the hash is in the filename, a URL identifies its
exact contents, which makes the crash database's freshness check as
simple as comparing the URL against the one the cached copy came
from.

---

## Data stores

The app only reads these; nothing writes back through them.

A store reading a downloaded file also exposes `isLoading`. A store
reading data built into the app is a plain module whose functions
answer immediately.

### CrashStore

`state/crashStore.svelte.ts`.

```ts
type CrashLoadHooks = {
  onDownloadProgress?: (loaded: number, total: number | null) => void
}

interface CrashStore {
  load(hooks?: CrashLoadHooks):     Promise<void>
  queryAll():                       Promise<CrashRecord[]>
  query(region: Region | null):     Promise<CrashRecord[]>
  countByEA(region: Region | null): Promise<BreakdownResult>
  isLoading: { get(): boolean }
  error: { get(): string | null }
}
```

`load()` is called once at startup. Calling it again is harmless:
callers that arrive while it is still running share the same
in-flight work rather than starting a second download. It looks up
the database URL in the manifest and hands it to the worker, which
skips the network completely when that URL matches the copy already
stored. `onDownloadProgress` drives the startup progress bar, and
`error` lets the interface show what went wrong instead of an empty
screen.

`query` and `countByEA` take an area, or `null` meaning every crash.
Which kind of query that needs is decided inside the store:

- A city or county area becomes a plain indexed lookup on the
  `countyId` or `cityId` column, which is fast because the values are
  already stamped on each row.
- A drawn area first asks the spatial index for the crashes whose
  bounding boxes overlap the shape, then tests those candidates
  properly with a point-in-polygon check. Narrowing by box first is
  what keeps the exact test cheap.
- `null` applies no filter.

Callers never see a column name or a filter shape.

Turning a site's stored crash ids back into records is deliberately
not a method here. `siteHelpers.querySiteCrashes` calls
`services/db/sqliteClient.queryByIds` directly. That function splits
the ids into batches of 900 per statement, because SQLite limits how
many values one statement can carry, so callers never have to think
about the limit.

### JurisdictionStore

`state/jurisdictionStore.svelte.ts`.

```ts
interface JurisdictionStore {
  list():                  Promise<Jurisdiction[]>
  getByName(name: string): Promise<Jurisdiction>
  isLoading: { get(): boolean }
}
```

Reads the boundary GeoJSON file, fetched once per session from its
hashed URL.

### CountermeasureCatalog

`data/countermeasureCatalog.ts`. Reads the countermeasure JSON that
the build generates from a CSV file. It is built into the app, so
there is nothing to wait for and no loading state.

```ts
function list():                                 Countermeasure[]
function getByWorkcode(workcode: string):        Countermeasure | undefined
function filterByApplicableWorkcodes(
  activeFlags: Set<HsipFlagKey>,
): Countermeasure[]
function catalogFieldValue(
  value: string | null | undefined,
): string | null
```

`filterByApplicableWorkcodes` is what narrows the catalog for one
site. The caller passes the workcode tags found on that site's
crashes, and gets back the countermeasures matching at least one of
them.

`catalogFieldValue` turns the catalog's placeholder text into `null`,
so a field with nothing real in it displays as empty rather than as
a placeholder string.

### CrashCostTable

`data/crashCostTable.ts`. Reads the cost table the build generates
from `config/hsip/crash_costs.csv`. Three entries, one per severity
level. Built into the app, so answers are immediate.

```ts
function get(severity: Severity): number
function all():                   CrashCostEntry[]
```

---

## State containers

Each container exposes `get()` for reading and named methods for
changing. Svelte notices `get()` calls made while rendering and
updates those readers when the value changes.

### RegionState

```ts
type RegionStateValue = {
  current: Region | null
  references: Region[]        // explicit peer picks, current UI presents at most one
}

interface RegionState {
  get(): RegionStateValue
  setCurrent(region: Region | null): void
  addReference(region: Region):      void
  removeReference(regionId: string): void
}
```

The whole-region yardstick is not one of the `references`. It is
just the crash dataset with no filter, `CrashStore.countByEA(null)`,
so it needs no entry and no shape.

`references` holds only comparison areas the user picked
deliberately. The current chart shows one at most, but the field is a
list with no cap, so a wider chart could show several without
changing anything here.

A comparison area can be picked before any current area. It is then
shown against the whole-region yardstick on its own.

`addReference` quietly ignores an area already in the list, and the
current area. `setCurrent` drops the incoming area from `references`
if it was sitting there as a comparison.

### CustomRegionStore

Areas the user drew. This mirrors `JurisdictionStore`: that one
offers the ready-made city and county areas, this one offers the
hand-drawn ones, and both feed `RegionState`.

```ts
type CustomRegionStoreValue = CustomRegion[]

interface CustomRegionStore {
  get(): CustomRegionStoreValue
  add(region: CustomRegion):      void
  remove(regionId: string):       void
}
```

Not registered with the snapshot registry, so a drawn area is lost on
reload along with everything else.

### SiteList

Holds the user's sites.

```ts
type SiteListValue = Site[]

type PartBufferFields = Pick<SitePart, 'drawnGeometry' | 'bufferFeet' | 'bufferedGeometry' | 'crashes'>

interface SiteList {
  get(): SiteListValue
  add(site: Site):        void
  remove(siteId: string): void

  addPart(siteId: string, part: SitePart):                                              void
  removePart(siteId: string, partId: string):                                           void
  updatePartBuffer(siteId: string, partId: string, fields: PartBufferFields):           void
  updateSiteBuffer(siteId: string, allPartFields: PartBufferFields[]):                  void
  updatePart(siteId: string, partId: string, fields: Partial<Pick<SitePart, 'name'>>):  void

  updateSite(siteId: string, fields: Partial<Pick<Site,
    'name' | 'description' | 'owner' | 'growthRatePercent' | 'functionalClass'>>): void

  getSnapshot(): SiteListValue
  applySnapshot(sites: SiteListValue): void
}
```

Any change to a part also recalculates the site's combined crash
list, in the same single update as the part change itself. The two
can never be seen apart, so the site total can never briefly
disagree with its parts.

`updatePartBuffer` applies a new shape and buffer to one part.
`updateSiteBuffer` applies them to every part at once, for a
buffer change across the whole site, so the combined list is
recalculated once rather than once per part.

`removePart` refuses to remove the last part and does nothing
instead: a site always has at least one. Removing the last part is
really deleting the site, which the interface handles separately
behind a confirmation that says so.

`getSnapshot` / `applySnapshot` are the snapshot-registry opt-in
(see "Snapshot registry" below).

### ProjectState

Per-site alternatives, plus an optional user-pinned "preferred"
alternative per site.

```ts
interface ProjectState {
  getAlternatives(siteId: string): Alternative[]
  getAddedWorkcodes(siteId: string): Set<string>
  addAlternative(siteId: string, workcode: string):                          void
  updateAlternative(alternativeId: string, fields: Partial<Alternative>):    void

  removeAlternative(siteId: string, alternativeId: string):                  void
  removeByWorkcode(siteId: string, workcode: string):                        void
  removeBySite(siteId: string):                                              void

  pin(siteId: string, alternativeId: string):                                void
  unpin(siteId: string):                                                     void
  getPin(siteId: string): string | null

  setChosen(siteId: string, chosen: ChosenAlt):                              void
  clearChosen(siteId: string):                                               void
  getChosen(siteId: string): ChosenAlt | null
}

type ChosenAlt = {
  altId: string
  source: 'auto' | 'explicit'
  prevented: { K: number; A: number; B: number }
}
```

**The chosen countermeasure.** Each site has at most one, and it is
what the plan-wide progress bar and the report both use.

How it is decided: the one the user pinned, if they pinned one and it
still exists. Otherwise the one with the highest SII. That automatic
pick only exists once a construction cost has been entered, since
without a cost there is no score to compare. A deliberate pin is
honoured whether or not a cost was entered, because the count of
crashes prevented does not depend on cost.

The stored reference always points at a countermeasure that really
exists. Any removal that deletes the currently chosen one also clears
the chosen entry, and the pin if it pointed there. Leaving a dangling
reference would keep the site in the report — `assembleReport`
includes every site that has a chosen entry — while showing nothing
marked as chosen inside it.

Deciding this needs the SII, so rather than recalculating it
everywhere the answer is written down here. The workbench refreshes
it whenever the open site's countermeasures, costs, or pin change,
and confirming a buffer change refreshes it too, because a buffer
edit changes the crash counts underneath and can happen while the
workbench is closed. Both paths run the same scoring and
resolution helpers. Anything reading the result calls `getChosen`
and never touches the SII itself.

`prevented` is how many past K, A, and B crashes the chosen
countermeasure would have prevented at that site.

Removing a site from `SiteList` also drops its countermeasures and
its pin from here. Nothing reading `ProjectState` has to watch
`SiteList` as well to stay consistent.

### ActiveSite

The site currently open in the planning view.

```ts
type ActiveSiteValue = string | null   // siteId

interface ActiveSite {
  get(): ActiveSiteValue
  set(siteId: string | null): void

  getPart(): string | null   // partId
  setPart(partId: string | null): void
}
```

`set()` always clears any part selection. `setPart` does nothing when
no site is selected. Deselecting a part falls back to having the
whole site selected, never to nothing selected.

### ViewMode

Which half of the app is showing. It starts on `'diagnosis'`.

```ts
type ViewModeValue = 'diagnosis' | 'planning'

interface ViewMode {
  get(): ViewModeValue
  set(mode: ViewModeValue): void
}
```

### WorkbenchState

Which site's countermeasure workbench is open. Exposes a getter
property rather than `get()`.

```ts
const workbenchState: {
  readonly siteId: string | null
  open(siteId: string): void
  close(): void
}
```

Opening the workbench shrinks the map and mounts `WorkbenchPanel`.
Returning to diagnosis mode closes it.

### ProjectInfoState

Report header fields. Exposes a getter property rather than
`get()`.

```ts
const projectInfoState: {
  readonly value: ProjectInfo
  update(fields: Partial<ProjectInfo>): void
  getSnapshot(): ProjectInfo
  applySnapshot(snap: ProjectInfo): void
}
```

### Map styling

There is no container for map styling.

Whether crashes are shown, and which emphasis areas are selected,
are ordinary `$state` values inside `App.svelte`, passed down to
`MapToolbar` and `CrashHeatmapLayer`.

Which overlays are on lives in `OverlayState`, below.

Site highlighting is not stored at all. `SiteBufferLayer` works it
out from `ActiveSite` and `DraftSiteState` as it draws.

### OverlayState

Which overlay layers are switched on, and which of their legend
classes.

Overlay layers are declared in `config/overlays.yaml` and turned
into JSON when the app is built, so the set of ids is data rather
than a type in the code. That is why entries are looked up by string
id: the code cannot list names it has never seen.

`OverlayLayerDef` and the style shapes live in `src/types.ts` and
mirror `config/schemas/overlays.schema.json`. Change the two together.

```ts
type OverlayEntry = {
  on: boolean
  classes: string[]     // legend row keys switched on
}

interface OverlayState {
  entry(id: string): OverlayEntry
  setVisible(id: string, on: boolean): void
  toggleClass(id: string, key: string): void
}
```

Filled in from the configuration when the module first loads. `on`
comes from the layer's `visible` setting, and `classes` starts with
every legend row listed, so switching a layer on shows all of its
data rather than none of it.

A layer's coloring, its legend rows, and the filter for
switched-off rows all come from the same style declaration, worked
out by `src/services/overlayStyle.ts`. One source for all three is
what stops them disagreeing.

A `categorical` style draws only the column values it names, hiding
anything else, unless the configuration adds an `other` entry. This
matters in practice: the HIN data has many segments with no tier at
all, and they stay off the map without needing a second filter.

Not registered with the snapshot registry. No map styling is
snapshotted anywhere, so registering overlays alone would make them
the odd one out. If styling is ever included, include all of it.

### DrawingState

Which drawing tool is active. Terra Draw keeps the half-finished
shape itself; this only tracks which tool is selected.

```ts
type DrawingTool = 'region-polygon' | 'roadway-line' | 'intersection-point' | null

interface DrawingState {
  get(): DrawingTool
  setTool(tool: DrawingTool): void
}
```

### ErrorState

What the two error surfaces show. One fatal failure, which blocks the
app, and a short list of notices, which do not. See
`07-tech-decisions.md` "Error handling" for why failures are split
this way.

```ts
type ErrorEnvelope = {
  id:        number          // for keying a notice, never displayed
  at:        string          // ISO timestamp
  appBuild:  string          // commit the bundle was built from, 'dev' locally
  dataBuild: string          // manifest buildId, 'not loaded' before it arrives
  where:     string          // free text, e.g. 'boot / download-crashes'
  advice:    string | null   // a sentence for the person at the screen
  message:   string
  stack:     string | null
  browser:   string
  recent:    string[]        // the last 50 lines the app logged
  fatal:     boolean
}

type ErrorNotice = {
  envelope: ErrorEnvelope
  repeats:  number
}

interface ErrorState {
  readonly fatal:   ErrorEnvelope | null
  readonly notices: ErrorNotice[]
  report(envelope: ErrorEnvelope): void
  dismiss(id: number):             void
  reset():                         void
}
```

Read through plain getter properties rather than `get()`, matching
`DataManifest`.

Envelopes are built by `reportError(error, { where, fatal, advice? })`
in `services/errorReporter.ts`, the single place a failure goes. It
fills in the stamps and the recent log lines, then calls `report`.
Anything can be thrown in JavaScript, so it accepts `unknown` and is
responsible for turning a string, a plain object, or nothing at all
into something readable.

The first fatal failure is the one kept. Whatever fails next is
usually a consequence of it, and replacing it would bury the cause.
Nothing clears a fatal failure; reloading the page is the only way
out of that screen.

Two notices are the same notice when `where` and `message` match, so
a failure that fires repeatedly — a map tile that will not load —
counts up in one row instead of stacking. The first envelope of a
repeat is the one kept, because its log lines cover the start of the
trouble. Past four distinct notices the oldest is dropped.

There is no user-facing reference code. `where` already names what
failed in plain words, which is a better thing to quote than four
characters, and with no server there is nothing to look a code up in.

`reset()` is for tests and the development debug menu.

---

## One-off signals

There is no messaging system. Anything that is not a state change is
passed as a function to call, and anything that looks like a
broadcast is really a component reading state inside an `$effect`.

### Finishing a drawing

This is the one signal that passes through several components.

```ts
type DrawResult =
  | { type: 'region';       geometry: Polygon }
  | { type: 'roadway';      geometry: LineString }
  | { type: 'intersection'; geometry: Point }
```

- **Where it starts.** `DrawControl` wraps Terra Draw. When a shape
  is finished it calls the `onDrawComplete: (result: DrawResult) =>
  void` function it was handed.
- **How it gets there.** `App` owns that function and passes it to
  `MapToolbar`, which passes it on to `DrawControl` without using
  it.
- **Where it goes.** `App.handleDrawComplete` checks
  `result.type`. A drawn area goes to `handleRegionDraw` in
  `region.ts`, which checks the shape is within bounds, builds the
  `CustomRegion`, writes it to `customRegionStore` and
  `regionState`, clears `drawingState`, and returns either an error
  message to show or nothing. A road or intersection goes to
  `SiteWorkflowPanel.receiveSiteGeometry`, reached through a
  reference to that component.
- **What happens to a new site.** `SiteWorkflowPanel` keeps the
  half-built site locally and copies it into `draftSiteState` so
  `SiteBufferLayer` can redraw the buffer as the user drags the
  slider. It is not a `Site` yet. On confirm, the crash query runs,
  the crash list is worked out, and the finished `Site` is added to
  `siteList`.

### Cancelling a drawing

No signal at all. `drawingState.setTool(null)` is the whole
mechanism: `DrawControl` watches the tool and shuts down the active
Terra Draw mode when it clears.

`drawingState.registerInProgressCheck` lets the draw control publish
a function answering "is a shape half-drawn right now," which panels
check before switching away from drawing.

### The map interaction lock

`mapInteraction` is a lock rather than a message. An effect in `App`
holds it while a tool is active, and releases it a moment after the
tool clears. That delay matters: finishing a point drawing is a
click, and without it the same click would also land on whatever
crash circle sat underneath. Map click and hover handlers check the
lock and do nothing while it is held.

### Zooming the map to fit something

No signal. The layer that owns the shape watches the state that
should cause a zoom and calls `map.fitBounds` itself.
`CurrentRegionLayer` watches `regionState.current`.
`SiteBufferLayer` watches the selected site, the selected part, and
the edit target.

Picking a comparison area deliberately does not zoom, so adding one
never moves the view out from under the user.

### Exporting a report

A plain chain of calls. `ExportDialog` calls `generateReport`, which
builds the data, captures the map images, mounts `ReportDocument`
off-screen, and opens the print dialog.

### Why nothing else is a signal

Everything else that might have been one is a state change, so
readers just watch the container: `regionState` for the area,
`siteList` for site changes, `projectState` for countermeasure and
pin edits, `viewMode` for switching halves, `activeSite` for
selection.

A signal would only be worth adding for something that is not
re-rendering, such as showing a brief notification.

## Helpers

### Site creation and buffer edit helpers (`siteHelpers.ts`)

Called by `SiteWorkflowPanel` when the user confirms, both when
creating a site and when editing its shape or buffer. The panel
calls a helper, then writes the result to `siteList`.

Shapes and crash lookups:

- **`createPart(input)`** — builds a `SitePart` from a drawn shape:
  grows the buffer with Turf, then runs the one crash query that
  shape needs. Used for a new site's first part and for parts added
  later alike.
- **`createSite(input)`** — wraps `createPart` into a finished
  one-part `Site`.
- **`requeryPartBuffer(part, bufferFeet)`** — redoes one part's
  buffer and crash list. Only the part that changed is queried.
- **`requerySiteBuffer(parts, bufferFeet)`** — redoes every part at
  one shared buffer distance, for a change across the whole site.
- **`replacePartGeometry(part, drawnGeometry)`** — swaps in a
  redrawn shape and requeries at the buffer already set. The part
  keeps its id and name.
- **`querySiteCrashes(site)`** — the full crash records for a site,
  for the views that need the emphasis area and workcode columns.
  Looks up the stored `crashIds` through
  `sqliteClient.queryByIds`, which is consistent with the site's
  own stored counts by construction. The spatial query only ever
  runs when a shape changes.

Reading derived figures, in neighbouring modules:

- **`dedupeCrashUnion(rowsPerPart)`** (`crashUnion.ts`) — combines
  the parts' crash lists, removes duplicates, and tallies by
  severity. It touches no files or network, which is what lets
  `siteList` use it without the two modules importing each other in
  a circle. Tested directly.
- **`siteCrashProfile(site)`** (`siteCrashProfile.ts`) — a site's
  totals, plus K/A/B counts per workcode. Not stored on the site.
- **`siteBreakdownByEA(site)`** — the emphasis area breakdown for
  one site's crashes.

Names and labels, also in `siteHelpers.ts`: `partNameBase`,
`partNoun`, `partCountLabel`, `siteBadgeLabel`, `bufferRange`,
`isAutoName`, `nextGroupName`, `nextPartName`,
`singleSitePromotionRenames`, `demoteRenames`.

Generated names skip any number still in use after a deletion. The
promotion and demotion helpers keep a site's name sensible as it
gains or loses parts, so a site that drops to one part is not left
named as though it still had several.

### calculateSII

A plain function, with no state of its own, working out the TxDOT
HSIP Safety Investment Index for one countermeasure at one site.

```ts
function calculateSII(input: {
  alternative:      Alternative
  countermeasure:   Countermeasure
  crashCounts:      SeverityTriplet  // K/A/B crashes at site
  dataYears:        number           // Y: years of crash data
  growthRatePercent: number          // from Site, e.g. 2 for 2%/yr
  crashCostTable:   CrashCostEntry[]
}): {
  S:   number                        // annual savings
  Q:   number                        // annual growth adjustment
  B:   number                        // present worth of benefits
  C:   number                        // construction cost
  SII: number | null                 // B/C; null if C is null or 0
} | null                             // null if reductionFactor is null
```

The sum, as TxDOT publishes it:

    R  = countermeasure.reductionFactor
    Ck = crashCostTable K entry
    Ca = crashCostTable A entry
    Cb = crashCostTable B entry
    M  = alternative.annualMaintenance
    L  = alternative.serviceLife, clamped to [0, 100]
    g  = growthRatePercent / 100

    S = R * (Ck * K + Ca * A + Cb * B) / Y - M
    Q = ((1 + g)^L - 1) / L * S
    B = (S + 1/2 Q) / 1.06 + sum(i=2..L) [(S + 1/2 Q) + (i-1)Q] / 1.06^i
    C = alternative.constructionCost
    SII = B / C

The 6% discount rate is fixed, as TxDOT specifies. The caller passes
crash counts already narrowed to the site, so this function never
queries anything itself.

TxDOT writes the savings line with one combined figure covering K
and A together. The version above prices the three levels
separately, which is a generalization of the same thing: give K and
A equal costs, as the shipped configuration does, and the two are
algebraically identical. The split only starts to matter if an
agency decides to price a fatal crash above a serious injury.

Service life is capped at 100 years inside the function rather than
only in the input box. The benefit is a sum with one term per year,
so an unbounded value would be a loop long enough to freeze the tab,
and dev fixtures can reach this function without passing through the
input box at all. Catalog service lives run 5 to 30 years, so the
cap is unreachable in normal use. Capping rather than refusing means
a restored session still shows numbers instead of an unexplained
blank.

### Snapshot registry

`state/sessionRegistry.ts`. Gathers the whole app's state into one
snapshot, and pushes a snapshot back in. This is the registration
half of saving; nothing is attached to it that writes to storage.

```ts
function register(
  key:           string,
  getSnapshot:   () => unknown,
  applySnapshot: (v: unknown) => void,
): void

function captureAll(): SessionSnapshot
function applyAll(snapshot: SessionSnapshot): void
```

- **Registering.** A container calls `register` once when its module
  loads, giving a unique key, a function returning its current state,
  and a function that accepts state back. The registry also records
  what the container held at that moment, before the user has touched
  anything. If the same key registers twice the newer one wins, so a
  dev-server reload replaces the entry instead of failing.

- **`captureAll`.** Reads every registered container into
  `stores[key]` and stamps the version on it.

- **`applyAll`.** Replaces rather than merges. Every registered
  container ends up exactly as the snapshot describes: it gets its
  own slice if the snapshot has one, and its original starting value
  if not. That second half matters — a snapshot taken before some
  container existed must not leave that container holding whatever
  the previous session put there.

  Keys with no matching container log a warning and are skipped.
  Each container is handed a copy of its slice rather than the
  original, so it cannot end up sharing an object with the caller.
  Loading the same fixture twice therefore applies clean data both
  times.

Registered: `siteList`, `projectState`, `projectInfoState`.

Deliberately not registered: `draftSiteState`, `drawingState`,
`mapInteraction`, `workbenchState`, `loadingState`, and `errorState`,
all of which hold moment-to-moment interface state that would make no
sense restored — a failure from a previous session least of all. `overlayState` is left out too, because no map styling is
snapshotted and including overlays alone would make them the odd one
out.

Data stores are never in a snapshot. They can always be rebuilt from
the manifest and the stored files.

**Nothing saves these.** No storage is attached. The only code using
this registry is the development debug menu, which captures and loads
test fixtures, and that is stripped from production builds. So no
user work survives closing the tab.

Adding saving means attaching storage and a delayed write to these
same registrations. See `08-future-ideas.md`.
