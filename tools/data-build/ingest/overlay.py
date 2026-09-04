"""Overlay data ingest. Source types: GPKG, ESRI.

Every overlay declared under `overlays` in build-config comes through here:
select the configured fields, rename the id columns, reproject to 4326. It is
display-only data, so there is nothing layer-specific to do beyond that.
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd

from .common import rename_id_columns


def _select_fields(gdf: gpd.GeoDataFrame, fields: list[str], id_columns: dict) -> gpd.GeoDataFrame:
    """Keep only requested fields plus county_id, city_id, and geometry."""
    keep = list(dict.fromkeys(
        [*id_columns.keys(), *fields, "geometry"]
    ))
    available = [c for c in keep if c in gdf.columns]
    return gdf[available]


def _ensure_4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        print(f"  Reprojecting from {gdf.crs} to EPSG:4326")
        gdf = gdf.to_crs("EPSG:4326")
    return gdf


def ingest_from_gpkg(
    path: Path,
    layer: str | None,
    id_columns: dict,
    fields: list[str],
    label: str = "features",
) -> gpd.GeoDataFrame:
    kwargs = {"layer": layer} if layer else {}
    gdf = gpd.read_file(path, **kwargs)
    gdf = rename_id_columns(gdf, id_columns)
    gdf = _select_fields(gdf, fields, id_columns)
    gdf = _ensure_4326(gdf)
    print(f"  Loaded {len(gdf):,} {label} from {path}")
    return gdf


def ingest_from_esri(
    url: str,
    id_columns: dict,
    fields: list[str],
) -> gpd.GeoDataFrame:
    from .esri import fetch_all_features

    source_id_cols = list(id_columns.values())
    out_fields = list(dict.fromkeys([*source_id_cols, *fields]))
    gdf = fetch_all_features(url, out_fields=out_fields)
    gdf = rename_id_columns(gdf, id_columns)
    gdf = _select_fields(gdf, fields, id_columns)
    return gdf
