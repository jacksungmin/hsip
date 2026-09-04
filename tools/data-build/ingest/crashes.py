"""Crash data ingest. Per-year loading with early severity filter.

Discovers year folders under the CRIS root, processes each year
independently (load, severity-filter, tag), and concatenates
into a single GeoDataFrame. Peak memory is one year's data, not all.
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pandas as pd

from crash_prep.cris_loader import load_cris_data
from crash_prep.pipeline import (
    filter_severity,
    tag_crashes,
    validate_configs,
)
from .common import rename_id_columns


SEVERITY_KEEP = {"K", "A", "B"}


def _add_crash_year(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if "Crash_Date" not in gdf.columns:
        return gdf
    date_str = gdf["Crash_Date"].astype(str)
    if date_str.iloc[0].count("/") == 2:
        gdf["crash_year"] = pd.to_numeric(date_str.str.split("/").str[2], errors="coerce")
    else:
        gdf["crash_year"] = pd.to_numeric(date_str.str[:4], errors="coerce")
    gdf["crash_year"] = gdf["crash_year"].astype("Int64")
    return gdf


def _discover_year_folders(cris_root: Path) -> list[Path]:
    """Find subdirectories under cris_root that contain CRIS extracts."""
    folders = sorted(
        d for d in cris_root.iterdir()
        if d.is_dir() and any(d.glob("*.csv"))
    )
    if not folders:
        raise FileNotFoundError(
            f"No year folders with CSVs found under {cris_root}"
        )
    return folders


def ingest(
    cris_root: Path,
    config_dir: Path,
    id_columns: dict,
) -> gpd.GeoDataFrame:
    """Load, filter, tag crash data per year. Return combined GeoDataFrame."""
    if not cris_root.exists():
        raise FileNotFoundError(
            f"CRIS data root not found: {cris_root}\n"
            f"Place CRIS CSV exports in {cris_root} or update cris_root in build-config.yaml."
        )

    hsip_config = config_dir / "hsip_rules.yaml"
    catalog = config_dir / "countermeasures.csv"

    print("Validating configs...")
    validate_configs(hsip_config, catalog)

    year_folders = _discover_year_folders(cris_root)
    print(f"Found {len(year_folders)} year folder(s)")

    year_gdfs: list[gpd.GeoDataFrame] = []

    for folder in year_folders:
        print(f"\n--- {folder.name} ---")
        crash_df, unit_df, person_df = load_cris_data(folder)

        crash_df, unit_df, person_df = filter_severity(
            crash_df, unit_df, person_df, keep=SEVERITY_KEEP,
        )

        if crash_df.empty:
            print(f"  No KAB crashes, skipping")
            continue

        gdf = tag_crashes(crash_df, unit_df, person_df, config_dir)
        year_gdfs.append(gdf)
        print(f"  Tagged {len(gdf):,} crashes")

    if not year_gdfs:
        raise ValueError("No crash data produced from any year folder")

    combined = pd.concat(year_gdfs, ignore_index=True)
    combined = gpd.GeoDataFrame(combined, geometry="geometry", crs="EPSG:4326")

    combined = rename_id_columns(combined, id_columns)
    combined = _add_crash_year(combined)

    print(f"\nTotal: {len(combined):,} tagged crashes across {len(year_gdfs)} year(s)")
    return combined
