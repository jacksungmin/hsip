# Future Ideas

Things the app could grow into, and what each one would involve. None
of these is needed for it to do its job today.

## Saving the user's work

Right now the work lives in memory and is lost when the tab closes.

Half the groundwork is already there. `state/sessionRegistry.ts` can
gather the whole app's state into one snapshot (`captureAll`) and
push a snapshot back into every container (`applyAll`). Containers
opt in by calling `register(key, getSnapshot, applySnapshot)`, and
`SiteList`, `ProjectState`, and `ProjectInfoState` already do.

What is missing is somewhere to put the snapshots. That means code
that calls `captureAll` shortly after a change, writes the result,
reads it back at startup, and hands it to `applyAll`. IndexedDB fits:
it is the browser's store for structured data of this size, it has a
generous quota, and it works through transactions rather than the
exclusive file locks that limit the SQLite copy to one tab. Keeping
it separate from that copy also means refreshing the data cannot
damage the user's work.

Beyond wiring up the storage itself:

- Register the containers that are currently left out but should
  survive a reload: `RegionState`, `CustomRegionStore`,
  `ActiveSite`, and `ViewMode`.
- Decide what a restored session does when the data has moved on. A
  snapshot holds crash ids, and a data refresh can retire them. The
  snapshot's version field and the manifest's `buildId` are the two
  things to check against.
- Decide whether map styling is saved too. None of it is snapshotted
  today, which is exactly why `overlayState` is left out; if styling
  is included, include all of it rather than one part.

## Defining an area from an uploaded file

Let the user upload a boundary file instead of picking a city or
county or drawing one. `CustomRegion` already allows an `'upload'`
source in its type; nothing creates one.

The file reading in `services/parseUploadedFile.ts`, used for
uploading sites, is close to what this needs. The difference is which
shapes are allowed: this would accept polygons and reject points and
lines, which is the opposite of the site case.

## Comparing against several areas at once

The chart shows one comparison area beside the whole-region
yardstick. `RegionState.references` is already a list with no cap,
and the one-at-a-time limit lives in the chart rather than in the
state, so a wider layout could show several without changing
anything underneath it.

## Using a countermeasure to guide where to draw

Pick a countermeasure and have the map highlight where the crashes it
could address are concentrated, as a hint about where to place sites.

This needs new machinery rather than a configuration change: somewhere
to get counts of addressable crashes per area or per segment, a state
field for the countermeasure being used as a guide, and a layer to
draw the result. The counting side is the easy half, since crash rows
already carry workcode tags, so it is a query rather than new
upstream data.

## More overlay variants

Overlay layers colored by a single emphasis area, or by severity,
rather than by an overall classification.

This is configuration work rather than code. It needs an entry in the
data build for a tile set carrying the right attributes, and a layer
in `config/overlays.yaml` coloring by them.

## Choosing which countermeasures reach the report

Let the user narrow the export, per site or across all sites, instead
of including every countermeasure considered at each included site.

`ReportPayload` already marks which countermeasure was chosen per
site, so this is a filter applied while the report is assembled, plus
the interface to drive it.

## Handing a session to someone else

Putting the state in a URL will not work: site shapes and per-site
crash id lists are far past a practical URL length.

A snapshot file the user exports and imports is the natural route,
and it would reuse the same snapshot format `captureAll` and
`applyAll` already produce, so it becomes straightforward once
saving exists.
