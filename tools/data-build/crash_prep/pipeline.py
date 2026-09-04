"""
Crash data tagging pipeline.

Takes loaded CRIS DataFrames (crash, unit, person), applies EA and
HSIP tagging rules from YAML configs, adds KABCO and geometry.
Returns a tagged GeoDataFrame ready for output to PMTiles and SQLite.
"""

from __future__ import annotations

import csv
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

from .tag_engine import load_config, run_tagging


SEVERITY_SHORT_CODES = {
    4: "K",
    1: "A",
    2: "B",
    3: "C",
    5: "O",
    0: "U",
}


def load_catalog_work_codes(catalog_path: Path) -> set[str]:
    """Read work codes from countermeasures.csv."""
    codes = set()
    with open(catalog_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            wc = row.get("Work Code", "").strip()
            if wc:
                codes.add(wc)
    return codes


def validate_configs(
    hsip_config_path: Path,
    catalog_path: Path,
) -> None:
    """Check that HSIP YAML rule ids match countermeasures.csv work codes."""
    hsip_config = load_config(hsip_config_path)
    yaml_ids = {str(r["id"]) for r in hsip_config.get("rules", [])}
    catalog_ids = load_catalog_work_codes(catalog_path)

    in_yaml_not_csv = yaml_ids - catalog_ids
    in_csv_not_yaml = catalog_ids - yaml_ids

    errors = []
    if in_yaml_not_csv:
        errors.append(f"HSIP rules in YAML but not in CSV: {sorted(in_yaml_not_csv)}")
    if in_csv_not_yaml:
        errors.append(f"Work codes in CSV but not in YAML: {sorted(in_csv_not_yaml)}")

    if errors:
        for e in errors:
            print(f"  ERROR: {e}")
        raise ValueError("HSIP YAML and countermeasures CSV are out of sync.")

    print(f"  HSIP YAML and CSV match ({len(yaml_ids)} work codes)")


def compute_kabco(crash_df: pd.DataFrame) -> pd.Series:
    """Compute KABCO short code from Crash_Sev_ID."""
    sev = pd.to_numeric(crash_df["Crash_Sev_ID"], errors="coerce")
    return sev.map(SEVERITY_SHORT_CODES).fillna("U")


def filter_severity(
    crash_df: pd.DataFrame,
    unit_df: pd.DataFrame,
    person_df: pd.DataFrame,
    keep: set[str] | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Filter to severity codes in `keep`. Also filters unit and person tables."""
    if keep is None:
        return crash_df, unit_df, person_df

    kabco = compute_kabco(crash_df)
    mask = kabco.isin(keep)
    crash_df = crash_df[mask].copy()
    crash_ids = set(crash_df["Crash_ID"])
    unit_df = unit_df[unit_df["Crash_ID"].isin(crash_ids)].copy()
    person_df = person_df[person_df["Crash_ID"].isin(crash_ids)].copy()

    print(f"  Severity filter: {sorted(keep)} -> {len(crash_df):,} crashes retained")
    return crash_df, unit_df, person_df


def add_geometry(crash_df: pd.DataFrame) -> gpd.GeoDataFrame:
    """Convert crash DataFrame to GeoDataFrame with point geometry."""
    lon = pd.to_numeric(crash_df["Longitude"], errors="coerce")
    lat = pd.to_numeric(crash_df["Latitude"], errors="coerce")

    geometry = [
        Point(x, y) if pd.notna(x) and pd.notna(y) else None
        for x, y in zip(lon, lat)
    ]

    gdf = gpd.GeoDataFrame(crash_df, geometry=geometry, crs="EPSG:4326")

    null_geom = gdf.geometry.isna().sum()
    if null_geom:
        print(f"  WARNING: {null_geom} crashes with null geometry (dropped)")
        gdf = gdf.dropna(subset=["geometry"])

    return gdf


def tag_crashes(
    crash_df: pd.DataFrame,
    unit_df: pd.DataFrame,
    person_df: pd.DataFrame,
    config_dir: Path,
) -> gpd.GeoDataFrame:
    """Tag crashes with EA and HSIP flags, add KABCO and geometry.

    Args:
        crash_df: Crash-level DataFrame (already severity-filtered).
        unit_df: Unit-level DataFrame (filtered to same crash IDs).
        person_df: Merged person DataFrame (filtered to same crash IDs).
        config_dir: Folder containing ea_rules.yaml, hsip_rules.yaml.

    Returns:
        GeoDataFrame with base columns, kabco, EA flags, HSIP flags, and geometry.
    """
    ea_config = config_dir / "ea_rules.yaml"
    hsip_config = config_dir / "hsip_rules.yaml"

    tables = {"crash": crash_df, "unit": unit_df, "person": person_df}

    print("  Tagging emphasis areas...")
    ea_flags = run_tagging(ea_config, tables, prefix="EA_")

    print("  Tagging HSIP work codes...")
    hsip_flags = run_tagging(hsip_config, tables, prefix="HSIP_")

    kabco = compute_kabco(crash_df)

    output_cols = ["Crash_ID", "Crash_Date", "Cnty_ID", "City_ID",
                   "Latitude", "Longitude"]
    base = crash_df[output_cols].copy().reset_index(drop=True)
    base["Crash_Date"] = pd.to_datetime(base["Crash_Date"]).dt.strftime("%Y-%m-%d")
    base["kabco"] = kabco.values

    ea_only = ea_flags.drop(columns=["Crash_ID"])
    hsip_only = hsip_flags.drop(columns=["Crash_ID"])
    output = pd.concat([base.reset_index(drop=True),
                        ea_only.reset_index(drop=True),
                        hsip_only.reset_index(drop=True)], axis=1)

    print("  Adding geometry...")
    gdf = add_geometry(output)

    return gdf
