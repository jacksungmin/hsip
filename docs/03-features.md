# Features

Features are grouped by the two halves of the user's work described
in `02-user-behavior.md`: understanding the problem, then building a
plan. Features that span both come last.

Each entry ends with a "Supports" line naming the user behavior it
serves.

## Understanding the problem

### Region selection

The user picks the area they want to work on, either by choosing a
city or county from a list or by drawing an outline on the map. That
choice sets the scope for everything else they do.
Supports: picking the area.

### Crash breakdown by emphasis area

For the chosen area, the app shows how its crashes split across
emphasis areas (the official TxDOT crash categories, such as
speeding or intersection crashes). The split is recalculated
whenever the area changes.
Supports: seeing how crashes split by emphasis area.

### Comparing against other areas

The app shows the chosen area's split next to the same split for the
whole H-GAC region, which acts as a fixed yardstick. The user can
also pick one other county or city to compare against, which makes
it easy to see which crash types are worse in their own area than
elsewhere.

The picker offers both counties and cities no matter which type the
current area is, and leaves out the current area itself. The
comparison area can be picked first, before any current area, in
which case it is shown against the whole-region yardstick on its
own.
Supports: comparing splits, spotting crash types that are worse
locally.

## Building a plan

### Picking locations

The user marks places worth improving. Each one is a **site**, and
its type is chosen as it is drawn:

- **Roadway site.** Drawn as a line along a stretch of road.
- **Intersection site.** Drawn as a point on an intersection.

Sites can also come from an uploaded file (`.geojson`, or a `.shp`
in a zip). A file of points becomes an intersection site; a file of
lines becomes a roadway site. A file holding several shapes produces
one site with several **parts**, one per shape.

Every site carries a **buffer**: a distance outward from the drawn
shape. The buffer does two jobs. It decides which crashes count as
belonging to the site, and it is the shape drawn on the map. Each
site type starts with a sensible default distance, and the user can
change it at any time. Changing it immediately updates which crashes
belong to the site and everything computed from them.

A site with several parts holds a buffer per part. Crashes are
counted once per site even where two part buffers overlap, so
nothing is double-counted.

Each site joins the site list, carrying its name, type, shapes, and
buffer.
Supports: building a list of locations by drawing or uploading, and
tuning how far each one reaches.

### Reference overlay layers

The app can draw extra map layers as background reference, each
styled by its own data and each with a legend whose entries can be
switched on and off one at a time.

Which layers exist, what they are called, and how they are colored
all come from configuration files rather than from code, so a layer
can be added or dropped without touching the app.

These layers are there to look at while placing sites. They cannot
be clicked to create a site.
Supports: seeing where crashes bunch up while deciding where to
draw.

### Site list

The app keeps the list of sites the user has created, and lets them
view it, rename entries, remove entries, and move the whole list
forward into the planning step. The list is what connects picking
locations to planning fixes for them.
Supports: holding the picked locations between the two halves of the
work.

### Crash history per site

For each site, the app shows the crashes inside it, split by
emphasis area and by severity, so the user can see what problem they
are trying to fix at that particular place.
Supports: reviewing a site's crash history.

### Comparing countermeasures

For each site, the user adds countermeasures from a catalog. The
catalog is filtered down to countermeasures that could have
addressed at least one crash at that site, so the list stays
relevant.

Each countermeasure added to a site is scored on its own as one
**alternative**. Alternatives are not combined into a single plan:
they sit side by side so the user can see which one looks best, and
their effects are never added together.

For each alternative the user enters a construction cost, a yearly
maintenance cost, and a service life (how many years the fix is
expected to last). From those the app works out the TxDOT Safety
Investment Index, or SII, which is a benefit-to-cost score. The
steps are:

- **S**, the yearly saving, from the crashes prevented, priced by
  severity against the TxDOT crash cost table, minus maintenance.
- **Q**, an adjustment for traffic growing over time.
- **B**, the total benefit over the service life, brought back to
  today's money.
- **C**, the construction cost.
- **SII**, which is B divided by C.

All of these update as the user types.

The alternatives appear in a table, one row each, showing the
countermeasure name, the crashes it would prevent by severity, its
reduction factor, cost, service life, maintenance, S, Q, B, and SII.
The table is sorted by SII, best first.

The user can pin the alternative they prefer. With nothing pinned,
the app picks the highest SII on its own and marks it with a grey
pin; a deliberate pin overrides that and shows in gold. Either way,
the marked alternative is the one that feeds the plan-wide progress
bar and the report.

That progress bar sits in the planning panel and shows what share of
the area's past KAB crashes the whole plan would prevent. Each site
shows how many countermeasures have been scored for it, or "Not yet
planned" if none have.
Supports: picking countermeasures, trying options, watching the
expected reduction change, comparing options for one site, marking a
preferred option, and tracking the plan's overall reach.

### Report export

The user exports a report covering the sites, the crash counts at
each one (by severity and emphasis area), the alternatives
considered, and for each alternative the crashes it would prevent,
the SII steps (S, Q, B, C), and the SII itself. The marked
alternative is flagged. Map images are included, one overview and
one per site.

Only sites with a marked alternative appear in the report. Crash
counts are given as totals rather than as a list of individual
crashes, which is enough for both planning documents and grant
applications.
Supports: exporting a report at the end of the work.

## Spanning both halves

### How long the work lasts

Everything the user does lives in the browser tab while it is open.
The area choice, the site list, the countermeasures, and the entered
costs are held in memory and are lost when the tab is closed or
reloaded. There is no save button, no account, and no syncing
between devices, so the user builds the plan and exports its report
in a single sitting. The exported report is the lasting record.

`08-future-ideas.md` covers what adding a save would involve.

### Moving between the two halves

The user can move back and forth between the diagnosis view
(understanding the problem, plus picking sites) and the planning
view (crash history, countermeasures, export) as often as they like.

Going forward brings the whole site list with it. Coming back keeps
every countermeasure already entered. Sites added later arrive in
planning with nothing entered for them yet, and removing a site
removes its countermeasures too. To the user it reads as one flow
that happens to run in both directions.
Supports: moving from picking locations to picking countermeasures
and back without losing work.
