Source data for the build pipeline. Contents are gitignored, so this
directory arrives empty on clone -- the data is handed over separately
and unpacked here before a build.

Paths are referenced from `tools/data-build/build-config.yaml`.

A full rebuild needs all four:

- `cris_export/` -- CRIS public extract, one folder of CSVs per year
  (crash, unit, person, primaryperson)
- `hgac_roads.gpkg` -- HGAC roadway inventory from the SS4A pipeline
- `HGAC HIN.gpkg` -- High Injury Network segments
- `jurisdictions.gpkg` -- county and city boundaries, one layer with a
  `type` column of "county"/"city", plus `name`, `cnty_id`, `city_id`

Every source is a local file; the build needs no network access.
