# Requirements

Requirements are the things that must be true for the features to
work. They are grouped by subject rather than by feature, and each
group ends with a line naming the features that rely on it.

Where the data comes from: the H-GAC SS4A project did the crash
analysis that produces the data this app reads. The data sections
below describe what the app is handed, not work it does itself.

How the data arrives: the SS4A data (which comes from TxDOT CRIS and
related sources) is prepared ahead of time by a build pipeline. The
pipeline writes three kinds of file:

- **PMTiles** for drawing the map. A single file holding map tiles,
  which the browser reads a piece at a time.
- **A prepared SQLite database** for counting and filtering crashes.
- **GeoJSON** for the city and county boundaries. A plain text
  format for shapes.

Every one of these files has a content hash in its name, meaning a
short code computed from the file's own bytes. Change the data and
the name changes with it. The app downloads these files once and
keeps them locally, so nothing it does afterwards needs the network.

## Keeping data locally

On a first visit the app downloads each data file and stores it
locally so later visits are fast.

Knowing when to download again is handled by those hashed names. At
startup the app reads a small `manifest.json` listing the current
file names, and downloads only the files whose name has changed
since last time. An unchanged name means the bytes are unchanged, so
there is nothing to fetch.

This is about speed. It does not save the user's own work; see
"How long the work lasts" below.

Used by: every feature that reads data.

## Crash data

Source: TxDOT CRIS, covering the whole H-GAC region, 2018 through
2024.

Only KAB crashes are in scope. KAB is the injury-severity shorthand
for the three most serious outcomes: K for fatal, A for suspected
serious injury, and B for suspected minor injury. The two lesser
levels, C and O, are dropped by the build pipeline and never reach
the app at all.

Each crash record carries:

- A position (latitude and longitude), accurate enough to tell which
  drawn shape it falls inside.
- One of the three KAB severity levels.
- A date inside the 2018 to 2024 window.
- A yes/no column for each emphasis area on TxDOT's official list,
  saying which categories the crash belongs to. Every crash belongs
  to at least one.
- One or more HSIP workcode tags. A workcode is TxDOT's id for a
  countermeasure, so a tag on a crash means that countermeasure
  could have addressed it. These tags are the direct link between
  crashes and the fixes worth considering, and they are worked out
  upstream by the SS4A analysis rather than by this app.

Used by: crash breakdown by emphasis area, comparing against other
areas, comparing countermeasures, crash history per site, report
export.

## City and county boundaries

Source: the city and county boundary data prepared for the SS4A
project, covering every city and county in the H-GAC region. The
list the user picks from is drawn from these.

The whole-region yardstick is simply the entire crash dataset with
no filter applied, so it needs no boundary shape of its own.

A region the user draws by hand has to come out as a closed shape
that does not cross over itself, so the app can reliably tell inside
from outside.

Used by: region selection, comparing against other areas.

## Overlay reference data

The app draws one or more background map layers so the user has
something to look at while deciding where to place sites.

What any such layer has to satisfy:

- It arrives already prepared. Any counting, scoring, or grouping
  that the coloring depends on is worked out beforehand and sits on
  the features as plain attributes. The app does not compute it
  while running.
- The attributes used for coloring and filtering are named in a
  configuration file, so adding a layer or changing how it looks is
  a configuration edit rather than a code change.
- The layer is for looking at only. It cannot be clicked or lassoed
  to create a site. Sites are drawn as lines or points; see "Site
  shapes and buffers" below.

Which layers actually ship is a data and configuration decision, not
something the app constrains. Layers can be added or dropped without
code changes.

Used by: reference overlay layers.

## Site shapes and buffers

A site has a type, a drawn shape, a buffer distance, and the wider
shape that distance produces:

- **Roadway site.** The drawn shape is a line along a stretch of
  road.
- **Intersection site.** The drawn shape is a point on an
  intersection.
- **Buffer distance.** A number stored per site, not fixed per
  type. Each type starts at a sensible default and the user can
  change it whenever they like.
- **Buffered shape.** The area you get by growing the drawn shape
  outward by the buffer distance. This does double duty: it is what
  gets drawn on the map, and it is the test for which crashes
  belong.

A crash belongs to a site exactly when it falls inside that
buffered shape, and never otherwise. Changing the buffer recomputes
the shape and the set of crashes, and everything downstream (crash
history, expected reductions, benefit and cost, the map) updates to
match.

The rule has to give the same answer every time, so that a number in
a report can be reproduced later from the same buffer value.

A site keeps its type, drawn shape, buffer, and buffered shape for
the rest of the user's work: on the list, in planning, and in the
report.

Used by: picking locations, crash history per site, comparing
countermeasures, report export.

## Countermeasure data

Source: the TxDOT HSIP countermeasure list. Each countermeasure has:

- A **workcode**, the same id that appears on crash records. This is
  what links a crash to the fixes that could have addressed it.
- A **crash reduction factor**, or CRF: the share of crashes the fix
  is expected to prevent. There is one figure per countermeasure,
  not one per severity level. Differences between severity levels
  are handled later, by pricing each level differently in the
  benefit calculation.

Each countermeasure added to a site is scored on its own. Their
effects are never added together. Keeping each one separate also
leaves room to support combined multi-fix plans later without
reworking how the data is held.

Used by: comparing countermeasures, report export.

## Crash cost by severity

Source: TxDOT's standard crash cost table, giving one dollar figure
for each of the three severity levels in scope.

These figures turn prevented crashes into money. For each
countermeasure at a site, the crashes it would prevent at each
severity level are multiplied by that level's cost and added up,
which gives the benefit figure.

Used by: comparing countermeasures, report export.

## Cost entered by the user

For each countermeasure at each site, the user enters an estimated
construction cost. That figure is the divisor in the
benefit-to-cost score.

Cost belongs to the pairing of one countermeasure with one site. The
same countermeasure at two different sites, or listed twice under
one site, can carry different costs. The app accepts whatever number
the user types and does not check it against any reference.

Used by: comparing countermeasures, report export.

## Emphasis area names

The app uses TxDOT's official emphasis area list word for word. No
renaming, no merging two categories into one, no invented
categories. Someone reading an exported report sees the same
category names that appear in their own planning documents.

Used by: crash breakdown by emphasis area, comparing against other
areas, crash history per site, report export.

## Speed

These describe how the app should feel to use, not how to build it.

- Changing the area and seeing the new crash breakdown: feels
  instant, with no visible wait. Under a second for a county-sized
  area.
- Adding, removing, or changing the comparison area: updated view
  within a second.
- Changing a countermeasure: updated crash reduction within a
  second.
- Panning, zooming, and clicking the map: stays smooth no matter how
  many crashes are in view.
- Exporting a report for a normal-sized plan (up to 20 sites, up to
  3 countermeasures each): done within a few seconds.

These assume a reasonably current laptop on ordinary broadband.

Used by: every feature that draws the map or updates a display.

## Platform

- Runs in a current desktop browser with nothing to install.
- Phones and tablets are out of scope.
- After the first download, all filtering, comparing, and
  calculating happens in the browser. No interaction requires a
  server.
- No login and no accounts.

Used by: all features.

## How long the work lasts

The user's work is held in memory for as long as the browser tab
stays open. The area choice, the comparison pick, the site list with
the crashes worked out for each site, and the countermeasures with
their entered costs all survive moving back and forth between the
two halves of the app, and all are lost when the tab is closed or
reloaded.

What this means in practice: the user builds a plan and exports its
report in one sitting. The exported report is the lasting record.

Used by: region selection, comparing against other areas, picking
locations, site list, comparing countermeasures, report export.

## Getting the numbers right

- Every number the app reports (crash counts, percentages, expected
  reductions, benefits, benefit-to-cost scores) has to be
  reproducible. The same area, the same data, and the same entered
  costs must always give the same answer.
- The exported report has to carry enough detail to trace each
  number back to what produced it: which data build was used, and
  for each countermeasure its workcode, its reduction factor, the
  crash cost figures applied, and the cost the user entered. Without
  that, the report cannot be defended in a grant review.

Used by: crash breakdown by emphasis area, comparing against other
areas, report export.
