# Session fixtures

A fixture is a captured session: a composite snapshot of the persisted
state stores (sites, alternatives + pins + chosen, project info) plus
capture metadata. Loading one teleports the running app into that
session state through the same `applySnapshot` door the future
SessionStore restore will use. See `src/dev/fixture.ts` for the shape.

Fixtures hold **store state only**:

- **No crash records.** Report generation and crash profiles query the
  live SQLite db by the `crashIds` stored on each site, so a loaded
  fixture exercises the real data layer. That is also why fixtures go
  stale: the ids reference a specific data build (see Staleness).
- **No UI state.** Loading first resets the UI to a deterministic
  home (diagnosis view, workbench closed, nothing selected, drafts
  cleared) so nothing keeps pointing at a site the incoming session
  doesn't have. Component-local UI state (an armed draw tool, panel
  flow steps) can't be reset from outside — load from the home screen
  for best results.

Loading is **replace-all**: every registered store ends up in the
state the snapshot describes. Stores the fixture doesn't cover reset
to their pristine initial state rather than keeping the previous
session's values.

## Two tiers

1. **Committed fixtures (this directory).** Each backs a named helper
   in the debug menu (a one-click scenario, e.g. report layout:
   load fixture + print). Helpers own their fixture imports in
   `src/dev/DebugMenu.svelte`; adding one means adding the JSON here
   plus a helper entry there. Committed fixtures are also importable
   from vitest integration tests: seed stores via
   `applyAll(fixture.snapshot)` from `src/state/sessionRegistry`.
2. **Local fixtures (yours, not committed).** Any capture you keep
   around for your own debugging. Load via debug menu →
   "Load session from JSON…" (file picker, reads the file at
   runtime — no dev-server restart, no WSL file-watching issues).

## Capturing a fixture

1. `npm run dev`, then set up the scenario by hand: pick a region,
   draw or upload sites, add alternatives with costs, pin or let SII
   choose, fill project info. The capture records exactly what the
   stores hold, so derived fields (crash unions, severity counts) stay
   internally consistent — never hand-author site or alternative data
   in fixture JSON. (Free-text fields like `projectInfo` are the
   exception: no invariants, safe to edit post-capture.)
2. Debug menu (bug button, bottom right) → **Capture session as
   fixture JSON**. A file downloads.
3. Keep it wherever you like and load it via the file picker (tier 2),
   or promote it to a committed helper fixture (tier 1): move it here
   with a kebab-case scenario name, fill `meta.description`, wire a
   helper entry in `DebugMenu.svelte`, and commit.

## Staleness

`meta.buildId` records the data build the session was captured
against. Loading a fixture whose buildId differs from the live
manifest logs a console warning: its `crashIds` may no longer exist in
the current db. When the data build changes, recapture fixtures
(repeat the setup, or load the stale fixture and re-capture if the
sites still resolve sensibly). If a report scenario suddenly shows
empty crash tables, check the buildId warning before debugging code.
