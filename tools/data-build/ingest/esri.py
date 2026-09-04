"""ESRI FeatureServer fetch helper.

Python port of src/services/remote/esri.ts. Count-first parallel page
fetch, GeoJSON response, WGS84 output.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

import geopandas as gpd
import requests


class EsriFetchError(Exception):
    """Raised when an ESRI FeatureServer request fails."""
    pass


def _check_esri_error(data: dict, context: str) -> None:
    if "error" in data:
        code = data["error"].get("code", "")
        msg = data["error"].get("message", "unknown error")
        raise EsriFetchError(f"{context}: {msg} (code {code})")


def fetch_count(layer_url: str, where: str = "1=1") -> int:
    params = {"where": where, "returnCountOnly": "true", "f": "json"}
    try:
        resp = requests.get(f"{layer_url}/query", params=params, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise EsriFetchError(f"Count query failed for {layer_url}: {e}") from e
    data = resp.json()
    _check_esri_error(data, f"Count query for {layer_url}")
    if "count" not in data:
        raise EsriFetchError(f"Count query returned no count for {layer_url}")
    return data["count"]


def fetch_page(
    layer_url: str,
    where: str,
    out_fields: list[str],
    offset: int,
    page_size: int,
) -> dict:
    params = {
        "where": where,
        "outFields": ",".join(out_fields),
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
        "resultOffset": str(offset),
        "resultRecordCount": str(page_size),
    }
    try:
        resp = requests.get(f"{layer_url}/query", params=params, timeout=60)
        resp.raise_for_status()
    except requests.RequestException as e:
        raise EsriFetchError(f"Page fetch failed at offset {offset}: {e}") from e
    data = resp.json()
    _check_esri_error(data, f"Page fetch at offset {offset}")
    return data


def fetch_all_features(
    layer_url: str,
    out_fields: list[str] | None = None,
    where: str = "1=1",
    page_size: int = 2000,
) -> gpd.GeoDataFrame:
    """Fetch all features from an ESRI FeatureServer layer.

    Returns a GeoDataFrame in EPSG:4326. Raises EsriFetchError on
    network or ESRI API errors.
    """
    if out_fields is None:
        out_fields = ["*"]

    total = fetch_count(layer_url, where)
    if total == 0:
        return gpd.GeoDataFrame()

    print(f"  Fetching {total:,} features from {layer_url}")
    offsets = list(range(0, total, page_size))
    all_features: list[dict] = []

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {
            pool.submit(fetch_page, layer_url, where, out_fields, off, page_size): off
            for off in offsets
        }
        for i, future in enumerate(as_completed(futures), 1):
            page = future.result()
            all_features.extend(page.get("features", []))
            print(f"    Page {i}/{len(offsets)} ({len(all_features):,} features)")

    geojson = {"type": "FeatureCollection", "features": all_features}
    gdf = gpd.GeoDataFrame.from_features(geojson, crs="EPSG:4326")
    print(f"  Fetched {len(gdf):,} features")
    return gdf
