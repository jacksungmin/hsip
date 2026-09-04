"""Jurisdiction boundary ingest. Source types: ESRI, GPKG."""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
from shapely import make_valid, unary_union
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.geometry.base import BaseGeometry


def _polygonal_parts(geometry: BaseGeometry) -> list[Polygon]:
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    if hasattr(geometry, "geoms"):
        return [
            part
            for child in geometry.geoms
            for part in _polygonal_parts(child)
        ]
    return []


def _normalize_polygonal_geometry(geometry: BaseGeometry, name: str) -> BaseGeometry:
    """Repair invalid source topology without simplifying coordinates.

    Multipart city boundaries can contain overlapping polygon members,
    while a few single polygons contain self-intersections. The app uses
    these boundaries for spatial lookup, so dissolve multipart overlaps
    and make invalid component rings valid before publishing.
    """
    if geometry.is_empty:
        raise ValueError(f"Jurisdiction {name!r} has empty geometry")
    if geometry.is_valid:
        return geometry

    source_parts = _polygonal_parts(geometry)
    repaired_parts = [
        part if part.is_valid else make_valid(part)
        for part in source_parts
    ]
    polygonal_parts = [
        part
        for repaired in repaired_parts
        for part in _polygonal_parts(repaired)
    ]
    normalized = unary_union(polygonal_parts)

    if not isinstance(normalized, (Polygon, MultiPolygon)):
        raise ValueError(
            f"Jurisdiction {name!r} repair produced {normalized.geom_type}, "
            "expected Polygon or MultiPolygon"
        )
    if not normalized.is_valid:
        raise ValueError(f"Jurisdiction {name!r} remains invalid after repair")
    return normalized


def _gdf_to_jurisdiction_list(
    gdf: gpd.GeoDataFrame,
    id_field: str,
    name_field: str,
    jtype: str,
    unincorporated_city_id: int | None = None,
) -> list[dict]:
    results = []
    normalized_names = []
    for _, row in gdf.iterrows():
        raw_id = row[id_field]
        if unincorporated_city_id is not None and int(raw_id) == unincorporated_city_id:
            continue
        geometry = row.geometry
        if not geometry.is_valid:
            normalized_names.append(row[name_field])
            geometry = _normalize_polygonal_geometry(geometry, row[name_field])
        results.append({
            "id": str(int(raw_id)),
            "name": row[name_field],
            "type": jtype,
            "geometry": mapping(geometry),
        })
    results.sort(key=lambda j: j["name"])
    if normalized_names:
        print(
            f"  Normalized invalid topology for {len(normalized_names)} "
            f"{jtype} geometries"
        )
    return results


def ingest_from_esri(
    counties_url: str,
    cities_url: str,
    county_id_field: str,
    city_id_field: str,
    name_field: str,
    unincorporated_city_id: int | None = None,
) -> list[dict]:
    from .esri import fetch_all_features

    print("Loading counties...")
    counties_gdf = fetch_all_features(counties_url, out_fields=[name_field, county_id_field])
    print("Loading cities...")
    cities_gdf = fetch_all_features(cities_url, out_fields=[name_field, city_id_field])

    counties = _gdf_to_jurisdiction_list(counties_gdf, county_id_field, name_field, "county")
    cities = _gdf_to_jurisdiction_list(
        cities_gdf, city_id_field, name_field, "city",
        unincorporated_city_id=unincorporated_city_id,
    )

    print(f"  {len(counties)} counties, {len(cities)} cities")
    return [*counties, *cities]


def ingest_from_gpkg(
    path: Path,
    layer: str | None = None,
    county_id_field: str = "cnty_id",
    city_id_field: str = "city_id",
    name_field: str = "name",
    type_field: str = "type",
    unincorporated_city_id: int | None = None,
) -> list[dict]:
    kwargs = {"layer": layer} if layer else {}
    gdf = gpd.read_file(path, **kwargs)

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")

    counties = gdf[gdf[type_field] == "county"]
    cities = gdf[gdf[type_field] == "city"]

    id_field_map = {"county": county_id_field, "city": city_id_field}

    result = []
    for jtype, subset in [("county", counties), ("city", cities)]:
        result.extend(_gdf_to_jurisdiction_list(
            subset, id_field_map[jtype], name_field, jtype,
            unincorporated_city_id=unincorporated_city_id if jtype == "city" else None,
        ))
    return result
