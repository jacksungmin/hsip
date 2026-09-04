"""Shared utilities for ingest modules."""

from __future__ import annotations

import geopandas as gpd


def rename_id_columns(gdf: gpd.GeoDataFrame, id_columns: dict) -> gpd.GeoDataFrame:
    """Rename source ID columns to canonical names (county_id, city_id)."""
    rename = {}
    for target, source in id_columns.items():
        if source in gdf.columns and source != target:
            rename[source] = target
    if rename:
        gdf = gdf.rename(columns=rename)
    return gdf
