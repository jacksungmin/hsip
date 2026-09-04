# HSIP Sketch Planning Tool

A crash data map and safety planning tool for the H-GAC region. Safety
engineers at local agencies use it to understand crash patterns in their
area, pick locations worth improving, choose countermeasures, and export a
report they can carry into a safety plan or a grant application.

The app has two halves that share one map: **diagnosis**, where you read the
crash picture and select locations, and **planning**, where each selected
location gets its crash history, a set of countermeasures, and a place in the
exported report. Following TxDOT HSIP practice, it looks only at KAB crashes
— fatal, serious injury, and minor injury.

## A static app

There is no server and no database to run. The build produces a folder of
static files, and everything the app does — filtering crashes, counting them,
running the analysis — happens in the browser.

That is possible because the data is prepared ahead of time. `public/` holds
the prepared artifacts: PMTiles tilesets for what the map draws, a SQLite
database the app queries in a Web Worker, and GeoJSON boundaries. The browser
downloads them once and works locally from there. The `.pmtiles` and `.db`
files are large, so they are tracked with **Git LFS** (see `.gitattributes`)
— clone with LFS installed or those files arrive as pointer stubs and the app
will not start.

The pipeline that produces the artifacts is a separate Python tool in
`tools/data-build/`, run by hand when the data changes. It is not part of the
app build and never runs in the browser. Its README covers setup and the
source data it expects.

## Running it locally

```sh
./start-dev.sh
```

The script checks for Node, installs dependencies if `node_modules` is
missing, and starts the Vite dev server. After the first run, `npm run dev`
is equivalent. Other scripts: `npm run test` (Vitest), `npm run check`
(svelte-check plus `tsc`), `npm run build` (production build into `dist/`).

## Deployment: GitHub Pages

The app is intended to be hosted as a static site on GitHub Pages, and
`.github/workflows/deploy.yml` does it. Every push to `main` (or `master`)
pulls the LFS files, builds, and publishes `dist/`. Nothing is deployed by
hand.

Two things have to be true in the hosting repository:

- **Pages is enabled with "GitHub Actions" as the source**, under Settings →
  Pages. The workflow publishes through the Pages deployment API, not a
  `gh-pages` branch.
- **The LFS files are present.** The workflow pulls them during the run, so
  the repository has to actually hold the LFS objects, not just the pointers.

Pages serves a project site under `/<repo-name>/`, so the workflow passes
`--base "/<repo-name>/"` at build time rather than relying on the `base` in
`vite.config.ts`. The repository can be renamed without touching the config.

Because the whole app is static files, any other static host works the same
way; only the base path would need attention.

## Documentation

Design documents live in `docs/`, starting with `docs/00-process.md`, which
explains how they fit together: who the user is and what they do (01–04), how
the pieces of the app talk to each other (05), the data shapes and state
contracts (06), why each tool was chosen (07), and where the app could grow
(08).

`CLAUDE.md` and `AGENTS.md` are context files for AI coding agents — the same
orientation a new contributor would get, written for a tool that reads the
repository rather than asks questions. The two are identical copies under the
names different agents look for, so edit them together. They are not required
reading for people, though they are a fair summary of the project's
conventions.
