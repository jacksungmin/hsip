"""Data build pipeline orchestrator.

Reads build-config.yaml, ingests data from configured sources,
produces PMTiles, SQLite .db, and jurisdiction JSON.

Usage:
    python build.py [--config build-config.yaml] [--only crashes,roads,jurisdictions]
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from time import perf_counter

from config import load_build_config, derive_ea_ids, derive_hsip_fields
from ingest import crashes as crash_ingest
from ingest import overlay as overlay_ingest
from ingest import jurisdictions as jurisdiction_ingest
from output.pmtiles import build_pmtiles
from output.publish import (
    CORE_ARTIFACTS,
    CORE_LAYER_ARTIFACTS,
    DB_ARTIFACT,
    checkout_db,
    overlay_stable_path,
    publish,
    stable_path,
)
from output.sqlite import build_crash_table


def resolve_path(path_str: str, repo_root: Path) -> Path:
    p = Path(path_str)
    if p.is_absolute():
        return p
    return repo_root / p


# An overlay name ends up as a filename, a tippecanoe layer name, a manifest
# key, and a `source` value in config/overlays.yaml, so keep it to the subset
# all four accept, and out of the way of the built-in layers.
OVERLAY_NAME_RE = re.compile(r"^[a-z0-9_-]+$")
RESERVED_NAMES = {*CORE_ARTIFACTS, *CORE_LAYER_ARTIFACTS}


def check_overlay_names(overlay_cfgs: dict) -> None:
    for name in overlay_cfgs:
        if not OVERLAY_NAME_RE.match(name):
            raise ValueError(
                f"overlay name {name!r} must be lowercase letters, digits, "
                "hyphens, and underscores"
            )
        if name in RESERVED_NAMES:
            raise ValueError(f"overlay name {name!r} is reserved; pick another")


def build_crashes(cfg: dict, repo_root: Path, output_dir: Path, ea_ids: list[str], hsip_fields: list[str]):
    print("\n=== Crashes ===")
    id_columns = cfg.get("id_columns", {})
    config_dir = repo_root / "config" / "hsip"
    cris_root = resolve_path(cfg["cris_root"], repo_root)

    gdf = crash_ingest.ingest(cris_root, config_dir, id_columns)

    # PMTiles
    pmtiles_cfg = cfg["pmtiles"]
    pmtiles_fields = [*pmtiles_cfg["fields"], "county_id", "city_id", *ea_ids]
    build_pmtiles(
        gdf,
        pmtiles_fields,
        pmtiles_cfg["tippecanoe"],
        stable_path(output_dir, "crashTiles"),
        layer="crashes",
    )

    # SQLite .db
    build_crash_table(gdf, ea_ids, hsip_fields, stable_path(output_dir, DB_ARTIFACT))

    return gdf


def build_overlay(name: str, cfg: dict, repo_root: Path, output_dir: Path) -> dict:
    """Build one display-only overlay tileset from its build-config entry.

    Every overlay takes the same path — ingest the configured fields, tile
    them — so adding one is a config entry plus a file in input_data, with no
    code change here. Overlays never write to the .db: nothing queries them
    analytically, and a layer that needs a table is not an overlay.

    The config key is the only name involved: it is the tileset's filename,
    its internal layer name, its manifest key, and what config/overlays.yaml
    references as `source`.
    """
    print(f"\n=== Overlay: {name} ===")
    source = cfg["source"]
    fields = cfg.get("fields", [])
    id_columns = cfg.get("id_columns", {})

    if source["type"] == "gpkg":
        gdf = overlay_ingest.ingest_from_gpkg(
            resolve_path(source["path"], repo_root),
            source.get("layer"),
            id_columns,
            fields,
            label=f"{name} features",
        )
    elif source["type"] == "esri":
        gdf = overlay_ingest.ingest_from_esri(source["url"], id_columns, fields)
    else:
        raise ValueError(f"overlay '{name}': unknown source type {source['type']!r}")

    # Tagging is what puts county_id and city_id in the data, so they reach the
    # tiles exactly when the overlay asked to be tagged.
    tile_fields = [*fields, *(["county_id", "city_id"] if id_columns else [])]

    return build_pmtiles(
        gdf,
        tile_fields,
        cfg.get("tippecanoe", []),
        overlay_stable_path(output_dir, name),
        layer=name,
    )


def build_jurisdictions(cfg: dict, repo_root: Path, output_dir: Path) -> list[dict]:
    print("\n=== Jurisdictions ===")
    source = cfg["source"]
    unincorp = cfg.get("unincorporated_city_id")

    if source["type"] == "esri":
        jurisdictions = jurisdiction_ingest.ingest_from_esri(
            source["counties_url"],
            source["cities_url"],
            source["county_id_field"],
            source["city_id_field"],
            source["name_field"],
            unincorporated_city_id=unincorp,
        )
    elif source["type"] == "gpkg":
        jurisdictions = jurisdiction_ingest.ingest_from_gpkg(
            resolve_path(source["path"], repo_root),
            source.get("layer"),
            unincorporated_city_id=unincorp,
        )
    else:
        raise ValueError(f"Unknown jurisdiction source type: {source['type']}")

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"id": j["id"], "name": j["name"], "jurisdictionType": j["type"]},
                "geometry": j["geometry"],
            }
            for j in jurisdictions
        ],
    }

    out_path = stable_path(output_dir, "jurisdictions")
    with open(out_path, "w") as f:
        json.dump(geojson, f)
    size_mb = out_path.stat().st_size / 1e6
    print(f"  Wrote {len(jurisdictions)} jurisdictions to {out_path} ({size_mb:.1f} MB)")
    return jurisdictions


def crash_years(crash_gdf) -> list[int]:
    """Every distinct crash year in the ingested data, ascending.

    Published in the manifest so the app's exposure period comes from the data
    it is actually showing. Cast to plain int: numpy integers are not JSON
    serializable.
    """
    return sorted(int(y) for y in crash_gdf["crash_year"].dropna().unique())


def check_jurisdiction_coverage(crash_gdf, jurisdictions: list[dict]) -> None:
    print("\n=== Cross-check: crash IDs vs jurisdictions ===")
    county_ids = {j["id"] for j in jurisdictions if j["type"] == "county"}
    city_ids = {j["id"] for j in jurisdictions if j["type"] == "city"}

    crash_counties = set(crash_gdf["county_id"].dropna().astype(str).unique())
    crash_cities = set(crash_gdf["city_id"].dropna().astype(str).unique())

    missing_counties = crash_counties - county_ids
    missing_cities = crash_cities - city_ids

    if missing_counties:
        print(f"  WARNING: {len(missing_counties)} crash county IDs not in jurisdictions: {sorted(missing_counties)}")
    if missing_cities:
        print(f"  WARNING: {len(missing_cities)} crash city IDs not in jurisdictions: {sorted(missing_cities)}")
    if not missing_counties and not missing_cities:
        print(f"  OK: all crash county/city IDs found in jurisdictions")


def main():
    parser = argparse.ArgumentParser(description="Build data artifacts for the HSIP app")
    parser.add_argument("--config", default="build-config.yaml",
                        help="Path to build config YAML (default: build-config.yaml)")
    parser.add_argument("--only", help="Comma-separated list of layers to build; "
                                       "crashes, jurisdictions, or any overlay name in build-config")
    parser.add_argument("--publish-only", action="store_true",
                        help="Skip all builds; publish existing stable-named artifacts "
                             "(hash, rename, write manifest, prune)")
    args = parser.parse_args()

    t0 = perf_counter()

    script_dir = Path(__file__).resolve().parent
    config_path = script_dir / args.config if not Path(args.config).is_absolute() else Path(args.config)
    repo_root = script_dir.parent.parent
    hsip_config_dir = repo_root / "config" / "hsip"

    cfg = load_build_config(config_path)
    ea_ids = derive_ea_ids(hsip_config_dir)
    hsip_fields = derive_hsip_fields(hsip_config_dir)
    print(f"Flag fields: {len(ea_ids)} EA, {len(hsip_fields)} HSIP")

    output_dir = resolve_path(cfg["output_dir"], repo_root)
    output_dir.mkdir(parents=True, exist_ok=True)

    overlay_cfgs = cfg.get("overlays", {})
    check_overlay_names(overlay_cfgs)

    # The --only vocabulary is the two built-in layers plus whatever overlays
    # the config declares, so a new overlay is buildable on its own the moment
    # it is configured.
    known_layers = [*CORE_LAYER_ARTIFACTS, *overlay_cfgs]

    if args.publish_only:
        requested = set()
    elif args.only:
        requested = set(args.only.split(","))
        unknown = requested - set(known_layers)
        if unknown:
            parser.error(f"unknown layers: {sorted(unknown)} (known: {sorted(known_layers)})")
    else:
        requested = set(known_layers)

    run_layers = [l for l in known_layers if l in requested and (l in cfg or l in overlay_cfgs)]
    skipped = requested - set(run_layers)
    if skipped:
        print(f"WARNING: requested layers missing from config, skipped: {sorted(skipped)}")

    # Core artifact keys this run rebuilds. Layers listing the shared db
    # need its previous content checked out first (each layer only
    # drops and recreates its own tables).
    touched = {a for layer in run_layers for a in CORE_LAYER_ARTIFACTS.get(layer, [])}
    if DB_ARTIFACT in touched:
        checkout_db(output_dir)

    crash_gdf = None
    jurisdictions = None
    # Layer name and actual field list per overlay built this run, None for the
    # rest. Published in the manifest so the app build can check
    # config/overlays.yaml against what the tiles really contain, and so an
    # overlay dropped from this config drops out of the manifest too.
    overlays: dict[str, dict | None] = {name: None for name in overlay_cfgs}

    if "crashes" in run_layers:
        crash_gdf = build_crashes(
            cfg["crashes"], repo_root, output_dir, ea_ids, hsip_fields
        )

    for name in overlay_cfgs:
        if name in run_layers:
            overlays[name] = build_overlay(name, overlay_cfgs[name], repo_root, output_dir)

    if "jurisdictions" in run_layers:
        jurisdictions = build_jurisdictions(cfg["jurisdictions"], repo_root, output_dir)

    if crash_gdf is not None and jurisdictions is not None:
        check_jurisdiction_coverage(crash_gdf, jurisdictions)

    # None when crashes were not rebuilt, which tells publish to carry the
    # previous manifest's crash-data block forward.
    years = crash_years(crash_gdf) if crash_gdf is not None else None
    publish(output_dir, touched, overlays, years)

    elapsed = perf_counter() - t0
    print(f"\nDone in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
