# Technology Decisions

Which tool was chosen for each job, what else was considered, and
why. The choices follow from the architecture and contracts rather
than the other way round.

---

## Language: TypeScript, loose config

**Chosen.** TypeScript with relaxed settings: `strict: false`,
`noImplicitAny: false`, `allowJs: true`, `skipLibCheck: true`.
Strictness is a dial to turn up over time, not something to set to
maximum on day one.

**Also considered.**

- Plain JavaScript. Throws away the type information the contracts
  already spell out, and loses the editor's help across a lot of
  components.
- TypeScript in strict mode. The strongest checking, but noisy while
  still learning the language.
- Types written in JSDoc comments. Clumsy for anything generic and
  the editor helps less.

**Why.**

- The contracts are already written in TypeScript syntax, so the
  shapes copy straight into `.ts` files with no translation.
- The loose settings let the compiler help without it complaining
  constantly. `strict: true` can be switched on later, per file or
  everywhere.
- Every library used here ships its own types or has community ones.
- It costs nothing at runtime. The types are stripped out when the
  app is built, leaving plain JavaScript.

---

## Framework: Svelte 5 with runes

**Chosen.** Svelte 5, using its runes API (`$state`, `$derived`,
`$effect`), with TypeScript in component files. Runes are Svelte's
way of marking which values are reactive, meaning values that cause
whatever read them to update when they change.

**Also considered.**

- React with Vite. Much the largest ecosystem, but a heavier runtime,
  and it leaves how to manage shared state entirely up to you.
- Preact. Works like React at a fraction of the size, but inherits
  the same open question about state.
- Lit. Built on web standards, better suited to reusable widgets
  than to a whole app, and state is hand-rolled.
- Plain JavaScript with a hand-written subscription system.
  Possible, but rebuilds what Svelte already gives for free.

**Why.**

- Svelte's reactive state maps almost one-to-one onto the state
  containers the architecture calls for, so there is very little
  translation between the design and the code.
- Types survive through reactive expressions, so editor help keeps
  working inside `$derived` chains.
- Smaller than React at runtime, because most of Svelte compiles
  away when the app is built.
- Less hidden behavior than React: no rules about what may happen
  during a render, and no concurrent-rendering rules to learn.

**The trade-off.** A smaller ecosystem than React, and fewer
examples to copy from. Acceptable for a tool with a known, fixed
scope.

---

## Build tool: Vite, plain Svelte-TS template

**Chosen.** Vite, from its `svelte-ts` template. A plain Svelte
single-page app, not SvelteKit. SvelteKit is the larger framework
built on top of Svelte, adding routing and server-side features.

**Also considered.**

- SvelteKit with `adapter-static`. Adds routing based on file
  layout, a server-endpoint model, and its own data-loading
  functions. It can produce a static site, but none of that buys
  anything here.
- Rollup or webpack on their own. Older ground, without Vite's
  dev-server conveniences.

**Why.**

- The app is one page with two modes, not two pages. A router has
  nothing to route.
- No server endpoints, and nothing to gain from rendering pages on a
  server ahead of time.
- Vite handles TypeScript, `.svelte` files, live reloading, and
  building to `dist/` with its defaults. The output is static files
  that drop onto any host once the base path is set.

**The trade-off.** Most Svelte tutorials assume SvelteKit, so
examples need mentally stripping of their SvelteKit wrappers. A
small ongoing tax, not a blocker.

---

## Data layer

These belong under one heading because they lean on each other:
where data comes from, what stores it locally, how the app knows
when it has changed, and how spatial questions get answered.

### ESRI services

Nothing the running app needs comes from an ESRI service. Two uses
remain:

1. **A source for the build.** An ESRI FeatureServer layer can be
   turned into a PMTiles file ahead of time with
   `ogr2ogr | tippecanoe`. The build can point at a service URL and
   produce a static tile file, with no custom code needed.
2. **A fallback for fetching live (not used).** The existing fetch
   code, which handles paging through results and detecting the
   coordinate system, can still pull a layer while the app runs and
   draw it as GeoJSON. It is kept only in case some layer changes
   often enough that preparing it ahead of time stops making sense.

### Static config files (countermeasures, crash cost)

**Chosen.** JSON files under `src/data/`, imported directly. Vite
builds them into the app and drops anything unused. Their types match
the entities in the contracts.

**Also considered.** Putting them in `public/` and fetching them
while the app runs. That makes swapping a file easier without
rebuilding, but adds a wait for data that is tiny and always needed.

**Why.**

- The files are small enough that including them costs nothing.
- Tying the data to the app version is the point: a new
  countermeasure list means a new release, and a report can be traced
  back to exactly which version produced it.
- Editing a file and committing it leaves a clearer history than
  editing a layer on a remote server.

### Running SQLite in the browser: `@sqlite.org/sqlite-wasm`

**Chosen.** The SQLite team's own WebAssembly build, set up to store
its file in OPFS through the "SAH pool" mode. Some terms:

- **WebAssembly** is a format that lets code written in C, as SQLite
  is, run inside a browser.
- **OPFS** (Origin Private File System) is a private filesystem the
  browser gives each site.
- **SAH** stands for sync access handle, a way of reading and writing
  an OPFS file directly rather than through callbacks. SQLite needs
  that, because its internals expect plain file reads.

**Also considered.**

- The same package using ordinary OPFS instead of the SAH pool. That
  mode needs two special HTTP response headers to be set, and GitHub
  Pages does not allow custom headers. Ruled out on hosting alone.
- `wa-sqlite`, a community build. More options, smaller community,
  and some of its options need those same headers. No clear gain.
- `sql.js`, which keeps the whole database in memory and saves by
  dumping it out and reloading it. For a table of this size that
  means re-reading hundreds of megabytes on every load. Ruled out
  on size.

**Why.**

- The SAH pool mode needs no special headers, so it works on GitHub
  Pages as-is.
- It is the official build, so it will be maintained for a long time.
- Reads are fast: the worker reads the file directly, and only the
  results cross back to the main thread.

**One tab at a time.** A sync access handle takes an exclusive lock
on the file, so a second tab opening the same database fails. This is
a browser file lock, not a SQLite one.

The answer is to treat the stored database as **throwaway**. It is
only a copy of a file that can be downloaded again. If setting up
OPFS fails, for any reason — a second tab, an unsupported browser,
private browsing — the app falls back to an in-memory database with
the same schema and the same queries. `CrashStore` looks identical
either way and callers never find out which is in use. The only cost
is downloading the file again next time.

The user's own work is never at risk here, because it never goes
into SQLite at all; it lives in ordinary app state.

### Cache invalidation: content-hash filenames + manifest

The problem: the app keeps a local copy of a downloaded file, and
needs to know when that copy is out of date.

The answer: put a hash of the file's own contents into its name, for
example `app-40d0b929.db`. Change the data and the name changes with
it. A small `manifest.json`, fetched at startup, lists the current
names and a `buildId` worked out from those hashes. The build writes
the manifest in one go and deletes the files it replaced.

In the app, everything looks up its URL in the manifest. The worker
compares the database URL against the one its stored copy came from:
the same means no network request at all, different means download.

**Why this rather than asking the server "has this changed?"**

- **It does not depend on the host.** Asking the server relies on it
  sending back reliable validity information. Naming by content works
  the same on GitHub Pages, on S3 behind a CDN, or on a client's own
  server — which matters, because this data-layer pattern is meant to
  be reused on other projects.
- **It suits a CDN.** A hashed name never changes contents, so a CDN
  can hold it as long as it likes and never needs clearing.
- **Everything switches together.** One manifest write moves the
  database, the tiles, and the boundaries to their new versions at
  once. Checking each file separately leaves a brief window during a
  deploy where they could disagree.
- **It doubles as a version stamp.** The hash identifies exactly
  which data a user saw, which is what the report records.

Also rejected: tying data refreshes to the app version. That couples
two unrelated things and still does not notice when a file's contents
change under an unchanged name.

The tiles are not stored by the app at all. MapLibre asks for the
pieces it needs as the user pans, and ordinary browser caching covers
it. Their hashed names still matter for three reasons: they clear
every cache between the host and the user, they switch at the same
moment as the database so the map and the numbers can never show
different vintages, and a format read in pieces must never have its
bytes change under a fixed name, since offsets from a stale index
would read nonsense out of a replaced file.

### Session persistence: none

Nothing saves the user's work, so no storage library is a
dependency at all. `state/sessionRegistry.ts` can gather the app's
state into a snapshot and put one back, but nothing writes those
snapshots anywhere; the only code using it is the development debug
menu.

If saving is added later, IndexedDB is the right fit. It is the
browser's store for structured data of this size, it has a generous
quota, and it works through transactions rather than the exclusive
file locks that limit the SQLite copy to one tab. Keeping it separate
from that copy is the point: refreshing the data must not be able to
damage the user's own work.

`localStorage` would not do. Its API blocks the main thread while it
writes, and its 5 MB limit is too small for site shapes and crash id
lists.

See `08-future-ideas.md`.

### Spatial query strategy: pre-tagged jurisdiction columns + R*Tree

**Chosen.** Two different methods, because there are two very
different questions being asked.

- **Which crashes are in this city or county?** Every crash row
  already carries `countyId` and `cityId` columns, filled in
  upstream by the SS4A pipeline. Both are indexed, so this is a
  plain equality lookup with no spatial work at all while the app
  runs.
- **Which crashes are inside this drawn buffer?** An R*Tree — a
  spatial index built into SQLite — is filled in alongside the crash
  table. A buffer query asks it which crashes have a bounding box
  overlapping the buffer's box, then tests those few candidates
  properly with Turf's point-in-polygon check.

**Why split them.**

- Cities and counties are a fixed, known list. Tagging them once,
  upstream, turns every later query into an indexed lookup. Doing it
  spatially instead would mean pulling tens of thousands of
  candidates and testing each against a many-ringed county outline.
- Drawn buffers are the opposite: they only exist once the user
  draws them, and the distance can change afterwards, so they cannot
  be tagged in advance and genuinely need a spatial index.
- The SQLite build used here already includes R*Tree, so nothing
  extra has to be loaded.
- Narrowing by bounding box and then testing exactly is the usual
  stand-in for a full spatial extension, which is not available in
  this build. It is cheap here because buffer boxes are small, so
  only a few dozen candidates come back.

**Also considered.** Doing the city and county tagging in the
browser at load time instead of upstream. That moves a one-time cost
into every user's first load, and duplicates work the upstream
pipeline was already doing anyway.

### Packing the tag columns into bits

**Chosen.** Pack the 14 emphasis area columns and the 24 workcode
columns, each holding 0 or 1, into two compact columns of raw bytes
(`ea_flags`, `hsip_flags`). These sit alongside the original
one-per-tag columns rather than replacing them. Packing happens when
the database is built; unpacking happens inside the worker as rows
are read. Nothing outside the worker ever sees the packed form, so
`CrashRecord` and `BreakdownResult` are unchanged.

**The problem this solves.** A drawn-buffer query has to turn
matching database rows into JavaScript objects. With 38 separate tag
columns, SQLite has to pull each one out of the row individually, the
binding then has to turn each into an object property, and every one
of those 38 properties has to be copied across the boundary from the
worker to the main thread. Across a large area of a 116,000-crash
table, that copying was taking longer than the actual work.

**How it works.** A small encoder and decoder in
`src/services/db/flagCodec.ts` handles both groups. It works out how
many bytes it needs from the length of the tag list rather than
having a number written into it, so adding a tag does not break it.
Each tag is one bit.

Reading a row now fetches two byte columns instead of 38 numbers, and
the worker unpacks them back into ordinary properties before handing
anything back. The counting path is narrower still: it fetches only
what it needs and tallies straight from the bytes without building
row objects at all.

**Why the original columns stay.** Counting crashes for a whole city
or county is done with `SUM()` in SQL, which needs real columns to
add up. They are also handy for ad-hoc queries while developing. The
only cost is disk space in a file that is thrown away and rebuilt
anyway.

**Why unpacking in JavaScript is not slower.** Pulling a column out
of a SQLite row means walking a variable-length record format, type
checking, and allocating through the binding, once per column. Reading
14 bits out of 2 bytes is a handful of integer operations on data
already sitting in an array. Copying 2 byte arrays across the worker
boundary is cheaper than copying 38 number properties. The unpacking
cost is trivial next to the cost it removes.

---

### CRS handling: Proj4js at ingest, stores always WGS84

**Chosen.** Convert incoming shapes to WGS84 (the coordinate system
web maps and GPS use, also written EPSG:4326) once, as the data is
prepared, using `proj4`. Where the source declares its own coordinate
system, that declaration is read rather than assumed. Stores always
hand back WGS84, and nothing downstream ever converts anything.

**Also considered.**

- Assuming every source is already WGS84. Fragile: common systems in
  Texas include Web Mercator and State Plane Texas South Central, and
  a wrong assumption here draws features in the wrong place and
  silently gives wrong answers to spatial queries.
- Converting when queried instead. More work at runtime, and it
  spreads knowledge of coordinate systems into many more places.

**Why.** Converting once and storing one system keeps it simple:
the stored data is the reference, callers never think about
coordinate systems, and Turf's distance maths expects WGS84 anyway.
If a source turns out to be WGS84 already the conversion is a no-op,
so the code is harmless either way.

---

### Data preparation pipeline: `tools/data-build/`

The app never reads source data directly. It reads prepared files:
tile files for the map, and a SQLite database for counting and
filtering. Source data sits in `input_data/`, which is not committed.
Prepared files go to `public/`.

**How it is put together.** `tools/data-build/` is a Python package
driven by a YAML config, with `build.py` running the whole thing.
There are two purpose-built builders, one for crashes and one for
boundaries, plus one general overlay builder that runs once per entry
listed under `overlays` in `build-config.yaml`.

Only the crash builder produces a database table. Overlays produce
tile files alone, because nothing counts or filters them; they are
only drawn. See `tools/data-build/README.md` for how to set up and
run it.

**Adding or removing an overlay.** Adding one takes three things: a
file in `input_data/`, an entry under `overlays` in
`build-config.yaml`, and a layer in `config/overlays.yaml`. Removing
the entry retires the layer on the next build and deletes its files.

That entry's key is the only name involved anywhere. It is the
published filename, the layer name inside the tile file, the key in
the manifest, and the `source` value the app config points at.
Because there is only one name, there is no second one to fall out of
step. Re-adding the entry and rebuilding brings the layer back.

**The crash builder.** Works through the CRIS CSV exports one year at
a time: load, keep only KAB severities, apply the tagging rules from
the YAML files in `config/hsip/` to set the emphasis area and
workcode columns, attach the position, then join the years together.
Handling one year at a time keeps peak memory to a single year's
data. Dates are normalized to `YYYY-MM-DD` here rather than in the
app.

**The overlay builder.** One path for every overlay: read the source
(a GeoPackage, or an ESRI service), keep the fields the config names,
rename id columns, convert coordinates to WGS84, and write the tile
file.

**What comes out**, all under hashed names, with `manifest.json`
listing the current set:

- `crashes_kab-<hash>.pmtiles` — crash points carrying emphasis area
  tags, severity, year, and city and county id.
- One `<name>-<hash>.pmtiles` per configured overlay.
- `app-<hash>.db` — the crash database.
- `jurisdictions-<hash>.geojson` — city and county boundaries.
- `manifest.json` — the pointer to the current set.

**Rebuilding one thing.** `python build.py --only crashes` rebuilds
just the crash layer. Each builder is independent and drops and
recreates only its own output.

**For the client team.** These are Python scripts, shipped in this
repository, and they are what gets run when the data is refreshed, so
readability matters more than cleverness. The YAML tagging rules are
meant to be edited by the data team; the CSV files holding
countermeasure details are meant to be edited by planners.
Tippecanoe, the tool that writes the tile files, has to be installed,
and runs on Linux, macOS, or WSL.

---

## Map and geometry

### Map rendering: MapLibre GL JS

**Chosen.** MapLibre GL JS. It draws maps using the graphics card,
and it is a freely licensed fork of Mapbox GL JS taken before that
project changed its licence. No access token or account needed.

**Also considered.**

- Mapbox GL JS. The same API, but it needs an access token and
  charges above a free tier, which conflicts with having no server
  and no accounts.
- Leaflet. Draws markers as page elements, which will not stay smooth
  with this many crash points. Clustering plugins help but add
  indirection.
- OpenLayers. Capable, but a larger API and a smaller community for
  this kind of data-styling work. No specific advantage here.
- deck.gl on top of MapLibre. Worth reaching for if MapLibre's own
  drawing ever runs out of headroom. Not needed.

**Why.**

- Drawing on the graphics card handles this many crash points and
  road segments without having to cluster or thin them out first.
- It reads GeoJSON directly, and reads PMTiles through a small
  add-on.
- Its model of "a data source, with layers referring to it" lines up
  almost exactly with the architecture's map-and-layers principle.
- Zooming to fit a shape is built in, which is what the layers use.
- Good TypeScript types, so nothing is untyped at the map boundary.

### Basemap tiles

**Chosen.** The VersaTiles "neutrino" style as the default, and the
basemap is configurable rather than fixed in code: `basemap.url` in
`config/app.yaml`. Neutrino is light and muted, which keeps crash
points, overlay layers, and the user's own drawings the most visible
things on screen. A background map is there to sit behind the real
data, not to compete with it.

Attribution for OpenStreetMap and VersaTiles is shown on the map, as
their terms require. The attribution string is configured alongside
the URL, because only whoever chose the tile source knows what that
source asks for.

**One URL, both kinds.** Config names a single URL and the app works
out from it whether the basemap is vector or raster: a raster tile
template is exactly the URL carrying `{z}`, `{x}`, and `{y}`
placeholders, and a vector style URL never carries them. Nothing in
config declares a type, so there is no type that can contradict the
URL beside it.

The asymmetry between the two is in the code, not the configuration.
MapLibre only ever accepts a style document. A vector style URL *is*
that document — it names its own tile source and the paint rules for
it — so it is passed straight through. A raster URL is a bare tile
address carrying no metadata, so the app wraps it in a minimal
document of one source and one layer, and supplies the values the
address cannot carry: tile depth, tile size, attribution. Those have
defaults suiting OpenStreetMap-derived sources, so in practice a
client switching providers still edits one line.

**What makes this safe to swap.** No app code names a layer inside
the basemap. Overlays, region outlines, and crash points are inserted
relative to five empty "slot" layers the app adds on top of whatever
style loaded (`src/map/baseMapStyle.ts`). Without that, changing
basemap would silently reorder the app's own layers, since insertion
points would refer to layer ids the new style does not have.

### Drawing tool: Terra Draw

**Chosen.** Terra Draw, with its MapLibre adapter. It covers the
three drawing modes needed — point, line, polygon — plus selecting
and editing what has been drawn.

**Also considered.**

- `@mapbox/mapbox-gl-draw`, the long-standing option. Works with
  MapLibre most of the time, but periodically breaks when either side
  ships a breaking change. Survivable, but annoying.
- Drawing by hand from map pointer events. Educational, but rebuilds
  a lot of fiddly edit-handle and snapping logic.

**Why.**

- It is deliberately not tied to one map library, so replacing
  MapLibre later would be a contained change.
- It reports a finished shape as GeoJSON directly, which is already
  the shape the draw-completion signal expects, so no conversion
  sits in between.
- Actively maintained, with good TypeScript types.

**The trade-off.** Younger than the Mapbox plugin, so fewer examples
and answered questions exist. Acceptable because the part used here
is small — three drawing modes, one finished-shape callback, one edit
mode — and the documentation covers it.

### Geometry compute: Turf.js, modular imports

**Chosen.** Turf.js, imported as separate small packages
(`@turf/buffer`, `@turf/boolean-point-in-polygon`, `@turf/bbox`, and
so on) rather than as the single all-in-one package.

**Also considered.**

- The all-in-one `@turf/turf` package. One import, whole toolkit,
  heavier download. Fine in a script, wasteful in a browser app using
  a handful of operations.
- Converting to a flat projection, doing ordinary flat maths, and
  converting back. More control, but more steps to get wrong, and
  unnecessary at the buffer distances used here.
- JSTS. More capable for heavy geometry work, larger, and needs
  conversion to and from GeoJSON. Overkill.

**Why.**

- It is the standard choice for this kind of geometry work in a
  browser, and it takes and returns GeoJSON, so no conversion layer
  is needed.
- Distances on a globe are not flat, and Turf handles that. It
  approximates the earth as a sphere, which is accurate to well
  under a meter at the buffer distances used here.
- `@turf/buffer` accepts `{ units: 'feet' }` directly, which matches
  the `bufferFeet` field, so nothing has to convert units first.
- Importing only the pieces used keeps the download small. The
  all-in-one package is written in a way that defeats automatic
  removal of unused code in some versions, so separate imports are
  the safer default.

### Geometry types: `@types/geojson`

**Chosen.** `@types/geojson`. Types only, nothing shipped at
runtime, and it matches the GeoJSON standard exactly.

**Why not re-use the types from MapLibre or Turf.** That would tie
the vocabulary for shapes to one library, so replacing either would
mean chasing imports across the whole codebase. Depending on the
types package directly says what is actually meant. It is pulled in
by both libraries anyway, so this adds nothing to the download.

### Crash point visualization: heatmap + severity points

**Chosen.** Two layers over the same tile data, fading into each
other as the user zooms. Zoomed out, MapLibre's built-in heatmap
shows where crashes bunch up. Zoomed in, that fades out and circles
colored by severity fade in, over roughly zoom levels 7 to 9.

**Also considered.**

- Aggregating into hexagons with `h3-js`. Gives countable units, but
  a fixed hexagon size is awkward across zoom levels — too coarse
  zoomed in, a mess of hexagons zoomed out — and re-indexing 116,000
  points on every zoom change is expensive. It also adds a
  dependency to provide counting that the breakdown chart and the
  per-site tables already give.
- MapLibre's built-in clustering. Simpler, but a cluster is not a
  meaningful unit to count.
- Drawing every point at every zoom. At low zoom 116,000 overlapping
  circles are an unreadable blob.

**Why.**

- The heatmap runs on the graphics card and handles this many points
  with no preparation and no extra dependency.
- Severity-colored circles give per-crash detail exactly where it
  matters, which is once the user has zoomed into somewhere specific.
- Fading two layers by zoom is built into MapLibre, so both layers
  read the same source and just vary their opacity.

**The trade-off.** A heatmap shows density as a continuous wash, so
the user cannot read "47 crashes here" off it. That is fine, because
counting is not the map's job at that zoom: the breakdown chart
answers it for an area and the site tables answer it per site. The
map's job zoomed out is "where do crashes concentrate," which a
heatmap conveys well.

### Map data source: PMTiles vector tiles

**Chosen.** Prepared PMTiles files. A PMTiles file is a whole tile
set in one file, and the browser fetches just the byte ranges it
needs using ordinary HTTP range requests. The `pmtiles` JavaScript
library, about 10 KB, registers itself with MapLibre so a tile URL
can point into one. The files are plain static assets deployed
alongside the app.

Drawing the map is kept separate from the database. The tiles carry
the shapes plus the few attributes needed for filtering and
coloring. The database holds the full records for counting and
analysis.

**Also considered.**

- Handing MapLibre a GeoJSON file and letting it index the data
  itself. Works at this size, but the indexing cost grows with the
  data and needs the whole file in memory. Past a few hundred
  thousand points, updating the source becomes visibly slow.
  Prepared tiles avoid it: the work is already done and only the
  visible tiles are fetched.
- Vector tiles from a server, such as PostGIS with a tile server.
  Needs a server running, which defeats the point of static hosting.
- Tiles as thousands of small files in a z/x/y folder tree. Same
  content, but awkward to deploy and version. One file with range
  requests is the same thing without the file count.

**Why.**

- Nothing has to be fetched, parsed, and indexed at startup, so the
  map appears without waiting for the database.
- Range requests work on any static host that supports them:
  GitHub Pages, S3, R2, Azure Blob. No server, no key.
- Filtering happens in the browser against tile attributes, with no
  refetching, and is evaluated as the map draws.
- Building the tiles is a one-time offline step, and the output is
  the same every time for the same input.

**What goes in the tiles.** Only the fields needed for filtering or
coloring, not every attribute from the source. Anything more
detailed comes from the database, looked up by id. An early
experiment made this concrete: a road layer built with all 150 source
attributes came to 147 MB and was sluggish, because every tile had to
decode all of them, while the same layer with only the needed fields
came to 42 MB and drew smoothly.

**The tool: tippecanoe.** The flags that matter:

- For lines, `--coalesce-densest-as-needed` merges nearby shapes when
  zoomed out instead of dropping them, so a road network stays
  visually continuous rather than developing gaps.
- For points, `--drop-densest-as-needed` thins them when zoomed out.
  Acceptable because the heatmap covers the zoomed-out view and
  individual points only matter close in.
- For both, `-zg` picks a sensible maximum zoom from how dense the
  data is, and `-l` sets the layer name inside the file.

**Showing only the chosen area.** Crash points are filtered with
MapLibre's `within` test, which keeps only points inside the area's
shape. For a city or county the filter uses the `county_id` and
`city_id` attributes already on each point instead, which is
cheaper than testing shapes.

Road and other overlay layers are deliberately never clipped to the
area. They stay visible everywhere as geographic context, which also
sidesteps a real limitation: `within` requires a shape to be entirely
inside the area, so a road crossing the boundary would vanish, and
MapLibre has no "overlaps" test to use instead. Counting and
filtering always go through the database regardless of what the map
shows.

### Analytical data source: pre-built SQLite .db

**Chosen.** Ship the crash data as an already-built database file.
On a first visit the app downloads it and stores it in OPFS; later
visits skip the download. Everything above about the SQLite engine,
its storage mode, and the spatial query approach applies unchanged.

**Also considered.** Fetching the rows from an ESRI service and
building the database in the browser, which is what an earlier
version did. It worked — roughly 5 seconds of fetching, then 9
seconds of inserting and index building — but it is wasted work,
because the data is fixed and identical for every user.

**Why.**

- The data does not change between releases, so building it once
  ahead of time beats rebuilding it in every user's browser on every
  cold start. First-visit cost becomes one download instead of a
  download plus 14 seconds of work.
- The schema, the indexes, the spatial index, and the packed tag
  columns are all built once by the pipeline and can be checked
  before deploying, so there is no chance of the build step and the
  browser disagreeing.
- Knowing when to download again is handled by the hashed filenames
  and manifest described above.

---

## EA breakdown rendering: native Svelte DOM + CSS

**Chosen.** A purpose-built Svelte component, using no chart
library. Each row is made of ordinary page elements: a wide bar for
the comparison area, a narrower bar for the chosen area, and a tick
mark for the whole-region yardstick. The relative view reuses the
same elements arranged around a centered zero line. The view toggle,
the searchable area picker, and the tooltips come from
shadcn-svelte.

This is a decision about this one chart, not a rule against chart
libraries. A future visualization with axes, brushing, or much more
data should be judged on its own needs.

**Also considered.**

- Keeping Plotly, which an earlier version used. It handles grouped
  and diverging bars, but it looks and behaves like a general
  analytical chart, and reproducing this compact layered layout would
  mean fighting its axes, margins, legend, and trace model.
- A chart library such as LayerChart. More composable than Plotly,
  but it adds a dependency, and a whole layer of scales and marks to
  learn, for fourteen rows of three simple shapes each.
- A progress-bar component. Right for one bounded value, wrong for
  overlapping bars, a reference tick, and signed values.
- SVG or D3 directly. Precise, but this layout does not need a
  coordinate system or scale API to express it.

**Why.**

- The chart has a fixed set of fourteen categories, and no panning,
  zooming, brushing, or open-ended number of series.
- Both views are straightforward percentage sums, and the marks map
  directly onto CSS positions.
- Ordinary page elements keep labels, tooltips, keyboard focus, and
  responsive layout simple.
- Limiting the chart to one comparison area belongs to this
  component, not to the state, so a future multi-area chart can
  replace the view without touching anything underneath.

**The trade-off.** The component owns a small amount of bar-layout
CSS that a chart library would otherwise have provided. Keep that
code specific to this chart rather than growing it into a
general-purpose charting layer.

---

## Testing: Vitest, Testing Library Svelte, Playwright deferred

**Chosen.** Vitest as the test runner, sharing Vite's own
configuration so tests and the build resolve modules identically.
`@testing-library/svelte` for the few component tests worth writing.
Playwright for whole-app tests.

**Also considered.**

- Jest. Heavier, and a separate configuration to keep in step with
  Vite's. No reason to run two toolchains.
- Node's built-in test runner. Fine for plain logic, but no Svelte
  component support.
- Cypress for whole-app tests. Heavier than Playwright for the
  handful of tests wanted here.

**Why.**

- Vitest is built for Vite and reuses its plugin chain, so there is
  no second configuration that can drift.
- Plain logic tests run in milliseconds, which gives tight feedback
  on exactly the kind of code this app accumulates: filters, counts,
  severity weighting, and the SII sum.

**What gets tested, in order of priority.**

- Plain logic, as soon as it exists: counting by emphasis area,
  severity weighting, area filtering, the SII calculation.
- Store behavior, once a store settles, checked against the shapes
  in `06-contracts.md`.
- Component behavior, sparingly, and only where a component carries
  real branching or interaction logic.
- Not tested: MapLibre wrappers and thin display-only components.
  Mocking rendering internals costs more than the test is worth.
- Whole-app tests with Playwright, covering the main path through
  the app.

**On coverage numbers.** Read them as a hint about what has been
forgotten, never as a target. A test that passes while the code is
broken is worse than no test.

**Where tests live.** Next to the code they cover, named
`*.test.ts`. No parallel test tree.

---

## Error handling: one reporter, two surfaces

**Chosen.** Every failure is classified by what the person looking at
the screen can do about it, and each class gets a different surface.

- Something the user can fix — a file that will not parse, an area
  with no crashes in it — is answered next to the control that caused
  it. No dialog, no technical text.
- Something the setup caused — offline, a data file missing from the
  deployment, a basemap address that does not answer — names the
  condition in plain words and, where it helps, says which
  configuration file to look at.
- Anything else is a fault in the app itself, which nobody using it
  can act on. It shows a report they can copy or screenshot and pass
  on.

One function, `reportError`, receives all three. It is the only place
that decides what a failure looks like, and the only place a later
change — sending failures somewhere automatically, say — would have
to touch.

Two surfaces render what it collects: a blocking screen for failures
that make the app untrustworthy, and a dismissible notice for
failures that leave it usable.

Four listeners make sure nothing escapes quietly, because JavaScript
has four separate ways for a failure to leave the code that caused
it: an ordinary error, a background task whose failure nobody waited
for, an error while Svelte is drawing the page, and an error inside
the database worker, which runs in its own thread and reports
separately.

**What the report holds.** What failed, in plain words, and the time.
Which build of the app is running, and which build of the data it
loaded. The technical message. And the last few dozen lines the app
logged on its way there, which is usually more useful than the
failure itself. A button copies the whole thing to the clipboard.

The app's build stamp is the commit identifier, written into the app
by GitHub at the moment it builds the site, and shown on the opening
screen beside the data build date. The two move independently — the
data can be rebuilt without rebuilding the app — so a report naming
only one of them would answer half the question.

**Also considered.**

- An error-reporting service such as Sentry, which would collect
  failures automatically instead of relying on someone to forward
  one. Rejected: it is a third-party account the hosting agency would
  have to own and approve, and crash locations would leave their
  control. Routing everything through one function keeps the option
  open if that ever changes.
- Leaving each part of the app to handle its own failures, which is
  what happened while the app was being built. It writes messages to
  the browser's developer console, which nobody running the app will
  ever open.
- Handling only the failures that can be named in advance. Cheaper,
  but the failures worth catching are the ones nobody thought of.
- Giving each report a short reference code. With no server there is
  nothing to look a code up in, and the plain-English description of
  what failed is a better thing to quote in an email than four
  characters. A code that classified failures rather than counting
  them would only restate that description less clearly.

**Why.**

- Nothing runs on a server. There is nowhere to send a failure
  report, so the person at the screen is the only way one travels.
  That makes "can this be copied and forwarded" the design
  requirement rather than an afterthought.
- The agency hosting the app did not build it. A failure has to
  survive being passed from a user to their IT staff and on to the
  original developers, and a screenshot reading "something went
  wrong" survives none of that.
- The numbers this app produces go into funding applications. A wrong
  number is worse than no number, so a failure that could leave a
  figure incomplete stops the app rather than letting it carry on.
- `06-contracts.md` already sets the rule that nothing catches a
  failure and quietly ignores it. Until now there was nowhere for a
  caught failure to go.

**What stops the app.** Failing to load the data manifest, to start
the database, or to download the crash data; a failure inside the
database worker; and any error while Svelte is drawing, since the
screen can no longer be trusted to match the data.

**What does not.** A map overlay the published data no longer
contains, a basemap that will not load, one map image missing from a
report. These leave every figure intact, so they say so and let the
work carry on.

**The trade-off.** Someone is shown technical text they cannot act
on. That is deliberate: the text is not for them, it is for whoever
they forward it to. It sits behind a short plain-English sentence and
a copy button rather than being the first thing on the screen.
