# Data Build

Builds the static data files that the HSIP app loads at runtime.
Takes raw source data (CRIS crash exports, road and boundary
GeoPackages) and produces five artifacts in `public/`:

- `crashes_kab-<hash>.pmtiles` -- crash points for the map
- `roads-<hash>.pmtiles` -- road segments for the map
- `hin-<hash>.pmtiles` -- High Injury Network segments for the map
- `app-<hash>.db` -- SQLite database for analytical queries (crash
  breakdowns, site analysis, countermeasure matching)
- `jurisdictions-<hash>.geojson` -- county/city boundaries for the
  region picker and client-side spatial lookup (full source-detail
  geometry, without pipeline simplification)

plus `manifest.json`, which lists the current filenames. Artifacts
are named by content hash; the app reads the manifest at boot to
find them, and re-downloads only files whose names changed. You
never edit the manifest by hand -- the build writes it.

The roads and HIN tilesets are *overlays*: display-only reference
layers declared under `overlays` in `build-config.yaml`, one entry
per tileset. They take a generic path through the build, so adding
another is three edits and no code -- drop the data in
`input_data/`, add an entry under `overlays`, add a layer to
`config/overlays.yaml`. Overlays never write to the .db; a layer
that needs analytical queries is not an overlay and gets its own
top-level config section, as `crashes` does.

One name covers each overlay end to end. The `overlays` key in
`build-config.yaml` becomes the published filename, the layer name
inside the tiles, the manifest key, and the `source` value that
`config/overlays.yaml` references.

Most of the time you only need to update crash data. Roads and
jurisdictions change rarely.

The jurisdiction artifact is roughly 8 MB. Keeping its full source
geometry lets the app use the same downloaded boundaries for accurate
site-to-city/county lookup. It remains a separate static artifact so it
is cached independently from the application bundle. The ingest step
normalizes invalid source ring topology for spatial use, but does not
simplify the boundary coordinates.

## Prerequisites

- Python 3.10+
- [tippecanoe](https://github.com/felt/tippecanoe) (builds PMTiles
  from GeoJSON). Install via package manager or build from source.
- **Windows:** tippecanoe requires a Linux environment. Install
  [WSL](https://learn.microsoft.com/en-us/windows/wsl/install)
  (`wsl --install` from an admin terminal), then install tippecanoe
  inside WSL (`sudo apt install tippecanoe`). Run the pipeline
  from the WSL terminal.

## Setup (one time)

```
cd tools/data-build
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Updating crash data

1. Download CRIS public extract CSVs from TxDOT. Each year is a
   separate export containing crash, unit, person, and primaryperson
   files. Place each year's folder under `input_data/cris_export/`:

   ```
   input_data/cris_export/
     20180101-20181231_HGAC/
       extract_..._crash_....csv
       extract_..._unit_....csv
       extract_..._person_....csv
       extract_..._primaryperson_....csv
     20190101-20191231_HGAC/
       ...
     20240101-20241231_HGAC/
       ...
   ```

   Folder names don't matter. The pipeline discovers CSV files by
   naming pattern (`_crash_`, `_unit_`, `_person_`, `_primaryperson_`).

2. Run the build (from the `tools/data-build/` directory):

   ```
   source venv/bin/activate
   python build.py --only crashes
   ```

   This processes each year independently: loads the CSVs, filters
   to KAB severity (fatal + serious injury + minor injury), tags
   emphasis areas and HSIP work codes, then writes both the PMTiles
   and the SQLite table.

3. The updated files appear in `public/` under new content-hashed
   names, superseded files are removed, and `manifest.json` is
   updated to match. Commit all of it together to deploy.

## Full rebuild (all layers)

```
python build.py
```

This builds crashes, jurisdictions, and every configured overlay into
target formats that will be served from the web application. 

The source data for building is read from `input_data/`. 

**Check `input_data/` first.** It is gitignored, so the source data
does not travel with the repository -- it is handed over separately
and has to be unpacked into `input_data/` before any full rebuild.
A full rebuild needs all four inputs present:

- `input_data/cris_export/` -- one folder of CRIS CSVs per year
- `input_data/hgac_roads.gpkg`
- `input_data/HGAC HIN.gpkg`
- `input_data/jurisdictions.gpkg`

Make sure what you unpack is the complete set, not a partial copy: a
missing or truncated input fails partway through and discards the
whole run, and a build that succeeds on short input publishes short
data with no complaint. `input_data/README.md` lists what each file
is.

To rebuild only specific layers -- `crashes`, `jurisdictions`, or
any overlay name in `build-config.yaml`:

```
python build.py --only crashes,roads
python build.py --only hin
python build.py --only jurisdictions
```

A partial rebuild keeps the manifest entries of untouched layers.

Retiring an overlay is one deletion: remove its entry from
`build-config.yaml` and the next build of any kind (`--only` runs
included) drops it from the manifest and prunes its tileset.
Remove its layers from `config/overlays.yaml` in the same breath,
or the app build will fail on a `source` nothing publishes -- which
is the intended order of failure, not a bug. Re-adding the entry
and rebuilding brings it back.

## How publishing works

Each build runs layers under stable working names (`app.db`,
`crashes_kab.pmtiles`, ...), then a publish step hashes each
touched file, renames it to `<name>-<hash8><ext>`, rewrites
`manifest.json`, and prunes superseded hashed files. The hashed
files in `public/` are the only persistent copies; the stable names
exist only while a build runs and are gitignored. Only the crashes
layer writes `app.db`, and because it rebuilds just its own tables,
a run touching it first copies the current published db back to the
working name. Overlays produce PMTiles only.

The manifest's `buildId` is derived from the artifact hashes, so it
identifies the exact data set a user sees (usable as provenance in
exported reports). Each `overlays` entry records its tileset's
internal layer name and the fields that reached the tiles; the app
build reads that to check `config/overlays.yaml` against what the
data actually contains, so a mistyped `source` or column fails the
build instead of shipping a map layer that draws nothing.

If a run dies partway, the published set in `public/` is untouched
and coherent; rerun the build. To re-publish existing stable-named
files without rebuilding anything (one-time migration, manual
artifact surgery):

```
python build.py --publish-only
```

## Severity filter

Only KAB crashes are included by default. To change this, edit
`SEVERITY_KEEP` in `ingest/crashes.py`:

```python
SEVERITY_KEEP = {"K", "A", "B"}          # KAB only (default)
SEVERITY_KEEP = {"K", "A", "B", "C"}     # KABC
SEVERITY_KEEP = None                      # all severities
```

## Tagging rules

EA and HSIP tagging rules live in `config/hsip/` at the repo root
(not inside this tool). Both the build pipeline and the app read
from the same config files.

| File | Purpose |
|------|---------|
| `ea_rules.yaml` | Emphasis area tagging (14 rules) |
| `hsip_rules.yaml` | HSIP work code tagging (88 rules) |
| `countermeasures.csv` | Countermeasure catalog (work codes, reduction factors, costs) |

The build validates that HSIP rule IDs in the YAML match work
codes in the CSV before processing. A mismatch produces an error.

### Rule format

Both EA and HSIP configs use the same YAML schema:

```yaml
rules:
  - id: 101
    label: Install Warning Signs
    paths:
      - table: crash             # crash, unit, or person
        aggregate: any           # any or any_nullable
        condition:
          field: FHE_Collsn_ID
          in: [20, 21, 22, 30]
    combine: or                  # how multiple paths merge
```

Condition operators: `in` (value in list), `range` (inclusive
min/max), `not_in`. Logic: `and`, `or`. Paths can nest in `group`
blocks with their own `combine`.
