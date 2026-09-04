## What this is

A crash data map and safety planning tool for the H-GAC region.
Safety engineers at local agencies use it to understand crash
patterns in their area, pick locations worth improving, choose
countermeasures (physical fixes such as a signal upgrade), and export
a report they can use in a safety plan or a grant application.

The app has two halves: **diagnosis** (understand the problem, pick
locations) and **planning** (crash history per location,
countermeasures, export). These are two modes of one screen, not two
pages. `viewMode` holds which one is showing, as
`'diagnosis' | 'planning'`. There is one map, shared by both.

**Nothing is saved.** Closing the tab discards the user's work.
`state/sessionRegistry.ts` can gather the app's state into a snapshot
and put one back, but no storage is attached to it — the only code
using it is the dev-only debug menu's test fixtures. This is a known
gap, not an oversight; see `docs/08-future-ideas.md`.

## Severity: KAB only

The app follows TxDOT HSIP, which looks only at KAB crashes. KAB is
the shorthand for the three most serious injury levels: K for fatal,
A for serious injury, B for minor injury.

The build pipeline drops the two lesser levels, C and O, so they
never reach the database, the tiles, or the app. The `Severity` type
is `'K' | 'A' | 'B'`. Do not add C or O to severity types, color
maps, labels, legends, or map filters.

## Documentation

Design documents are in `docs/`. Start with `docs/00-process.md`,
which explains how they fit together.

- **01-04** — who the user is, what they do, what the app does, and
  what has to be true for it to work.
- **05** — the pieces of the app and how they talk to each other.
- **06** — data shapes, store methods, state containers, signals.
- **07** — which tools were chosen and why.
- **08** — ideas the app could grow into.

## Where the data comes from

The app only reads prepared files, never source data:

- **PMTiles** for drawing the map (crash points, overlays). One file
  per layer, holding map tiles the browser fetches in pieces.
- **A prepared SQLite database** for counting and filtering crashes.
  Stored in OPFS, queried in a Web Worker.
- **GeoJSON** for city and county boundaries.
- **JSON** for countermeasures and the crash cost table. Small
  enough to be built into the app.

Every file has a hash of its own contents in its name, and
`manifest.json` lists the current set. The app reads the manifest at
startup and looks up every URL through it, so nothing hardcodes a
data filename.

The build pipeline in `tools/data-build/` produces all of this. See
`tools/data-build/README.md` to set it up and run it.

## Overlay layers come from configuration

Overlay layers are the background reference layers on the map. Which
ones exist is configuration, not code:

- `tools/data-build/build-config.yaml` — which overlays the pipeline
  builds into tiles.
- `config/overlays.yaml` — how the app draws and colors each one.
- `config/schemas/overlays.schema.json` — validates the file live in the
  editor (YAML language server); not read by the build.

The build checks it separately, in `vite-plugin-overlay-config.ts`: the
fields the app dereferences, plus every `source` and column name against
the overlay inventory the data build publishes in `manifest.json`. So a
typo in a name fails the build rather than shipping a layer that draws
nothing.

To add one: put a source file in `input_data/`, add an entry to
`build-config.yaml`, add a layer to `overlays.yaml`. No code changes.

## Main tools

- **Framework:** Svelte 5 with runes, TypeScript
- **Build:** Vite, plain Svelte-TS template, not SvelteKit
- **Map:** MapLibre GL JS, reading PMTiles through a small add-on
- **Drawing:** Terra Draw
- **Geometry:** Turf.js, imported as separate small packages
- **Database:** `@sqlite.org/sqlite-wasm`, stored in OPFS
- **UI:** shadcn-svelte, bits-ui, Tailwind v4
- **Tests:** Vitest, @testing-library/svelte

## How the code is organized

- **State lives in containers; one-off signals are passed as
  functions.** Shared state sits in `$state`-backed modules read
  through accessors. Anything that is not a state change, such as a
  finished drawing, is passed down as a function to call. There is no
  event bus. Do not add one without a real reason.
- **Views are computed from state, not patched.** Map layers are the
  exception, because MapLibre is driven by method calls; they make
  those calls inside an `$effect` keyed on state, never from event
  handlers.
- **Drawing the map and querying the data are separate paths.** Map
  layers read tiles. Counting and filtering read SQLite in a worker.
  They share no data path at runtime.
- **Downloaded once, then local.** Startup fetches the data files;
  later visits read the stored copies. No interaction hits the
  network.
- **The contracts doc is the reference.** Data shapes, store methods,
  and signal paths are in `docs/06-contracts.md`. If code and that
  doc disagree, update the doc and the shared types in the same commit
  as the code change.

## Source layout

- `src/types.ts` — shared TypeScript types
- `src/state/` — state containers and data stores (`*.svelte.ts`)
- `src/services/` — logic, helpers, calculations. `services/db/` holds
  the SQLite worker, the code that talks to it, and the tag-column
  packing
- `src/components/` — Svelte components. `components/report/` holds
  the printable report
- `src/data/` — built-in catalogs and generated config
  (countermeasures, crash costs, emphasis areas, overlay definitions)
- `src/map/` — basemap style and overlay tile sources
- `src/lib/` — shadcn-svelte UI components, generated. Avoid editing
  by hand
- `src/dev/` — debug menu and test fixtures, stripped from production
  builds
- `config/` — configuration files (overlays, HSIP data)
- `tools/data-build/` — the Python data pipeline
- `docs/` — design documentation
- `public/` — static files, including the built data files

## Getting oriented

Read the docs in `docs/`, starting with `00-process.md`, then look
through `src/` and `git log`.
