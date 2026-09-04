# Architecture

What the pieces of the app are, what each is responsible for, and how
they talk to each other. Which libraries were chosen, and why, is in
`07-tech-decisions.md`.

## Principles

- **State lives in containers that components watch.** Each piece of
  shared state sits in its own module and is exposed through a
  `get()` method (or a plain getter). Those modules are built on
  Svelte's `$state`, which tracks who read what: a component that
  reads a container while rendering is re-rendered on its own when
  that container changes. Nothing sends a "this changed" message by
  hand.

- **One-off signals are passed as functions.** Some things are not
  state changes at all, such as "the user just finished drawing." A
  component that needs to report one is handed a function to call,
  and calls it. There is no app-wide messaging system to publish to.

- **Views are computed from state, not patched.** A component works
  out what it should look like from whatever the state currently
  says. Map layers are the exception, because MapLibre is driven by
  method calls rather than markup; they make those calls inside an
  `$effect`, which is a block Svelte re-runs whenever the state it
  read changes. So even there the state is what drives the calls.

- **One job per component.** If describing what a component does
  needs two sentences, or an "and," it should be two components.

- **The map is one surface with layers on it.** `MapView` creates
  the MapLibre map and shares it with its children through Svelte
  context, which is a way to pass a value down a component tree
  without threading it through every level. Each thing drawn on the
  map is a child component that adds its own data and layers when it
  appears and removes them when it goes away. There is a single map
  for the whole app, shared by both halves.

- **Drawing the map and querying the data are separate paths.** Map
  layers read PMTiles, the pre-built tile files. Counting and
  filtering read the SQLite database in a Web Worker, a background
  thread separate from the one that draws the page. The two never
  share a data path at runtime, which means the map appears as soon
  as tiles arrive rather than waiting for the database to load.

- **Downloaded once, then kept locally.** Crash data arrives as a
  prepared SQLite file, stored in OPFS (Origin Private File System,
  a private per-site filesystem in the browser). Tiles and boundary
  GeoJSON rely on ordinary browser caching. Countermeasures and the
  crash cost table are small enough to be built into the app itself.
  After startup, using the app needs no network.

- **The user's work is only in memory.** Nothing survives closing
  the tab. See "The user's work" below.

## Overall shape

One app, one browser tab, one map.

The two halves of the user's work are held in a `viewMode` container
as `'diagnosis'` (understand the problem, pick sites) and
`'planning'` (countermeasures per site, export). They are two modes
of one screen rather than two pages: switching writes a value, and
nothing is handed over, because every panel reads the same
containers either way.

The layout is three columns under a header. On the left is the site
workflow panel. In the middle is the map, which shrinks to make room
for the countermeasure workbench when a site is opened. On the right
is a panel that swaps between the diagnosis and planning panels
depending on `viewMode`.

### The user's work

Nothing is saved anywhere.

`sessionRegistry` holds half of what saving would need. Containers
opt in by calling `register(key, getSnapshot, applySnapshot)`, and
the registry can then gather the whole app's state into one snapshot
(`captureAll`) or push a snapshot back into every container
(`applyAll`). Three containers are registered: `siteList`,
`projectState`, and `projectInfoState`.

The missing half is storage. Nothing writes those snapshots
anywhere. The only code that uses the registry is the development
debug menu, which loads test fixtures, and that is stripped out of
production builds. So closing the tab discards everything.

## The pieces

### Data stores

The app only reads these. Each one sits in front of a prepared file.

- **crashStore** (`state/crashStore.svelte.ts`). Hands back crash
  records, and counts per emphasis area, for a given area. Callers
  pass an area and get an answer; working out which kind of query
  that needs is the store's business, not theirs.
- **jurisdictionStore** (`state/jurisdictionStore.svelte.ts`). The
  county and city list, read from the boundary GeoJSON file.
- **dataManifest** (`state/dataManifest.svelte.ts`). Reads
  `manifest.json` at startup, then turns a plain name like `appDb`
  into the real hashed filename to fetch. Nothing else in the app
  hardcodes a data filename.
- **countermeasureCatalog** (`data/countermeasureCatalog.ts`). The
  countermeasure list. Built into the app, so lookups return
  immediately rather than returning a promise.
- **crashCostTable** (`data/crashCostTable.ts`). Dollar cost per
  severity level. Also built in, also immediate.
- **overlayConfig** (`data/overlayConfig.ts`). The overlay layer
  definitions, generated from `config/overlays.yaml` when the app is
  built.
- **emphasisAreas**, **hsipWorkcodes**, **severityMeta** (`data/`).
  The emphasis area ids, the HSIP workcode field names, and the
  severity labels and colors. These are single sources of truth:
  the same lists are used to decode the crash flag columns, filter
  the map, and color the legend, so those three cannot drift apart.

### State containers

- **regionState.** The area currently chosen, and the comparison
  area if one is picked.
- **customRegionStore.** Areas the user drew by hand. Feeds
  `regionState` the same way `jurisdictionStore` does.
- **siteList.** The sites the user has created. Each site holds a
  name, a type, where it came from, and one or more parts. Each part
  holds its drawn shape, its buffer distance, the buffered shape,
  and the crashes inside it. The site's own crash list is the parts'
  crashes combined with duplicates removed, and it is recalculated
  inside every change to a part, so it can never fall out of step.
- **projectState.** Per site: the countermeasures being compared,
  which one the user pinned if any, and the one currently counted as
  chosen along with how many crashes it would prevent.
- **projectInfoState.** The report header fields: project name,
  organization, analyst, locality, notes.
- **activeSite.** Which site is selected, and optionally which part
  within it.
- **viewMode.** Which half of the app is showing, `'diagnosis'` or
  `'planning'`.
- **workbenchState.** The id of the site whose countermeasure
  workbench is open, or null when none is.
- **overlayState.** Which overlays are switched on, and which of
  their legend entries. Keyed by overlay id rather than a fixed list
  of names, because the overlays themselves come from configuration.
- **drawingState.** Which drawing tool is active. The draw control
  also registers a function here that answers "is a drawing
  half-finished right now," so panels can check before switching
  away.
- **draftSiteState.** The site being drawn right now: its shape, its
  buffer, and the buffered shape, so the map can preview it live. It
  also records which existing site or part is being edited, and
  which part to hide while it is replaced. Not snapshotted.
- **mapInteraction.** A lock. While a drawing is in progress it is
  held, and map click and hover handlers check it and do nothing. It
  stops the click that finishes a drawing from also selecting
  whatever was underneath.
- **loadingState.** Which startup step is running, and how far along
  the progress bar should be. Steps are weighted, because the crash
  download takes far longer than the others.
- **reportGenerationState** (`services/`). How far report generation
  has got. Shared by the export dialog and the debug menu so both
  run exactly the same code.

### The map and its layers

- **MapView.** Creates the MapLibre map and shares it with its
  children.
- **MapToolbar.** The controls that sit on top of the map. It
  arranges `CrashLayerControl`, `CrashPointLegend`, and
  `OverlayLayerList`, and passes the draw-finished function through
  to whatever it wraps without looking at it.
- **CrashHeatmapLayer.** Draws crash points from the tiles. Zoomed
  out it is a heatmap showing where crashes bunch up; zoomed in it
  fades into individual circles colored by severity. Filtered by
  whether crashes are switched on and which emphasis areas are
  selected.
- **OverlayLayer.** Draws one overlay layer, colored and filtered
  according to its own definition and what `overlayState` says is
  switched on. One of these exists per configured overlay.
- **CurrentRegionLayer.** Draws the outline of the chosen area and
  zooms the map to fit it when it changes. Comparison areas are
  never drawn on the map; they appear only in the breakdown chart.
- **SiteBufferLayer.** Draws every site: its buffered shapes and the
  lines or points they came from, plus the one being drawn right
  now. Highlighting the selected site is not a separate layer.
  Instead every shape is tagged `'active'` or `'inactive'`, worked
  out from `activeSite` and the draft, and MapLibre varies color,
  opacity, line width, and point size off that tag. This layer also
  zooms the map when the selection or the edit target changes.
- **DrawControl.** Wraps Terra Draw. When a shape is finished it
  turns it into a simple typed result and calls the function it was
  given.

### Panels and dialogs

- **SiteWorkflowPanel.** The left panel: draw buttons, the card for
  the site being drawn, and the list of finished sites with
  expand-to-edit. It keeps the draft locally and copies it into
  `draftSiteState` so the map can preview it. Contains
  `BufferControl`, `SiteUploadDialog`, and `ExportDialog`.
- **BufferControl.** The buffer distance slider, with a number box
  that can be typed into instead.
- **SiteUploadDialog.** Takes an uploaded shape file and turns it
  into a site.
- **RegionAnalysisPanel.** The right panel in diagnosis mode.
  Contains `RegionPanel`, `ReferenceRegionPicker`, and
  `BreakdownView`.
- **RegionPanel.** Takes the area choice, either from the city and
  county list or from a drawn outline.
- **ReferenceRegionPicker.** Takes the optional comparison county or
  city.
- **BreakdownView.** Draws the emphasis area comparison: the chosen
  area against the whole-region yardstick, plus one optional
  comparison area, shown either as plain shares or as differences.
- **SitePlanningPanel.** The right panel in planning mode: the site
  list with how far each site has got, the plan-wide crash reduction
  bar, and the button back to diagnosis.
- **WorkbenchPanel.** The panel below the map for the open site.
  Contains `CountermeasureLibrary` and `AppraisalTable`, and
  recalculates which countermeasure counts as chosen whenever the
  inputs change.
- **CountermeasureLibrary.** Takes countermeasure picks from the
  catalog, showing the ones that apply to crashes at this site.
- **AppraisalTable.** The comparison table for one site: crashes
  prevented, cost boxes, the SII working, and the pin buttons.
  Sorted by SII.
- **CrashLayerControl.** Switches the crash layer on and off and
  picks which emphasis areas to show.
- **CrashPointLegend.** The severity color key.
- **OverlayLayerList.** One row per configured overlay, in the order
  the configuration lists them, each with its legend toggles.
- **SplashDialog.** Startup progress and a short introduction.
- **ExportDialog.** Takes the export choices and starts the report.
- **ReportGenerationOverlay.** Shows report progress while it runs.

### Building the report

`report/ReportDocument.svelte` assembles the printable document out
of `ReportAbout`, `ReportSiteSection`, `ReportMapMeta`,
`ReportCountermeasureAppendix`, and `ReportCalculationAppendix`.
`services/generateReport.ts` mounts it off-screen and then opens the
browser's print dialog.

### Services and helpers

Plain logic. None of these hold component state.

- **siteHelpers.** Building sites and parts, redoing the crash query
  after a buffer or shape change, looking up a site's crash records,
  and generating names and labels.
- **crashUnion.** Combining the parts' crash lists into one with
  duplicates removed, and tallying it by severity.
- **siteCrashProfile.** A site's crash totals, plus the K/A/B counts
  per workcode, which is what tells the catalog which
  countermeasures apply.
- **calculateSII.** The TxDOT Safety Investment Index sum for one
  countermeasure at one site.
- **sitePlan.** Scoring the countermeasures at a site and deciding
  which one counts as chosen. Shared by the workbench and by the
  buffer-edit path so both agree.
- **assembleReport.** Builds the report data from app state and the
  crash rows fetched for it.
- **captureMaps.** Grabs the map images the report needs. They are
  temporary and never stored.
- **generateReport.** Runs the whole export in order: assemble,
  capture, mount, print.
- **parseUploadedFile.** Reads an uploaded shape file, checks it, and
  turns it into site parts.
- **loadManifest.** Reads `manifest.json` and checks it is valid.
- **loadJurisdictions.** Fetches the boundary GeoJSON and tidies up
  its shapes.
- **overlayStyle.** Turns one overlay's style declaration into three
  things at once: the MapLibre coloring rules, the legend rows, and
  the filter for switched-off legend entries. One source for all
  three is what stops them disagreeing.
- **errors.** The named error types.
- **region.ts** (`src/`). Checking and building a drawn area.
- **db/sqliteClient**, **db/sqliteWorker**, **db/flagCodec**. Talking
  to the worker, the worker itself, and packing and unpacking the
  crash flag columns.
- **map/baseMapStyle**, **map/overlaySource**. The basemap style URL
  and its attribution line, and building overlay tile sources.
- **remote/esri**. Helpers for fetching from ESRI services. Kept for
  build-time data conversion, not used while the app runs.

## How the pieces talk

### State changes

A component calls a container's change method. Every component that
had read that container then updates on its own. Picking an area, for
example:

1. `RegionPanel` calls `regionState.setCurrent(region)`.
2. `CurrentRegionLayer` re-reads `regionState`, swaps its shape data,
   and zooms the map.
3. `BreakdownView` re-reads it, asks `crashStore.countByEA` for new
   counts, and redraws.

Nobody arranged that. All three happen because each one had read
`regionState`.

Switching halves works the same way. `viewMode.set('planning')`
makes the right panel swap and the header button appear. Nothing is
handed over, because the planning panels read `siteList` and
`projectState` for themselves.

### One-off signals

A finished drawing goes down as a function and comes back as a call.
`App` hands `handleDrawComplete` to `MapToolbar`, which passes it
along to `DrawControl` without using it. When Terra Draw finishes a
shape, `DrawControl` calls it with a small typed result, and `App`
checks the type: a drawn area goes to the handler in `region.ts`, a
road or intersection goes to a method on `SiteWorkflowPanel` so the
draft card can take over. `App` only chooses between the two; it
does no handling itself.

Zooming the map to fit something is not signalled at all. The layer
that owns the shape watches the state that ought to cause a zoom and
calls `fitBounds` itself. Selecting a site always frames it, with
nothing needing to coordinate that.

Exporting is a plain chain of calls: `ExportDialog` calls
`generateReport`, which builds the data, captures the images, mounts
the document, and prints.

Components never reach into each other. They read containers, or
they call functions they were handed.

## Decisions worth knowing

- **Many small containers rather than one big one.** Each is easy to
  follow and easy to test alone, and reading across several costs
  nothing under Svelte's reactivity. Gathering them all up for a
  snapshot is `sessionRegistry`'s job, which is a better place for it
  than merging the state itself.

- **Overlays come from configuration, not code.** Which reference
  layers exist, how they look, and what their legends say all come
  from `config/overlays.yaml` and the data build, so a layer can be
  added or dropped without touching the app. That is exactly why
  overlays are tracked by string id: a fixed list of names in code
  could not include a layer the code has never seen.

- **Crashes are counted upstream or in SQL, never in the page.**
  Counts per emphasis area for an area are a SQL sum. Per-site
  figures are worked out from the rows already fetched for that
  site. Nothing walks the whole crash set on the thread that draws
  the page.

- **The SII is recalculated, not stored.** A countermeasure entry
  holds only what the user typed. The one exception is the chosen
  countermeasure, whose result is written into `projectState` so
  that the progress bar and the report can ask "what did this site
  pick" without redoing the sum.

- **No limits built into the state.** Any number of countermeasures
  per site, any number of overlays on the map. Where too many
  becomes unreadable is a question for the interface, not for the
  state.

- **Sites store crash ids, not crash records.** A site keeps the ids
  and a severity tally; the full records are fetched when something
  needs them. The spatial query only runs when a shape actually
  changes.
